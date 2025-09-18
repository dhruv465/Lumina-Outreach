/**
 * Rate Limiting Middleware
 * 
 * This middleware provides rate limiting for API endpoints to prevent abuse.
 * It uses a token bucket algorithm to limit requests based on IP address or user ID.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import logger, { getErrorMessage } from '../utils/logger';

// Define the rate limiter response interface
interface RateLimiterResponse {
  msBeforeNext: number;
  remainingPoints: number;
  consumedPoints: number;
  isFirstInDuration: boolean;
}

// Rate limiter configurations
const apiLimiter = new RateLimiterMemory({
  points: process.env.NODE_ENV === 'development' ? 1000 : 100, // Significantly more points in development
  duration: 60,             // Per 60 seconds
  blockDuration: process.env.NODE_ENV === 'development' ? 10 : 60 * 2 // Much shorter block time in development
});

const authLimiter = new RateLimiterMemory({
  points: process.env.NODE_ENV === 'development' ? 50 : 5, // 10x more points in development
  duration: 60,             // Per 60 seconds
  blockDuration: process.env.NODE_ENV === 'development' ? 30 : 60 * 15 // Much shorter block time in development
});

/**
 * Get client identifier (IP address or user ID)
 * @param req Fastify request
 * @returns Client identifier
 */
const getClientIdentifier = (req: FastifyRequest): string => {
  // Use user ID if authenticated
  if ((req as any).user?._id) {
    return `user_${(req as any).user._id}`;
  }
  
  // Use IP address as fallback
  const ip = req.ip || 
    req.headers['x-forwarded-for']?.toString() || 
    'unknown';
  
  return `ip_${ip}`;
};

/**
 * Rate limiting pre-handler hook factory
 * @param limiter Rate limiter instance
 * @param pointsToConsume Points to consume per request
 * @returns Fastify pre-handler hook
 */
const createRateLimitHook = (
  limiter: RateLimiterMemory,
  pointsToConsume: number = 1
) => {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const clientId = getClientIdentifier(req);
    
    try {
      await limiter.consume(clientId, pointsToConsume);
    } catch (error) {
      if (error instanceof Error) {
        // Handle unexpected errors
        logger.error(`Rate limiter error: ${error.message}`);
        throw error; // Re-throw to let Fastify's error handler catch it
      } else {
        // Handle rate limit exceeded
        const rateLimiterRes = error as RateLimiterResponse;
        
        logger.warn(`Rate limit exceeded for ${clientId}, path: ${req.raw.url}`);
        
        reply.status(429).send({
          error: 'Too many requests',
          retryAfter: Math.round(rateLimiterRes.msBeforeNext / 1000) || 1,
          message: 'Please try again later'
        });
        throw new Error('Rate limit exceeded'); // Throw to stop further processing
      }
    }
  };
};

/**
 * Standard API rate limiting pre-handler hook
 */
export const apiRateLimit = createRateLimitHook(apiLimiter);

/**
 * Authentication rate limiting pre-handler hook (very strict limits)
 */
export const authRateLimit = createRateLimitHook(authLimiter);

/**
 * Custom rate limiting pre-handler hook with configurable points
 * @param points Points to consume per request
 * @returns Fastify pre-handler hook
 */
export const customRateLimit = (points: number) => createRateLimitHook(apiLimiter, points);

/**
 * Reset rate limit for a client
 * @param clientId Client identifier
 * @param limiterType Limiter type ('api', 'auth')
 */
export const resetRateLimit = async (
  clientId: string,
  limiterType: 'api' | 'auth' = 'api'
): Promise<boolean> => {
  try {
    let limiter: RateLimiterMemory;
    
    switch (limiterType) {
      case 'auth':
        limiter = authLimiter;
        break;
      case 'api':
      default:
        limiter = apiLimiter;
        break;
    }
    
    await limiter.delete(clientId);
    return true;
  } catch (error) {
    logger.error(`Failed to reset rate limit for ${clientId}: ${getErrorMessage(error)}`);
    return false;
  }
};