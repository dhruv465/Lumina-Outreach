/**
 * Rate Limiting Middleware
 * 
 * This middleware implements rate limiting for API requests,
 * preventing abuse and ensuring fair usage of the system.
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger, getErrorMessage } from '../index';

// Define interface for extended request
interface RateLimitedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

// Different rate limits for different user roles
const limiterOptions = {
  default: {
    points: 60, // Number of points
    duration: 60, // Per X seconds
    keyPrefix: 'rl_default'
  },
  admin: {
    points: 200,
    duration: 60,
    keyPrefix: 'rl_admin'
  },
  premium: {
    points: 120,
    duration: 60,
    keyPrefix: 'rl_premium'
  }
};

// Create rate limiters
const limiters = {
  default: new RateLimiterMemory(limiterOptions.default),
  admin: new RateLimiterMemory(limiterOptions.admin),
  premium: new RateLimiterMemory(limiterOptions.premium)
};

/**
 * Rate limiting middleware
 */
export const rateLimiter = async (
  req: RateLimitedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Determine which limiter to use based on user role
    const userRole = req.user?.role || 'default';
    const limiter = limiters[userRole as keyof typeof limiters] || limiters.default;
    
    // Use IP for non-authenticated requests, user ID for authenticated
    const key = req.user?.id || req.ip || 'unknown';
    
    try {
      // Check rate limit
      await limiter.consume(key);
      next();
    } catch (rateLimitError) {
      // Rate limit exceeded
      const retryAfter = Math.floor((rateLimitError as any).msBeforeNext / 1000) || 60;
      
      logger.warn(`Rate limit exceeded for ${key} (${userRole})`);
      
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: 'Too many requests, please try again later.',
        retryAfter
      });
    }
  } catch (error) {
    // In case of unexpected error, allow the request to proceed
    logger.error(`Rate limiter error: ${getErrorMessage(error)}`);
    next();
  }
};
