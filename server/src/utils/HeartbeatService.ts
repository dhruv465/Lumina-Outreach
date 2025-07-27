/**
 * Bidirectional Heartbeat Service
 * 
 * Implements comprehensive ping/pong mechanism with configurable intervals,
 * latency calculation, connection liveness detection, and timeout handling.
 * 
 * Requirements: 1.1, 1.3, 2.4
 */

import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import logger from './logger';

export interface HeartbeatConfig {
  pingInterval: number;           // Interval between ping messages (ms)
  pongTimeout: number;           // Timeout waiting for pong response (ms)
  maxMissedHeartbeats: number;   // Max consecutive missed heartbeats before declaring dead
  adaptiveInterval: boolean;     // Whether to adapt interval based on connection quality
  minInterval: number;           // Minimum ping interval (ms)
  maxInterval: number;           // Maximum ping interval (ms)
  latencyThreshold: number;      // Latency threshold for interval adjustment (ms)
}

export interface HeartbeatMetrics {
  isAlive: boolean;
  currentInterval: number;
  averageLatency: number;
  lastPingTime: Date | null;
  lastPongTime: Date | null;
  missedHeartbeats: number;
  totalPings: number;
  totalPongs: number;
  latencyHistory: number[];
  timeoutCount: number;
  connectionAge: number; // ms since heartbeat started
}

export interface HeartbeatEvent {
  type: 'PING_SENT' | 'PONG_RECEIVED' | 'TIMEOUT' | 'MISSED_HEARTBEAT' | 'CONNECTION_DEAD' | 'INTERVAL_ADJUSTED';
  timestamp: Date;
  latency?: number;
  interval?: number;
  missedCount?: number;
  context?: Record<string, any>;
}

export class HeartbeatService extends EventEmitter {
  private ws: WebSocket;
  private config: HeartbeatConfig;
  private connectionId: string;
  
  // State tracking
  private isActive: boolean = false;
  private isAlive: boolean = true;
  private currentInterval: number;
  private missedHeartbeats: number = 0;
  private totalPings: number = 0;
  private totalPongs: number = 0;
  private timeoutCount: number = 0;
  
  // Timing tracking
  private lastPingTime: Date | null = null;
  private lastPongTime: Date | null = null;
  private startTime: Date = new Date();
  private latencyHistory: number[] = [];
  
  // Intervals and timeouts
  private pingInterval?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;
  
  // Event history
  private eventHistory: HeartbeatEvent[] = [];
  
  // Default configuration
  private static readonly DEFAULT_CONFIG: HeartbeatConfig = {
    pingInterval: 30000,        // 30 seconds
    pongTimeout: 10000,         // 10 seconds
    maxMissedHeartbeats: 3,     // 3 missed heartbeats = dead
    adaptiveInterval: true,     // Adapt based on connection quality
    minInterval: 10000,         // Minimum 10 seconds
    maxInterval: 60000,         // Maximum 60 seconds
    latencyThreshold: 500       // 500ms latency threshold
  };

  constructor(ws: WebSocket, connectionId: string, config?: Partial<HeartbeatConfig>) {
    super();
    this.ws = ws;
    this.connectionId = connectionId;
    this.config = { ...HeartbeatService.DEFAULT_CONFIG, ...config };
    this.currentInterval = this.config.pingInterval;
    
    this.setupWebSocketHandlers();
  }

