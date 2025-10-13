import NodeCache from 'node-cache';
import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

/**
 * Response cache for GET requests
 * Dramatically improves performance for frequently accessed, rarely changing data
 */
class ResponseCache {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 60, // Default 60 seconds
      checkperiod: 120, // Check for expired entries every 2 minutes
      useClones: false, // Better performance
    });
  }

  /**
   * Generate cache key from request
   */
  private generateCacheKey(request: FastifyRequest): string {
    const url = request.raw.url || '';
    const userId = (request.user as any)?.id || 'anonymous';
    return crypto.createHash('md5').update(`${userId}:${url}`).digest('hex');
  }

  /**
   * Create a caching middleware for specific routes
   */
  public createCacheMiddleware(ttl: number = 60) {
    const cache = this.cache;
    
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Only cache GET requests
      if (request.raw.method !== 'GET') {
        return;
      }

      const url = request.raw.url || '';
      const userId = (request.user as any)?.id || 'anonymous';
      const cacheKey = crypto.createHash('md5').update(`${userId}:${url}`).digest('hex');
      
      const cached = cache.get(cacheKey);

      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(cached);
      }

      // Mark as cache miss and store for onSend hook
      reply.header('X-Cache', 'MISS');
      (reply as any)._cacheKey = cacheKey;
      (reply as any)._cacheTTL = ttl;
      (reply as any)._shouldCache = true;
    };
  }

  /**
   * Create onSend hook to cache responses
   */
  public createCacheOnSendHook() {
    const cache = this.cache;
    
    return async (request: FastifyRequest, reply: FastifyReply, payload: any) => {
      if ((reply as any)._shouldCache && reply.raw.statusCode === 200 && payload) {
        const cacheKey = (reply as any)._cacheKey;
        const ttl = (reply as any)._cacheTTL || 60;
        cache.set(cacheKey, payload, ttl);
      }
      return payload;
    };
  }

  /**
   * Invalidate cache for a specific pattern
   */
  public invalidate(pattern: string) {
    const keys = this.cache.keys();
    const invalidated = keys.filter(key => key.includes(pattern));
    invalidated.forEach(key => this.cache.del(key));
    return invalidated.length;
  }

  /**
   * Clear all cache
   */
  public clear() {
    this.cache.flushAll();
  }

  /**
   * Get cache statistics
   */
  public getStats() {
    return this.cache.getStats();
  }

  /**
   * Check if a key exists in cache
   */
  public has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get a value from cache
   */
  public get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  /**
   * Set a value in cache
   */
  public set<T>(key: string, value: T, ttl?: number): boolean {
    return this.cache.set(key, value, ttl || 60);
  }
}

export const responseCache = new ResponseCache();

/**
 * Decorator for caching specific routes
 * Usage: Add to route options: { preHandler: cacheResponse(30) }
 */
export const cacheResponse = (ttl: number = 60) => {
  return responseCache.createCacheMiddleware(ttl);
};

/**
 * Global onSend hook for caching
 * Must be registered in the main app
 */
export const cacheOnSendHook = responseCache.createCacheOnSendHook();
