/**
 * Enhanced WebSocket Server for Improved Twilio Media Stream Connections
 * 
 * This server integrates the sophisticated connection management capabilities
 * from EnhancedWebSocketManager at the server level, providing:
 * - Robust connection stability with intelligent reconnection
 * - Comprehensive error classification and recovery
 * - Advanced monitoring and metrics collection
 * - Enhanced protocol compliance validation
 * - Adaptive heartbeat and health monitoring
 */

import http from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { parse as parseUrl } from 'url';
import { Request } from 'express';
import { EnhancedWebSocketManager } from '../utils/enhancedWebSocketManager';
import { TwilioWebSocketManager } from '../utils/TwilioWebSocketManager';
import { ReconnectionService } from './ReconnectionService';
import logger from '../utils/logger';

// Enhanced connection state that leverages EnhancedWebSocketManager
export interface EnhancedConnectionState {
  callId: string;
  conversationId: string;
  enhancedManager: EnhancedWebSocketManager;
  twilioManager: TwilioWebSocketManager;
  createdAt: number;
  streamSid?: string;
  gotConnected: boolean;
  gotStart: boolean;
  // Enhanced metrics and monitoring
  connectionMetrics: {
    totalMessages: number;
    totalErrors: number;
    averageLatency: number;
    lastHealthCheck: number;
    qualityScore: number;
  };
}

// Enhanced server configuration
export interface EnhancedServerConfig {
  // Connection management
  maxConnections?: number;
  connectionTimeout?: number;
  heartbeatInterval?: number;
  
  // Enhanced WebSocket Manager configuration (allowing partial configuration)
  enhancedManagerConfig?: {
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    heartbeatInterval?: number;
    connectionTimeout?: number;
    maxHeartbeatMisses?: number;
    pingInterval?: number;
    pongTimeout?: number;
    enableFrameValidation?: boolean;
    strictProtocolCompliance?: boolean;
    maxFrameSize?: number;
    maxMessageSize?: number;
    errorClassificationEnabled?: boolean;
    retryOnProtocolErrors?: boolean;
  };
  
  // Server-level monitoring
  enableHealthMonitoring?: boolean;
  healthCheckInterval?: number;
  metricsCollectionInterval?: number;
  
  // Protocol compliance
  enableProtocolValidation?: boolean;
  strictTwilioCompliance?: boolean;
}

/**
 * Enhanced WebSocket Server with integrated sophisticated connection management
 */
export class EnhancedWebSocketServer {
  private wss: WebSocketServer;
  private server: http.Server;
  private activeConnections: Map<string, EnhancedConnectionState> = new Map();
  private reconnectionService: ReconnectionService;
  private config: Required<EnhancedServerConfig>;
  
  // Monitoring and health check timers
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsCollectionInterval?: NodeJS.Timeout;
  
