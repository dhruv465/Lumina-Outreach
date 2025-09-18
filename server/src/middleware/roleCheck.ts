/**
 * roleCheck.ts
 * Middleware for checking user roles
 */

import { FastifyRequest, FastifyReply } from 'fastify';

export const roleCheck = (allowedRoles: string[]) => {
  return (req: FastifyRequest, reply: FastifyReply) => {
    // Get user from request (assuming it was added by auth middleware)
    const user = (req as any).user;
    
    if (!user) {
      reply.status(401).send({
        success: false,
        error: 'Unauthorized - Authentication required'
      });
      throw new Error('Unauthorized');
    }
    
    // Check if user has any of the allowed roles
    if (!user.role || !allowedRoles.includes(user.role)) {
      reply.status(403).send({
        success: false,
        error: 'Forbidden - Insufficient permissions'
      });
      throw new Error('Forbidden');
    }
  };
};
