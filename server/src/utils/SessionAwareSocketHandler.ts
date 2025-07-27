/**
 * Session-Aware Socket Handler
 * 
 * Implements comprehensive session binding and management with session-to-socket
 * mapping, state persistence across reconnections, and session cleanup.
 * 
 * Requirements: 1.1, 1.2, 5.3
 */

import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import { TwilioWebSocketManager } from './TwilioWebSocketManager';
import logger from './logger';

export interface SessionState {
  sessionId: string;
  callId: string;
  conversationId: string;
  userId?: string;
  createdAt: Date;
  lastActiveAt: Date;
  connectionCount: number;
  totalReconnections: number;
  currentSocketId?: string;
  
  // Call-specific state
  streamSid?: string;
  audioSequence: number;
  lastAudioTimestamp?: Date;
  
  // Conversation state
  messageHistory: SessionMessage[];
  conversationContext: Record<string, any>;
  
  // Connection state
  connectionHealth: SessionConnectionHealth;
  preferences: SessionPreferences;
  
  // Persistence flags
  isPersistent: boolean;
  persistUntil?: Date;
  
  // Recovery state
  recoveryData?: SessionRecoveryData;
}

export interface SessionMessage {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface SessionConnectionHealth {
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  averageConnectionDuration: number;
  lastConnectionError?: string;
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  
  // Enhanced per-session monitoring
  currentLatency: number;
  averageLatency: number;
  latencyHistory: number[];
  errorRate: number;
  reconnectionCount: number;
  lastHealthCheck: Date;
  healthScore: number; // 0-100
  connectionStability: number; // 0-100
  
  // Session-specific metrics
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  protocolErrors: number;
  networkErrors: number;
  sessionErrors: number;
  
  // Real-time status
  isMonitoring: boolean;
  lastActivity: Date;
  connectionUptime: number;
  degradationEvents: SessionDegradationEvent[];
}

export interface SessionPreferences {
  language: string;
  voiceId?: string;
  audioFormat: string;
  maxMessageHistory: number;
  enablePersistence: boolean;
  adaptiveEnabled?: boolean;
  heartbeatPreferences?: {
    preferredInterval?: number;
    adaptiveEnabled: boolean;
  };
}

export interface SessionRecoveryData {
  lastKnownState: Record<string, any>;
  pendingMessages: SessionMessage[];
  recoveryTimestamp: Date;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
  
  // Enhanced recovery data
  connectionSnapshot: {
    healthScore: number;
    latency: number;
    errorCount: number;
    lastSuccessfulOperation: Date;
    connectionQuality: string;
  };
  sessionSnapshot: {
    messageCount: number;
    lastMessageId: string;
    conversationState: Record<string, any>;
    audioSequence: number;
  };
  recoveryStrategy: 'immediate' | 'delayed' | 'gradual' | 'fallback';
  recoveryReason: string;
  expectedRecoveryTime: number;
}

export interface SessionDegradationEvent {
  id: string;
  type: 'latency_spike' | 'connection_drop' | 'error_burst' | 'protocol_violation' | 'resource_exhaustion';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  description: string;
  metrics: Record<string, any>;
  resolved: boolean;
  resolvedAt?: Date;
  recoveryAction?: string;
}

export interface SessionHealthReport {
  sessionId: string;
  timestamp: Date;
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  connectionHealth: SessionConnectionHealth;
  recommendations: string[];
  alerts: SessionDegradationEvent[];
  predictedIssues: string[];
  recoveryCapability: 'high' | 'medium' | 'low' | 'none';
}

export interface SocketBinding {
  socketId: string;
  socket: WebSocket;
  twilioManager: TwilioWebSocketManager;
  sessionId: string;
  bindTime: Date;
  lastActivity: Date;
  isActive: boolean;
  connectionMetrics: {
    messagesReceived: number;
    messagesSent: number;
    bytesReceived: number;
    bytesSent: number;
    errors: number;
  };
}

export interface SessionEvent {
  type: 'SESSION_CREATED' | 'SESSION_BOUND' | 'SESSION_UNBOUND' | 'SESSION_RECOVERED' | 'SESSION_EXPIRED' | 'SESSION_ERROR';
  sessionId: string;
  timestamp: Date;
  data?: Record<string, any>;
}

export class SessionAwareSocketHandler extends EventEmitter {
  private sessions: Map<string, SessionState> = new Map();
  private socketBindings: Map<string, SocketBinding> = new Map();
  private sessionToSocket: Map<string, string> = new Map();
  private socketToSession: Map<string, string> = new Map();
  
  // Cleanup and maintenance
  private cleanupInterval?: NodeJS.Timeout;
  private persistenceInterval?: NodeJS.Timeout;
  
  // Configuration
  private config = {
    maxSessions: 1000,
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    cleanupInterval: 5 * 60 * 1000, // 5 minutes
    persistenceInterval: 60 * 1000, // 1 minute
    maxMessageHistory: 100,
    maxRecoveryAttempts: 3,
    recoveryTimeout: 30 * 1000 // 30 seconds
  };

  constructor(config?: Partial<typeof SessionAwareSocketHandler.prototype.config>) {
    super();
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    this.startMaintenance();
  }

