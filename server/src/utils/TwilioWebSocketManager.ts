/**
 * Enhanced WebSocket Connection Manager for Twilio
 * 
 * Addresses specific Twilio WebSocket protocol requirements:
 * - Prevents message fragmentation
 * - Ensures proper message formatting
 * - Handles Twilio-specific error codes
 * - Implements proper connection lifecycle management
 * - Integrates comprehensive health monitoring
 * - Uses EnhancedWebSocketManager for robust connection handling
 */

import * as WebSocket from 'ws';
import logger from './logger';
import { ConnectionHealthMonitor, ConnectionError } from './ConnectionHealthMonitor';
import { ConnectionCircuitBreaker } from './ConnectionCircuitBreaker';
import { RealTimeHealthAssessment, ReconnectionDecision } from './RealTimeHealthAssessment';
import { HeartbeatService } from './HeartbeatService';
import { AdaptiveHeartbeatManager, IntensiveOperation } from './AdaptiveHeartbeatManager';
import { ReconnectionService } from '../services/ReconnectionService';
import { EnhancedWebSocketManager } from './enhancedWebSocketManager';

interface TwilioMessage {
  event: string;
  streamSid?: string;
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  [key: string]: any;
}

interface ConnectionHealth {
  isHealthy: boolean;
  latency: number;
  errorCount: number;
  lastError?: string;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'critical';
}

export class TwilioWebSocketManager {
  private enhancedManager: EnhancedWebSocketManager;
  private connectionHealth: ConnectionHealth;
  private healthMonitor: ConnectionHealthMonitor;
  private circuitBreaker: ConnectionCircuitBreaker;
  private realTimeAssessment: RealTimeHealthAssessment;
  private heartbeatService: HeartbeatService;
  private adaptiveHeartbeatManager: AdaptiveHeartbeatManager;
  private reconnectionService: ReconnectionService;
  private sequenceNumber: number = 0;
  private streamSid?: string;
  private lastPingTime: number = 0;
  private pingInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  
  // Twilio-specific constants
  private static readonly MAX_MESSAGE_SIZE = 64 * 1024; // 64KB - Twilio's safe limit
  private static readonly MAX_AUDIO_CHUNK_SIZE = 32 * 1024; // 32KB for audio chunks
  private static readonly PING_INTERVAL = 30000; // 30 seconds
  private static readonly HEALTH_CHECK_INTERVAL = 5000; // 5 seconds

