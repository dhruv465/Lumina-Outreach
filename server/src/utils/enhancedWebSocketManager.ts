/**
 * Enhanced WebSocket Connection Manager for Call Stability
 * 
 * Provides robust WebSocket connection management with automatic reconnection,
 * health monitoring, and graceful degradation for live voice calls.
 */

import * as WebSocket from 'ws';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { getCallResilienceService } from './callResilienceService';

export interface ConnectionConfig {
  maxReconnectAttempts: number;
  reconnectDelay: number;
  heartbeatInterval: number;
  connectionTimeout: number;
  maxHeartbeatMisses: number;
  pingInterval: number;
  pongTimeout: number;
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
}

export interface BufferStats {
  size: number;
  maxSize: number;
  overflowCount: number;
  lastCleared: Date;
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
  private readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB
  private readonly BUFFER_CLEANUP_THRESHOLD = 40 * 1024 * 1024; // 40MB
  
  constructor(callId: string, url: string, config: Partial<ConnectionConfig> = {}) {
    super();
    
    this.callId = callId;
    this.url = url;
    
    this.config = {
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 10000,
      connectionTimeout: 30000,
      maxHeartbeatMisses: 3,
      pingInterval: 15000,
      pongTimeout: 5000,
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
      errorCount: 0
    };
    
    this.bufferStats = {
      size: 0,
      maxSize: this.MAX_BUFFER_SIZE,
      overflowCount: 0,
      lastCleared: new Date()
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
      this.ws = new WebSocket(this.url, {
        perMessageDeflate: false,
        handshakeTimeout: this.config.connectionTimeout
      });
      
      const connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.ws.terminate();
          reject(new Error('Connection timeout'));
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
    
    // Update connection quality
    this.updateConnectionQuality('excellent');
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Clear any reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Register with resilience service
    const resilienceService = getCallResilienceService();
    resilienceService.registerCall(this.callId);
    
    this.emit('connected');
  }
  
  /**
   * Handle connection close
   */
  private onConnectionClose(code: number, reason: string): void {
    logger.warn(`WebSocket closed for call ${this.callId}`, { code, reason });
    
    this.metrics.activeConnections = 0;
    this.stopHealthMonitoring();
    
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(
      this.callId,
      new Error(`Connection closed: ${code} ${reason}`),
      'websocket'
    );
    
    // Attempt reconnection if appropriate
    if (this.shouldReconnect && code !== 1000) { // 1000 = normal closure
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
    this.updateConnectionQuality('failed');
    
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(this.callId, error, 'websocket');
    
    this.emit('error', error);
  }
  
  /**
   * Handle incoming messages
   */
  private onMessage(data: WebSocket.Data): void {
    try {
      // Update heartbeat
      this.metrics.lastHeartbeat = new Date();
      this.metrics.heartbeatMisses = 0;
      
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
    // Add to audio buffer
    this.audioBuffer.push(data);
    this.updateBufferStats();
    
    // Check for buffer overflow
    if (this.bufferStats.size > this.BUFFER_CLEANUP_THRESHOLD) {
      this.cleanupAudioBuffer();
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
   * Update buffer statistics
   */
  private updateBufferStats(): void {
    this.bufferStats.size = this.audioBuffer.reduce((total, buffer) => total + buffer.length, 0);
    
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