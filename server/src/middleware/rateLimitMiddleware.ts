/**
 * Rate Limiting Middleware
 * 
 * This middleware provides rate limiting for API endpoints to prevent abuse.
 * It uses a token bucket algorithm to limit requests based on IP address or user ID.
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import logger from '../utils/logger';

// Define the rate limiter response interface
interface RateLimiterResponse {
  msBeforeNext: number;
  remainingPoints: number;
  consumedPoints: number;
  isFirstInDuration: boolean;
}

// Rate limiter configurations
const apiLimiter = new RateLimiterMemory({
  points: 100,              // Number of points
  duration: 60,             // Per 60 seconds
  blockDuration: 60 * 2     // Block for 2 minutes if exceeded
});

// Web call limiter removed

const authLimiter = new RateLimiterMemory({
  points: 5,                // Number of points
  duration: 60,             // Per 60 seconds
  blockDuration: 60 * 15    // Block for 15 minutes if exceeded
});

/**
 * Get client identifier (IP address or user ID)
 * @param req Express request
 * @returns Client identifier
 */
const getClientIdentifier = (req: Request): string => {
  // Use user ID if authenticated
  if ((req as any).user?._id) {
    return `user_${(req as any).user._id}`;
  }
  
  // Use IP address as fallback
  const ip = req.ip || 
    req.connection.remoteAddress || 
    req.headers['x-forwarded-for'] || 
    'unknown';
  
  return `ip_${ip}`;
};

/**
 * Rate limiting middleware factory
 * @param limiter Rate limiter instance
 * @param pointsToConsume Points to consume per request
 * @returns Express middleware
 */
const createRateLimitMiddleware = (
  limiter: RateLimiterMemory,
  pointsToConsume: number = 1
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientId = getClientIdentifier(req);
    
    try {
      await limiter.consume(clientId, pointsToConsume);
      next();
    } catch (error) {
      if (error instanceof Error) {
        // Handle unexpected errors
        logger.error(`Rate limiter error: ${error.message}`);
        next(error);
      } else {
        // Handle rate limit exceeded
        const rateLimiterRes = error as RateLimiterResponse;
        
        logger.warn(`Rate limit exceeded for ${clientId}, path: ${req.path}`);
        
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.round(rateLimiterRes.msBeforeNext / 1000) || 1,
          message: 'Please try again later'
        });
      }
    }
  };
};

/**
 * Standard API rate limiting middleware
 */
export const apiRateLimit = createRateLimitMiddleware(apiLimiter);

// Web call rate limiting removed

/**
 * Authentication rate limiting middleware (very strict limits)
 */
export const authRateLimit = createRateLimitMiddleware(authLimiter);

/**
 * Custom rate limiting middleware with configurable points
 * @param points Points to consume per request
 * @returns Express middleware
 */
export const customRateLimit = (points: number) => createRateLimitMiddleware(apiLimiter, points);

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
    logger.error(`Failed to reset rate limit for ${clientId}: ${error.message}`);
    return false;
  }
};