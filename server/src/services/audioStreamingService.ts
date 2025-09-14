import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import logger from '../utils/logger';
import { AudioStreamManager } from './audioStreamManager';

/**
 * Dedicated WebSocket server for audio streaming with optimized performance
 * This service handles audio streaming with minimal latency
 */
export class AudioStreamingService {
  private io: Server;
  private app: express.Application;
  private server: any;
  private streamManager: AudioStreamManager;
  private readonly bufferSize: number = 1024; // Optimized buffer size for ultra-low latency
  private readonly maxBufferCount: number = 2; // Reduced buffer count for faster processing
  private readonly keepAliveInterval: number = 5000; // 5 seconds for faster detection
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(port: number = 3002) {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      maxHttpBufferSize: 1e6, // 1MB
      transports: ['websocket'] // Force WebSocket for lower latency
    });

    // Initialize audio stream manager
    this.streamManager = new AudioStreamManager({
      bufferSize: this.bufferSize,
      maxBufferCount: this.maxBufferCount
    });

    this.setupRoutes();
    this.setupSocketHandlers();
    this.server.listen(port, () => {
      logger.info(`Audio streaming server listening on port ${port}`);
    });
  }

  private setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', uptime: process.uptime() });
    });
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`New audio streaming connection: ${socket.id}`);
      
      // Create a new stream for this connection
      const streamId = this.streamManager.createStream(socket.id);
      
      // Send initial connection info
      socket.emit('stream:ready', { 
        streamId, 
        bufferSize: this.bufferSize,
        channels: 1,
        sampleRate: 16000, // 16kHz for faster processing
        keepAliveInterval: this.keepAliveInterval
      });

      // Set up keep-alive for this stream (inspired by Deepgram Voice Agent)
      this.setupStreamKeepAlive(socket.id, streamId);

      // Handle incoming audio data
      socket.on('stream:audio', async (data) => {
        try {
          // Queue the audio chunk for processing
          this.streamManager.queueAudioChunk(streamId, data);
          
          // Apply backpressure if needed
          if (this.streamManager.shouldApplyBackpressure(streamId)) {
            socket.emit('stream:backpressure', { pause: true });
          }
        } catch (error) {
          logger.error(`Error processing audio chunk: ${error.message}`);
          socket.emit('stream:error', { message: 'Failed to process audio chunk' });
        }
      });

      // Handle audio control messages
      socket.on('stream:control', (control) => {
        if (control.action === 'pause') {
          this.streamManager.pauseStream(streamId);
        } else if (control.action === 'resume') {
          this.streamManager.resumeStream(streamId);
          // If buffer is now manageable, notify client to resume sending
          if (!this.streamManager.shouldApplyBackpressure(streamId)) {
            socket.emit('stream:backpressure', { pause: false });
          }
        }
      });

      // Handle stream configuration
      socket.on('stream:config', (config) => {
        this.streamManager.configureStream(streamId, config);
      });

      // Handle keep-alive response
      socket.on('stream:keepAliveResponse', (data) => {
        logger.debug(`Keep-alive response received from ${socket.id}: ${JSON.stringify(data)}`);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`Audio streaming connection closed: ${socket.id}`);
        this.clearStreamKeepAlive(socket.id);
        this.streamManager.destroyStream(streamId);
      });
    });
  }

  /**
   * Set up keep-alive mechanism for a stream (inspired by Deepgram Voice Agent)
   * @param socketId Socket ID
   * @param streamId Stream ID
   */
  private setupStreamKeepAlive(socketId: string, streamId: string): void {
    // Clear any existing timer
    this.clearStreamKeepAlive(socketId);

    // Set up new keep-alive timer
    const timer = setInterval(() => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket && socket.connected) {
        socket.emit('stream:keepAlive', {
          streamId,
          timestamp: Date.now(),
          message: 'Connection alive'
        });
        logger.debug(`Keep-alive sent to stream ${streamId}`);
      } else {
        // Socket disconnected, clear timer
        this.clearStreamKeepAlive(socketId);
      }
    }, this.keepAliveInterval);

    this.keepAliveTimers.set(socketId, timer);
    logger.debug(`Keep-alive setup for stream ${streamId} (socket: ${socketId})`);
  }

  /**
   * Clear keep-alive timer for a socket
   * @param socketId Socket ID
   */
  private clearStreamKeepAlive(socketId: string): void {
    const timer = this.keepAliveTimers.get(socketId);
    if (timer) {
      clearInterval(timer);
      this.keepAliveTimers.delete(socketId);
      logger.debug(`Keep-alive cleared for socket ${socketId}`);
    }
  }
}

// Export singleton instance for direct use
export const audioStreamingService = new AudioStreamingService();
