/**
 * Call Resilience Service - Comprehensive error handling and recovery for live calls
 * 
 * This service provides robust error handling, fallback mechanisms, and recovery strategies
 * to ensure call stability and minimize disruptions during live conversations.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { CallState, CallEvent, RealTimeCallStateMachine } from './realTimeCallStateMachine';
import { RateLimitAwareCircuitBreaker } from '../utils/circuitBreaker';

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
  
  // Circuit breakers for external services
  private ttsCircuitBreaker: RateLimitAwareCircuitBreaker<any[], any>;
  private sttCircuitBreaker: RateLimitAwareCircuitBreaker<any[], any>;
  private llmCircuitBreaker: RateLimitAwareCircuitBreaker<any[], any>;
  
  constructor(config: Partial<CallResilienceConfig> = {}) {
    super();
    
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      fallbackTimeout: 5000,
      heartbeatInterval: 10000,
      connectionTimeout: 30000,
      audioBufferMaxSize: 10 * 1024 * 1024, // 10MB
      cleanupInterval: 60000, // 1 minute
      ...config
    };
    
    this.serviceHealth = {
      tts: true,
      stt: true,
      llm: true,
      websocket: true,
      database: true
    };
    
    this.initializeCircuitBreakers();
    this.startHealthMonitoring();
    this.startCleanupService();
  }
  
  /**
   * Initialize circuit breakers for external services
   */
  private initializeCircuitBreakers(): void {
    const circuitBreakerConfig = {
      timeout: this.config.fallbackTimeout,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      volumeThreshold: this.config.circuitBreakerThreshold,
      maxRetries: this.config.maxRetries,
      baseDelay: this.config.retryDelay,
      maxDelay: 10000,
      jitter: true
    };
    
    // TTS Circuit Breaker
    this.ttsCircuitBreaker = new RateLimitAwareCircuitBreaker(
      async (provider: string, text: string, voiceId: string) => {
        // This will be wrapped around actual TTS calls
        throw new Error('TTS circuit breaker not implemented');
      },
      circuitBreakerConfig,
      'tts'
    );
    
    // STT Circuit Breaker
    this.sttCircuitBreaker = new RateLimitAwareCircuitBreaker(
      async (audioData: Buffer) => {
        // This will be wrapped around actual STT calls
        throw new Error('STT circuit breaker not implemented');
      },
      circuitBreakerConfig,
      'stt'
    );
    
    // LLM Circuit Breaker
    this.llmCircuitBreaker = new RateLimitAwareCircuitBreaker(
      async (messages: any[], provider: string) => {
        // This will be wrapped around actual LLM calls
        throw new Error('LLM circuit breaker not implemented');
      },
      circuitBreakerConfig,
      'llm'
    );
    
    // Setup circuit breaker event handlers
    this.setupCircuitBreakerHandlers();
  }
  
  /**
   * Setup circuit breaker event handlers
   */
  private setupCircuitBreakerHandlers(): void {
    // TTS Circuit Breaker Events
    this.ttsCircuitBreaker.on('open', () => {
      logger.warn('TTS Circuit breaker opened - switching to fallback');
      this.serviceHealth.tts = false;
      this.emit('serviceDown', 'tts');
    });
    
    this.ttsCircuitBreaker.on('halfOpen', () => {
      logger.info('TTS Circuit breaker half-open - testing service');
    });
    
    this.ttsCircuitBreaker.on('close', () => {
      logger.info('TTS Circuit breaker closed - service restored');
      this.serviceHealth.tts = true;
      this.emit('serviceRestored', 'tts');
    });
    
    // STT Circuit Breaker Events
    this.sttCircuitBreaker.on('open', () => {
      logger.warn('STT Circuit breaker opened - switching to fallback');
      this.serviceHealth.stt = false;
      this.emit('serviceDown', 'stt');
    });
    
    this.sttCircuitBreaker.on('close', () => {
      logger.info('STT Circuit breaker closed - service restored');
      this.serviceHealth.stt = true;
      this.emit('serviceRestored', 'stt');
    });
    
    // LLM Circuit Breaker Events
    this.llmCircuitBreaker.on('open', () => {
      logger.warn('LLM Circuit breaker opened - switching to fallback');
      this.serviceHealth.llm = false;
      this.emit('serviceDown', 'llm');
    });
    
    this.llmCircuitBreaker.on('close', () => {
      logger.info('LLM Circuit breaker closed - service restored');
      this.serviceHealth.llm = true;
      this.emit('serviceRestored', 'llm');
    });
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
      
      // Remove sessions older than 1 hour with no heartbeat
      if (age > 3600000) {
        expiredSessions.push(callId);
      }
    }
    
    expiredSessions.forEach(callId => {
      this.sessions.delete(callId);
      logger.info(`Cleaned up expired call session ${callId}`);
    });
  }
  
  /**
   * Unregister a call session
   */
  public unregisterCall(callId: string): void {
    this.sessions.delete(callId);
    logger.info(`Call ${callId} unregistered from resilience monitoring`);
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
  
  /**
   * Get circuit breaker for TTS
   */
  public getTTSCircuitBreaker(): RateLimitAwareCircuitBreaker<any[], any> {
    return this.ttsCircuitBreaker;
  }
  
  /**
   * Get circuit breaker for STT
   */
  public getSTTCircuitBreaker(): RateLimitAwareCircuitBreaker<any[], any> {
    return this.sttCircuitBreaker;
  }
  
  /**
   * Get circuit breaker for LLM
   */
  public getLLMCircuitBreaker(): RateLimitAwareCircuitBreaker<any[], any> {
    return this.llmCircuitBreaker;
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