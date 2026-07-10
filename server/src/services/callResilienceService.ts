/**
 * Call Resilience Service - Comprehensive error handling and recovery for live calls
 * 
 * This service provides robust error handling, fallback mechanisms, and recovery strategies
 * to ensure call stability and minimize disruptions during live conversations.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { CallState } from './realTimeCallStateMachine';

export interface CallResilienceConfig {
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  fallbackTimeout: number;
  heartbeatInterval: number;
  connectionTimeout: number;
  audioBufferMaxSize: number;
  cleanupInterval: number;
}

export interface CallSession {
  callId: string;
  state: CallState;
  lastHeartbeat: Date;
  errorCount: number;
  retryCount: number;
  audioBufferSize: number;
  connectionHealth: 'healthy' | 'degraded' | 'failed';
  fallbackActive: boolean;
}

export interface ServiceHealth {
  tts: boolean;
  stt: boolean;
  llm: boolean;
  websocket: boolean;
  database: boolean;
}

export class CallResilienceService extends EventEmitter {
  private sessions: Map<string, CallSession> = new Map();
  private config: CallResilienceConfig;
  private serviceHealth: ServiceHealth;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<CallResilienceConfig> = {}) {
    super();
    
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      circuitBreakerThreshold: 3,
      fallbackTimeout: 3000,
      heartbeatInterval: 5000,
      connectionTimeout: 15000,
      audioBufferMaxSize: 10 * 1024 * 1024, // 10MB
      cleanupInterval: 30000,
      ...config
    };
    
    this.serviceHealth = {
      tts: true,
      stt: true,
      llm: true,
      websocket: true,
      database: true
    };
    
    this.startHealthMonitoring();
    this.startCleanupService();
  }
  
  /**
   * Register a new call session
   */
  public registerCall(callId: string): void {
    const session: CallSession = {
      callId,
      state: CallState.INITIALIZING,
      lastHeartbeat: new Date(),
      errorCount: 0,
      retryCount: 0,
      audioBufferSize: 0,
      connectionHealth: 'healthy',
      fallbackActive: false
    };
    
    this.sessions.set(callId, session);
    logger.info(`Call ${callId} registered for resilience monitoring`);
  }
  
  /**
   * Update call heartbeat
   */
  public updateHeartbeat(callId: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      session.lastHeartbeat = new Date();
      
      // Check if connection health improved
      if (session.connectionHealth === 'failed') {
        session.connectionHealth = 'healthy';
        logger.info(`Call ${callId} connection restored`);
        this.emit('connectionRestored', callId);
      }
    }
  }
  
  /**
   * Report an error for a call
   */
  public reportError(callId: string, error: Error, context: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      session.errorCount++;
      
      logger.warn(`Call ${callId} error in ${context}:`, {
        error: error.message,
        errorCount: session.errorCount,
        context
      });
      
      // Degrade connection health if too many errors
      if (session.errorCount >= this.config.circuitBreakerThreshold) {
        session.connectionHealth = 'failed';
        this.emit('connectionDegraded', callId, error);
      } else if (session.errorCount >= 2) {
        session.connectionHealth = 'degraded';
      }
      
      // Emit error event for handling
      this.emit('callError', callId, error, context);
    }
  }
  
  /**
   * Update audio buffer size
   */
  public updateAudioBufferSize(callId: string, size: number): void {
    const session = this.sessions.get(callId);
    if (session) {
      session.audioBufferSize = size;
      
      // Check for buffer overflow
      if (size > this.config.audioBufferMaxSize) {
        logger.warn(`Call ${callId} audio buffer overflow: ${size} bytes`);
        this.emit('bufferOverflow', callId, size);
      }
    }
  }
  
  /**
   * Activate fallback mode for a call
   */
  public activateFallback(callId: string, reason: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      session.fallbackActive = true;
      logger.info(`Call ${callId} fallback activated: ${reason}`);
      this.emit('fallbackActivated', callId, reason);
    }
  }
  
  /**
   * Deactivate fallback mode for a call
   */
  public deactivateFallback(callId: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      session.fallbackActive = false;
      logger.info(`Call ${callId} fallback deactivated`);
      this.emit('fallbackDeactivated', callId);
    }
  }
  
  /**
   * Get call session status
   */
  public getCallStatus(callId: string): CallSession | null {
    return this.sessions.get(callId) || null;
  }
  
  /**
   * Get overall service health
   */
  public getServiceHealth(): ServiceHealth {
    return { ...this.serviceHealth };
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.heartbeatInterval);
  }
  
  /**
   * Perform health check on all active calls
   */
  private performHealthCheck(): void {
    const now = new Date();
    
    for (const [callId, session] of this.sessions) {
      const timeSinceHeartbeat = now.getTime() - session.lastHeartbeat.getTime();
      
      if (timeSinceHeartbeat > this.config.connectionTimeout) {
        session.connectionHealth = 'failed';
        logger.warn(`Call ${callId} connection timeout: ${timeSinceHeartbeat}ms since last heartbeat`);
        this.emit('connectionTimeout', callId, timeSinceHeartbeat);
      } else if (timeSinceHeartbeat > this.config.heartbeatInterval * 2) {
        session.connectionHealth = 'degraded';
      }
    }
  }
  
  /**
   * Start cleanup service
   */
  private startCleanupService(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.config.cleanupInterval);
  }
  
  /**
   * Cleanup old sessions and resources
   */
  private performCleanup(): void {
    const now = new Date();
    const expiredSessions: string[] = [];
    
    for (const [callId, session] of this.sessions) {
      const age = now.getTime() - session.lastHeartbeat.getTime();
      
      if (age > 300000 || (session.connectionHealth === 'failed' && age > 120000)) {
        expiredSessions.push(callId);
      }
    }
    
    expiredSessions.forEach(callId => {
      this.sessions.delete(callId);
      logger.info(`Cleaned up expired call session ${callId}`);
      this.emit('sessionCleaned', callId);
    });
  }
  
  /**
   * Unregister a call session
   */
  public unregisterCall(callId: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      this.sessions.delete(callId);
      logger.info(`Call ${callId} unregistered from resilience monitoring`);
      this.emit('sessionCleaned', callId);
    }
  }
  
  /**
   * Shutdown the resilience service
   */
  public shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    this.sessions.clear();
    logger.info('Call resilience service shutdown');
  }
}

// Singleton instance
let resilienceService: CallResilienceService | null = null;

export function getCallResilienceService(): CallResilienceService {
  if (!resilienceService) {
    resilienceService = new CallResilienceService();
  }
  return resilienceService;
}

export function shutdownCallResilienceService(): void {
  if (resilienceService) {
    resilienceService.shutdown();
    resilienceService = null;
  }
}