  constructor(enhancedManager: EnhancedWebSocketManager, connectionId?: string) {
    this.enhancedManager = enhancedManager;
    this.connectionHealth = {
      isHealthy: true,
      latency: 0,
      errorCount: 0,
      connectionQuality: 'excellent'
    };
    
    // Initialize health monitoring components with unique connection ID
    const connId = connectionId || `twilio-ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.healthMonitor = new ConnectionHealthMonitor(connId);
    this.circuitBreaker = new ConnectionCircuitBreaker(connId);
    this.realTimeAssessment = new RealTimeHealthAssessment(
      this.healthMonitor,
      this.circuitBreaker,
      connId
    );
    
    // Get the underlying WebSocket for services that need it
    const ws = enhancedManager.getWebSocket();
    if (!ws) {
      throw new Error('Enhanced WebSocket Manager does not have an active connection');
    }
    
    // Initialize enhanced heartbeat service using the underlying WebSocket
    this.heartbeatService = new HeartbeatService(ws, connId, {
      pingInterval: 30000,        // 30 seconds
      pongTimeout: 10000,         // 10 seconds
      maxMissedHeartbeats: 3,     // 3 missed = dead
      adaptiveInterval: true,     // Adapt based on connection quality
      minInterval: 15000,         // Minimum 15 seconds
      maxInterval: 60000,         // Maximum 60 seconds
      latencyThreshold: 500       // 500ms threshold for adaptation
    });

    // Initialize intelligent reconnection service
    this.reconnectionService = new ReconnectionService({
      maxAttempts: 10,
      baseDelay: 1000,           // 1 second base delay
      maxDelay: 30000,           // 30 seconds max delay
      jitterFactor: 0.1,         // 10% jitter
      circuitBreakerThreshold: 5, // Open after 5 failures
      circuitBreakerTimeout: 60000 // 1 minute timeout
    });
    
    // Initialize adaptive heartbeat manager for advanced optimization
    this.adaptiveHeartbeatManager = new AdaptiveHeartbeatManager(
      this.heartbeatService,
      connId,
      {
        excellentInterval: 45000,     // 45 seconds for excellent networks
        goodInterval: 30000,          // 30 seconds for good networks
        fairInterval: 20000,          // 20 seconds for fair networks
        poorInterval: 15000,          // 15 seconds for poor networks
        criticalInterval: 10000,      // 10 seconds for critical networks
        adaptationSensitivity: 0.7,   // Moderate adaptation speed
        stabilityWindow: 300000,      // 5 minute stability window
        jitterThreshold: 100,         // 100ms jitter threshold
        pauseDuringIntensiveOps: true, // Pause during intensive operations
        intensiveOpThreshold: 80,     // 80% resource threshold
        resumeDelay: 3000,            // 3 second resume delay
        predictiveAdaptation: true,   // Enable predictive algorithms
        learningEnabled: true,        // Enable learning from patterns
        timeOfDayOptimization: false  // Disabled for now
      }
    );
    
    this.setupConnectionMonitoring();
    this.setupEventHandlers();
  }

  /**
   * Create an enhanced WebSocket connection for outbound Twilio connections
   * This method creates a new WebSocket using the EnhancedWebSocketManager for robust connection handling
   */
  public static async createEnhancedConnection(
    callId: string, 
    url: string, 
    connectionId?: string
  ): Promise<TwilioWebSocketManager> {
    logger.info(`Creating enhanced Twilio WebSocket connection for call ${callId}`, { url, connectionId });

    // Create an enhanced WebSocket manager with Twilio-specific configuration
    const enhancedManager = new EnhancedWebSocketManager(callId, url, {
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 15000, // More frequent heartbeats for real-time audio
      connectionTimeout: 10000,
      maxHeartbeatMisses: 3,
      pingInterval: 20000,
      pongTimeout: 5000
    });

    try {
      // Connect using the enhanced manager
      await enhancedManager.connect();

      // Create TwilioWebSocketManager with the enhanced manager
      const twilioManager = new TwilioWebSocketManager(enhancedManager, connectionId);

      // Set up enhanced manager event forwarding
      enhancedManager.on('connected', () => {
        logger.info(`Enhanced WebSocket connected for call ${callId}`);
      });

      enhancedManager.on('disconnected', (code, reason) => {
        logger.warn(`Enhanced WebSocket disconnected for call ${callId}`, { code, reason });
      });

      enhancedManager.on('reconnecting', (attempt) => {
        logger.info(`Enhanced WebSocket reconnecting for call ${callId}`, { attempt });
      });

      enhancedManager.on('error', (error) => {
        logger.error(`Enhanced WebSocket error for call ${callId}`, { error: error.message });
      });

      logger.info(`Enhanced Twilio WebSocket connection established for call ${callId}`);
      return twilioManager;

    } catch (error) {
      logger.error(`Failed to create enhanced Twilio WebSocket connection for call ${callId}`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Set up connection monitoring and health checks
   */
  private setupConnectionMonitoring(): void {
    // Set up heartbeat service event handlers
    this.setupHeartbeatEventHandlers();
    
    // Set up adaptive heartbeat manager event handlers
    this.setupAdaptiveHeartbeatEventHandlers();
    
    // Start the enhanced heartbeat service
    this.heartbeatService.start();
    
    // Start the adaptive heartbeat manager
    this.adaptiveHeartbeatManager.start();

    // Start health monitoring
    this.healthCheckInterval = setInterval(() => {
      this.assessConnectionHealth();
    }, TwilioWebSocketManager.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Set up enhanced manager event handlers with Twilio-specific error handling
   */
  private setupEventHandlers(): void {
    // Use enhanced manager events instead of raw WebSocket events
    this.enhancedManager.on('error', (error) => {
      this.handleConnectionError(error);
    });

    this.enhancedManager.on('disconnected', (code, reason) => {
      this.handleConnectionClose(code, reason);
    });

    // Set up ReconnectionService event handlers
    this.setupReconnectionEventHandlers();
  }

  /**
   * Set up ReconnectionService event handlers
   */
  private setupReconnectionEventHandlers(): void {
    this.reconnectionService.on('reconnectionStarted', (data) => {
      logger.info('Reconnection attempt started', {
        attemptNumber: data.attemptNumber,
        reason: data.reason,
        sessionId: data.sessionId,
        delay: data.delay
      });
    });

    this.reconnectionService.on('reconnectionSuccess', (data) => {
      logger.info('Reconnection successful', {
        attemptNumber: data.attemptNumber,
        reason: data.reason,
        sessionId: data.sessionId,
        totalAttempts: data.totalAttempts
      });
      
      // Reset connection health on successful reconnection
      this.connectionHealth.isHealthy = true;
      this.connectionHealth.errorCount = 0;
      this.connectionHealth.connectionQuality = 'good';
    });

    this.reconnectionService.on('reconnectionFailed', (data) => {
      logger.error('Reconnection attempt failed', {
        attemptNumber: data.attemptNumber,
        reason: data.reason,
        sessionId: data.sessionId,
        error: data.error,
        consecutiveFailures: data.consecutiveFailures
      });
      
      // Update connection health on failure
      this.connectionHealth.errorCount++;
      this.connectionHealth.connectionQuality = 'poor';
    });

    this.reconnectionService.on('circuitBreakerOpened', (data) => {
      logger.warn('Reconnection circuit breaker opened', {
        consecutiveFailures: data.consecutiveFailures,
        threshold: data.threshold
      });
      
      // Mark connection as unhealthy when circuit breaker opens
      this.connectionHealth.isHealthy = false;
      this.connectionHealth.connectionQuality = 'critical';
    });

    this.reconnectionService.on('maxAttemptsExceeded', (data) => {
      logger.error('Maximum reconnection attempts exceeded', {
        maxAttempts: data.maxAttempts,
        reason: data.reason,
        sessionId: data.sessionId
      });
      
      // Mark connection as failed when max attempts exceeded
      this.connectionHealth.isHealthy = false;
      this.connectionHealth.connectionQuality = 'critical';
    });
  }

  /**
   * Set up heartbeat service event handlers
   */
  private setupHeartbeatEventHandlers(): void {
    // Handle pong events from heartbeat service
    this.heartbeatService.on('pong', (data) => {
      const { latency } = data;
      this.connectionHealth.latency = latency;
      
      // Record latency in real-time assessment system
      this.realTimeAssessment.recordLatency(latency);
      
      logger.debug(`Enhanced heartbeat pong received, latency: ${latency}ms`);
    });

    // Handle missed heartbeats
    this.heartbeatService.on('missedHeartbeat', (data) => {
      const { missedCount, connectionId } = data;
      
      logger.warn(`Missed heartbeat detected for connection ${connectionId}`, {
        missedCount,
        connectionId
      });

      // Record as connection error
      this.realTimeAssessment.recordConnectionError({
        type: 'network',
        code: 'MISSED_HEARTBEAT',
        message: `Missed heartbeat (${missedCount} consecutive)`,
        timestamp: new Date(),
        severity: missedCount >= 2 ? 'high' : 'medium',
        context: { missedCount }
      });
    });

    // Handle connection declared dead
    this.heartbeatService.on('connectionDead', (data) => {
      const { connectionId, missedHeartbeats, metrics } = data;
      
      logger.error(`Connection declared dead by heartbeat service for ${connectionId}`, {
        connectionId,
        missedHeartbeats,
        totalPings: metrics.totalPings,
        totalPongs: metrics.totalPongs,
        averageLatency: metrics.averageLatency
      });

      // Force circuit breaker open
      this.realTimeAssessment.forceCircuitOpen('Heartbeat service declared connection dead');

      // Update connection health
      this.connectionHealth.isHealthy = false;
      this.connectionHealth.connectionQuality = 'critical';
      this.connectionHealth.lastError = 'Connection declared dead by heartbeat service';
    });
  }

  /**
   * Set up adaptive heartbeat manager event handlers
   */
  private setupAdaptiveHeartbeatEventHandlers(): void {
    // Handle network condition changes
    this.adaptiveHeartbeatManager.on('conditionChanged', (data) => {
      const { oldCondition, newCondition, connectionId } = data;
      
      logger.info(`Network condition changed for connection ${connectionId}`, {
        connectionId,
        oldCondition: oldCondition.type,
        newCondition: newCondition.type,
        latency: newCondition.latency,
        jitter: newCondition.jitter,
        stability: newCondition.stability
      });

      // Update connection health based on new condition
      this.updateConnectionHealthFromCondition(newCondition);
    });

    // Handle heartbeat interval changes
    this.adaptiveHeartbeatManager.on('intervalChanged', (data) => {
      const { oldInterval, newInterval, reason, connectionId } = data;
      
      logger.debug(`Adaptive heartbeat interval changed for connection ${connectionId}`, {
        connectionId,
        oldInterval,
        newInterval,
        reason,
        change: newInterval - oldInterval
      });
    });

    // Handle heartbeat pause events
    this.adaptiveHeartbeatManager.on('heartbeatPaused', (data) => {
      const { reason, context, connectionId } = data;
      
      logger.info(`Adaptive heartbeat paused for connection ${connectionId}`, {
        connectionId,
        reason,
        context
      });
    });

    // Handle heartbeat resume events
    this.adaptiveHeartbeatManager.on('heartbeatResumed', (data) => {
      const { reason, context, connectionId } = data;
      
      logger.info(`Adaptive heartbeat resumed for connection ${connectionId}`, {
        connectionId,
        reason,
        context
      });
    });
  }

  /**
   * Send audio data to Twilio with proper chunking to prevent fragmentation
   */
  public sendAudioToTwilio(audioData: Buffer, streamSid: string): boolean {
    if (!this.isConnectionReady()) {
      logger.warn('Cannot send audio: WebSocket connection not ready');
      return false;
    }

    this.streamSid = streamSid;

    // Check if audio data is too large and needs chunking
    if (audioData.length > TwilioWebSocketManager.MAX_AUDIO_CHUNK_SIZE) {
      return this.sendLargeAudioInChunks(audioData, streamSid);
    }

    return this.sendSingleAudioChunk(audioData, streamSid);
  }

  /**
   * Send large audio data in smaller chunks to prevent fragmentation
   */
  private sendLargeAudioInChunks(audioData: Buffer, streamSid: string): boolean {
    const chunkSize = TwilioWebSocketManager.MAX_AUDIO_CHUNK_SIZE;
    let offset = 0;
    let success = true;

    logger.debug(`Splitting large audio data (${audioData.length} bytes) into chunks of ${chunkSize} bytes`);

    while (offset < audioData.length && success) {
      const end = Math.min(offset + chunkSize, audioData.length);
      const chunk = audioData.slice(offset, end);
      
      success = this.sendSingleAudioChunk(chunk, streamSid);
      offset = end;

      // Small delay between chunks to prevent overwhelming Twilio
      if (success && offset < audioData.length) {
        // Use setImmediate to yield control and prevent blocking
        setImmediate(() => {});
      }
    }

    return success;
  }

  /**
   * Send a single audio chunk with proper Twilio formatting
   */
  private sendSingleAudioChunk(audioData: Buffer, streamSid: string): boolean {
    const message: TwilioMessage = {
      event: 'media',
      streamSid: streamSid,
      media: {
        track: 'outbound',
        chunk: (++this.sequenceNumber).toString(),
        timestamp: Date.now().toString(),
        payload: audioData.toString('base64')
      }
    };

    return this.sendTwilioMessage(message);
  }

  /**
   * Send a properly formatted message to Twilio with validation
   */
  public sendTwilioMessage(message: TwilioMessage): boolean {
    try {
      // Validate message format
      const validation = this.validateTwilioMessage(message);
      if (!validation.valid) {
        logger.error(`Invalid Twilio message format: ${validation.error}`, { message });
        this.connectionHealth.errorCount++;
        
        // Record validation error in real-time assessment
        this.realTimeAssessment.recordConnectionError({
          type: 'protocol',
          code: 'INVALID_MESSAGE_FORMAT',
          message: `Invalid Twilio message format: ${validation.error}`,
          timestamp: new Date(),
          severity: 'high',
          context: { messageType: message.event }
        });
        
        return false;
      }

      // Serialize message
      const jsonMessage = JSON.stringify(message);

      // Check message size to prevent fragmentation
      if (jsonMessage.length > TwilioWebSocketManager.MAX_MESSAGE_SIZE) {
        logger.error(`Message too large for Twilio (${jsonMessage.length} bytes), max: ${TwilioWebSocketManager.MAX_MESSAGE_SIZE}`, {
          messageType: message.event,
          messageSize: jsonMessage.length
        });
        this.connectionHealth.errorCount++;
        
        // Record size error in real-time assessment
        this.realTimeAssessment.recordConnectionError({
          type: 'protocol',
          code: 'MESSAGE_TOO_LARGE',
          message: `Message too large for Twilio (${jsonMessage.length} bytes)`,
          timestamp: new Date(),
          severity: 'high',
          context: { 
            messageType: message.event,
            messageSize: jsonMessage.length,
            maxSize: TwilioWebSocketManager.MAX_MESSAGE_SIZE
          }
        });
        
        return false;
      }

      // Check WebSocket state before sending
      if (!this.enhancedManager.isConnected()) {
        logger.error('Cannot send message: Enhanced WebSocket manager not connected', {
          messageType: message.event
        });
        return false;
      }

      // Send through enhanced manager's Twilio-specific method
      const success = this.enhancedManager.sendTwilioMessage(jsonMessage);
      
      if (!success) {
        this.connectionHealth.errorCount++;
        
        // Record send error in real-time assessment
        this.realTimeAssessment.recordConnectionError({
          type: 'network',
          code: 'SEND_FAILED',
          message: 'Failed to send message through enhanced manager',
          timestamp: new Date(),
          severity: 'medium',
          context: { 
            messageType: message.event
          }
        });
        
        return false;
      }

      // Log success (periodically to avoid spam)
      if (message.event === 'media' && this.sequenceNumber % 20 === 0) {
        logger.debug(`Successfully sent audio chunk ${this.sequenceNumber} to Twilio`);
      } else if (message.event !== 'media') {
        logger.debug(`Successfully sent ${message.event} message to Twilio`);
      }

      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Failed to send message to Twilio:', {
        error: errorMessage,
        messageType: message.event,
        connected: this.enhancedManager.isConnected()
      });
      
      this.connectionHealth.errorCount++;
      this.connectionHealth.lastError = errorMessage;
      
      // Record send error in real-time assessment
      this.realTimeAssessment.recordConnectionError({
        type: 'network',
        code: 'SEND_FAILED',
        message: `Failed to send message to Twilio: ${errorMessage}`,
        timestamp: new Date(),
        severity: 'medium',
        context: { 
          messageType: message.event,
          connected: this.enhancedManager.isConnected()
        }
      });
      
      return false;
    }
  }

  /**
   * Validate Twilio message format to prevent protocol errors
   */
  private validateTwilioMessage(message: TwilioMessage): { valid: boolean; error?: string } {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'Message must be an object' };
    }

    if (!message.event || typeof message.event !== 'string') {
      return { valid: false, error: 'Message must have a valid event field' };
    }

    // Validate known Twilio event types
    const validEvents = ['media', 'start', 'stop', 'mark', 'clear'];
    if (!validEvents.includes(message.event)) {
      return { valid: false, error: `Invalid event type: ${message.event}. Must be one of: ${validEvents.join(', ')}` };
    }

    // Validate media messages specifically
    if (message.event === 'media') {
      if (!message.streamSid || typeof message.streamSid !== 'string') {
        return { valid: false, error: 'Media messages must include streamSid as string' };
      }
      
      if (!message.media || typeof message.media !== 'object') {
        return { valid: false, error: 'Media messages must include media object' };
      }
      
      const { media } = message;
      
      // Validate required media fields with strict types
      if (!media.track || typeof media.track !== 'string') {
        return { valid: false, error: 'Media messages must include track as string' };
      }
      
      if (!media.chunk || typeof media.chunk !== 'string') {
        return { valid: false, error: 'Media messages must include chunk as string' };
      }
      
      if (!media.timestamp || typeof media.timestamp !== 'string') {
        return { valid: false, error: 'Media messages must include timestamp as string' };
      }
      
      if (!media.payload || typeof media.payload !== 'string') {
        return { valid: false, error: 'Media messages must include payload as string' };
      }

      // Validate track value
      if (!['inbound', 'outbound'].includes(media.track)) {
        return { valid: false, error: 'Media track must be either "inbound" or "outbound"' };
      }

      // Validate chunk is a valid sequence number
      const chunkNum = parseInt(media.chunk, 10);
      if (isNaN(chunkNum) || chunkNum < 0) {
        return { valid: false, error: 'Media chunk must be a valid non-negative integer string' };
      }

      // Validate timestamp is a valid number string
      const timestampNum = parseInt(media.timestamp, 10);
      if (isNaN(timestampNum) || timestampNum <= 0) {
        return { valid: false, error: 'Media timestamp must be a valid positive integer string' };
      }

      // Validate base64 payload
      try {
        const decoded = Buffer.from(media.payload, 'base64');
        if (decoded.length === 0) {
          return { valid: false, error: 'Media payload cannot be empty after base64 decoding' };
        }
      } catch (e) {
        return { valid: false, error: 'Media payload must be valid base64' };
      }
    }

    // Validate mark messages
    if (message.event === 'mark') {
      if (!message.streamSid || typeof message.streamSid !== 'string') {
        return { valid: false, error: 'Mark messages must include streamSid as string' };
      }
      if (!message.mark || typeof message.mark !== 'object') {
        return { valid: false, error: 'Mark messages must include mark object' };
      }
      if (!message.mark.name || typeof message.mark.name !== 'string') {
        return { valid: false, error: 'Mark messages must include mark.name as string' };
      }
    }

    return { valid: true };
  }



  /**
   * Update connection health based on network condition from adaptive manager
   */
  private updateConnectionHealthFromCondition(condition: any): void {
    // Map network condition to connection quality
    switch (condition.type) {
      case 'excellent':
        this.connectionHealth.connectionQuality = 'excellent';
        this.connectionHealth.isHealthy = true;
        break;
      case 'good':
        this.connectionHealth.connectionQuality = 'good';
        this.connectionHealth.isHealthy = true;
        break;
      case 'fair':
        this.connectionHealth.connectionQuality = 'good';
        this.connectionHealth.isHealthy = true;
        break;
      case 'poor':
        this.connectionHealth.connectionQuality = 'poor';
        this.connectionHealth.isHealthy = false;
        break;
      case 'critical':
        this.connectionHealth.connectionQuality = 'critical';
        this.connectionHealth.isHealthy = false;
        break;
    }
    
    this.connectionHealth.latency = condition.latency;
  }

  /**
   * Assess connection health based on various metrics
   */
  private assessConnectionHealth(): void {
    const now = Date.now();
    const timeSinceLastPing = now - this.lastPingTime;
    
    // Update connection quality based on metrics
    if (this.connectionHealth.errorCount > 10) {
      this.connectionHealth.connectionQuality = 'critical';
      this.connectionHealth.isHealthy = false;
    } else if (this.connectionHealth.errorCount > 5 || this.connectionHealth.latency > 1000) {
      this.connectionHealth.connectionQuality = 'poor';
      this.connectionHealth.isHealthy = false;
    } else if (this.connectionHealth.errorCount > 2 || this.connectionHealth.latency > 500) {
      this.connectionHealth.connectionQuality = 'good';
      this.connectionHealth.isHealthy = true;
    } else {
      this.connectionHealth.connectionQuality = 'excellent';
      this.connectionHealth.isHealthy = true;
    }

    // Check for stale connection
    if (timeSinceLastPing > TwilioWebSocketManager.PING_INTERVAL * 2) {
      logger.warn('WebSocket connection may be stale - no recent ping activity');
      this.connectionHealth.isHealthy = false;
    }
  }

  /**
   * Handle connection errors with Twilio-specific error codes
   */
  private handleConnectionError(error: Error): void {
    logger.error('WebSocket connection error:', {
      error: error.message,
      code: (error as any).code,
      connectionHealth: this.connectionHealth
    });

    this.connectionHealth.errorCount++;
    this.connectionHealth.lastError = error.message;
    this.connectionHealth.isHealthy = false;

    // Determine error severity and type
    let errorType: ConnectionError['type'] = 'network';
    let severity: ConnectionError['severity'] = 'medium';
    
    // Handle specific Twilio error patterns and codes
    if (error.message.includes('Protocol Error') || error.message.includes('fragmented') ||
        error.message.includes('31924') || error.message.includes('malformed') ||
        error.message.includes('31951') || error.message.includes('Invalid message')) {
      logger.error('Detected Twilio WebSocket protocol error - message format or framing issue', {
        error: error.message,
        errorType: 'protocol_violation'
      });
      errorType = 'protocol';
      severity = 'critical';
    } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      errorType = 'network';
      severity = 'high';
    }

    // Record error in real-time assessment
    this.realTimeAssessment.recordConnectionError({
      type: errorType,
      code: (error as any).code || 'UNKNOWN',
      message: error.message,
      timestamp: new Date(),
      severity,
      context: {
        connectionHealth: this.connectionHealth,
        connected: this.enhancedManager.isConnected()
      }
    });
  }

  /**
   * Handle connection close with proper cleanup
   */
  private handleConnectionClose(code: number, reason: Buffer): void {
    logger.info('WebSocket connection closed:', {
      code,
      reason: reason.toString(),
      connectionHealth: this.connectionHealth
    });

    this.cleanup();

    // Log specific Twilio close codes
    if (code === 1006) {
      logger.warn('WebSocket closed abnormally (1006) - possible Twilio protocol error');
    }
  }

  /**
   * Check if connection is ready for sending messages
   */
  private isConnectionReady(): boolean {
    return this.enhancedManager.isConnected() && this.connectionHealth.isHealthy;
  }

  /**
   * Get current connection health status
   */
  public getConnectionHealth(): ConnectionHealth {
    return { ...this.connectionHealth };
  }

  /**
   * Clean up resources and intervals
   */
  public cleanup(): void {
    // Clean up enhanced manager if it exists
    const enhancedManager = (this as any).enhancedManager;
    if (enhancedManager) {
      logger.info('Cleaning up enhanced WebSocket manager');
      try {
        enhancedManager.close();
      } catch (error) {
        logger.error('Error closing enhanced WebSocket manager', { error: error.message });
      }
      delete (this as any).enhancedManager;
    }

    // Stop heartbeat services
    this.heartbeatService.stop();
    this.adaptiveHeartbeatManager.stop();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Clean up health monitoring components
    this.realTimeAssessment.cleanup();
    this.heartbeatService.cleanup();
    this.adaptiveHeartbeatManager.cleanup();
  }

  /**
   * Get connection statistics
   */
  public getStats(): {
    sequenceNumber: number;
    connectionHealth: ConnectionHealth;
    isReady: boolean;
  } {
    return {
      sequenceNumber: this.sequenceNumber,
      connectionHealth: this.getConnectionHealth(),
      isReady: this.isConnectionReady()
    };
  }

  /**
   * Get detailed health metrics from the health monitor
   */
  public getHealthMetrics() {
    return this.healthMonitor.getMetrics();
  }

  /**
   * Get comprehensive health report
   */
  public getHealthReport() {
    return this.healthMonitor.generateHealthReport();
  }

  /**
   * Check if reconnection should be triggered based on real-time health assessment
   */
  public shouldReconnect(): boolean {
    const decision = this.realTimeAssessment.assessConnectionHealth();
    return decision.shouldReconnect;
  }

  /**
   * Get current health score
   */
  public getHealthScore() {
    return this.healthMonitor.assessConnectionHealth();
  }

  /**
   * Get real-time reconnection decision with detailed reasoning
   */
  public getReconnectionDecision(): ReconnectionDecision {
    return this.realTimeAssessment.assessConnectionHealth();
  }

  /**
   * Get comprehensive real-time health assessment report
   */
  public getRealTimeHealthReport() {
    return this.realTimeAssessment.getHealthAssessmentReport();
  }

  /**
   * Record a successful operation (for circuit breaker and health assessment)
   */
  public recordSuccess(): void {
    this.realTimeAssessment.recordSuccess();
  }

  /**
   * Record a reconnection attempt
   */
  public recordReconnectionAttempt(success: boolean): void {
    this.realTimeAssessment.recordReconnectionAttempt(success);
  }

  /**
   * Attempt intelligent reconnection using the ReconnectionService
   * Handles Twilio-specific connection issues with exponential backoff
   */
  public async attemptIntelligentReconnection(
    connectionFunction: () => Promise<void>,
    reason: string,
    sessionId?: string
  ): Promise<boolean> {
    logger.info('Starting intelligent reconnection attempt', {
      reason,
      sessionId,
      currentHealth: this.getConnectionHealth(),
      reconnectionMetrics: this.reconnectionService.getMetrics()
    });

    // Record the reconnection attempt in our health monitoring
    const success = await this.reconnectionService.attemptReconnection(
      connectionFunction,
      reason,
      sessionId
    );

    // Update our health monitoring with the result
    this.recordReconnectionAttempt(success);

    if (success) {
      // Reset connection health on successful reconnection
      this.connectionHealth.isHealthy = true;
      this.connectionHealth.errorCount = 0;
      this.connectionHealth.connectionQuality = 'good';
      
      logger.info('Intelligent reconnection successful', {
        reason,
        sessionId,
        reconnectionMetrics: this.reconnectionService.getMetrics()
      });
    } else {
      logger.error('Intelligent reconnection failed', {
        reason,
        sessionId,
        reconnectionMetrics: this.reconnectionService.getMetrics()
      });
    }

    return success;
  }

  /**
   * Get enhanced reconnection decision that combines both services
   */
  public getEnhancedReconnectionDecision(reason: string): {
    shouldReconnect: boolean;
    urgency: 'low' | 'medium' | 'high' | 'immediate';
    estimatedDelay: number;
    fallbackRecommended: boolean;
    healthAssessment: ReconnectionDecision;
    reconnectionMetrics: any;
  } {
    const healthDecision = this.realTimeAssessment.assessConnectionHealth();
    const reconnectionDecision = this.reconnectionService.getReconnectionDecision(reason);
    
    // Combine both decisions - be conservative (don't reconnect if either says no)
    const shouldReconnect = healthDecision.shouldReconnect && reconnectionDecision.shouldReconnect;
    
    // Use the higher urgency from both services
    const urgencyLevels = { low: 0, medium: 1, high: 2, immediate: 3 };
    const healthUrgency = healthDecision.urgency || 'medium';
    const reconnectionUrgency = reconnectionDecision.urgency;
    
    const maxUrgency = urgencyLevels[healthUrgency] > urgencyLevels[reconnectionUrgency] 
      ? healthUrgency : reconnectionUrgency;
    
    return {
      shouldReconnect,
      urgency: maxUrgency as 'low' | 'medium' | 'high' | 'immediate',
      estimatedDelay: reconnectionDecision.estimatedDelay,
      fallbackRecommended: healthDecision.fallbackRecommended || reconnectionDecision.fallbackRecommended,
      healthAssessment: healthDecision,
      reconnectionMetrics: this.reconnectionService.getMetrics()
    };
  }

  /**
   * Get reconnection service metrics
   */
  public getReconnectionMetrics() {
    return this.reconnectionService.getMetrics();
  }

  /**
   * Check if currently attempting reconnection
   */
  public isReconnecting(): boolean {
    return this.reconnectionService.isCurrentlyReconnecting();
  }

  /**
   * Force circuit breaker open (for external health management)
   */
  public forceCircuitOpen(reason: string): void {
    this.realTimeAssessment.forceCircuitOpen(reason);
  }

  /**
   * Get heartbeat service metrics
   */
  public getHeartbeatMetrics() {
    return this.heartbeatService.getMetrics();
  }

  /**
   * Get heartbeat connection health assessment
   */
  public getHeartbeatHealth() {
    return this.heartbeatService.getConnectionHealth();
  }

  /**
   * Force send a heartbeat ping
   */
  public forceHeartbeatPing(): void {
    this.heartbeatService.forcePing();
  }

  /**
   * Check if heartbeat service considers connection alive
   */
  public isHeartbeatAlive(): boolean {
    return this.heartbeatService.isConnectionAlive();
  }

  /**
   * Get adaptive heartbeat metrics
   */
  public getAdaptiveHeartbeatMetrics() {
    return this.adaptiveHeartbeatManager.getMetrics();
  }

  /**
   * Get adaptive heartbeat recommendations
   */
  public getAdaptiveHeartbeatRecommendations(): string[] {
    return this.adaptiveHeartbeatManager.getRecommendations();
  }

  /**
   * Register an intensive operation that may affect heartbeat
   */
  public registerIntensiveOperation(operation: IntensiveOperation): void {
    this.adaptiveHeartbeatManager.registerIntensiveOperation(operation);
  }

  /**
   * Complete an intensive operation
   */
  public completeIntensiveOperation(operationId: string): void {
    this.adaptiveHeartbeatManager.completeIntensiveOperation(operationId);
  }

  /**
   * Pause adaptive heartbeat for a specific reason
   */
  public pauseAdaptiveHeartbeat(reason: string, context?: string): void {
    this.adaptiveHeartbeatManager.pauseHeartbeat(reason, context);
  }

  /**
   * Resume adaptive heartbeat
   */
  public resumeAdaptiveHeartbeat(reason: string, context?: string): void {
    this.adaptiveHeartbeatManager.resumeHeartbeat(reason, context);
  }

  /**
   * Force adaptation based on external conditions
   */
  public forceHeartbeatAdaptation(condition: any, reason: string): void {
    this.adaptiveHeartbeatManager.forceAdaptation(condition, reason);
  }

  /**
   * Create a TwilioWebSocketManager from a raw WebSocket (legacy compatibility)
   * @param ws Raw WebSocket instance
   * @param connectionId Optional connection ID
   * @deprecated Use createEnhancedConnection for full enhanced capabilities
   */
  public static fromWebSocket(ws: WebSocket, connectionId?: string): TwilioWebSocketManager {
    // Create a minimal enhanced wrapper for backward compatibility
    const callId = connectionId || `legacy-${Date.now()}`;
    const enhancedManager = new EnhancedWebSocketManager(callId, '', {
      maxReconnectAttempts: 3,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      connectionTimeout: 10000
    });
    
    // Override the WebSocket in the enhanced manager for backward compatibility
    (enhancedManager as any).ws = ws;
    (enhancedManager as any).metrics.activeConnections = 1;
    (enhancedManager as any).metrics.totalConnections = 1;
    
    return new TwilioWebSocketManager(enhancedManager, connectionId);
  }
}

/**
 * Factory function to create a Twilio WebSocket manager with backward compatibility
 * @param ws Raw WebSocket instance
 * @param connectionId Optional connection ID
 * @deprecated Use TwilioWebSocketManager.createEnhancedConnection for full enhanced capabilities
 */
export function createTwilioWebSocketManager(ws: WebSocket, connectionId?: string): TwilioWebSocketManager {
  return TwilioWebSocketManager.fromWebSocket(ws, connectionId);
}