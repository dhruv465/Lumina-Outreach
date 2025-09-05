/**
 * Session Manager
 * 
 * Implements session-aware WebSocket handling with lifecycle management,
 * session-specific health monitoring, and session binding capabilities.
 * 
 * Requirements: 1.2, 4.1, 4.2
 */

import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import { TwilioWebSocketManager } from './TwilioWebSocketManager';
import { AdaptiveHeartbeatManager } from './AdaptiveHeartbeatManager';
import logger from './logger';
import { CompatibleWebSocket } from './websocketCompatibility';

export interface SessionConfig {
  sessionId: string;
  callId: string;
  conversationId: string;
  userId?: string;
  campaignId?: string;
  leadId?: string;
  sessionType: 'voice_call' | 'test_call' | 'webhook' | 'admin';
  priority: 'low' | 'medium' | 'high' | 'critical';
  maxDuration?: number;        // Maximum session duration in ms
  idleTimeout?: number;        // Idle timeout in ms
  healthCheckInterval?: number; // Health check interval in ms
}

export interface SessionMetrics {
  sessionId: string;
  startTime: Date;
  lastActivity: Date;
  duration: number;
  messageCount: number;
  errorCount: number;
  reconnectionCount: number;
  healthScore: number;
  networkCondition: string;
  adaptiveMetrics: any;
  isActive: boolean;
  isHealthy: boolean;
}

export interface SessionEvent {
  type: 'SESSION_CREATED' | 'SESSION_STARTED' | 'SESSION_ENDED' | 'SESSION_ERROR' | 
        'SESSION_IDLE' | 'SESSION_RECONNECTED' | 'HEALTH_DEGRADED' | 'HEALTH_RECOVERED';
  sessionId: string;
  timestamp: Date;
  data?: any;
  context?: Record<string, any>;
}

export interface SessionHealthReport {
  sessionId: string;
  timestamp: Date;
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  metrics: SessionMetrics;
  connectionHealth: any;
  heartbeatHealth: any;
  adaptiveHealth: any;
  issues: string[];
  recommendations: string[];
  alerts: any[];
}

export class Session extends EventEmitter {
  public readonly config: SessionConfig;
  public readonly createdAt: Date;
  private ws: CompatibleWebSocket;
  private twilioManager: TwilioWebSocketManager;
  private lastActivity: Date;
  private messageCount: number = 0;
  private errorCount: number = 0;
  private reconnectionCount: number = 0;
  private isActive: boolean = false;
  private eventHistory: SessionEvent[] = [];
  
  // Timers
  private idleTimer?: NodeJS.Timeout;
  private maxDurationTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(ws: CompatibleWebSocket, config: SessionConfig) {
    super();
    this.ws = ws;
    this.config = config;
    this.createdAt = new Date();
    this.lastActivity = new Date();
    
    // Create Twilio WebSocket manager for this session
    this.twilioManager = new TwilioWebSocketManager(ws, this.getConnectionId());
    
    this.setupSessionHandlers();
    this.addEvent({
      type: 'SESSION_CREATED',
      sessionId: config.sessionId,
      timestamp: new Date(),
      data: { config }
    });
  }

  /**
   * Start the session
   */
  public start(): void {
    if (this.isActive) {
      logger.warn(`Session ${this.config.sessionId} is already active`);
      return;
    }

    this.isActive = true;
    this.lastActivity = new Date();
    
    logger.info(`Starting session ${this.config.sessionId}`, {
      sessionId: this.config.sessionId,
      callId: this.config.callId,
      conversationId: this.config.conversationId,
      sessionType: this.config.sessionType,
      priority: this.config.priority
    });

    // Start timers
    this.startIdleTimer();
    this.startMaxDurationTimer();
    this.startHealthCheckTimer();
    
    this.addEvent({
      type: 'SESSION_STARTED',
      sessionId: this.config.sessionId,
      timestamp: new Date()
    });
    
    this.emit('sessionStarted', { sessionId: this.config.sessionId });
  }

  /**
   * End the session
   */
  public end(reason?: string): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    
    logger.info(`Ending session ${this.config.sessionId}`, {
      sessionId: this.config.sessionId,
      reason: reason || 'Manual termination',
      duration: this.getDuration(),
      messageCount: this.messageCount,
      errorCount: this.errorCount
    });