  /**
   * Create a new session
   */
  public createSession(
    sessionId: string,
    callId: string,
    conversationId: string,
    options?: {
      userId?: string;
      preferences?: Partial<SessionPreferences>;
      isPersistent?: boolean;
      persistUntil?: Date;
    }
  ): SessionState {
    if (this.sessions.has(sessionId)) {
      logger.warn(`Session ${sessionId} already exists, returning existing session`);
      return this.sessions.get(sessionId)!;
    }

    const now = new Date();
    const session: SessionState = {
      sessionId,
      callId,
      conversationId,
      userId: options?.userId,
      createdAt: now,
      lastActiveAt: now,
      connectionCount: 0,
      totalReconnections: 0,
      audioSequence: 0,
      messageHistory: [],
      conversationContext: {},
      connectionHealth: {
        totalConnections: 0,
        successfulConnections: 0,
        failedConnections: 0,
        averageConnectionDuration: 0,
        connectionQuality: 'good',
        
        // Enhanced monitoring properties (will be initialized when monitoring starts)
        currentLatency: 0,
        averageLatency: 0,
        latencyHistory: [],
        errorRate: 0,
        reconnectionCount: 0,
        lastHealthCheck: now,
        healthScore: 100,
        connectionStability: 100,
        messagesSent: 0,
        messagesReceived: 0,
        bytesTransferred: 0,
        protocolErrors: 0,
        networkErrors: 0,
        sessionErrors: 0,
        isMonitoring: false,
        lastActivity: now,
        connectionUptime: 0,
        degradationEvents: []
      },
      preferences: {
        language: 'en',
        audioFormat: 'mp3',
        maxMessageHistory: this.config.maxMessageHistory,
        enablePersistence: options?.isPersistent ?? true,
        adaptiveEnabled: true,
        ...options?.preferences
      },
      isPersistent: options?.isPersistent ?? true,
      persistUntil: options?.persistUntil
    };

    this.sessions.set(sessionId, session);

    logger.info(`Created session ${sessionId}`, {
      sessionId,
      callId,
      conversationId,
      userId: options?.userId,
      isPersistent: session.isPersistent
    });

    this.emitSessionEvent({
      type: 'SESSION_CREATED',
      sessionId,
      timestamp: now,
      data: { callId, conversationId, userId: options?.userId }
    });

    return session;
  }

  /**
   * Bind a socket to a session
   */
  public bindSession(
    socket: WebSocket,
    twilioManager: TwilioWebSocketManager,
    sessionId: string
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.error(`Cannot bind socket: session ${sessionId} not found`);
      return false;
    }

    const socketId = this.generateSocketId();
    const now = new Date();

    // Unbind any existing socket for this session
    this.unbindSession(sessionId);

    // Create socket binding
    const binding: SocketBinding = {
      socketId,
      socket,
      twilioManager,
      sessionId,
      bindTime: now,
      lastActivity: now,
      isActive: true,
      connectionMetrics: {
        messagesReceived: 0,
        messagesSent: 0,
        bytesReceived: 0,
        bytesSent: 0,
        errors: 0
      }
    };

    // Update mappings
    this.socketBindings.set(socketId, binding);
    this.sessionToSocket.set(sessionId, socketId);
    this.socketToSession.set(socketId, sessionId);

    // Update session state
    session.currentSocketId = socketId;
    session.connectionCount++;
    session.connectionHealth.totalConnections++;
    session.lastActiveAt = now;

    // Set up socket event handlers
    this.setupSocketHandlers(binding);

    logger.info(`Bound socket ${socketId} to session ${sessionId}`, {
      sessionId,
      socketId,
      connectionCount: session.connectionCount
    });

    this.emitSessionEvent({
      type: 'SESSION_BOUND',
      sessionId,
      timestamp: now,
      data: { socketId, connectionCount: session.connectionCount }
    });

    return true;
  }

