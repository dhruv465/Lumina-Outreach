/**
 * Enhanced WebSocket Connection Manager for Call Stability
 * 
 * Provides robust WebSocket connection management with automatic reconnection,
 * health monitoring, and graceful degradation for live voice calls.
 */

import * as WebSocket from 'ws';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { getCallResilienceService } from '../services/callResilienceService';

export interface ConnectionConfig {
  maxReconnectAttempts: number;
  reconnectDelay: number;
  heartbeatInterval: number;
  connectionTimeout: number;
  maxHeartbeatMisses: number;
  pingInterval: number;
  pongTimeout: number;
  // RFC 6455 compliance options
  enableFrameValidation: boolean;
  strictProtocolCompliance: boolean;
  maxFrameSize: number;
  maxMessageSize: number;
  // Enhanced error handling
  errorClassificationEnabled: boolean;
  retryOnProtocolErrors: boolean;
}

export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  reconnectAttempts: number;
  heartbeatMisses: number;
  lastHeartbeat: Date | null;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'failed';
  latency: number;
  errorCount: number;
  messagesSent: number;
  // Enhanced metrics for production monitoring
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  protocolErrors: number;
  networkErrors: number;
  applicationErrors: number;
  frameValidationErrors: number;
  compressionErrors: number;
  fragmentationErrors: number;
  avgReconnectionDelay: number;
  connectionUptime: number;
  lastConnectionTime: Date | null;
  lastDisconnectionTime: Date | null;
  disconnectionReason: string | null;
}

export interface BufferStats {
  size: number;
  maxSize: number;
  overflowCount: number;
  lastCleared: Date;
  // Enhanced buffer management metrics
  totalBufferedMessages: number;
  averageMessageSize: number;
  memoryPressure: 'low' | 'medium' | 'high' | 'critical';
  cleanupCycles: number;
  adaptiveCleanupEnabled: boolean;
}

// RFC 6455 Frame Types and Opcodes
export enum WebSocketOpcode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa
}

// Error classification for better recovery strategies  
export enum ErrorType {
  NETWORK = 'network',
  PROTOCOL = 'protocol', 
  APPLICATION = 'application',
  BUFFER_OVERFLOW = 'buffer_overflow',
  TIMEOUT = 'timeout',
  AUTHENTICATION = 'authentication',
  TWILIO_SPECIFIC = 'twilio_specific'
}

export interface ClassifiedError {
  type: ErrorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  originalError: Error;
  timestamp: Date;
  recoverable: boolean;
  retryCount: number;
}

