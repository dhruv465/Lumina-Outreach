import * as WebSocket from 'ws';
import * as http from 'http';
import * as url from 'url';
import logger from '../utils/logger';
import { handleOptimizedVoiceStream } from '../controllers/optimizedStreamController';
import { Request } from 'express';

/**
 * Dedicated WebSocket server for Twilio Media Streams
 * Uses native 'ws' library for robust WebSocket framing
 */
export class TwilioWebSocketServer {
  private wss: WebSocket.Server;

  constructor(server: http.Server) {
    // Create WebSocket server with proper configuration for Twilio
    this.wss = new WebSocket.Server({
      server,
      perMessageDeflate: false, // Disable compression for real-time audio
      maxPayload: 1024 * 1024, // 1MB max payload
      clientTracking: true,
      handleProtocols: (protocols, request) => {
        // Accept any protocol for Twilio compatibility
        return protocols.size > 0 ? Array.from(protocols)[0] : false;
      },
      verifyClient: (info) => {
        // Accept connections to Twilio-related paths
        const pathname = url.parse(info.req.url || '').pathname || '';
        
        // Normalize path - handle with or without trailing .websocket
        const normalizedPath = pathname;
        
        const isValidPath = pathname.startsWith('/voice/low-latency') || 
                           pathname.startsWith('/stream') ||
                           pathname.includes('.websocket') ||
                           pathname.includes('project-call-stream');
        
        // Verify WebSocket upgrade headers
        const hasValidHeaders = info.req.headers.upgrade === 'websocket' &&
                               info.req.headers.connection &&
                               info.req.headers.connection.toLowerCase().includes('upgrade');
        
        // Log the connection attempt for debugging
        logger.info('WebSocket connection attempt', {
          origin: info.origin,
          secure: info.secure,
          url: info.req.url,
          pathname,
          normalizedPath,
          accepted: isValidPath && hasValidHeaders,
          userAgent: info.req.headers['user-agent'],
          upgradeHeader: info.req.headers.upgrade,
          connectionHeader: info.req.headers.connection
        });
        
        return isValidPath && hasValidHeaders;
      }
    });

    this.setupEventHandlers();
    logger.info('Twilio WebSocket server initialized');
  }