    // Clear timers
    this.clearTimers();
    
    // Cleanup Twilio manager
    this.twilioManager.cleanup();
    
    this.addEvent({
      type: 'SESSION_ENDED',
      sessionId: this.config.sessionId,
      timestamp: new Date(),
      data: { reason, duration: this.getDuration() }
    });
    
    this.emit('sessionEnded', { 
      sessionId: this.config.sessionId, 
      reason,
      metrics: this.getMetrics()
    });
  }

  /**
   * Record session activity
   */
  public recordActivity(type: 'message' | 'error' | 'reconnection', data?: any): void {
    this.lastActivity = new Date();
    
    switch (type) {
      case 'message':
        this.messageCount++;
        break;
      case 'error':
        this.errorCount++;
        this.addEvent({
          type: 'SESSION_ERROR',
          sessionId: this.config.sessionId,
          timestamp: new Date(),
          data
        });
        break;
      case 'reconnection':
        this.reconnectionCount++;
        this.addEvent({
          type: 'SESSION_RECONNECTED',
          sessionId: this.config.sessionId,
          timestamp: new Date(),
          data
        });
        break;
    }
    
    // Reset idle timer
    this.resetIdleTimer();
  }

  /**
   * Get session metrics
   */
  public getMetrics(): SessionMetrics {
    const heartbeatMetrics = this.twilioManager.getHeartbeatMetrics();
    const adaptiveMetrics = this.twilioManager.getAdaptiveHeartbeatMetrics();
    const healthScore = this.twilioManager.getHealthScore();
    
    return {
      sessionId: this.config.sessionId,
      startTime: this.createdAt,
      lastActivity: this.lastActivity,
      duration: this.getDuration(),
      messageCount: this.messageCount,
      errorCount: this.errorCount,
      reconnectionCount: this.reconnectionCount,
      healthScore: healthScore.overall,
      networkCondition: adaptiveMetrics.currentCondition.type,
      adaptiveMetrics,
      isActive: this.isActive,
      isHealthy: this.isHealthy()
    };
  }

  /**
   * Get comprehensive health report
   */
  public getHealthReport(): SessionHealthReport {
    const metrics = this.getMetrics();
    const connectionHealth = this.twilioManager.getConnectionHealth();
    const heartbeatHealth = this.twilioManager.getHeartbeatHealth();
    const adaptiveHealth = this.twilioManager.getAdaptiveHeartbeatMetrics();
    const realTimeReport = this.twilioManager.getRealTimeHealthReport();
    
    // Determine overall health
    let overallHealth: SessionHealthReport['overallHealth'] = 'good';
    if (metrics.healthScore >= 90) overallHealth = 'excellent';
    else if (metrics.healthScore >= 70) overallHealth = 'good';
    else if (metrics.healthScore >= 50) overallHealth = 'fair';
    else if (metrics.healthScore >= 30) overallHealth = 'poor';
    else overallHealth = 'critical';
    
    // Collect issues and recommendations
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    if (metrics.errorCount > 5) {
      issues.push(`High error count: ${metrics.errorCount}`);
      recommendations.push('Investigate error patterns and implement better error handling');
    }
    
    if (metrics.reconnectionCount > 2) {
      issues.push(`Multiple reconnections: ${metrics.reconnectionCount}`);
      recommendations.push('Check network stability and connection quality');
    }
    
    if (!connectionHealth.isHealthy) {
      issues.push('Connection health is poor');
      recommendations.push('Consider connection reset or fallback mechanisms');
    }
    
    // Add heartbeat and adaptive recommendations
    recommendations.push(...heartbeatHealth.recommendations);
    recommendations.push(...this.twilioManager.getAdaptiveHeartbeatRecommendations());
    
    return {
      sessionId: this.config.sessionId,
      timestamp: new Date(),
      overallHealth,
      metrics,
      connectionHealth,
      heartbeatHealth,
      adaptiveHealth,
      issues,
      recommendations,
      alerts: realTimeReport.recommendations || []
    };
  }

  /**
   * Get Twilio WebSocket manager for this session
   */
  public getTwilioManager(): TwilioWebSocketManager {
    return this.twilioManager;
  }

  /**
   * Get session events
   */
  public getEvents(limit?: number): SessionEvent[] {
    return limit ? this.eventHistory.slice(-limit) : [...this.eventHistory];
  }

  /**
   * Check if session is healthy
   */
  public isHealthy(): boolean {
    if (!this.isActive) return false;
    
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivity.getTime();
    const idleTimeout = this.config.idleTimeout || 300000; // 5 minutes default
    
    // Check if session is idle
    if (timeSinceActivity > idleTimeout) {
      return false;
    }
    
    // Check connection health
    const connectionHealth = this.twilioManager.getConnectionHealth();
    if (!connectionHealth.isHealthy) {
      return false;
    }
    
    // Check heartbeat health
    if (!this.twilioManager.isHeartbeatAlive()) {
      return false;
    }
    
    return true;
  }

  /**
   * Get session duration in milliseconds
   */
  public getDuration(): number {
    return Date.now() - this.createdAt.getTime();
  }

  /**
   * Clean up session resources
   */
  public cleanup(): void {
    this.end('Cleanup requested');
  }

  // Private methods

  private getConnectionId(): string {
    return `${this.config.callId}-${this.config.conversationId}`;
  }

  private setupSessionHandlers(): void {
    // Handle WebSocket events
    this.ws.on('message', (data) => {
      this.recordActivity('message', { size: Buffer.isBuffer(data) ? data.length : data.toString().length });
    });
    
    this.ws.on('error', (error) => {
      this.recordActivity('error', { error: error.message });
    });
    
    this.ws.on('close', (code, reason) => {
      logger.info(`WebSocket closed for session ${this.config.sessionId}`, {
        sessionId: this.config.sessionId,
        code,
        reason: reason?.toString()
      });
      this.end(`WebSocket closed: ${code}`);
    });
    
    // Handle Twilio manager events (if supported)
    // Note: TwilioWebSocketManager may not have event emitter capabilities
    // This would be handled through other mechanisms if needed
    
    // Handle health degradation
    const healthCheckInterval = setInterval(() => {
      const wasHealthy = this.isHealthy();
      const isHealthyNow = this.isHealthy();
      
      if (wasHealthy && !isHealthyNow) {
        this.addEvent({
          type: 'HEALTH_DEGRADED',
          sessionId: this.config.sessionId,
          timestamp: new Date(),
          data: { healthReport: this.getHealthReport() }
        });
        this.emit('healthDegraded', { sessionId: this.config.sessionId });
      } else if (!wasHealthy && isHealthyNow) {
        this.addEvent({
          type: 'HEALTH_RECOVERED',
          sessionId: this.config.sessionId,
          timestamp: new Date()
        });
        this.emit('healthRecovered', { sessionId: this.config.sessionId });
      }
    }, 10000); // Check every 10 seconds
    
    // Clean up health check on session end
    this.on('sessionEnded', () => {
      clearInterval(healthCheckInterval);
    });
  }

  private startIdleTimer(): void {
    const idleTimeout = this.config.idleTimeout || 300000; // 5 minutes default
    
    this.idleTimer = setTimeout(() => {
      logger.warn(`Session ${this.config.sessionId} idle timeout reached`);
      
      this.addEvent({
        type: 'SESSION_IDLE',
        sessionId: this.config.sessionId,
        timestamp: new Date(),
        data: { idleTimeout }
      });
      
      this.emit('sessionIdle', { sessionId: this.config.sessionId });
      this.end('Idle timeout');
    }, idleTimeout);
  }

  private startMaxDurationTimer(): void {
    if (!this.config.maxDuration) return;
    
    this.maxDurationTimer = setTimeout(() => {
      logger.warn(`Session ${this.config.sessionId} maximum duration reached`);
      this.end('Maximum duration reached');
    }, this.config.maxDuration);
  }

  private startHealthCheckTimer(): void {
    const interval = this.config.healthCheckInterval || 30000; // 30 seconds default
    
    this.healthCheckTimer = setInterval(() => {
      const healthReport = this.getHealthReport();
      
      if (healthReport.overallHealth === 'critical') {
        logger.error(`Critical health detected for session ${this.config.sessionId}`, {
          sessionId: this.config.sessionId,
          healthReport
        });
        
        this.emit('criticalHealth', { 
          sessionId: this.config.sessionId, 
          healthReport 
        });
      }
    }, interval);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.startIdleTimer();
    }
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = undefined;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private addEvent(event: SessionEvent): void {
    this.eventHistory.push(event);
    
    // Keep history manageable
    if (this.eventHistory.length > 200) {
      this.eventHistory = this.eventHistory.slice(-100);
    }
  }
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private sessionsByCall: Map<string, Set<string>> = new Map();
  private sessionsByUser: Map<string, Set<string>> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  
  constructor() {
    super();
    this.startCleanupTimer();
  }

  /**
   * Create a new session
   */
  public createSession(ws: CompatibleWebSocket, config: SessionConfig): Session {
    if (this.sessions.has(config.sessionId)) {
      throw new Error(`Session ${config.sessionId} already exists`);
    }

    const session = new Session(ws, config);
    this.sessions.set(config.sessionId, session);
    
    // Index by call ID
    if (!this.sessionsByCall.has(config.callId)) {
      this.sessionsByCall.set(config.callId, new Set());
    }
    this.sessionsByCall.get(config.callId)!.add(config.sessionId);
    
    // Index by user ID if provided
    if (config.userId) {
      if (!this.sessionsByUser.has(config.userId)) {
        this.sessionsByUser.set(config.userId, new Set());
      }
      this.sessionsByUser.get(config.userId)!.add(config.sessionId);
    }
    
    // Set up session event handlers
    this.setupSessionEventHandlers(session);
    
    logger.info(`Created session ${config.sessionId}`, {
      sessionId: config.sessionId,
      callId: config.callId,
      sessionType: config.sessionType,
      totalSessions: this.sessions.size
    });
    
    this.emit('sessionCreated', { session, config });
    
    return session;
  }

  /**
   * Get a session by ID
   */
  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a call
   */
  public getSessionsByCall(callId: string): Session[] {
    const sessionIds = this.sessionsByCall.get(callId);
    if (!sessionIds) return [];
    
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((session): session is Session => session !== undefined);
  }

  /**
   * Get all sessions for a user
   */
  public getSessionsByUser(userId: string): Session[] {
    const sessionIds = this.sessionsByUser.get(userId);
    if (!sessionIds) return [];
    
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((session): session is Session => session !== undefined);
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(session => session.getMetrics().isActive);
  }

  /**
   * Get session statistics
   */
  public getStats(): {
    totalSessions: number;
    activeSessions: number;
    sessionsByType: Record<string, number>;
    sessionsByPriority: Record<string, number>;
    averageSessionDuration: number;
    healthySessions: number;
  } {
    const allSessions = Array.from(this.sessions.values());
    const activeSessions = allSessions.filter(s => s.getMetrics().isActive);
    const healthySessions = allSessions.filter(s => s.isHealthy());
    
    const sessionsByType: Record<string, number> = {};
    const sessionsByPriority: Record<string, number> = {};
    let totalDuration = 0;
    
    for (const session of allSessions) {
      const config = session.config;
      sessionsByType[config.sessionType] = (sessionsByType[config.sessionType] || 0) + 1;
      sessionsByPriority[config.priority] = (sessionsByPriority[config.priority] || 0) + 1;
      totalDuration += session.getDuration();
    }
    
    return {
      totalSessions: allSessions.length,
      activeSessions: activeSessions.length,
      sessionsByType,
      sessionsByPriority,
      averageSessionDuration: allSessions.length > 0 ? totalDuration / allSessions.length : 0,
      healthySessions: healthySessions.length
    };
  }

  /**
   * End a session
   */
  public endSession(sessionId: string, reason?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.end(reason);
    return true;
  }

  /**
   * End all sessions for a call
   */
  public endSessionsByCall(callId: string, reason?: string): number {
    const sessions = this.getSessionsByCall(callId);
    sessions.forEach(session => session.end(reason));
    return sessions.length;
  }

  /**
   * Clean up inactive sessions
   */
  public cleanup(): void {
    const now = Date.now();
    const sessionsToRemove: string[] = [];
    
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)!;
      const metrics = session.getMetrics();
      
      // Remove inactive sessions older than 1 hour
      if (!metrics.isActive && (now - metrics.startTime.getTime()) > 3600000) {
        sessionsToRemove.push(sessionId);
      }
    }
    
    for (const sessionId of sessionsToRemove) {
      this.removeSession(sessionId);
    }
    
    if (sessionsToRemove.length > 0) {
      logger.info(`Cleaned up ${sessionsToRemove.length} inactive sessions`);
    }
  }

  /**
   * Shutdown the session manager
   */
  public shutdown(): void {
    // End all active sessions
    const activeSessions = this.getActiveSessions();
    activeSessions.forEach(session => session.end('Session manager shutdown'));
    
    // Clear cleanup timer
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    logger.info(`Session manager shutdown - ended ${activeSessions.length} active sessions`);
  }

  // Private methods

  private setupSessionEventHandlers(session: Session): void {
    session.on('sessionEnded', (data) => {
      this.removeSession(data.sessionId);
      this.emit('sessionEnded', data);
    });
    
    session.on('sessionIdle', (data) => {
      this.emit('sessionIdle', data);
    });
    
    session.on('healthDegraded', (data) => {
      this.emit('sessionHealthDegraded', data);
    });
    
    session.on('healthRecovered', (data) => {
      this.emit('sessionHealthRecovered', data);
    });
    
    session.on('criticalHealth', (data) => {
      this.emit('sessionCriticalHealth', data);
    });
  }

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const config = session.config;
    
    // Remove from main map
    this.sessions.delete(sessionId);
    
    // Remove from call index
    const callSessions = this.sessionsByCall.get(config.callId);
    if (callSessions) {
      callSessions.delete(sessionId);
      if (callSessions.size === 0) {
        this.sessionsByCall.delete(config.callId);
      }
    }
    
    // Remove from user index
    if (config.userId) {
      const userSessions = this.sessionsByUser.get(config.userId);
      if (userSessions) {
        userSessions.delete(sessionId);
        if (userSessions.size === 0) {
          this.sessionsByUser.delete(config.userId);
        }
      }
    }
    
    logger.debug(`Removed session ${sessionId} from session manager`);
  }

  /**
   * Create a new session with enhanced WebSocket connection
   * This method creates a session using the EnhancedWebSocketManager for better connection handling
   */
  public async createEnhancedSession(
    url: string,
    config: SessionConfig
  ): Promise<Session> {
    logger.info(`Creating enhanced session ${config.sessionId} for call ${config.callId}`);

    try {
      // Import enhanced WebSocket factory
      const { createPlainWebSocket } = await import('./enhancedWebSocketFactory');

      // Create enhanced WebSocket connection
      const ws = await createPlainWebSocket(url, {
        callId: config.callId,
        connectionId: config.sessionId,
        serviceName: 'session-manager',
        // Session-specific optimizations
        heartbeatInterval: 20000, // 20 seconds for session management
        connectionTimeout: 12000,
        maxReconnectAttempts: 5,
        reconnectDelay: 1500
      });

      // Create session with enhanced WebSocket
      const session = new Session(ws, config);

      // Register the session
      this.sessions.set(config.sessionId, session);
      
      // Index by call ID
      if (!this.sessionsByCall.has(config.callId)) {
        this.sessionsByCall.set(config.callId, new Set());
      }
      this.sessionsByCall.get(config.callId)!.add(config.sessionId);
      
      // Index by user ID if provided
      if (config.userId) {
        if (!this.sessionsByUser.has(config.userId)) {
          this.sessionsByUser.set(config.userId, new Set());
        }
        this.sessionsByUser.get(config.userId)!.add(config.sessionId);
      }

      logger.info(`Enhanced session ${config.sessionId} created successfully`);
      return session;

    } catch (error) {
      logger.error(`Failed to create enhanced session ${config.sessionId}`, {
        error: error.message,
        callId: config.callId,
        url
      });
      throw error;
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000); // Clean up every 5 minutes
  }
}

// Global session manager instance
export const globalSessionManager = new SessionManager();