export class EnhancedWebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: ConnectionConfig;
  private metrics: ConnectionMetrics;
  private bufferStats: BufferStats;
  private callId: string;
  private url: string;
  
  // Timers and intervals
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  
  // Connection state
  private isConnecting = false;
  private isReconnecting = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private lastPingTime = 0;
  
  // Audio buffer management
  private audioBuffer: Buffer[] = [];
  private readonly MAX_BUFFER_SIZE = 30 * 1024 * 1024; // Reduced from 50MB to 30MB
  private readonly BUFFER_CLEANUP_THRESHOLD = 20 * 1024 * 1024; // Reduced from 40MB to 20MB
  private readonly AGGRESSIVE_CLEANUP_THRESHOLD = 25 * 1024 * 1024; // New: 25MB for more aggressive cleanup
  
  // Enhanced error tracking and classification
  private errorHistory: ClassifiedError[] = [];
  private readonly MAX_ERROR_HISTORY = 100;
  
  // Frame validation and protocol compliance
  private frameBuffer: Buffer = Buffer.alloc(0);
  private expectedContinuationFrames = 0;
  private readonly TWILIO_ERROR_CODES = [31924, 31951, 31003, 53400, 53401, 11205];
  
  // Connection quality tracking
  private connectionStartTime: Date | null = null;
  private lastQualityCheck: Date = new Date();
  
  constructor(callId: string, url: string, config: Partial<ConnectionConfig> = {}) {
    super();
    
    this.callId = callId;
    this.url = url;
    
    this.config = {
      maxReconnectAttempts: 5,
      reconnectDelay: 500, // Reduced from 1000 for faster reconnection
      heartbeatInterval: 5000, // Reduced from 10000 for more frequent heartbeats
      connectionTimeout: 15000, // Reduced from 30000 for faster timeout detection
      maxHeartbeatMisses: 2, // Reduced from 3 for faster failure detection
      pingInterval: 10000, // Reduced from 15000 for more frequent pings
      pongTimeout: 3000, // Reduced from 5000 for faster pong timeout
      // RFC 6455 compliance defaults
      enableFrameValidation: true,
      strictProtocolCompliance: true,
      maxFrameSize: 64 * 1024, // 64KB max frame size for Twilio compatibility
      maxMessageSize: 1024 * 1024, // 1MB max message size
      // Enhanced error handling defaults
      errorClassificationEnabled: true,
      retryOnProtocolErrors: false, // Don't retry protocol errors by default
      ...config
    };
    
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      reconnectAttempts: 0,
      heartbeatMisses: 0,
      lastHeartbeat: null,
      connectionQuality: 'excellent',
      latency: 0,
      errorCount: 0,
      messagesSent: 0,
      // Enhanced metrics initialization
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      protocolErrors: 0,
      networkErrors: 0,
      applicationErrors: 0,
      frameValidationErrors: 0,
      compressionErrors: 0,
      fragmentationErrors: 0,
      avgReconnectionDelay: 0,
      connectionUptime: 0,
      lastConnectionTime: null,
      lastDisconnectionTime: null,
      disconnectionReason: null
    };
    
    this.bufferStats = {
      size: 0,
      maxSize: this.MAX_BUFFER_SIZE,
      overflowCount: 0,
      lastCleared: new Date(),
      // Enhanced buffer stats initialization
      totalBufferedMessages: 0,
      averageMessageSize: 0,
      memoryPressure: 'low',
      cleanupCycles: 0,
      adaptiveCleanupEnabled: true
    };
  }
  
  /**
   * Connect to WebSocket with retry logic
   */
  public async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }
    
    this.isConnecting = true;
    
    try {
      await this.establishConnection();
    } catch (error) {
      this.handleConnectionError(error as Error);
    } finally {
      this.isConnecting = false;
    }
  }
  
  /**
   * Establish WebSocket connection
   */
  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`Connecting to WebSocket for call ${this.callId}: ${this.url}`);
      
      // Create WebSocket connection
      this.ws = new (WebSocket as any)(this.url, {
        perMessageDeflate: false,
        handshakeTimeout: this.config.connectionTimeout
      });
      
      // Enhanced timeout handling for Twilio 11205 scenarios
      const connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          logger.warn(`Connection timeout after ${this.config.connectionTimeout}ms for call ${this.callId}`, {
            readyState: this.ws.readyState,
            url: this.url,
            reconnectAttempts: this.reconnectAttempts
          });
          this.ws.terminate();
          reject(new Error(`Twilio WebSocket connection timeout after ${this.config.connectionTimeout}ms - possible 11205 scenario`));
        }
      }, this.config.connectionTimeout);
      
      this.ws.on('open', () => {
        clearTimeout(connectionTimeout);
        this.onConnectionOpen();
        resolve();
      });
      
      this.ws.on('close', (code: number, reason: string) => {
        clearTimeout(connectionTimeout);
        this.onConnectionClose(code, reason);
      });
      
      this.ws.on('error', (error: Error) => {
        clearTimeout(connectionTimeout);
        this.onConnectionError(error);
        reject(error);
      });
      
      this.ws.on('message', (data: WebSocket.Data) => {
        this.onMessage(data);
      });
      
      this.ws.on('pong', () => {
        this.onPong();
      });
    });
  }
  
  /**
   * Handle successful connection
   */
  private onConnectionOpen(): void {
    logger.info(`WebSocket connected for call ${this.callId}`);
    
    this.metrics.totalConnections++;
    this.metrics.activeConnections = 1;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.connectionStartTime = new Date();
    this.metrics.lastConnectionTime = this.connectionStartTime;
    
    // Update connection quality
    this.updateConnectionQuality('excellent');
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Clear any reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Reset frame buffer for RFC compliance
    this.frameBuffer = Buffer.alloc(0);
    this.expectedContinuationFrames = 0;
    
    // Register with resilience service
    const resilienceService = getCallResilienceService();
    resilienceService.registerCall(this.callId);
    
    this.emit('connected');
  }
  
  /**
   * Handle connection close
   */
  private onConnectionClose(code: number, reason: string): void {
    this.metrics.lastDisconnectionTime = new Date();
    this.metrics.disconnectionReason = `Code: ${code}, Reason: ${reason}`;
    
    // Update connection uptime
    if (this.connectionStartTime) {
      this.metrics.connectionUptime += Date.now() - this.connectionStartTime.getTime();
      this.connectionStartTime = null;
    }
    
    logger.warn(`WebSocket closed for call ${this.callId}`, { code, reason });
    
    this.metrics.activeConnections = 0;
    this.updateConnectionQuality('failed');
    this.stopHealthMonitoring();
    
    // Classify the close reason for better error handling
    const error = this.classifyCloseCode(code, reason);
    if (error) {
      this.recordClassifiedError(error);
    }
    
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(
      this.callId,
      new Error(`Connection closed: ${code} ${reason}`),
      'websocket'
    );
    
    // Attempt reconnection based on close code and error classification
    if (this.shouldReconnect && this.shouldAttemptReconnection(code, error)) {
      this.scheduleReconnect();
    }
    
    this.emit('disconnected', code, reason);
  }
  
  /**
   * Handle connection error
   */
  private onConnectionError(error: Error): void {
    logger.error(`WebSocket error for call ${this.callId}:`, error);
    
    this.metrics.errorCount++;
    
    // Classify the error for better handling and recovery
    const classifiedError = this.classifyError(error);
    this.recordClassifiedError(classifiedError);
    
    // Update metrics based on error type
    this.updateMetricsForError(classifiedError);
    
    // Update connection quality based on error severity
    this.updateConnectionQualityFromError(classifiedError);
    
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(this.callId, error, 'websocket');
    
    this.emit('error', { original: error, classified: classifiedError });
  }
  
  /**
   * Handle incoming messages
   */
  private onMessage(data: WebSocket.Data): void {
    try {
      // Update heartbeat and metrics
      this.metrics.lastHeartbeat = new Date();
      this.metrics.heartbeatMisses = 0;
      this.metrics.messagesReceived++;
      
      // Calculate bytes received
      const messageSize = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data.toString(), 'utf8');
      this.metrics.bytesReceived += messageSize;
      
      // Validate frame if RFC compliance is enabled
      if (this.config.enableFrameValidation) {
        const validationResult = this.validateIncomingFrame(data, messageSize);
        if (!validationResult.valid) {
          this.metrics.frameValidationErrors++;
          const error = this.classifyError(new Error(`Frame validation failed: ${validationResult.reason}`));
          this.recordClassifiedError(error);
          
          if (this.config.strictProtocolCompliance) {
            logger.error(`Frame validation failed for call ${this.callId}: ${validationResult.reason}`);
            return; // Drop invalid frames in strict mode
          }
        }
      }
      
      const resilienceService = getCallResilienceService();
      resilienceService.updateHeartbeat(this.callId);
      
      // Handle different message types
      if (Buffer.isBuffer(data)) {
        this.handleBinaryMessage(data);
      } else {
        this.handleTextMessage(data.toString());
      }
      
      this.emit('message', data);
    } catch (error) {
      this.handleMessageError(error as Error);
    }
  }
  
  /**
   * Handle binary messages (audio data)
   */
  private handleBinaryMessage(data: Buffer): void {
    // Add to audio buffer with enhanced metrics
    this.audioBuffer.push(data);
    this.bufferStats.totalBufferedMessages++;
    this.updateBufferStats();
    
    // Calculate memory pressure level
    this.updateMemoryPressureLevel();
    
    // Adaptive cleanup strategy based on memory pressure and connection quality
    const cleanupStrategy = this.determineCleanupStrategy();
    this.executeCleanupStrategy(cleanupStrategy);
    
    // Emit buffer overflow warning if we're near the limit
    if (this.bufferStats.size > this.MAX_BUFFER_SIZE * 0.9) {
      const resilienceService = getCallResilienceService();
      resilienceService.emit('bufferOverflow', this.callId, this.bufferStats.size);
    }
  }
  
  /**
   * Handle text messages (control messages)
   */
  private handleTextMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      // Handle control messages
      if (message.event === 'ping') {
        this.sendPong();
      } else if (message.event === 'start') {
        logger.info(`Stream started for call ${this.callId}`);
      } else if (message.event === 'stop') {
        logger.info(`Stream stopped for call ${this.callId}`);
      }
      
      this.emit('control', message);
    } catch (error) {
      // Not JSON, treat as plain text
      this.emit('text', data);
    }
  }
  
  /**
   * Handle message processing errors
   */
  private handleMessageError(error: Error): void {
    logger.error(`Message processing error for call ${this.callId}:`, error);
    
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(this.callId, error, 'message_processing');
  }
  
  /**
   * Send data through WebSocket with error handling
   */
  public async send(data: WebSocket.Data): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    
    return new Promise((resolve, reject) => {
      this.ws!.send(data, (error) => {
        if (error) {
          this.handleConnectionError(error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send Twilio-compliant message with proper frame handling and validation
   * This method ensures protocol compliance to prevent malformed message errors
   */
  public sendTwilioMessage(data: string | Buffer): boolean {
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        logger.error(`Cannot send Twilio message: WebSocket not connected for call ${this.callId}`);
        return false;
      }

      // Validate and format data for Twilio protocol compliance
      let messageData: string | Buffer;
      let messageSize = 0;
      
      if (typeof data === 'string') {
        // For text messages, validate JSON format and Twilio-specific fields
        try {
          const parsed = JSON.parse(data);
          
          // Validate Twilio message structure
          if (!this.validateTwilioMessageStructure(parsed)) {
            logger.error(`Invalid Twilio message structure for call ${this.callId}`);
            return false;
          }
          
          // Re-stringify to ensure consistent formatting and remove unnecessary whitespace
          messageData = JSON.stringify(parsed);
          messageSize = Buffer.byteLength(messageData, 'utf8');
        } catch (error) {
          logger.error(`Invalid JSON message for call ${this.callId}:`, error);
          this.metrics.protocolErrors++;
          return false;
        }
      } else {
        messageData = data;
        messageSize = data.length;
        
        // Validate binary frame if configured
        if (this.config.enableFrameValidation) {
          const validation = this.validateOutgoingFrame(messageData, messageSize);
          if (!validation.valid) {
            logger.error(`Frame validation failed for call ${this.callId}: ${validation.reason}`);
            this.metrics.frameValidationErrors++;
            return false;
          }
        }
      }

      // Enhanced size validation with Twilio-specific limits
      const maxSize = Math.min(this.config.maxMessageSize, 64 * 1024); // 64KB Twilio limit
      if (messageSize > maxSize) {
        logger.error(`Message too large for Twilio protocol: ${messageSize} bytes (max: ${maxSize}) for call ${this.callId}`);
        this.metrics.protocolErrors++;
        return false;
      }

      // Send with RFC 6455 compliant options for Twilio
      this.ws.send(messageData, {
        binary: Buffer.isBuffer(messageData),
        compress: false, // Disable compression to prevent fragmentation issues
        fin: true, // Ensure message is sent as a complete frame (RFC 6455 requirement)
        mask: undefined // Let WebSocket library handle masking automatically
      });

      // Update enhanced metrics
      this.metrics.messagesSent++;
      this.metrics.bytesSent += messageSize;
      
      // Update buffer stats for message tracking
      this.bufferStats.averageMessageSize = 
        (this.bufferStats.averageMessageSize * (this.metrics.messagesSent - 1) + messageSize) / this.metrics.messagesSent;
      
      return true;
    } catch (error) {
      logger.error(`Failed to send Twilio message for call ${this.callId}:`, error);
      
      // Classify and handle the error
      const classifiedError = this.classifyError(error as Error);
      this.recordClassifiedError(classifiedError);
      this.updateMetricsForError(classifiedError);
      
      this.handleConnectionError(error as Error);
      return false;
    }
  }
  
  /**
   * Send ping to check connection
   */
  private sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.lastPingTime = Date.now();
      this.ws.ping();
      
      // Set pong timeout
      this.pongTimer = setTimeout(() => {
        logger.warn(`Pong timeout for call ${this.callId}`);
        this.metrics.heartbeatMisses++;
        this.updateConnectionQuality('poor');
        
        if (this.metrics.heartbeatMisses >= this.config.maxHeartbeatMisses) {
          this.handleConnectionError(new Error('Heartbeat failed'));
        }
      }, this.config.pongTimeout);
    }
  }
  
  /**
   * Handle pong response
   */
  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    
    // Calculate latency
    const latency = Date.now() - this.lastPingTime;
    this.metrics.latency = latency;
    
    // Update connection quality based on latency
    if (latency < 100) {
      this.updateConnectionQuality('excellent');
    } else if (latency < 300) {
      this.updateConnectionQuality('good');
    } else {
      this.updateConnectionQuality('poor');
    }
    
    logger.debug(`Pong received for call ${this.callId}, latency: ${latency}ms`);
  }
  
  /**
   * Send pong response
   */
  private sendPong(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.pong();
    }
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Start heartbeat monitoring
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, this.config.heartbeatInterval);
    
    // Start ping/pong monitoring
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, this.config.pingInterval);
  }
  
  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }
  
  /**
   * Check heartbeat status
   */
  private checkHeartbeat(): void {
    if (!this.metrics.lastHeartbeat) {
      return;
    }
    
    const timeSinceHeartbeat = Date.now() - this.metrics.lastHeartbeat.getTime();
    
    if (timeSinceHeartbeat > this.config.heartbeatInterval * 2) {
      this.metrics.heartbeatMisses++;
      
      if (this.metrics.heartbeatMisses >= this.config.maxHeartbeatMisses) {
        this.handleConnectionError(new Error('Heartbeat timeout'));
      }
    }
  }
  
  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts reached for call ${this.callId}`);
      this.emit('maxReconnectAttemptsReached');
      return;
    }
    
    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.metrics.reconnectAttempts = this.reconnectAttempts;
    
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info(`Scheduling reconnect for call ${this.callId} in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error(`Reconnect failed for call ${this.callId}:`, error);
        this.scheduleReconnect();
      }
    }, delay);
  }
  
  /**
   * Update connection quality
   */
  private updateConnectionQuality(quality: 'excellent' | 'good' | 'poor' | 'failed'): void {
    if (this.metrics.connectionQuality !== quality) {
      this.metrics.connectionQuality = quality;
      this.emit('qualityChanged', quality);
      
      logger.debug(`Connection quality for call ${this.callId}: ${quality}`);
    }
  }
  
  /**
   * Enhanced update buffer statistics with average calculations
   */
  private updateBufferStats(): void {
    this.bufferStats.size = this.audioBuffer.reduce((total, buffer) => total + buffer.length, 0);
    
    // Update average message size
    if (this.bufferStats.totalBufferedMessages > 0) {
      this.bufferStats.averageMessageSize = this.bufferStats.size / this.audioBuffer.length;
    }
    
    const resilienceService = getCallResilienceService();
    resilienceService.updateAudioBufferSize(this.callId, this.bufferStats.size);
  }
  
  /**
   * Clean up audio buffer
   */
  private cleanupAudioBuffer(): void {
    // Keep only the last 25% of the buffer
    const keepCount = Math.floor(this.audioBuffer.length * 0.25);
    this.audioBuffer = this.audioBuffer.slice(-keepCount);
    
    this.updateBufferStats();
    this.bufferStats.lastCleared = new Date();
    
    logger.info(`Audio buffer cleaned for call ${this.callId}, size: ${this.bufferStats.size}`);
  }

  /**
   * Aggressive cleanup for severe buffer overflow
   */
  private aggressiveCleanupAudioBuffer(): void {
    // Keep only the last 10% of the buffer in aggressive mode
    const keepCount = Math.floor(this.audioBuffer.length * 0.1);
    this.audioBuffer = this.audioBuffer.slice(-keepCount);
    
    this.updateBufferStats();
    this.bufferStats.lastCleared = new Date();
    this.bufferStats.overflowCount++;
    
    logger.warn(`Aggressive audio buffer cleanup performed for call ${this.callId}, size: ${this.bufferStats.size}, overflow count: ${this.bufferStats.overflowCount}`);
    
    // Report to resilience service
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(
      this.callId,
      new Error(`Audio buffer overflow requiring aggressive cleanup`),
      'buffer_management'
    );
  }
  
  /**
   * Get connection metrics
   */
  public getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get buffer statistics
   */
  public getBufferStats(): BufferStats {
    return { ...this.bufferStats };
  }
  
  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Handle connection error and trigger resilience measures
   */
  private handleConnectionError(error: Error): void {
    this.onConnectionError(error);
    
    // Activate fallback if available
    const resilienceService = getCallResilienceService();
    resilienceService.activateFallback(this.callId, `WebSocket error: ${error.message}`);
  }
  
  /**
   * Get the underlying WebSocket instance
   * Used for integration with other WebSocket managers
   */
  public getWebSocket(): WebSocket | null {
    return this.ws;
  }

  // ==================== Enhanced Error Classification Methods ====================

  /**
   * Classify error based on type and content for better recovery strategies
   */
  private classifyError(error: Error): ClassifiedError {
    const errorMessage = error.message.toLowerCase();
    let type: ErrorType = ErrorType.APPLICATION;
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let recoverable = true;

    // Twilio-specific errors (check first to avoid conflicts with generic terms)
    if (this.TWILIO_ERROR_CODES.some(code => errorMessage.includes(code.toString())) ||
        errorMessage.includes('twilio') || errorMessage.includes('malformed') ||
        errorMessage.includes('31924') || errorMessage.includes('31951') ||
        errorMessage.includes('11205') || errorMessage.includes('connection closed by server') ||
        errorMessage.includes('websocket connection closed')) {
      type = ErrorType.TWILIO_SPECIFIC;
      
      // Special handling for 11205 (server-initiated connection closure)
      if (errorMessage.includes('11205') || errorMessage.includes('connection closed by server') ||
          errorMessage.includes('websocket connection closed')) {
        severity = 'high'; // Less critical than protocol errors but needs immediate attention
        recoverable = true;
        logger.warn('Twilio error 11205 detected - WebSocket connection closed by server', {
          error: error.message,
          callId: this.callId,
          timestamp: new Date().toISOString()
        });
      } else {
        severity = 'critical';
        recoverable = true; // Twilio errors are often recoverable with reconnection
      }
    }
    // Network-related errors
    else if (errorMessage.includes('econnrefused') || errorMessage.includes('enotfound') ||
        errorMessage.includes('timeout') || errorMessage.includes('network') ||
        errorMessage.includes('connection') || errorMessage.includes('econnreset')) {
      type = ErrorType.NETWORK;
      severity = 'high';
      recoverable = true;
    }
    // Protocol errors (RFC 6455 violations)
    else if (errorMessage.includes('protocol') || errorMessage.includes('frame') ||
             errorMessage.includes('opcode') || errorMessage.includes('fragmentation') ||
             errorMessage.includes('close code') || errorMessage.includes('invalid')) {
      type = ErrorType.PROTOCOL;
      severity = 'critical';
      recoverable = this.config.retryOnProtocolErrors;
    }
    // Buffer overflow errors
    else if (errorMessage.includes('buffer') || errorMessage.includes('overflow') ||
             errorMessage.includes('memory')) {
      type = ErrorType.BUFFER_OVERFLOW;
      severity = 'high';
      recoverable = true;
    }
    // Timeout errors
    else if (errorMessage.includes('timeout') || errorMessage.includes('pong') ||
             errorMessage.includes('heartbeat')) {
      type = ErrorType.TIMEOUT;
      severity = 'medium';
      recoverable = true;
    }
    // Authentication errors
    else if (errorMessage.includes('auth') || errorMessage.includes('unauthorized') ||
             errorMessage.includes('forbidden') || errorMessage.includes('401') ||
             errorMessage.includes('403')) {
      type = ErrorType.AUTHENTICATION;
      severity = 'critical';
      recoverable = false;
    }

    return {
      type,
      severity,
      message: error.message,
      originalError: error,
      timestamp: new Date(),
      recoverable,
      retryCount: 0
    };
  }

  /**
   * Classify WebSocket close codes for better error handling
   */
  private classifyCloseCode(code: number, reason: string): ClassifiedError | null {
    let type: ErrorType = ErrorType.NETWORK;
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let recoverable = true;

    switch (code) {
      case 1000: // Normal closure
        // Check for server-initiated closures that may indicate Twilio error 11205
        if (reason && 
            (reason.toLowerCase().includes('server') || 
             reason.toLowerCase().includes('twilio') ||
             reason.toLowerCase().includes('closed'))) {
          type = ErrorType.TWILIO_SPECIFIC;
          severity = 'high';
          recoverable = true;
          logger.info('Detected potential Twilio 11205 scenario - server-initiated closure', {
            code,
            reason: reason.toString(),
            callId: this.callId
          });
          break;
        }
        return null; // Normal closure, not an error
      case 1001: // Going away
        type = ErrorType.NETWORK;
        severity = 'low';
        recoverable = true;
        break;
      case 1002: // Protocol error
      case 1007: // Invalid frame payload data
      case 1010: // Mandatory extension
        type = ErrorType.PROTOCOL;
        severity = 'critical';
        recoverable = this.config.retryOnProtocolErrors;
        break;
      case 1003: // Unsupported data
        type = ErrorType.APPLICATION;
        severity = 'high';
        recoverable = false;
        break;
      case 1006: // Abnormal closure
      case 1015: // TLS handshake failure
        type = ErrorType.NETWORK;
        severity = 'high';
        recoverable = true;
        break;
      case 1011: // Internal server error
        type = ErrorType.APPLICATION;
        severity = 'critical';
        recoverable = true;
        break;
      default:
        if (code >= 4000 && code <= 4999) {
          // Twilio-specific codes
          type = ErrorType.TWILIO_SPECIFIC;
          severity = 'critical';
          recoverable = true;
        }
    }

    return {
      type,
      severity,
      message: `WebSocket closed with code ${code}: ${reason}`,
      originalError: new Error(`WebSocket close code ${code}`),
      timestamp: new Date(),
      recoverable,
      retryCount: 0
    };
  }

  /**
   * Record classified error in history for analysis
   */
  private recordClassifiedError(error: ClassifiedError): void {
    this.errorHistory.push(error);
    
    // Keep only recent errors
    if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
      this.errorHistory = this.errorHistory.slice(-this.MAX_ERROR_HISTORY);
    }

    // Log error with classification
    logger.error(`Classified error for call ${this.callId}`, {
      type: error.type,
      severity: error.severity,
      recoverable: error.recoverable,
      message: error.message
    });
  }

  /**
   * Update metrics based on error type
   */
  private updateMetricsForError(error: ClassifiedError): void {
    switch (error.type) {
      case ErrorType.NETWORK:
        this.metrics.networkErrors++;
        break;
      case ErrorType.PROTOCOL:
        this.metrics.protocolErrors++;
        break;
      case ErrorType.APPLICATION:
        this.metrics.applicationErrors++;
        break;
      case ErrorType.TWILIO_SPECIFIC:
        this.metrics.protocolErrors++; // Twilio errors are protocol-related
        break;
    }
  }

  /**
   * Update connection quality based on error severity
   */
  private updateConnectionQualityFromError(error: ClassifiedError): void {
    switch (error.severity) {
      case 'critical':
        this.updateConnectionQuality('failed');
        break;
      case 'high':
        this.updateConnectionQuality('poor');
        break;
      case 'medium':
        if (this.metrics.connectionQuality === 'excellent') {
          this.updateConnectionQuality('good');
        }
        break;
      // 'low' severity doesn't change quality
    }
  }

  // ==================== RFC 6455 Frame Validation Methods ====================

  /**
   * Validate incoming WebSocket frame for RFC 6455 compliance
   */
  private validateIncomingFrame(data: WebSocket.Data, size: number): { valid: boolean; reason?: string } {
    // Basic size validation
    if (size > this.config.maxFrameSize) {
      return { valid: false, reason: `Frame size ${size} exceeds maximum ${this.config.maxFrameSize}` };
    }

    // For binary frames, check if it's a valid audio format (basic check)
    if (Buffer.isBuffer(data)) {
      // Audio frames should have minimum size for valid audio data
      if (size < 32 && size > 0) {
        return { valid: false, reason: 'Binary frame too small to be valid audio data' };
      }
    } else {
      // Text frames should be valid UTF-8 and proper JSON for Twilio
      try {
        const textData = data.toString();
        if (textData.trim()) {
          JSON.parse(textData);
        }
      } catch (error) {
        return { valid: false, reason: 'Text frame contains invalid JSON' };
      }
    }

    return { valid: true };
  }

  /**
   * Validate outgoing WebSocket frame for RFC 6455 compliance
   */
  private validateOutgoingFrame(data: string | Buffer, size: number): { valid: boolean; reason?: string } {
    // Basic size validation
    if (size > this.config.maxFrameSize) {
      return { valid: false, reason: `Frame size ${size} exceeds maximum ${this.config.maxFrameSize}` };
    }

    if (size === 0) {
      return { valid: false, reason: 'Empty frame not allowed' };
    }

    return { valid: true };
  }

  /**
   * Validate Twilio message structure for protocol compliance
   */
  private validateTwilioMessageStructure(message: any): boolean {
    if (!message || typeof message !== 'object') {
      return false;
    }

    // Check for required Twilio fields based on message type
    if (message.event) {
      // Control messages should have event field
      return typeof message.event === 'string';
    } else if (message.media) {
      // Media messages should have media field with payload
      return message.media.payload && typeof message.media.payload === 'string';
    }

    // Allow other message types but ensure they're objects
    return true;
  }

  // ==================== Enhanced Buffer Management Methods ====================

  /**
   * Update memory pressure level based on current buffer state
   */
  private updateMemoryPressureLevel(): void {
    const pressureRatio = this.bufferStats.size / this.MAX_BUFFER_SIZE;
    
    if (pressureRatio >= 0.9) {
      this.bufferStats.memoryPressure = 'critical';
    } else if (pressureRatio >= 0.7) {
      this.bufferStats.memoryPressure = 'high';
    } else if (pressureRatio >= 0.4) {
      this.bufferStats.memoryPressure = 'medium';
    } else {
      this.bufferStats.memoryPressure = 'low';
    }
  }

  /**
   * Determine cleanup strategy based on memory pressure and connection quality
   */
  private determineCleanupStrategy(): 'none' | 'gentle' | 'moderate' | 'aggressive' | 'critical' {
    const pressureLevel = this.bufferStats.memoryPressure;
    const quality = this.metrics.connectionQuality;
    
    // Critical pressure always requires aggressive cleanup
    if (pressureLevel === 'critical') {
      return 'critical';
    }
    
    // High pressure with poor connection requires aggressive cleanup
    if (pressureLevel === 'high' && (quality === 'poor' || quality === 'failed')) {
      return 'aggressive';
    }
    
    // High pressure with good connection uses moderate cleanup
    if (pressureLevel === 'high') {
      return 'moderate';
    }
    
    // Medium pressure with poor connection uses gentle cleanup
    if (pressureLevel === 'medium' && quality === 'poor') {
      return 'gentle';
    }
    
    return 'none';
  }

  /**
   * Execute cleanup strategy based on determined approach
   */
  private executeCleanupStrategy(strategy: 'none' | 'gentle' | 'moderate' | 'aggressive' | 'critical'): void {
    switch (strategy) {
      case 'gentle':
        this.gentleCleanupAudioBuffer(0.8); // Keep 80%
        break;
      case 'moderate':
        this.cleanupAudioBuffer(); // Keep 25% (existing method)
        break;
      case 'aggressive':
        this.aggressiveCleanupAudioBuffer(); // Keep 10% (existing method)
        break;
      case 'critical':
        this.criticalCleanupAudioBuffer(); // Keep 5%
        break;
      case 'none':
      default:
        // No cleanup needed
        break;
    }
  }

  /**
   * Gentle cleanup - keeps more data for high-quality connections
   */
  private gentleCleanupAudioBuffer(keepRatio = 0.8): void {
    const keepCount = Math.floor(this.audioBuffer.length * keepRatio);
    this.audioBuffer = this.audioBuffer.slice(-keepCount);
    
    this.updateBufferStats();
    this.bufferStats.lastCleared = new Date();
    this.bufferStats.cleanupCycles++;
    
    logger.debug(`Gentle audio buffer cleanup performed for call ${this.callId}, kept ${keepRatio * 100}%, size: ${this.bufferStats.size}`);
  }

  /**
   * Critical cleanup for emergency situations
   */
  private criticalCleanupAudioBuffer(): void {
    // Keep only the last 5% of the buffer in critical mode
    const keepCount = Math.floor(this.audioBuffer.length * 0.05);
    this.audioBuffer = this.audioBuffer.slice(-keepCount);
    
    this.updateBufferStats();
    this.bufferStats.lastCleared = new Date();
    this.bufferStats.overflowCount++;
    this.bufferStats.cleanupCycles++;
    
    logger.error(`Critical audio buffer cleanup performed for call ${this.callId}, size: ${this.bufferStats.size}, overflow count: ${this.bufferStats.overflowCount}`);
    
    // Report to resilience service
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(
      this.callId,
      new Error(`Critical audio buffer overflow requiring emergency cleanup`),
      'buffer_management'
    );
  }

  // ==================== Enhanced Reconnection Logic ====================

  /**
   * Determine if reconnection should be attempted based on error classification
   */
  private shouldAttemptReconnection(code: number, error: ClassifiedError | null): boolean {
    // Normal closure - but check for Twilio 11205 patterns first
    if (code === 1000) {
      // For Twilio 11205 scenarios, server-initiated closures should trigger reconnection
      if (error?.type === ErrorType.TWILIO_SPECIFIC && error?.recoverable) {
        logger.info('Allowing reconnection for potential Twilio 11205 server closure', {
          code,
          error: error?.message,
          callId: this.callId
        });
        return true;
      }
      return false;
    }

    // Authentication errors - no reconnection
    if (error?.type === ErrorType.AUTHENTICATION) {
      return false;
    }

    // Protocol errors - only if configured to retry
    if (error?.type === ErrorType.PROTOCOL && !this.config.retryOnProtocolErrors) {
      return false;
    }

    // Enhanced handling for Twilio-specific errors including 11205
    if (error?.type === ErrorType.TWILIO_SPECIFIC) {
      // Always attempt reconnection for Twilio errors as they're often recoverable
      logger.info('Attempting reconnection for Twilio-specific error', {
        code,
        error: error?.message,
        callId: this.callId,
        severity: error?.severity
      });
      return true;
    }

    // Check if we've hit the retry limit for this error type
    if (error && !error.recoverable) {
      return false;
    }

    return true;
  }



  /**
   * Gracefully close connection
   */
  public close(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.stopHealthMonitoring();
    
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    
    // Clear audio buffer
    this.audioBuffer = [];
    this.updateBufferStats();
    
    // Unregister from resilience service
    const resilienceService = getCallResilienceService();
    resilienceService.unregisterCall(this.callId);
    
    logger.info(`WebSocket connection closed for call ${this.callId}`);
  }
  
  /**
   * Force terminate connection
   */
  public terminate(): void {
    this.shouldReconnect = false;
    
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    
    this.close();
  }
}

export default EnhancedWebSocketManager;