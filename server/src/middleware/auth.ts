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
      logger.warn(`No auth header for ${request.raw.method} ${request.raw.url}`);
      return reply.status(401).send({ message: 'No token, authorization denied' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Check if token is empty or malformed
    if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
      logger.warn(`Invalid token for ${request.raw.method} ${request.raw.url}`);
      return reply.status(401).send({ message: 'Token is invalid or malformed' });
    }
    
    // Check cache first - avoids expensive JWT verification
    const cached = tokenCache.get<any>(token);
    if (cached) {
      request.user = cached;
      return;
    }
    
    // Verify token (only if not cached)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret') as any;

    // Check JWT version
    const User = require('../models/User').default;
    const user = await User.findById(decoded.id);

    if (!user) {
      logger.warn(`User not found for token: ${decoded.id}`);
      return reply.status(401).send({ message: 'User not found' });
    }

    if (user.jwtVersion !== decoded.jwtVersion) {
      logger.warn(`JWT version mismatch for user ${user.email}: expected ${user.jwtVersion}, got ${decoded.jwtVersion}`);
      return reply.status(401).send({ message: 'Token version mismatch' });
    }
    
    // Cache the user object for future requests
    const userObj = user.toObject();
    tokenCache.set(token, userObj);
    
    // Add user from payload
    request.user = userObj;
  } catch (error: any) {
    // Provide more specific error messages
    if (error.name === 'TokenExpiredError') {
      logger.warn(`Token expired for ${request.raw.method} ${request.raw.url}`);
      return reply.status(401).send({ message: 'Token has expired' });
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn(`Invalid JWT for ${request.raw.method} ${request.raw.url}: ${error.message}`);
      return reply.status(401).send({ message: 'Invalid token format' });
    } else {
      logger.error(`Authentication error for ${request.raw.method} ${request.raw.url}:`, {
        error: error.message,
        name: error.name
      });
      return reply.status(401).send({ message: 'Authentication failed' });
    }
  }
};

// Export cache stats for monitoring
export const getAuthCacheStats = () => tokenCache.getStats();

/**
 * Middleware to check for admin role
 */
export const isAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  const user = request.user as any;
  if (!user || user.role !== 'admin') {
    logger.warn(`Unauthorized access attempt to admin resource by user: ${user?.email || 'unknown'}`);
    return reply.status(403).send({ message: 'Access denied: Admin role required' });
  }
};

/**
 * Middleware to check for manager or admin role
 */
export const isManager = async (request: FastifyRequest, reply: FastifyReply) => {
  const user = request.user as any;
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    logger.warn(`Unauthorized access attempt to manager resource by user: ${user?.email || 'unknown'}`);
    return reply.status(403).send({ message: 'Access denied: Manager or Admin role required' });
  }
};