  // Server-level metrics
  private serverMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    totalReconnections: 0,
    totalErrors: 0,
    avgConnectionDuration: 0,
    healthScore: 100
  };

  // Constants optimized for Twilio Media Streams
  private static readonly TWILIO_AUDIO_CHUNK_SIZE = 640; // ~40ms at 8kHz PCM16
  private static readonly TWILIO_SAMPLES_PER_FRAME = 160;

  constructor(server: http.Server, config: EnhancedServerConfig = {}) {
    this.server = server;
    this.config = this.mergeWithDefaults(config);
    this.reconnectionService = new ReconnectionService();
    
    logger.info("Initializing EnhancedWebSocketServer with advanced connection management");
    
    // Initialize WebSocket server with enhanced configuration
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false, // Disable for real-time audio
      maxPayload: this.config.enhancedManagerConfig.maxMessageSize,
      clientTracking: true,
    });

    this.setupServerUpgradeHandler();
    this.setupServerHealthMonitoring();
    
    logger.info("EnhancedWebSocketServer initialized", { 
      config: this.sanitizeConfigForLogging(this.config),
      serverMetrics: this.serverMetrics
    });
  }

  /**
   * Merge user config with sensible defaults optimized for Twilio Media Streams
   */
  private mergeWithDefaults(config: EnhancedServerConfig): Required<EnhancedServerConfig> {
    return {
      maxConnections: config.maxConnections ?? 1000,
      connectionTimeout: config.connectionTimeout ?? 15000,
      heartbeatInterval: config.heartbeatInterval ?? 10000,
      
      enhancedManagerConfig: {
        maxReconnectAttempts: config.enhancedManagerConfig?.maxReconnectAttempts ?? 5,
        reconnectDelay: config.enhancedManagerConfig?.reconnectDelay ?? 1000,
        heartbeatInterval: config.enhancedManagerConfig?.heartbeatInterval ?? 15000,
        connectionTimeout: config.enhancedManagerConfig?.connectionTimeout ?? 10000,
        maxHeartbeatMisses: config.enhancedManagerConfig?.maxHeartbeatMisses ?? 3,
        pingInterval: config.enhancedManagerConfig?.pingInterval ?? 20000,
        pongTimeout: config.enhancedManagerConfig?.pongTimeout ?? 5000,
        enableFrameValidation: config.enhancedManagerConfig?.enableFrameValidation ?? true,
        strictProtocolCompliance: config.enhancedManagerConfig?.strictProtocolCompliance ?? true,
        maxFrameSize: config.enhancedManagerConfig?.maxFrameSize ?? 64 * 1024,
        maxMessageSize: config.enhancedManagerConfig?.maxMessageSize ?? 1024 * 1024,
        errorClassificationEnabled: config.enhancedManagerConfig?.errorClassificationEnabled ?? true,
        retryOnProtocolErrors: config.enhancedManagerConfig?.retryOnProtocolErrors ?? false,
        ...config.enhancedManagerConfig
      },
      
      enableHealthMonitoring: config.enableHealthMonitoring ?? true,
      healthCheckInterval: config.healthCheckInterval ?? 30000,
      metricsCollectionInterval: config.metricsCollectionInterval ?? 60000,
      enableProtocolValidation: config.enableProtocolValidation ?? true,
      strictTwilioCompliance: config.strictTwilioCompliance ?? true
    };
  }

  /**
   * Set up the server upgrade handler with enhanced connection management
   */
  private setupServerUpgradeHandler(): void {
    this.server.on('upgrade', async (request, socket, head) => {
      try {
        const upgradeHeader = (request.headers['upgrade'] || '').toString().toLowerCase();
        const connectionHeader = (request.headers['connection'] || '').toString().toLowerCase();
        const urlPath = request.url || '/';
        const { pathname } = parseUrl(urlPath);

        // Normalize pathname to prevent duplication issues
        const normalizedPathname = pathname ? pathname.replace(/\/\.websocket$/, "").replace(/\.websocket$/, "") : "";

        const isWs = upgradeHeader === 'websocket' && connectionHeader.includes('upgrade');
        
        // Validate Twilio Media Stream endpoints
        const isValidPath = normalizedPathname && (
          normalizedPathname.startsWith("/voice/optimized-stream") ||
          normalizedPathname.startsWith("/voice/low-latency") ||
          normalizedPathname.startsWith("/voice/stream") ||
          normalizedPathname.startsWith("/stream") ||
          normalizedPathname.includes("project-call-stream")
        );

        logger.info('Enhanced WebSocket upgrade request', {
          upgradeHeader,
          connectionHeader,
          url: urlPath,
          pathname,
          normalizedPathname,
          isValidPath,
          userAgent: request.headers["user-agent"],
          activeConnections: this.activeConnections.size
        });

        // Only handle valid WebSocket requests for Twilio paths
        if (!isWs || !isValidPath) {
          return; // Let other handlers manage this
        }

        // Check connection limits
        if (this.activeConnections.size >= this.config.maxConnections) {
          logger.warn('Connection limit reached, rejecting new connection', {
            activeConnections: this.activeConnections.size,
            maxConnections: this.config.maxConnections
          });
          socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        // Extract call parameters for structured endpoints
        let callId: string | undefined;
        let conversationId: string | undefined;

        if (normalizedPathname.startsWith('/voice/stream/')) {
          const parts = normalizedPathname.split('/').filter(Boolean);
          if (parts.length === 4 && parts[0] === 'voice' && parts[1] === 'stream') {
            callId = parts[2];
            conversationId = parts[3];
          } else {
            logger.warn('Invalid path structure for /voice/stream', { 
              pathname: normalizedPathname, 
              parts,
              expected: '/voice/stream/:callId/:conversationId'
            });
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        // Handle the WebSocket upgrade with enhanced management
        await this.handleEnhancedUpgrade(request, socket, head, callId, conversationId, normalizedPathname);
        
      } catch (error) {
        logger.error('Error in enhanced WebSocket upgrade handler', {
          error: error.message,
          stack: error.stack
        });
        
        try {
          socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
          socket.destroy();
        } catch (destroyError) {
          logger.error('Error destroying socket after upgrade failure', { error: destroyError });
        }
      }
    });
  }

  /**
   * Handle WebSocket upgrade with enhanced connection management
   */
  private async handleEnhancedUpgrade(
    request: any,
    socket: any,
    head: any,
    callId?: string,
    conversationId?: string,
    pathname?: string
  ): Promise<void> {
    // Use the WebSocket Server to handle the upgrade
    this.wss.handleUpgrade(request, socket, head, async (ws) => {
      try {
        logger.info('Enhanced WebSocket upgrade completed', {
          callId,
          conversationId,
          pathname,
          readyState: ws.readyState
        });

        // Create enhanced connection if we have call parameters
        if (callId && conversationId) {
          await this.createEnhancedConnection(ws, callId, conversationId);
        } else {
          // Set up basic enhanced connection for legacy paths
          await this.createBasicEnhancedConnection(ws, pathname || '/unknown');
        }
        
        this.serverMetrics.totalConnections++;
        this.serverMetrics.activeConnections = this.activeConnections.size;

      } catch (error) {
        logger.error('Error setting up enhanced WebSocket connection', {
          error: error.message,
          callId,
          conversationId,
          stack: error.stack
        });
        
        // Close the connection on setup failure
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'Server error during connection setup');
        }
      }
    });
  }

  /**
   * Create enhanced connection with full management capabilities
   */
  private async createEnhancedConnection(ws: WebSocket, callId: string, conversationId: string): Promise<void> {
    const connectionKey = `${callId}:${conversationId}`;
    
    try {
      // Create a virtual URL for the enhanced manager (not used for actual connection)
      const virtualUrl = `ws://enhanced-internal/${connectionKey}`;
      
      // Create enhanced WebSocket manager with optimized Twilio configuration
      const enhancedManager = new EnhancedWebSocketManager(callId, virtualUrl, this.config.enhancedManagerConfig);
      
      // Inject the existing WebSocket into the enhanced manager
      // This is a special integration for server-side usage
      (enhancedManager as any).ws = ws;
      (enhancedManager as any).isConnected = true;
      enhancedManager.emit('connected');
      
      // Create Twilio manager wrapper
      const twilioManager = new TwilioWebSocketManager(enhancedManager, connectionKey);
      
      // Create enhanced connection state
      const connectionState: EnhancedConnectionState = {
        callId,
        conversationId,
        enhancedManager,
        twilioManager,
        createdAt: Date.now(),
        gotConnected: false,
        gotStart: false,
        connectionMetrics: {
          totalMessages: 0,
          totalErrors: 0,
          averageLatency: 0,
          lastHealthCheck: Date.now(),
          qualityScore: 100
        }
      };
      
      // Store connection
      this.activeConnections.set(connectionKey, connectionState);
      
      // Set up enhanced event handling
      this.setupEnhancedEventHandlers(ws, connectionState);
      
      logger.info('Enhanced WebSocket connection created', {
        connectionKey,
        callId,
        conversationId,
        activeConnections: this.activeConnections.size,
        enhancedFeatures: {
          frameValidation: this.config.enhancedManagerConfig.enableFrameValidation,
          protocolCompliance: this.config.enhancedManagerConfig.strictProtocolCompliance,
          errorClassification: this.config.enhancedManagerConfig.errorClassificationEnabled
        }
      });
      
    } catch (error) {
      logger.error('Failed to create enhanced connection', {
        error: error.message,
        callId,
        conversationId,
        connectionKey,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Create basic enhanced connection for legacy endpoints
   */
  private async createBasicEnhancedConnection(ws: WebSocket, pathname: string): Promise<void> {
    // Generate a temporary connection key for legacy connections
    const connectionKey = `legacy:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    const callId = `legacy-${Date.now()}`;
    
    try {
      const virtualUrl = `ws://enhanced-internal/${connectionKey}`;
      const enhancedManager = new EnhancedWebSocketManager(callId, virtualUrl, this.config.enhancedManagerConfig);
      
      // Inject existing WebSocket
      (enhancedManager as any).ws = ws;
      (enhancedManager as any).isConnected = true;
      enhancedManager.emit('connected');
      
      const twilioManager = new TwilioWebSocketManager(enhancedManager, connectionKey);
      
      const connectionState: EnhancedConnectionState = {
        callId,
        conversationId: 'legacy',
        enhancedManager,
        twilioManager,
        createdAt: Date.now(),
        gotConnected: false,
        gotStart: false,
        connectionMetrics: {
          totalMessages: 0,
          totalErrors: 0,
          averageLatency: 0,
          lastHealthCheck: Date.now(),
          qualityScore: 100
        }
      };
      
      this.activeConnections.set(connectionKey, connectionState);
      this.setupEnhancedEventHandlers(ws, connectionState);
      
      logger.info('Basic enhanced WebSocket connection created', {
        connectionKey,
        pathname,
        callId,
        activeConnections: this.activeConnections.size
      });
      
    } catch (error) {
      logger.error('Failed to create basic enhanced connection', {
        error: error.message,
        pathname,
        connectionKey,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Set up enhanced event handlers leveraging EnhancedWebSocketManager capabilities
   */
  private setupEnhancedEventHandlers(ws: WebSocket, state: EnhancedConnectionState): void {
    const { callId, conversationId, enhancedManager } = state;
    const connectionKey = `${callId}:${conversationId}`;

    // Enhanced error handling
    ws.on('error', (error: Error) => {
      logger.error('Enhanced WebSocket connection error', {
        error: error.message,
        callId,
        conversationId,
        connectionKey,
        connectionAge: Date.now() - state.createdAt,
        metrics: state.connectionMetrics
      });
      
      state.connectionMetrics.totalErrors++;
      
      // Let the enhanced manager handle error classification
      enhancedManager.emit('error', error);
    });

    // Enhanced close handling with metrics
    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString?.() || '';
      const connectionDuration = Date.now() - state.createdAt;
      
      logger.info('Enhanced WebSocket connection closed', {
        code,
        reason: reasonStr,
        callId,
        conversationId,
        connectionDuration,
        metrics: state.connectionMetrics,
        enhancedMetrics: enhancedManager.getMetrics()
      });
      
      // Update server metrics
      this.serverMetrics.activeConnections = Math.max(0, this.serverMetrics.activeConnections - 1);
      this.updateAverageConnectionDuration(connectionDuration);
      
      // Clean up connection
      this.cleanupConnection(connectionKey);
      
      // Emit enhanced close event
      enhancedManager.emit('disconnected', code, reasonStr);
    });

    // Enhanced message handling
    ws.on('message', (data: RawData) => {
      state.connectionMetrics.totalMessages++;
      state.connectionMetrics.lastHealthCheck = Date.now();
      
      // Forward to enhanced manager for processing
      enhancedManager.emit('message', data);
    });

    // Enhanced ping/pong handling
    ws.on('pong', () => {
      state.connectionMetrics.lastHealthCheck = Date.now();
      enhancedManager.emit('pong');
    });
  }

  /**
   * Set up server-level health monitoring
   */
  private setupServerHealthMonitoring(): void {
    if (!this.config.enableHealthMonitoring) return;

    // Health check interval
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);

    // Metrics collection interval
    this.metricsCollectionInterval = setInterval(() => {
      this.collectAndLogMetrics();
    }, this.config.metricsCollectionInterval);

    logger.info('Server health monitoring initialized', {
      healthCheckInterval: this.config.healthCheckInterval,
      metricsCollectionInterval: this.config.metricsCollectionInterval
    });
  }

  /**
   * Perform comprehensive health checks on all connections
   */
  private performHealthChecks(): void {
    let healthyConnections = 0;
    let unhealthyConnections = 0;
    
    this.activeConnections.forEach((state, connectionKey) => {
      try {
        const now = Date.now();
        const connectionAge = now - state.createdAt;
        const timeSinceLastMessage = now - state.connectionMetrics.lastHealthCheck;
        
        // Get enhanced metrics from the manager
        const enhancedMetrics = state.enhancedManager.getMetrics();
        
        // Assess connection health
        const isHealthy = (
          enhancedMetrics.connectionQuality !== 'failed' &&
          timeSinceLastMessage < 60000 && // No activity for > 1 minute
          enhancedMetrics.errorCount < 10 && // Not too many errors
          connectionAge > 1000 // Connection has been alive for at least 1 second
        );
        
        if (isHealthy) {
          healthyConnections++;
        } else {
          unhealthyConnections++;
          logger.warn('Unhealthy connection detected', {
            connectionKey,
            connectionAge,
            timeSinceLastMessage,
            enhancedMetrics,
            quality: enhancedMetrics.connectionQuality
          });
        }
        
        // Update connection quality score
        state.connectionMetrics.qualityScore = this.calculateQualityScore(enhancedMetrics, timeSinceLastMessage);
        
      } catch (error) {
        logger.error('Error during health check', {
          connectionKey,
          error: error.message
        });
        unhealthyConnections++;
      }
    });
    
    // Update server health score
    const totalConnections = healthyConnections + unhealthyConnections;
    this.serverMetrics.healthScore = totalConnections > 0 
      ? Math.round((healthyConnections / totalConnections) * 100)
      : 100;
    
    logger.debug('Health check completed', {
      healthyConnections,
      unhealthyConnections,
      serverHealthScore: this.serverMetrics.healthScore
    });
  }

  /**
   * Calculate connection quality score based on enhanced metrics
   */
  private calculateQualityScore(enhancedMetrics: any, timeSinceLastMessage: number): number {
    let score = 100;
    
    // Deduct for connection quality issues
    switch (enhancedMetrics.connectionQuality) {
      case 'poor': score -= 30; break;
      case 'failed': score -= 80; break;
      case 'good': score -= 10; break;
    }
    
    // Deduct for errors
    score -= Math.min(enhancedMetrics.errorCount * 5, 40);
    
    // Deduct for inactivity
    if (timeSinceLastMessage > 30000) score -= 20;
    if (timeSinceLastMessage > 60000) score -= 40;
    
    // Deduct for reconnection attempts
    score -= Math.min(enhancedMetrics.reconnectAttempts * 10, 30);
    
    return Math.max(0, score);
  }

  /**
   * Collect and log comprehensive server metrics
   */
  private collectAndLogMetrics(): void {
    const connectionMetrics: any[] = [];
    let totalMessages = 0;
    let totalErrors = 0;
    let totalLatency = 0;
    let connections = 0;
    
    this.activeConnections.forEach((state, connectionKey) => {
      const enhancedMetrics = state.enhancedManager.getMetrics();
      connectionMetrics.push({
        connectionKey,
        callId: state.callId,
        conversationId: state.conversationId,
        connectionAge: Date.now() - state.createdAt,
        messages: state.connectionMetrics.totalMessages,
        errors: state.connectionMetrics.totalErrors,
        qualityScore: state.connectionMetrics.qualityScore,
        enhancedQuality: enhancedMetrics.connectionQuality,
        latency: enhancedMetrics.latency
      });
      
      totalMessages += state.connectionMetrics.totalMessages;
      totalErrors += state.connectionMetrics.totalErrors;
      totalLatency += enhancedMetrics.latency || 0;
      connections++;
    });
    
    const serverSummary = {
      ...this.serverMetrics,
      activeConnections: this.activeConnections.size,
      averageLatency: connections > 0 ? Math.round(totalLatency / connections) : 0,
      totalMessages,
      totalErrors,
      errorRate: totalMessages > 0 ? Math.round((totalErrors / totalMessages) * 100) : 0
    };
    
    logger.info('Enhanced WebSocket Server Metrics', {
      server: serverSummary,
      connectionCount: connectionMetrics.length,
      topConnections: connectionMetrics.slice(0, 5) // Log top 5 most active
    });
  }

  /**
   * Update average connection duration metric
   */
  private updateAverageConnectionDuration(duration: number): void {
    const totalConnections = this.serverMetrics.totalConnections;
    if (totalConnections > 1) {
      this.serverMetrics.avgConnectionDuration = 
        ((this.serverMetrics.avgConnectionDuration * (totalConnections - 1)) + duration) / totalConnections;
    } else {
      this.serverMetrics.avgConnectionDuration = duration;
    }
  }

  /**
   * Clean up connection resources
   */
  private cleanupConnection(connectionKey: string): void {
    const state = this.activeConnections.get(connectionKey);
    if (state) {
      try {
        // Clean up enhanced manager resources
        state.enhancedManager.removeAllListeners();
        
        // Clean up Twilio manager resources
        // (TwilioWebSocketManager should handle its own cleanup)
        
        this.activeConnections.delete(connectionKey);
        
        logger.debug('Connection cleaned up', { connectionKey });
      } catch (error) {
        logger.error('Error during connection cleanup', {
          connectionKey,
          error: error.message
        });
      }
    }
  }

  /**
   * Send enhanced Twilio-compliant media frame
   */
  public sendEnhancedMediaFrame(callId: string, conversationId: string, audioData: Buffer): boolean {
    const connectionKey = `${callId}:${conversationId}`;
    const state = this.activeConnections.get(connectionKey);
    
    if (!state || !state.streamSid) {
      logger.warn('Cannot send media frame: connection not ready', { connectionKey });
      return false;
    }
    
    try {
      // Use the enhanced Twilio manager to send the audio data
      return state.twilioManager.sendAudioToTwilio(audioData, state.streamSid);
    } catch (error) {
      logger.error('Failed to send enhanced media frame', {
        connectionKey,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get enhanced connection metrics for monitoring
   */
  public getConnectionMetrics(callId?: string): any {
    if (callId) {
      const connectionKey = Array.from(this.activeConnections.keys()).find(key => key.startsWith(`${callId}:`));
      if (connectionKey) {
        const state = this.activeConnections.get(connectionKey);
        return state ? {
          connection: state.connectionMetrics,
          enhanced: state.enhancedManager.getMetrics()
        } : null;
      }
      return null;
    }
    
    return {
      server: this.serverMetrics,
      connections: Array.from(this.activeConnections.entries()).map(([key, state]) => ({
        connectionKey: key,
        metrics: state.connectionMetrics,
        enhanced: state.enhancedManager.getMetrics()
      }))
    };
  }

  /**
   * Get server health status
   */
  public getHealthStatus(): any {
    return {
      status: this.serverMetrics.healthScore > 80 ? 'healthy' : 
             this.serverMetrics.healthScore > 50 ? 'degraded' : 'unhealthy',
      score: this.serverMetrics.healthScore,
      metrics: this.serverMetrics,
      activeConnections: this.activeConnections.size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Sanitize config for logging (remove sensitive data)
   */
  private sanitizeConfigForLogging(config: Required<EnhancedServerConfig>): any {
    return {
      maxConnections: config.maxConnections,
      connectionTimeout: config.connectionTimeout,
      heartbeatInterval: config.heartbeatInterval,
      enableHealthMonitoring: config.enableHealthMonitoring,
      healthCheckInterval: config.healthCheckInterval,
      enhancedFeatures: {
        frameValidation: config.enhancedManagerConfig.enableFrameValidation,
        protocolCompliance: config.enhancedManagerConfig.strictProtocolCompliance,
        errorClassification: config.enhancedManagerConfig.errorClassificationEnabled
      }
    };
  }

  /**
   * Cleanup server resources
   */
  public cleanup(): void {
    logger.info('Starting EnhancedWebSocketServer cleanup');
    
    // Clear monitoring intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    if (this.metricsCollectionInterval) {
      clearInterval(this.metricsCollectionInterval);
      this.metricsCollectionInterval = undefined;
    }
    
    // Clean up all connections
    this.activeConnections.forEach((state, connectionKey) => {
      try {
        if (state.enhancedManager && (state.enhancedManager as any).ws) {
          const ws = (state.enhancedManager as any).ws;
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1001, 'Server shutdown');
          }
        }
        this.cleanupConnection(connectionKey);
      } catch (error) {
        logger.error('Error cleaning up connection during server shutdown', {
          connectionKey,
          error: error.message
        });
      }
    });
    
    this.activeConnections.clear();
    
    // Close WebSocket server
    this.wss.close();
    
    logger.info('EnhancedWebSocketServer cleanup completed', {
      finalMetrics: this.serverMetrics
    });
  }
}

/**
 * Factory function to initialize the Enhanced WebSocket Server
 */
export function initializeEnhancedWebSocketServer(
  server: http.Server, 
  config?: EnhancedServerConfig
): EnhancedWebSocketServer {
  return new EnhancedWebSocketServer(server, config);
}

export default EnhancedWebSocketServer;