import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../index';

// Extend Express Request interface to include user
interface AuthenticatedRequest extends Request {
  user?: any;
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(`No auth header for ${req.method} ${req.originalUrl}`, { authHeader });
      return res.status(401).json({ message: 'No token, authorization denied' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Check if token is empty or malformed
    if (!token || token === 'undefined' || token === 'null') {
      logger.warn(`Invalid token for ${req.method} ${req.originalUrl}`, { token: token?.substring(0, 10) + '...' });
      return res.status(401).json({ message: 'Token is invalid or malformed' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    
    // Add user from payload
    req.user = decoded;
    next();
  } catch (error) {
    logger.error(`Authentication error for ${req.method} ${req.originalUrl}:`, {
      error: error.message,
      tokenStart: req.headers.authorization?.substring(0, 20) + '...'
    });
    return res.status(401).json({ message: 'Token is not valid' });
  }
};