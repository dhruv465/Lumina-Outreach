import { Server as SocketIOServer } from 'socket.io';
import { handleWebCallEvent } from '../controllers/webCallController';
import logger from '../utils/logger';

/**
 * Set up WebSocket handlers for web call testing
 * @param io Socket.IO server instance
 */
export const setupWebCallSocketHandlers = (io: SocketIOServer): void => {
  // Create a namespace for web call testing
  const webCallNamespace = io.of('/webcall');
  
  // Set up authentication middleware
  webCallNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication required'));
    }
    
    // Verify token (simplified for now)
    try {
      // In a real implementation, verify the JWT token
      // For now, just allow the connection
      next();
    } catch (error) {
      return next(new Error('Invalid authentication token'));
    }
  });
  
  // Handle connections
  webCallNamespace.on('connection', (socket) => {
    logger.info(`New web call WebSocket connection: ${socket.id}`);
    
    // Handle web call events
    handleWebCallEvent(socket);
  });
  
  logger.info('Web call WebSocket handlers initialized');
};

export default setupWebCallSocketHandlers;