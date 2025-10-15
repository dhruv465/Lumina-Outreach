import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import NodeCache from 'node-cache';
import { logger } from '../index';

// JWT token cache - 5 minute TTL, check for expired tokens every minute
// This dramatically reduces JWT verification overhead (crypto operations)
const tokenCache = new NodeCache({ 
  stdTTL: 300, // 5 minutes
  checkperiod: 60, // Check for expired entries every 60 seconds
  useClones: false // Better performance, we don't mutate the cached objects
});

export const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    // Get token from header
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(`No auth header for ${request.raw.method} ${request.raw.url}`, { authHeader });
      return reply.status(401).send({ message: 'No token, authorization denied' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Check if token is empty or malformed
    if (!token || token === 'undefined' || token === 'null') {
      logger.warn(`Invalid token for ${request.raw.method} ${request.raw.url}`, { token: token?.substring(0, 10) + '...' });
      return reply.status(401).send({ message: 'Token is invalid or malformed' });
    }
    
    // Check cache first - avoids expensive JWT verification
    const cached = tokenCache.get<any>(token);
    if (cached) {
      request.user = cached;
      return;
    }
    
    // Verify token (only if not cached)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    
    // Cache the decoded token for future requests
    tokenCache.set(token, decoded);
    
    // Add user from payload
    request.user = decoded as any;
  } catch (error) {
    logger.error(`Authentication error for ${request.raw.method} ${request.raw.url}:`, {
      error: error.message,
      tokenStart: request.headers.authorization?.substring(0, 20) + '...'
    });
    return reply.status(401).send({ message: 'Token is not valid' });
  }
};

// Export cache stats for monitoring
export const getAuthCacheStats = () => tokenCache.getStats();