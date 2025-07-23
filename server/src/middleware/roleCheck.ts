/**
 * roleCheck.ts
 * Middleware for checking user roles
 */

import { Request, Response, NextFunction } from 'express';

export const roleCheck = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Get user from request (assuming it was added by auth middleware)
    const user = (req as any).user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Authentication required'
      });
    }
    
    // Check if user has any of the allowed roles
    if (!user.role || !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Insufficient permissions'
      });
    }
    
    // User has required role, proceed
    next();
  };
};