  /**
   * Start the heartbeat service
   */
  public start(): void {
    if (this.isActive) {
      logger.warn(`Heartbeat service already active for connection ${this.connectionId}`);
      return;
    }

    this.isActive = true;
    this.isAlive = true;
    this.startTime = new Date();
    
    logger.info(`Starting heartbeat service for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      interval: this.currentInterval,
      adaptiveInterval: this.config.adaptiveInterval
    });

    this.scheduleNextPing();
    
    this.addEvent({
      type: 'PING_SENT',
      timestamp: new Date(),
      context: { action: 'service_started', interval: this.currentInterval }
    });
  }

  /**
   * Stop the heartbeat service
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    
    if (this.pingInterval) {
      clearTimeout(this.pingInterval);
      this.pingInterval = undefined;
    }
    
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
    }

    logger.info(`Stopped heartbeat service for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      totalPings: this.totalPings,
      totalPongs: this.totalPongs,
      averageLatency: this.getAverageLatency()
    });
  }

  /**
   * Get current heartbeat metrics
   */
  public getMetrics(): HeartbeatMetrics {
    return {
      isAlive: this.isAlive,
      currentInterval: this.currentInterval,
      averageLatency: this.getAverageLatency(),
      lastPingTime: this.lastPingTime,
      lastPongTime: this.lastPongTime,
      missedHeartbeats: this.missedHeartbeats,
      totalPings: this.totalPings,
      totalPongs: this.totalPongs,
      latencyHistory: [...this.latencyHistory],
      timeoutCount: this.timeoutCount,
      connectionAge: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * Get recent heartbeat events
   */
  public getRecentEvents(limit: number = 10): HeartbeatEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Force send a ping (for testing or manual triggering)
   */
  public forcePing(): void {
    if (!this.isActive || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot force ping - service inactive or WebSocket not open`, {
        connectionId: this.connectionId,
        isActive: this.isActive,
        readyState: this.ws.readyState
      });
      return;
    }

    this.sendPing();
  }

  /**
   * Check if connection is considered alive
   */
  public isConnectionAlive(): boolean {
    return this.isAlive && this.missedHeartbeats < this.config.maxMissedHeartbeats;
  }

  /**
   * Get connection health assessment based on heartbeat data
   */
  public getConnectionHealth(): {
    isHealthy: boolean;
    quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const metrics = this.getMetrics();
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    let quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' = 'excellent';
    let isHealthy = true;

    // Check if connection is alive
    if (!this.isAlive) {
      quality = 'critical';
      isHealthy = false;
      issues.push('Connection declared dead');
      recommendations.push('Immediate reconnection required');
    } else if (this.missedHeartbeats > 0) {
      if (this.missedHeartbeats >= this.config.maxMissedHeartbeats - 1) {
        quality = 'critical';
        isHealthy = false;
        issues.push(`${this.missedHeartbeats} consecutive missed heartbeats`);
        recommendations.push('Connection may be failing - prepare for reconnection');
      } else {
        quality = 'poor';
        issues.push(`${this.missedHeartbeats} missed heartbeats`);
        recommendations.push('Monitor connection closely');
      }
    }

    // Check latency
    const avgLatency = this.getAverageLatency();
    if (avgLatency > 2000) {
      quality = quality === 'excellent' ? 'poor' : quality;
      issues.push(`High average latency: ${avgLatency}ms`);
      recommendations.push('Consider connection optimization');
    } else if (avgLatency > 1000) {
      quality = quality === 'excellent' ? 'fair' : quality;
      issues.push(`Elevated latency: ${avgLatency}ms`);
    }

    // Check timeout rate
    const timeoutRate = this.totalPings > 0 ? this.timeoutCount / this.totalPings : 0;
    if (timeoutRate > 0.2) { // More than 20% timeouts
      quality = quality === 'excellent' ? 'poor' : quality;
      issues.push(`High timeout rate: ${(timeoutRate * 100).toFixed(1)}%`);
      recommendations.push('Investigate network stability');
    }

    // Check response rate
    const responseRate = this.totalPings > 0 ? this.totalPongs / this.totalPings : 1;
    if (responseRate < 0.8) { // Less than 80% response rate
      quality = quality === 'excellent' ? 'poor' : quality;
      isHealthy = false;
      issues.push(`Low response rate: ${(responseRate * 100).toFixed(1)}%`);
      recommendations.push('Connection reliability issues detected');
    }

    return {
      isHealthy,
      quality,
      issues,
      recommendations
    };
  }

  /**
   * Clean up old data and events
   */
  public cleanup(): void {
    // Keep only recent latency history (last 50 measurements)
    if (this.latencyHistory.length > 50) {
      this.latencyHistory = this.latencyHistory.slice(-50);
    }

    // Keep only recent events (last 100)
    if (this.eventHistory.length > 100) {
      this.eventHistory = this.eventHistory.slice(-100);
    }
  }

  // Private methods

  private setupWebSocketHandlers(): void {
    // Handle pong responses
    this.ws.on('pong', (data: Buffer) => {
      this.handlePongReceived(data);
    });

    // Handle ping from remote (respond with pong)
    this.ws.on('ping', (data: Buffer) => {
      this.handlePingReceived(data);
    });

    // Handle connection close
    this.ws.on('close', () => {
      this.stop();
    });
  }

  private scheduleNextPing(): void {
    if (!this.isActive) {
      return;
    }

    this.pingInterval = setTimeout(() => {
      this.sendPing();
    }, this.currentInterval);
  }

  private sendPing(): void {
    if (!this.isActive || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const now = new Date();
    this.lastPingTime = now;
    this.totalPings++;

    // Create ping payload with timestamp for latency calculation
    const pingPayload = Buffer.from(JSON.stringify({
      timestamp: now.getTime(),
      connectionId: this.connectionId,
      sequence: this.totalPings
    }));

    try {
      // Send WebSocket ping frame
      this.ws.ping(pingPayload);

      logger.debug(`Sent heartbeat ping for connection ${this.connectionId}`, {
        connectionId: this.connectionId,
        sequence: this.totalPings,
        interval: this.currentInterval
      });

      this.addEvent({
        type: 'PING_SENT',
        timestamp: now,
        context: { sequence: this.totalPings, interval: this.currentInterval }
      });

      // Set timeout for pong response
      this.setPongTimeout();

      // Schedule next ping
      this.scheduleNextPing();

    } catch (error) {
      logger.error(`Failed to send heartbeat ping for connection ${this.connectionId}:`, error);
      this.handlePingError(error);
    }
  }

  private setPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
    }

    this.pongTimeout = setTimeout(() => {
      this.handlePongTimeout();
    }, this.config.pongTimeout);
  }

  private handlePongReceived(data: Buffer): void {
    const now = new Date();
    this.lastPongTime = now;
    this.totalPongs++;

    // Clear pong timeout
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
    }

    // Calculate latency
    let latency = 0;
    try {
      const payload = JSON.parse(data.toString());
      if (payload.timestamp) {
        latency = now.getTime() - payload.timestamp;
        this.recordLatency(latency);
      }
    } catch (error) {
      // If we can't parse payload, use time since last ping
      if (this.lastPingTime) {
        latency = now.getTime() - this.lastPingTime.getTime();
        this.recordLatency(latency);
      }
    }

    // Reset missed heartbeats counter
    this.missedHeartbeats = 0;
    this.isAlive = true;

    logger.debug(`Received heartbeat pong for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      latency,
      totalPongs: this.totalPongs
    });

    this.addEvent({
      type: 'PONG_RECEIVED',
      timestamp: now,
      latency,
      context: { totalPongs: this.totalPongs }
    });

    // Emit pong event for external listeners
    this.emit('pong', { latency, connectionId: this.connectionId });

    // Adjust interval if adaptive mode is enabled
    if (this.config.adaptiveInterval) {
      this.adjustIntervalBasedOnLatency(latency);
    }
  }

  private handlePingReceived(data: Buffer): void {
    // Respond to ping with pong
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.pong(data);
        logger.debug(`Responded to ping with pong for connection ${this.connectionId}`);
      } catch (error) {
        logger.error(`Failed to respond to ping for connection ${this.connectionId}:`, error);
      }
    }
  }

  private handlePongTimeout(): void {
    this.timeoutCount++;
    this.missedHeartbeats++;

    logger.warn(`Heartbeat pong timeout for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      missedHeartbeats: this.missedHeartbeats,
      maxMissedHeartbeats: this.config.maxMissedHeartbeats
    });

    this.addEvent({
      type: 'TIMEOUT',
      timestamp: new Date(),
      missedCount: this.missedHeartbeats,
      context: { timeoutCount: this.timeoutCount }
    });

    // Check if connection should be declared dead
    if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
      this.declareConnectionDead();
    } else {
      this.addEvent({
        type: 'MISSED_HEARTBEAT',
        timestamp: new Date(),
        missedCount: this.missedHeartbeats
      });

      // Emit missed heartbeat event
      this.emit('missedHeartbeat', {
        missedCount: this.missedHeartbeats,
        connectionId: this.connectionId
      });
    }
  }

  private handlePingError(error: any): void {
    logger.error(`Ping error for connection ${this.connectionId}:`, error);
    this.missedHeartbeats++;

    if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
      this.declareConnectionDead();
    }
  }

  private declareConnectionDead(): void {
    this.isAlive = false;

    logger.error(`Connection declared dead for ${this.connectionId}`, {
      connectionId: this.connectionId,
      missedHeartbeats: this.missedHeartbeats,
      totalPings: this.totalPings,
      totalPongs: this.totalPongs
    });

    this.addEvent({
      type: 'CONNECTION_DEAD',
      timestamp: new Date(),
      missedCount: this.missedHeartbeats,
      context: {
        totalPings: this.totalPings,
        totalPongs: this.totalPongs,
        averageLatency: this.getAverageLatency()
      }
    });

    // Emit connection dead event
    this.emit('connectionDead', {
      connectionId: this.connectionId,
      missedHeartbeats: this.missedHeartbeats,
      metrics: this.getMetrics()
    });

    // Stop the service
    this.stop();
  }

  private recordLatency(latency: number): void {
    this.latencyHistory.push(latency);

    // Keep history manageable
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }
  }

  private getAverageLatency(): number {
    if (this.latencyHistory.length === 0) {
      return 0;
    }

    const sum = this.latencyHistory.reduce((acc, latency) => acc + latency, 0);
    return Math.round(sum / this.latencyHistory.length);
  }

  private adjustIntervalBasedOnLatency(latency: number): void {
    if (!this.config.adaptiveInterval) {
      return;
    }

    const avgLatency = this.getAverageLatency();
    let newInterval = this.currentInterval;

    // Increase interval for high latency connections
    if (avgLatency > this.config.latencyThreshold) {
      newInterval = Math.min(this.currentInterval * 1.2, this.config.maxInterval);
    }
    // Decrease interval for low latency connections
    else if (avgLatency < this.config.latencyThreshold / 2) {
      newInterval = Math.max(this.currentInterval * 0.9, this.config.minInterval);
    }

    // Only adjust if change is significant (more than 10%)
    if (Math.abs(newInterval - this.currentInterval) > this.currentInterval * 0.1) {
      const oldInterval = this.currentInterval;
      this.currentInterval = Math.round(newInterval);

      logger.debug(`Adjusted heartbeat interval for connection ${this.connectionId}`, {
        connectionId: this.connectionId,
        oldInterval,
        newInterval: this.currentInterval,
        averageLatency: avgLatency
      });

      this.addEvent({
        type: 'INTERVAL_ADJUSTED',
        timestamp: new Date(),
        interval: this.currentInterval,
        context: {
          oldInterval,
          averageLatency: avgLatency,
          reason: avgLatency > this.config.latencyThreshold ? 'high_latency' : 'low_latency'
        }
      });
    }
  }

  private addEvent(event: HeartbeatEvent): void {
    this.eventHistory.push(event);

    // Keep history manageable
    if (this.eventHistory.length > 200) {
      this.eventHistory = this.eventHistory.slice(-150);
    }
  }
}