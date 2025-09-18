import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { logger } from '../index';

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
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    
    // Add user from payload
    request.user = decoded;
  } catch (error) {
    logger.error(`Authentication error for ${request.raw.method} ${request.raw.url}:`, {
      error: error.message,
      tokenStart: request.headers.authorization?.substring(0, 20) + '...'
    });
    return reply.status(401).send({ message: 'Token is not valid' });
  }
};