  /**
   * Unbind a session from its current socket
   */
  public unbindSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.currentSocketId) {
      return false;
    }

    const socketId = session.currentSocketId;
    const binding = this.socketBindings.get(socketId);

    if (binding) {
      // Calculate connection duration
      const duration = Date.now() - binding.bindTime.getTime();
      
      // Update session connection health
      const totalDuration = session.connectionHealth.averageConnectionDuration * 
                           (session.connectionHealth.totalConnections - 1) + duration;
      session.connectionHealth.averageConnectionDuration = 
        totalDuration / session.connectionHealth.totalConnections;

      // Mark binding as inactive
      binding.isActive = false;

      // Clean up socket handlers
      this.cleanupSocketHandlers(binding);
    }

    // Remove mappings
    this.socketBindings.delete(socketId);
    this.sessionToSocket.delete(sessionId);
    this.socketToSession.delete(socketId);

    // Update session state
    session.currentSocketId = undefined;
    session.lastActiveAt = new Date();

    logger.info(`Unbound session ${sessionId} from socket ${socketId}`, {
      sessionId,
      socketId,
      duration: binding ? Date.now() - binding.bindTime.getTime() : 0
    });

    this.emitSessionEvent({
      type: 'SESSION_UNBOUND',
      sessionId,
      timestamp: new Date(),
      data: { socketId, duration: binding ? Date.now() - binding.bindTime.getTime() : 0 }
    });

    return true;
  }

  /**
   * Get session by ID
   */
  public getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session by socket
   */
  public getSessionBySocket(socket: WebSocket): SessionState | undefined {
    // Find socket binding
    for (const binding of this.socketBindings.values()) {
      if (binding.socket === socket) {
        return this.sessions.get(binding.sessionId);
      }
    }
    return undefined;
  }

  /**
   * Get socket binding for session
   */
  public getSessionSocket(sessionId: string): SocketBinding | undefined {
    const socketId = this.sessionToSocket.get(sessionId);
    return socketId ? this.socketBindings.get(socketId) : undefined;
  }

  /**
   * Update session state
   */
  public updateSessionState(
    sessionId: string,
    updates: Partial<Pick<SessionState, 'streamSid' | 'conversationContext' | 'preferences'>>
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Apply updates
    Object.assign(session, updates);
    session.lastActiveAt = new Date();

    logger.debug(`Updated session state for ${sessionId}`, {
      sessionId,
      updates: Object.keys(updates)
    });

    return true;
  }

  /**
   * Add message to session history
   */
  public addSessionMessage(
    sessionId: string,
    message: Omit<SessionMessage, 'id' | 'timestamp'>
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const fullMessage: SessionMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date()
    };

    session.messageHistory.push(fullMessage);
    session.lastActiveAt = new Date();

    // Trim message history if needed
    if (session.messageHistory.length > session.preferences.maxMessageHistory) {
      session.messageHistory = session.messageHistory.slice(-session.preferences.maxMessageHistory);
    }

    return true;
  }

  /**
   * Prepare session for recovery
   */
  public prepareSessionRecovery(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Create enhanced recovery data
    session.recoveryData = {
      lastKnownState: {
        streamSid: session.streamSid,
        audioSequence: session.audioSequence,
        conversationContext: { ...session.conversationContext }
      },
      pendingMessages: [...session.messageHistory.slice(-10)], // Last 10 messages
      recoveryTimestamp: new Date(),
      recoveryAttempts: 0,
      maxRecoveryAttempts: this.config.maxRecoveryAttempts,
      
      // Enhanced recovery data
      connectionSnapshot: {
        healthScore: session.connectionHealth.healthScore,
        latency: session.connectionHealth.currentLatency,
        errorCount: session.connectionHealth.protocolErrors + session.connectionHealth.networkErrors + session.connectionHealth.sessionErrors,
        lastSuccessfulOperation: session.lastActiveAt,
        connectionQuality: session.connectionHealth.connectionQuality
      },
      sessionSnapshot: {
        messageCount: session.messageHistory.length,
        lastMessageId: session.messageHistory[session.messageHistory.length - 1]?.id || '',
        conversationState: { ...session.conversationContext },
        audioSequence: session.audioSequence
      },
      recoveryStrategy: this.determineRecoveryStrategy(session),
      recoveryReason: 'Connection degradation detected',
      expectedRecoveryTime: this.calculateExpectedRecoveryTime(session)
    };

    logger.info(`Prepared recovery data for session ${sessionId}`, {
      sessionId,
      recoveryData: {
        hasStreamSid: !!session.recoveryData.lastKnownState.streamSid,
        audioSequence: session.recoveryData.lastKnownState.audioSequence,
        pendingMessages: session.recoveryData.pendingMessages.length
      }
    });

    return true;
  }

  /**
   * Recover session state
   */
  public recoverSession(sessionId: string): SessionRecoveryData | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || !session.recoveryData) {
      return undefined;
    }

    const recoveryData = session.recoveryData;
    recoveryData.recoveryAttempts++;

    // Check if recovery attempts exceeded
    if (recoveryData.recoveryAttempts > recoveryData.maxRecoveryAttempts) {
      logger.warn(`Session ${sessionId} exceeded max recovery attempts`, {
        sessionId,
        attempts: recoveryData.recoveryAttempts,
        maxAttempts: recoveryData.maxRecoveryAttempts
      });
      
      // Clear recovery data
      session.recoveryData = undefined;
      return undefined;
    }

    // Restore state
    if (recoveryData.lastKnownState.streamSid) {
      session.streamSid = recoveryData.lastKnownState.streamSid;
    }
    
    if (recoveryData.lastKnownState.audioSequence) {
      session.audioSequence = recoveryData.lastKnownState.audioSequence;
    }
    
    if (recoveryData.lastKnownState.conversationContext) {
      session.conversationContext = { ...recoveryData.lastKnownState.conversationContext };
    }

    session.totalReconnections++;
    session.lastActiveAt = new Date();

    logger.info(`Recovered session ${sessionId}`, {
      sessionId,
      recoveryAttempt: recoveryData.recoveryAttempts,
      restoredStreamSid: !!session.streamSid,
      audioSequence: session.audioSequence,
      totalReconnections: session.totalReconnections
    });

    this.emitSessionEvent({
      type: 'SESSION_RECOVERED',
      sessionId,
      timestamp: new Date(),
      data: {
        recoveryAttempt: recoveryData.recoveryAttempts,
        totalReconnections: session.totalReconnections
      }
    });

    return { ...recoveryData };
  }

  /**
   * Remove session and clean up
   */
  public removeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Unbind any active socket
    this.unbindSession(sessionId);

    // Remove session
    this.sessions.delete(sessionId);

    logger.info(`Removed session ${sessionId}`, {
      sessionId,
      duration: Date.now() - session.createdAt.getTime(),
      connectionCount: session.connectionCount,
      messageCount: session.messageHistory.length
    });

    this.emitSessionEvent({
      type: 'SESSION_EXPIRED',
      sessionId,
      timestamp: new Date(),
      data: {
        duration: Date.now() - session.createdAt.getTime(),
        connectionCount: session.connectionCount
      }
    });

    return true;
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): SessionState[] {
    return Array.from(this.sessions.values()).filter(session => 
      session.currentSocketId && this.socketBindings.has(session.currentSocketId)
    );
  }

  /**
   * Get session statistics
   */
  public getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    totalConnections: number;
    averageSessionDuration: number;
    totalMessages: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const activeSessions = this.getActiveSessions();
    
    const totalConnections = sessions.reduce((sum, s) => sum + s.connectionCount, 0);
    const totalMessages = sessions.reduce((sum, s) => sum + s.messageHistory.length, 0);
    
    const now = Date.now();
    const totalDuration = sessions.reduce((sum, s) => sum + (now - s.createdAt.getTime()), 0);
    const averageSessionDuration = sessions.length > 0 ? totalDuration / sessions.length : 0;

    return {
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      totalConnections,
      averageSessionDuration,
      totalMessages
    };
  }

  /**
   * Clean up expired sessions and inactive bindings
   */
  public cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    // Find expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now - session.lastActiveAt.getTime();
      const isExpired = age > this.config.sessionTimeout;
      const isPersistentExpired = session.persistUntil && now > session.persistUntil.getTime();

      if (isExpired || isPersistentExpired) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      this.removeSession(sessionId);
    }

    // Clean up inactive socket bindings
    const inactiveBindings: string[] = [];
    for (const [socketId, binding] of this.socketBindings.entries()) {
      if (!binding.isActive || binding.socket.readyState === WebSocket.CLOSED) {
        inactiveBindings.push(socketId);
      }
    }

    for (const socketId of inactiveBindings) {
      const binding = this.socketBindings.get(socketId);
      if (binding) {
        this.unbindSession(binding.sessionId);
      }
    }

    if (expiredSessions.length > 0 || inactiveBindings.length > 0) {
      logger.debug('Session cleanup completed', {
        expiredSessions: expiredSessions.length,
        inactiveBindings: inactiveBindings.length,
        remainingSessions: this.sessions.size,
        activeBindings: this.socketBindings.size
      });
    }
  }

  /**
   * Start connection monitoring for a specific session
   */
  public startConnectionMonitoring(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.error(`Cannot start monitoring: session ${sessionId} not found`);
      return false;
    }

    // Initialize enhanced connection health if not already done
    if (!session.connectionHealth.isMonitoring) {
      this.initializeSessionHealthMonitoring(session);
    }

    logger.info(`Started connection monitoring for session ${sessionId}`, {
      sessionId,
      currentHealth: session.connectionHealth.connectionQuality,
      healthScore: session.connectionHealth.healthScore
    });

    return true;
  }

  /**
   * Stop connection monitoring for a specific session
   */
  public stopConnectionMonitoring(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.connectionHealth.isMonitoring = false;
    
    logger.info(`Stopped connection monitoring for session ${sessionId}`, {
      sessionId,
      finalHealthScore: session.connectionHealth.healthScore,
      totalConnections: session.connectionHealth.totalConnections,
      errorRate: session.connectionHealth.errorRate
    });

    return true;
  }

  /**
   * Record connection health metrics for a session
   */
  public recordSessionHealthMetric(
    sessionId: string, 
    metric: {
      type: 'latency' | 'error' | 'message' | 'bytes' | 'reconnection';
      value: number;
      context?: Record<string, any>;
    }
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.connectionHealth.isMonitoring) {
      return false;
    }

    const health = session.connectionHealth;
    const now = new Date();

    switch (metric.type) {
      case 'latency':
        this.recordLatencyMetric(health, metric.value);
        break;
      case 'error':
        this.recordErrorMetric(health, metric.context);
        break;
      case 'message':
        health.messagesSent += metric.value;
        break;
      case 'bytes':
        health.bytesTransferred += metric.value;
        break;
      case 'reconnection':
        health.reconnectionCount += metric.value;
    }

    health.lastActivity = now;
    health.lastHealthCheck = now;
    
    // Update health score
    this.updateSessionHealthScore(session);
    
    // Check for degradation
    this.checkForSessionDegradation(session);

    return true;
  }

  /**
   * Get comprehensive health report for a session
   */
  public getSessionHealthReport(sessionId: string): SessionHealthReport | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const health = session.connectionHealth;
    const overallHealth = this.determineOverallHealth(health.healthScore);
    const recommendations = this.generateHealthRecommendations(session);
    const alerts = health.degradationEvents.filter(event => !event.resolved);
    const predictedIssues = this.predictPotentialIssues(session);
    const recoveryCapability = this.assessRecoveryCapability(session);

    return {
      sessionId,
      timestamp: new Date(),
      overallHealth,
      connectionHealth: { ...health },
      recommendations,
      alerts,
      predictedIssues,
      recoveryCapability
    };
  }

  /**
   * Handle connection degradation for a specific session
   */
  public handleConnectionDegradation(sessionId: string, degradationType: SessionDegradationEvent['type']): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const degradationEvent: SessionDegradationEvent = {
      id: this.generateDegradationId(),
      type: degradationType,
      severity: this.determineDegradationSeverity(degradationType, session),
      timestamp: new Date(),
      description: this.getDegradationDescription(degradationType),
      metrics: this.captureCurrentMetrics(session),
      resolved: false
    };

    session.connectionHealth.degradationEvents.push(degradationEvent);

    // Apply recovery strategy based on degradation type and severity
    const recoveryAction = this.applyDegradationRecovery(session, degradationEvent);
    degradationEvent.recoveryAction = recoveryAction;

    logger.warn(`Connection degradation detected for session ${sessionId}`, {
      sessionId,
      degradationType,
      severity: degradationEvent.severity,
      recoveryAction,
      currentHealth: session.connectionHealth.healthScore
    });

    this.emitSessionEvent({
      type: 'SESSION_ERROR',
      sessionId,
      timestamp: new Date(),
      data: { degradationEvent, recoveryAction }
    });

    return true;
  }

  /**
   * Restore session state after reconnection with enhanced recovery
   */
  public restoreSessionState(sessionId: string, connectionSnapshot?: Record<string, any>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.recoveryData) {
      logger.error(`Cannot restore session state: session ${sessionId} not found or no recovery data`);
      return false;
    }

    const recoveryData = session.recoveryData;
    const now = new Date();

    try {
      // Restore connection state
      if (recoveryData.connectionSnapshot) {
        this.restoreConnectionState(session, recoveryData.connectionSnapshot);
      }

      // Restore session state
      if (recoveryData.sessionSnapshot) {
        this.restoreSessionSnapshot(session, recoveryData.sessionSnapshot);
      }

      // Apply connection snapshot if provided
      if (connectionSnapshot) {
        this.applyConnectionSnapshot(session, connectionSnapshot);
      }

      // Reset recovery attempts on successful restoration
      recoveryData.recoveryAttempts = 0;
      session.connectionHealth.reconnectionCount++;
      session.connectionHealth.successfulConnections++;
      session.lastActiveAt = now;

      // Update health metrics
      this.updateSessionHealthScore(session);

      logger.info(`Successfully restored session state for ${sessionId}`, {
        sessionId,
        recoveryStrategy: recoveryData.recoveryStrategy,
        restoredMessages: recoveryData.pendingMessages.length,
        healthScore: session.connectionHealth.healthScore,
        totalReconnections: session.totalReconnections
      });

      this.emitSessionEvent({
        type: 'SESSION_RECOVERED',
        sessionId,
        timestamp: now,
        data: {
          recoveryStrategy: recoveryData.recoveryStrategy,
          healthScore: session.connectionHealth.healthScore,
          restoredState: {
            messages: recoveryData.pendingMessages.length,
            audioSequence: session.audioSequence,
            conversationContext: Object.keys(session.conversationContext).length
          }
        }
      });

      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`Failed to restore session state for ${sessionId}:`, {
        sessionId,
        error: errorMessage,
        recoveryAttempts: recoveryData.recoveryAttempts
      });

      // Record recovery failure
      session.connectionHealth.failedConnections++;
      this.updateSessionHealthScore(session);

      return false;
    }
  }

  /**
   * Get session-specific error handling strategy
   */
  public getSessionErrorStrategy(sessionId: string, errorType: string): {
    strategy: 'retry' | 'reconnect' | 'fallback' | 'abort';
    delay: number;
    maxAttempts: number;
    fallbackAction?: string;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { strategy: 'abort', delay: 0, maxAttempts: 0 };
    }

    const health = session.connectionHealth;
    const baseStrategy = this.getBaseErrorStrategy(errorType);

    // Adjust strategy based on session health
    if (health.healthScore < 30) {
      return {
        strategy: 'fallback',
        delay: 5000,
        maxAttempts: 1,
        fallbackAction: 'switch_to_http'
      };
    } else if (health.healthScore < 60) {
      return {
        strategy: 'reconnect',
        delay: Math.min(baseStrategy.delay * 2, 10000),
        maxAttempts: Math.max(baseStrategy.maxAttempts - 1, 1)
      };
    }

    return baseStrategy;
  }

  /**
   * Stop the session handler and clean up resources
   */
  public stop(): void {
    // Stop maintenance intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = undefined;
    }

    // Unbind all sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      this.unbindSession(sessionId);
    }

    // Clear all data
    this.sessions.clear();
    this.socketBindings.clear();
    this.sessionToSocket.clear();
    this.socketToSession.clear();

    logger.info('Session-aware socket handler stopped');
  }

  // Private methods

  /**
   * Initialize enhanced health monitoring for a session
   */
  private initializeSessionHealthMonitoring(session: SessionState): void {
    const now = new Date();
    
    // Initialize enhanced health properties
    session.connectionHealth = {
      ...session.connectionHealth,
      currentLatency: 0,
      averageLatency: 0,
      latencyHistory: [],
      errorRate: 0,
      reconnectionCount: 0,
      lastHealthCheck: now,
      healthScore: 100,
      connectionStability: 100,
      messagesSent: 0,
      messagesReceived: 0,
      bytesTransferred: 0,
      protocolErrors: 0,
      networkErrors: 0,
      sessionErrors: 0,
      isMonitoring: true,
      lastActivity: now,
      connectionUptime: 0,
      degradationEvents: []
    };

    logger.debug(`Initialized health monitoring for session ${session.sessionId}`, {
      sessionId: session.sessionId,
      initialHealthScore: session.connectionHealth.healthScore
    });
  }

  /**
   * Record latency metric for session health
   */
  private recordLatencyMetric(health: SessionConnectionHealth, latency: number): void {
    health.currentLatency = latency;
    health.latencyHistory.push(latency);
    
    // Keep history manageable
    if (health.latencyHistory.length > 50) {
      health.latencyHistory.shift();
    }
    
    // Update average latency
    health.averageLatency = health.latencyHistory.reduce((sum, l) => sum + l, 0) / health.latencyHistory.length;
  }

  /**
   * Record error metric for session health
   */
  private recordErrorMetric(health: SessionConnectionHealth, context?: Record<string, any>): void {
    const errorType = context?.type || 'unknown';
    
    switch (errorType) {
      case 'protocol':
        health.protocolErrors++;
        break;
      case 'network':
        health.networkErrors++;
        break;
      case 'session':
        health.sessionErrors++;
        break;
    }
    
    // Update error rate (errors per minute)
    const totalErrors = health.protocolErrors + health.networkErrors + health.sessionErrors;
    const uptimeMinutes = Math.max(health.connectionUptime / 60000, 1);
    health.errorRate = totalErrors / uptimeMinutes;
  }

  /**
   * Update session health score based on current metrics
   */
  private updateSessionHealthScore(session: SessionState): void {
    const health = session.connectionHealth;
    
    // Calculate component scores (0-100)
    const latencyScore = this.calculateLatencyScore(health.averageLatency);
    const errorScore = this.calculateErrorScore(health.errorRate);
    const stabilityScore = this.calculateStabilityScore(health);
    const uptimeScore = this.calculateUptimeScore(health);
    
    // Weighted overall score
    health.healthScore = Math.round(
      latencyScore * 0.3 +
      errorScore * 0.3 +
      stabilityScore * 0.25 +
      uptimeScore * 0.15
    );
    
    // Update connection quality based on health score
    if (health.healthScore >= 90) {
      health.connectionQuality = 'excellent';
    } else if (health.healthScore >= 70) {
      health.connectionQuality = 'good';
    } else if (health.healthScore >= 50) {
      health.connectionQuality = 'fair';
    } else if (health.healthScore >= 30) {
      health.connectionQuality = 'poor';
    } else {
      health.connectionQuality = 'critical';
    }
  }

  /**
   * Check for session degradation and create events
   */
  private checkForSessionDegradation(session: SessionState): void {
    const health = session.connectionHealth;
    
    // Check for latency spikes
    if (health.currentLatency > 1000 && health.averageLatency < 500) {
      this.createDegradationEvent(session, 'latency_spike', 'medium');
    }
    
    // Check for error bursts
    if (health.errorRate > 0.5) { // More than 0.5 errors per minute
      this.createDegradationEvent(session, 'error_burst', 'high');
    }
    
    // Check for protocol violations
    if (health.protocolErrors > 0) {
      this.createDegradationEvent(session, 'protocol_violation', 'critical');
    }
  }

  /**
   * Create a degradation event
   */
  private createDegradationEvent(
    session: SessionState, 
    type: SessionDegradationEvent['type'], 
    severity: SessionDegradationEvent['severity']
  ): void {
    const event: SessionDegradationEvent = {
      id: this.generateDegradationId(),
      type,
      severity,
      timestamp: new Date(),
      description: this.getDegradationDescription(type),
      metrics: this.captureCurrentMetrics(session),
      resolved: false
    };
    
    session.connectionHealth.degradationEvents.push(event);
    
    // Keep degradation events manageable
    if (session.connectionHealth.degradationEvents.length > 20) {
      session.connectionHealth.degradationEvents = session.connectionHealth.degradationEvents.slice(-10);
    }
  }

  /**
   * Generate health recommendations for a session
   */
  private generateHealthRecommendations(session: SessionState): string[] {
    const health = session.connectionHealth;
    const recommendations: string[] = [];
    
    if (health.averageLatency > 500) {
      recommendations.push('High latency detected - consider optimizing network routing');
    }
    
    if (health.errorRate > 0.2) {
      recommendations.push('High error rate - review error handling and connection stability');
    }
    
    if (health.reconnectionCount > 3) {
      recommendations.push('Frequent reconnections - investigate network stability');
    }
    
    if (health.protocolErrors > 0) {
      recommendations.push('Protocol errors detected - review message formatting and Twilio compliance');
    }
    
    if (health.healthScore < 50) {
      recommendations.push('Critical health score - immediate intervention required');
    }
    
    return recommendations;
  }

  /**
   * Predict potential issues based on current trends
   */
  private predictPotentialIssues(session: SessionState): string[] {
    const health = session.connectionHealth;
    const issues: string[] = [];
    
    // Analyze latency trend
    if (health.latencyHistory.length >= 5) {
      const recentLatency = health.latencyHistory.slice(-5);
      const trend = this.calculateTrend(recentLatency);
      
      if (trend > 50) { // Increasing trend
        issues.push('Latency trending upward - potential network degradation');
      }
    }
    
    // Check error pattern
    const recentErrors = health.degradationEvents
      .filter(e => e.timestamp > new Date(Date.now() - 300000)) // Last 5 minutes
      .length;
    
    if (recentErrors > 2) {
      issues.push('Error pattern detected - connection may become unstable');
    }
    
    return issues;
  }

  /**
   * Assess recovery capability for a session
   */
  private assessRecoveryCapability(session: SessionState): 'high' | 'medium' | 'low' | 'none' {
    const health = session.connectionHealth;
    
    if (health.healthScore >= 70 && health.reconnectionCount <= 2) {
      return 'high';
    } else if (health.healthScore >= 50 && health.reconnectionCount <= 5) {
      return 'medium';
    } else if (health.healthScore >= 30) {
      return 'low';
    } else {
      return 'none';
    }
  }

  /**
   * Restore connection state from snapshot
   */
  private restoreConnectionState(session: SessionState, snapshot: any): void {
    const health = session.connectionHealth;
    
    if (snapshot.healthScore) {
      health.healthScore = Math.max(snapshot.healthScore - 10, 0); // Slight penalty for reconnection
    }
    
    if (snapshot.latency) {
      health.currentLatency = snapshot.latency;
      health.latencyHistory.push(snapshot.latency);
    }
    
    if (snapshot.connectionQuality) {
      health.connectionQuality = snapshot.connectionQuality;
    }
  }

  /**
   * Restore session snapshot
   */
  private restoreSessionSnapshot(session: SessionState, snapshot: any): void {
    if (snapshot.audioSequence) {
      session.audioSequence = snapshot.audioSequence;
    }
    
    if (snapshot.conversationState) {
      session.conversationContext = { ...snapshot.conversationState };
    }
    
    if (snapshot.lastMessageId && snapshot.messageCount) {
      // Validate message history consistency
      const lastMessage = session.messageHistory[session.messageHistory.length - 1];
      if (lastMessage && lastMessage.id !== snapshot.lastMessageId) {
        logger.warn(`Message history inconsistency detected for session ${session.sessionId}`);
      }
    }
  }

  /**
   * Apply connection snapshot from external source
   */
  private applyConnectionSnapshot(session: SessionState, snapshot: Record<string, any>): void {
    if (snapshot.twilioStreamSid) {
      session.streamSid = snapshot.twilioStreamSid;
    }
    
    if (snapshot.connectionMetrics) {
      const health = session.connectionHealth;
      health.messagesSent += snapshot.connectionMetrics.messagesSent || 0;
      health.messagesReceived += snapshot.connectionMetrics.messagesReceived || 0;
      health.bytesTransferred += snapshot.connectionMetrics.bytesTransferred || 0;
    }
  }

  /**
   * Helper methods for health score calculations
   */
  private calculateLatencyScore(avgLatency: number): number {
    if (avgLatency < 50) return 100;
    if (avgLatency < 150) return 80;
    if (avgLatency < 300) return 60;
    if (avgLatency < 500) return 40;
    return 20;
  }

  private calculateErrorScore(errorRate: number): number {
    if (errorRate < 0.01) return 100;
    if (errorRate < 0.05) return 80;
    if (errorRate < 0.1) return 60;
    if (errorRate < 0.2) return 40;
    return 20;
  }

  private calculateStabilityScore(health: SessionConnectionHealth): number {
    const reconnectionPenalty = Math.min(health.reconnectionCount * 10, 50);
    const errorPenalty = Math.min((health.protocolErrors + health.networkErrors) * 5, 30);
    return Math.max(100 - reconnectionPenalty - errorPenalty, 0);
  }

  private calculateUptimeScore(health: SessionConnectionHealth): number {
    const uptimeHours = health.connectionUptime / 3600000;
    if (uptimeHours >= 1) return 100;
    if (uptimeHours >= 0.5) return 80;
    if (uptimeHours >= 0.25) return 60;
    return 40;
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  private determineOverallHealth(healthScore: number): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
    if (healthScore >= 90) return 'excellent';
    if (healthScore >= 70) return 'good';
    if (healthScore >= 50) return 'fair';
    if (healthScore >= 30) return 'poor';
    return 'critical';
  }

  private generateDegradationId(): string {
    return `deg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  private getDegradationDescription(type: SessionDegradationEvent['type']): string {
    const descriptions = {
      latency_spike: 'Sudden increase in connection latency detected',
      connection_drop: 'Connection was unexpectedly dropped',
      error_burst: 'Multiple errors occurred in rapid succession',
      protocol_violation: 'WebSocket protocol violation detected',
      resource_exhaustion: 'System resources are being exhausted'
    };
    return descriptions[type] || 'Unknown degradation event';
  }

  private determineDegradationSeverity(
    type: SessionDegradationEvent['type'], 
    session: SessionState
  ): SessionDegradationEvent['severity'] {
    const health = session.connectionHealth;
    
    switch (type) {
      case 'protocol_violation':
        return 'critical';
      case 'connection_drop':
        return health.reconnectionCount > 3 ? 'critical' : 'high';
      case 'error_burst':
        return health.errorRate > 1 ? 'high' : 'medium';
      case 'latency_spike':
        return health.currentLatency > 2000 ? 'high' : 'medium';
      case 'resource_exhaustion':
        return 'critical';
      default:
        return 'medium';
    }
  }

  private captureCurrentMetrics(session: SessionState): Record<string, any> {
    const health = session.connectionHealth;
    return {
      healthScore: health.healthScore,
      latency: health.currentLatency,
      errorRate: health.errorRate,
      reconnectionCount: health.reconnectionCount,
      messagesSent: health.messagesSent,
      messagesReceived: health.messagesReceived,
      connectionQuality: health.connectionQuality,
      timestamp: new Date().toISOString()
    };
  }

  private applyDegradationRecovery(session: SessionState, event: SessionDegradationEvent): string {
    switch (event.type) {
      case 'protocol_violation':
        return 'Reset connection with protocol compliance validation';
      case 'connection_drop':
        return 'Initiate immediate reconnection with exponential backoff';
      case 'error_burst':
        return 'Pause operations and implement circuit breaker';
      case 'latency_spike':
        return 'Adjust heartbeat frequency and monitor network conditions';
      case 'resource_exhaustion':
        return 'Implement resource throttling and cleanup';
      default:
        return 'Apply standard recovery procedures';
    }
  }

  private getBaseErrorStrategy(errorType: string): {
    strategy: 'retry' | 'reconnect' | 'fallback' | 'abort';
    delay: number;
    maxAttempts: number;
  } {
    const strategies = {
      network: { strategy: 'retry' as const, delay: 1000, maxAttempts: 3 },
      protocol: { strategy: 'reconnect' as const, delay: 2000, maxAttempts: 2 },
      session: { strategy: 'retry' as const, delay: 500, maxAttempts: 5 },
      resource: { strategy: 'fallback' as const, delay: 5000, maxAttempts: 1 },
      critical: { strategy: 'abort' as const, delay: 0, maxAttempts: 0 }
    };
    
    return strategies[errorType as keyof typeof strategies] || strategies.network;
  }

  /**
   * Classify error type for health monitoring
   */
  private classifyError(error: Error): 'network' | 'protocol' | 'session' {
    const message = error.message.toLowerCase();
    
    if (message.includes('protocol') || message.includes('fragmented') || message.includes('malformed')) {
      return 'protocol';
    } else if (message.includes('timeout') || message.includes('connection') || message.includes('network')) {
      return 'network';
    } else {
      return 'session';
    }
  }

  /**
   * Determine recovery strategy based on session health
   */
  private determineRecoveryStrategy(session: SessionState): 'immediate' | 'delayed' | 'gradual' | 'fallback' {
    const health = session.connectionHealth;
    
    if (health.healthScore >= 70) {
      return 'immediate';
    } else if (health.healthScore >= 50) {
      return 'delayed';
    } else if (health.healthScore >= 30) {
      return 'gradual';
    } else {
      return 'fallback';
    }
  }

  /**
   * Calculate expected recovery time based on session state
   */
  private calculateExpectedRecoveryTime(session: SessionState): number {
    const health = session.connectionHealth;
    const baseTime = 5000; // 5 seconds base
    
    // Adjust based on health score
    const healthMultiplier = Math.max(1, (100 - health.healthScore) / 20);
    
    // Adjust based on reconnection history
    const reconnectionMultiplier = Math.min(1 + (health.reconnectionCount * 0.5), 5);
    
    return Math.round(baseTime * healthMultiplier * reconnectionMultiplier);
  }

  private setupSocketHandlers(binding: SocketBinding): void {
    const { socket, twilioManager, sessionId } = binding;

    // Handle socket messages
    socket.on('message', (data: Buffer) => {
      binding.connectionMetrics.messagesReceived++;
      binding.connectionMetrics.bytesReceived += data.length;
      binding.lastActivity = new Date();

      // Update session activity and health metrics
      const session = this.sessions.get(sessionId);
      if (session) {
        session.lastActiveAt = new Date();
        
        // Record health metrics if monitoring is enabled
        if (session.connectionHealth.isMonitoring) {
          this.recordSessionHealthMetric(sessionId, {
            type: 'message',
            value: 1
          });
          
          this.recordSessionHealthMetric(sessionId, {
            type: 'bytes',
            value: data.length
          });
        }
      }
    });

    // Handle socket errors
    socket.on('error', (error: Error) => {
      binding.connectionMetrics.errors++;
      
      logger.error(`Socket error for session ${sessionId}:`, {
        sessionId,
        socketId: binding.socketId,
        error: error.message
      });

      // Update session connection health
      const session = this.sessions.get(sessionId);
      if (session) {
        session.connectionHealth.failedConnections++;
        session.connectionHealth.lastConnectionError = error.message;
        this.updateConnectionQuality(session);
        
        // Record error in health monitoring if enabled
        if (session.connectionHealth.isMonitoring) {
          const errorType = this.classifyError(error);
          this.recordSessionHealthMetric(sessionId, {
            type: 'error',
            value: 1,
            context: { type: errorType, message: error.message }
          });
          
          // Handle connection degradation
          this.handleConnectionDegradation(sessionId, 'connection_drop');
        }
      }

      this.emitSessionEvent({
        type: 'SESSION_ERROR',
        sessionId,
        timestamp: new Date(),
        data: { error: error.message, socketId: binding.socketId }
      });
    });

    // Handle socket close
    socket.on('close', (code: number, reason: Buffer) => {
      logger.info(`Socket closed for session ${sessionId}`, {
        sessionId,
        socketId: binding.socketId,
        code,
        reason: reason.toString()
      });

      // Prepare session for recovery if it was an unexpected close
      if (code !== 1000) { // Not a normal close
        this.prepareSessionRecovery(sessionId);
      }

      // Unbind the session
      this.unbindSession(sessionId);
    });

    // Handle Twilio manager events (if it extends EventEmitter)
    if (twilioManager && typeof (twilioManager as any).on === 'function') {
      (twilioManager as any).on('connectionDead', () => {
        logger.warn(`Connection declared dead for session ${sessionId}`, {
          sessionId,
          socketId: binding.socketId
        });

        // Update session health monitoring
        const session = this.sessions.get(sessionId);
        if (session && session.connectionHealth.isMonitoring) {
          this.handleConnectionDegradation(sessionId, 'connection_drop');
        }

        this.prepareSessionRecovery(sessionId);
      });

      // Handle latency updates from Twilio manager if available
      (twilioManager as any).on('latencyUpdate', (latency: number) => {
        const session = this.sessions.get(sessionId);
        if (session && session.connectionHealth.isMonitoring) {
          this.recordSessionHealthMetric(sessionId, {
            type: 'latency',
            value: latency
          });
        }
      });
    }
  }

  private cleanupSocketHandlers(binding: SocketBinding): void {
    // Remove all listeners to prevent memory leaks
    binding.socket.removeAllListeners();
    
    // Clean up Twilio manager if it has event emitter capabilities
    if (binding.twilioManager && typeof (binding.twilioManager as any).removeAllListeners === 'function') {
      (binding.twilioManager as any).removeAllListeners();
    }
  }

  private updateConnectionQuality(session: SessionState): void {
    const health = session.connectionHealth;
    const successRate = health.totalConnections > 0 ? 
      health.successfulConnections / health.totalConnections : 1;

    if (successRate >= 0.95 && !health.lastConnectionError) {
      health.connectionQuality = 'excellent';
    } else if (successRate >= 0.85) {
      health.connectionQuality = 'good';
    } else if (successRate >= 0.70) {
      health.connectionQuality = 'fair';
    } else if (successRate >= 0.50) {
      health.connectionQuality = 'poor';
    } else {
      health.connectionQuality = 'critical';
    }
  }

  private startMaintenance(): void {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    // Start persistence interval (for future database persistence)
    this.persistenceInterval = setInterval(() => {
      this.persistSessions();
    }, this.config.persistenceInterval);
  }

  private persistSessions(): void {
    // This would persist session state to database in a real implementation
    // For now, just log session count
    const stats = this.getSessionStats();
    
    if (stats.totalSessions > 0) {
      logger.debug('Session persistence check', {
        totalSessions: stats.totalSessions,
        activeSessions: stats.activeSessions,
        totalConnections: stats.totalConnections
      });
    }
  }

  private generateSocketId(): string {
    return `socket-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private emitSessionEvent(event: SessionEvent): void {
    this.emit('sessionEvent', event);
    this.emit(event.type.toLowerCase(), event);
  }
}