  private setupEventHandlers() {
    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      logger.info('New Twilio WebSocket connection', {
        url: req.url,
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin
      });

      // Set up proper WebSocket options for Twilio
      ws.binaryType = 'arraybuffer';
      
      // Configure WebSocket for optimal performance
      if ((ws as any)._socket) {
        (ws as any)._socket.setNoDelay(true); // Disable Nagle's algorithm for low latency
        (ws as any)._socket.setKeepAlive(true, 30000); // Keep connection alive
      }
      
      // Add connection metadata
      (ws as any).isAlive = true;
      (ws as any).connectionTime = Date.now();

      // Parse URL to extract parameters
      const parsedUrl = url.parse(req.url || '', true);
      const pathParts = parsedUrl.pathname?.split('/').filter(Boolean) || [];
      
      // Extract callId and conversationId from URL path
      let callId: string | undefined;
      let conversationId: string | undefined;
      
      if (pathParts.length >= 4) {
        // Format: /voice/low-latency/callId/conversationId or /voice/low-latency/callId/conversationId/.websocket
        callId = pathParts[2];
        conversationId = pathParts[3];
        
        // If there's a 5th part that's ".websocket", then we have the correct format
        if (pathParts.length >= 4) {
          // URL format: /voice/low-latency/callId/conversationId/.websocket
          conversationId = pathParts[3];
        } 
        
        // Log the URL parsing for debugging
        logger.debug(`WebSocket URL parsing: ${parsedUrl.pathname}`, {
          callId,
          conversationId,
          pathParts,
          originalPath: parsedUrl.pathname
        });
      }
      
      // Also check query parameters
      if (!callId) callId = parsedUrl.query?.callId as string;
      if (!conversationId) conversationId = parsedUrl.query?.conversationId as string;

      // Create a mock Express request object for compatibility
      const mockReq: Partial<Request> = {
        url: req.url,
        headers: req.headers,
        params: {
          callId: callId || '',
          conversationId: conversationId || ''
        },
        query: parsedUrl.query || {}
      };

      // Handle the connection using our existing controller
      try {
        // Verify connection parameters before proceeding
        if (!callId || !conversationId) {
          logger.error('Missing required parameters for WebSocket connection', {
            callId,
            conversationId,
            url: req.url,
            pathname: parsedUrl.pathname
          });
          ws.close(1002, 'Missing required parameters');
          return;
        }
        
        // Log successful connection establishment
        logger.info('Establishing WebSocket connection for Twilio Media Stream', {
          callId,
          conversationId,
          url: req.url,
          userAgent: req.headers['user-agent']
        });
        
        handleOptimizedVoiceStream(ws, mockReq as Request);
        
        // Set up ping/pong to keep connection alive for Twilio
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            logger.debug(`Ping sent to keep WebSocket connection alive for call ${callId}`);
          } else {
            clearInterval(pingInterval);
          }
        }, 15000); // Send ping every 15 seconds
        
        // Store the interval for cleanup
        (ws as any).pingInterval = pingInterval;
        
        // Clean up interval when connection closes
        ws.on('close', () => {
          if (pingInterval) {
            clearInterval(pingInterval);
          }
          logger.info(`WebSocket connection closed for call ${callId}`);
        });
        
      } catch (error) {
        logger.error('Error handling WebSocket connection:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          callId,
          conversationId
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'Internal server error');
        }
      }

      // Set up ping/pong for connection health
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', {
          error: error.message,
          code: (error as any).code,
          callId,
          conversationId,
          connectionTime: (ws as any).connectionTime,
          readyState: ws.readyState,
          stack: error.stack
        });
        
        // Clean up ping interval on error
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
        }
        
        // Handle specific WebSocket errors that might cause Twilio issues
        if ((error as any).code === 'ECONNRESET' || 
            (error as any).code === 'EPIPE' ||
            (error as any).code === 'ENOTFOUND' ||
            error.message.includes('WebSocket') ||
            error.message.includes('connection')) {
          logger.warn('WebSocket connection error detected, cleaning up', {
            errorCode: (error as any).code,
            callId,
            conversationId
          });
          
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'Connection error');
          }
        }
      });

      ws.on('close', (code, reason) => {
        // Clean up ping interval if it exists
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
        }
        
        logger.info('WebSocket connection closed', {
          code,
          reason: reason.toString(),
          callId,
          conversationId,
          connectionDuration: Date.now() - ((ws as any).connectionTime || Date.now())
        });
      });
    });

      // Set up connection health monitoring
      const interval = setInterval(() => {
        this.wss.clients.forEach((ws) => {
          if (!(ws as any).isAlive) {
            logger.warn('Terminating unresponsive WebSocket connection', {
              connectionTime: (ws as any).connectionTime,
              readyState: ws.readyState
            });
            
            // Clean up ping interval if it exists
            if ((ws as any).pingInterval) {
              clearInterval((ws as any).pingInterval);
            }
            
            return ws.terminate();
          }

          (ws as any).isAlive = false;
          
          // Only ping if connection is open
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        });
      }, 30000); // Check every 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    // Log server statistics periodically
    setInterval(() => {
      const clientCount = this.wss.clients.size;
      if (clientCount > 0) {
        logger.debug(`Active WebSocket connections: ${clientCount}`);
      }
    }, 60000); // Log every minute
  }

  public close() {
    this.wss.close();
  }

  public getClientCount(): number {
    return this.wss.clients.size;
  }
}

// Export singleton instance
let twilioWSServer: TwilioWebSocketServer | null = null;

export function initializeTwilioWebSocketServer(server: http.Server): TwilioWebSocketServer {
  if (twilioWSServer) {
    twilioWSServer.close();
  }
  
  twilioWSServer = new TwilioWebSocketServer(server);
  return twilioWSServer;
}

export function getTwilioWebSocketServer(): TwilioWebSocketServer | null {
  return twilioWSServer;
}