/**
 * Authentication Middleware
 * 
 * Provides middleware functions for authentication and authorization.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import logger from '../utils/logger';

// Extend the Request interface to include user property
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

/**
 * Middleware to protect routes - requires valid JWT token
 */
export const protect = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check if token exists
    if (!token) {
      return res.status(401).json({
        message: 'Not authorized, no token provided'
      });
    }

    try {
      // Verify token
      const secret = process.env.JWT_SECRET || 'default_secret_replace_in_production';
      const decoded = jwt.verify(token, secret);

      // Find user by ID from token
      const User = mongoose.model('User');
      const user = await User.findById((decoded as any).id).select('-password');

      if (!user) {
        return res.status(401).json({
          message: 'Not authorized, user not found'
        });
      }

      // Attach user to request
      req.user = user;
      next();
    } catch (error) {
      logger.error('Token verification failed:', error);

      return res.status(401).json({
        message: 'Not authorized, token failed'
      });
    }
  } catch (error) {
    logger.error('Authentication middleware error:', error);

    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};

/**
 * Middleware to check if user is admin
 */
export const admin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({
      message: 'Not authorized as an admin'
    });
  }
};