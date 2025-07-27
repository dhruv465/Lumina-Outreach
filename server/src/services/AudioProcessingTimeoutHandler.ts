/**
 * Audio Processing Timeout Handler
 * 
 * Implements configurable timeouts for each processing stage, timeout recovery
 * mechanisms, user feedback, and processing error classification with recovery strategies.
 * 
 * Requirements: 3.2, 3.4, 2.2
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';

export interface TimeoutConfig {
  stage: ProcessingStage;
  timeout: number;
  retryCount: number;
  maxRetries: number;
  backoffMultiplier: number;
  maxBackoffDelay: number;
  recoveryStrategy: RecoveryStrategy;
  userFeedbackEnabled: boolean;
  criticalThreshold: number; // ms - when to escalate to critical
}

export type ProcessingStage = 
  | 'speech_to_text' 
  | 'llm_processing' 
  | 'text_to_speech' 
  | 'audio_analysis'
  | 'websocket_send'
  | 'websocket_receive'
  | 'session_recovery';

export type RecoveryStrategy = 
  | 'immediate_retry'
  | 'exponential_backoff'
  | 'circuit_breaker'
  | 'fallback_service'
  | 'graceful_degradation'
  | 'user_notification'
  | 'session_reset';

export type ErrorType = 
  | 'timeout'
  | 'network_error'
  | 'service_unavailable'
  | 'rate_limit'
  | 'authentication_error'
  | 'validation_error'
  | 'resource_exhaustion'
  | 'protocol_error'
  | 'unknown_error';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ProcessingError {
  id: string;
  sessionId: string;
  stage: ProcessingStage;
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  timestamp: Date;
  context: Record<string, any>;
  recoverable: boolean;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  recoveryStrategy: RecoveryStrategy;
  userNotified: boolean;
  resolved: boolean;
  resolvedAt?: Date;
  resolutionMethod?: string;
}

export interface TimeoutEvent {
  id: string;
  sessionId: string;
  stage: ProcessingStage;
  startTime: Date;
  timeoutTime: Date;
  actualDuration: number;
  expectedDuration: number;
  context: Record<string, any>;
  recoveryAction: RecoveryStrategy;
  userFeedback?: UserFeedback;
}

export interface UserFeedback {
  type: 'notification' | 'progress' | 'error' | 'recovery';
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  actionRequired: boolean;
  suggestedActions?: string[];
  estimatedResolutionTime?: number;
  progressPercentage?: number;
}

export interface RecoveryMechanism {
  strategy: RecoveryStrategy;
  execute: (error: ProcessingError) => Promise<RecoveryResult>;
  canRecover: (error: ProcessingError) => boolean;
  estimatedRecoveryTime: number;
  successRate: number;
  description: string;
}

export interface RecoveryResult {
  success: boolean;
  message: string;
  newTimeout?: number;
  fallbackUsed?: boolean;
  userFeedback?: UserFeedback;
  nextAction?: RecoveryStrategy;
  context?: Record<string, any>;
}

export interface TimeoutMetrics {
  totalTimeouts: number;
  timeoutsByStage: Record<ProcessingStage, number>;
  timeoutsByError: Record<ErrorType, number>;
  averageRecoveryTime: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  userNotificationsSent: number;
  criticalTimeouts: number;
  recoveryStrategiesUsed: Record<RecoveryStrategy, number>;
}

export class AudioProcessingTimeoutHandler extends EventEmitter {
  private timeoutConfigs: Map<ProcessingStage, TimeoutConfig> = new Map();
  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private processingErrors: Map<string, ProcessingError> = new Map();
  private timeoutEvents: Map<string, TimeoutEvent> = new Map();
  private recoveryMechanisms: Map<RecoveryStrategy, RecoveryMechanism> = new Map();
  
  // Metrics tracking
  private metrics: TimeoutMetrics = {
    totalTimeouts: 0,
    timeoutsByStage: {} as Record<ProcessingStage, number>,
    timeoutsByError: {} as Record<ErrorType, number>,
    averageRecoveryTime: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    userNotificationsSent: 0,
    criticalTimeouts: 0,
    recoveryStrategiesUsed: {} as Record<RecoveryStrategy, number>
  };
  
  // Circuit breaker states
  private circuitBreakerStates: Map<string, {
    failures: number;
    lastFailure: Date;
    state: 'closed' | 'open' | 'half-open';
    nextAttempt: Date;
  }> = new Map();

  constructor() {
    super();
    this.initializeDefaultConfigs();
    this.initializeRecoveryMechanisms();
    
    logger.info('AudioProcessingTimeoutHandler initialized');
  }

  /**
   * Set timeout configuration for a processing stage
   */
  public setTimeoutConfig(stage: ProcessingStage, config: Partial<TimeoutConfig>): void {
    const existingConfig = this.timeoutConfigs.get(stage) || this.getDefaultConfig(stage);
    const newConfig = { ...existingConfig, ...config, stage };
    
    this.timeoutConfigs.set(stage, newConfig);
    
    logger.debug(`Updated timeout config for stage ${stage}`, {
      stage,
      timeout: newConfig.timeout,
      maxRetries: newConfig.maxRetries,
      recoveryStrategy: newConfig.recoveryStrategy
    });
  }

  /**
   * Start timeout monitoring for a processing operation
   */
  public startTimeout(
    operationId: string,
    sessionId: string,
    stage: ProcessingStage,
    context: Record<string, any> = {}
  ): void {
    const config = this.timeoutConfigs.get(stage) || this.getDefaultConfig(stage);
    const startTime = new Date();
    
    // Clear any existing timeout for this operation
    this.clearTimeout(operationId);
    
    // Set timeout
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(operationId, sessionId, stage, startTime, context);
    }, config.timeout);
    
    this.activeTimeouts.set(operationId, timeoutHandle);
    
    logger.debug(`Started timeout monitoring for operation ${operationId}`, {
      operationId,
      sessionId,
      stage,
      timeout: config.timeout,
      context
    });
  }

  /**
   * Clear timeout for an operation
   */
  public clearTimeout(operationId: string): boolean {
    const timeoutHandle = this.activeTimeouts.get(operationId);
    
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.activeTimeouts.delete(operationId);
      
      logger.debug(`Cleared timeout for operation ${operationId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Handle processing error with classification and recovery
   */
  public async handleProcessingError(
    sessionId: string,
    stage: ProcessingStage,
    error: Error,
    context: Record<string, any> = {}
  ): Promise<RecoveryResult> {
    const processingError = this.classifyError(sessionId, stage, error, context);
    
    // Store error for tracking
    this.processingErrors.set(processingError.id, processingError);
    
    // Update metrics
    this.updateErrorMetrics(processingError);
    
    logger.warn(`Processing error occurred`, {
      errorId: processingError.id,
      sessionId,
      stage,
      type: processingError.type,
      severity: processingError.severity,
      message: processingError.message
    });
    
    // Emit error event
    this.emit('processingError', processingError);
    
    // Attempt recovery
    const recoveryResult = await this.attemptRecovery(processingError);
    
    // Send user feedback if enabled and appropriate
    if (processingError.severity === 'high' || processingError.severity === 'critical') {
      await this.sendUserFeedback(processingError, recoveryResult);
    }
    
    return recoveryResult;
  }

  /**
   * Get timeout configuration for a stage
   */
  public getTimeoutConfig(stage: ProcessingStage): TimeoutConfig {
    return this.timeoutConfigs.get(stage) || this.getDefaultConfig(stage);
  }

  /**
   * Get processing error by ID
   */
  public getProcessingError(errorId: string): ProcessingError | undefined {
    return this.processingErrors.get(errorId);
  }

  /**
   * Get timeout metrics
   */
  public getTimeoutMetrics(): TimeoutMetrics {
    return { ...this.metrics };
  }

  /**
   * Get session error history
   */
  public getSessionErrorHistory(sessionId: string, limit: number = 10): ProcessingError[] {
    return Array.from(this.processingErrors.values())
      .filter(error => error.sessionId === sessionId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Update timeout configuration at runtime
   */
  public updateTimeoutConfig(
    stage: ProcessingStage,
    updates: Partial<Omit<TimeoutConfig, 'stage'>>
  ): void {
    const config = this.timeoutConfigs.get(stage);
    if (config) {
      Object.assign(config, updates);
      
      logger.info(`Updated timeout configuration for ${stage}`, {
        stage,
        updates
      });
      
      this.emit('configUpdated', { stage, config });
    }
  }

  /**
   * Reset circuit breaker for a stage
   */
  public resetCircuitBreaker(stage: ProcessingStage): void {
    const key = `circuit_${stage}`;
    this.circuitBreakerStates.delete(key);
    
    logger.info(`Reset circuit breaker for stage ${stage}`);
  }

  /**
   * Get circuit breaker status
   */
  public getCircuitBreakerStatus(stage: ProcessingStage): {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    nextAttempt?: Date;
  } {
    const key = `circuit_${stage}`;
    const state = this.circuitBreakerStates.get(key);
    
    return {
      state: state?.state || 'closed',
      failures: state?.failures || 0,
      nextAttempt: state?.nextAttempt
    };
  }

  /**
   * Cleanup expired errors and timeouts
   */
  public cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean up old errors
    const expiredErrors: string[] = [];
    for (const [errorId, error] of this.processingErrors.entries()) {
      if (now - error.timestamp.getTime() > maxAge) {
        expiredErrors.push(errorId);
      }
    }
    
    for (const errorId of expiredErrors) {
      this.processingErrors.delete(errorId);
    }
    
    // Clean up old timeout events
    const expiredEvents: string[] = [];
    for (const [eventId, event] of this.timeoutEvents.entries()) {
      if (now - event.startTime.getTime() > maxAge) {
        expiredEvents.push(eventId);
      }
    }
    
    for (const eventId of expiredEvents) {
      this.timeoutEvents.delete(eventId);
    }
    
    if (expiredErrors.length > 0 || expiredEvents.length > 0) {
      logger.debug(`Cleaned up expired data`, {
        expiredErrors: expiredErrors.length,
        expiredEvents: expiredEvents.length
      });
    }
  }

  // Private methods

  private initializeDefaultConfigs(): void {
    const stages: ProcessingStage[] = [
      'speech_to_text',
      'llm_processing', 
      'text_to_speech',
      'audio_analysis',
      'websocket_send',
      'websocket_receive',
      'session_recovery'
    ];
    
    for (const stage of stages) {
      this.timeoutConfigs.set(stage, this.getDefaultConfig(stage));
    }
  }

  private getDefaultConfig(stage: ProcessingStage): TimeoutConfig {
    const baseConfig = {
      stage,
      retryCount: 0,
      backoffMultiplier: 2,
      maxBackoffDelay: 30000,
      userFeedbackEnabled: true,
      criticalThreshold: 60000
    };
    
    switch (stage) {
      case 'speech_to_text':
        return {
          ...baseConfig,
          timeout: 15000,
          maxRetries: 2,
          recoveryStrategy: 'exponential_backoff'
        };
      case 'llm_processing':
        return {
          ...baseConfig,
          timeout: 30000,
          maxRetries: 3,
          recoveryStrategy: 'circuit_breaker'
        };
      case 'text_to_speech':
        return {
          ...baseConfig,
          timeout: 20000,
          maxRetries: 2,
          recoveryStrategy: 'fallback_service'
        };
      case 'audio_analysis':
        return {
          ...baseConfig,
          timeout: 10000,
          maxRetries: 1,
          recoveryStrategy: 'graceful_degradation'
        };
      case 'websocket_send':
        return {
          ...baseConfig,
          timeout: 5000,
          maxRetries: 3,
          recoveryStrategy: 'immediate_retry'
        };
      case 'websocket_receive':
        return {
          ...baseConfig,
          timeout: 10000,
          maxRetries: 2,
          recoveryStrategy: 'session_reset'
        };
      case 'session_recovery':
        return {
          ...baseConfig,
          timeout: 15000,
          maxRetries: 3,
          recoveryStrategy: 'exponential_backoff'
        };
      default:
        return {
          ...baseConfig,
          timeout: 30000,
          maxRetries: 2,
          recoveryStrategy: 'exponential_backoff'
        };
    }
  }

  private initializeRecoveryMechanisms(): void {
    // Immediate retry mechanism
    this.recoveryMechanisms.set('immediate_retry', {
      strategy: 'immediate_retry',
      execute: async (error: ProcessingError) => {
        if (error.retryCount >= error.maxRetries) {
          return {
            success: false,
            message: 'Maximum retries exceeded',
            userFeedback: {
              type: 'error',
              message: 'Operation failed after multiple attempts',
              severity: 'error',
              actionRequired: true,
              suggestedActions: ['Try again later', 'Contact support']
            }
          };
        }
        
        return {
          success: true,
          message: 'Retrying immediately',
          userFeedback: {
            type: 'progress',
            message: 'Retrying operation...',
            severity: 'info',
            actionRequired: false,
            progressPercentage: 50
          }
        };
      },
      canRecover: (error) => error.retryCount < error.maxRetries,
      estimatedRecoveryTime: 1000,
      successRate: 0.7,
      description: 'Immediately retry the failed operation'
    });
    
    // Exponential backoff mechanism
    this.recoveryMechanisms.set('exponential_backoff', {
      strategy: 'exponential_backoff',
      execute: async (error: ProcessingError) => {
        if (error.retryCount >= error.maxRetries) {
          return {
            success: false,
            message: 'Maximum retries exceeded with backoff',
            userFeedback: {
              type: 'error',
              message: 'Operation failed after multiple attempts with delays',
              severity: 'error',
              actionRequired: true
            }
          };
        }
        
        const config = this.getTimeoutConfig(error.stage);
        const delay = Math.min(
          config.backoffMultiplier ** error.retryCount * 1000,
          config.maxBackoffDelay
        );
        
        error.nextRetryAt = new Date(Date.now() + delay);
        
        return {
          success: true,
          message: `Retrying with ${delay}ms delay`,
          userFeedback: {
            type: 'progress',
            message: `Retrying in ${Math.round(delay / 1000)} seconds...`,
            severity: 'info',
            actionRequired: false,
            estimatedResolutionTime: delay
          }
        };
      },
      canRecover: (error) => error.retryCount < error.maxRetries,
      estimatedRecoveryTime: 5000,
      successRate: 0.8,
      description: 'Retry with exponentially increasing delays'
    });
    
    // Circuit breaker mechanism
    this.recoveryMechanisms.set('circuit_breaker', {
      strategy: 'circuit_breaker',
      execute: async (error: ProcessingError) => {
        const key = `circuit_${error.stage}`;
        const state = this.circuitBreakerStates.get(key) || {
          failures: 0,
          lastFailure: new Date(),
          state: 'closed' as const,
          nextAttempt: new Date()
        };
        
        state.failures++;
        state.lastFailure = new Date();
        
        if (state.failures >= 5) {
          state.state = 'open';
          state.nextAttempt = new Date(Date.now() + 60000); // 1 minute
          
          this.circuitBreakerStates.set(key, state);
          
          return {
            success: false,
            message: 'Circuit breaker opened - service temporarily unavailable',
            userFeedback: {
              type: 'error',
              message: 'Service temporarily unavailable. Please try again in a few minutes.',
              severity: 'warning',
              actionRequired: false,
              estimatedResolutionTime: 60000
            }
          };
        }
        
        this.circuitBreakerStates.set(key, state);
        
        return {
          success: true,
          message: 'Circuit breaker allowing retry',
          userFeedback: {
            type: 'progress',
            message: 'Attempting recovery...',
            severity: 'info',
            actionRequired: false
          }
        };
      },
      canRecover: (error) => {
        const key = `circuit_${error.stage}`;
        const state = this.circuitBreakerStates.get(key);
        return !state || state.state !== 'open' || Date.now() > state.nextAttempt.getTime();
      },
      estimatedRecoveryTime: 10000,
      successRate: 0.6,
      description: 'Prevent cascading failures by temporarily blocking requests'
    });
    
    // Graceful degradation mechanism
    this.recoveryMechanisms.set('graceful_degradation', {
      strategy: 'graceful_degradation',
      execute: async (error: ProcessingError) => {
        return {
          success: true,
          message: 'Continuing with reduced functionality',
          fallbackUsed: true,
          userFeedback: {
            type: 'notification',
            message: 'Some features are temporarily unavailable, but core functionality continues',
            severity: 'warning',
            actionRequired: false
          }
        };
      },
      canRecover: () => true,
      estimatedRecoveryTime: 0,
      successRate: 1.0,
      description: 'Continue operation with reduced functionality'
    });
    
    // User notification mechanism
    this.recoveryMechanisms.set('user_notification', {
      strategy: 'user_notification',
      execute: async (error: ProcessingError) => {
        return {
          success: true,
          message: 'User notified of issue',
          userFeedback: {
            type: 'error',
            message: `${error.stage} operation failed: ${error.message}`,
            severity: error.severity === 'critical' ? 'critical' : 'error',
            actionRequired: true,
            suggestedActions: [
              'Check your internet connection',
              'Try refreshing the page',
              'Contact support if the issue persists'
            ]
          }
        };
      },
      canRecover: () => true,
      estimatedRecoveryTime: 0,
      successRate: 1.0,
      description: 'Notify user about the issue and provide guidance'
    });
  }

  private async handleTimeout(
    operationId: string,
    sessionId: string,
    stage: ProcessingStage,
    startTime: Date,
    context: Record<string, any>
  ): Promise<void> {
    const config = this.getTimeoutConfig(stage);
    const timeoutTime = new Date();
    const actualDuration = timeoutTime.getTime() - startTime.getTime();
    
    // Create timeout event
    const timeoutEvent: TimeoutEvent = {
      id: this.generateEventId(),
      sessionId,
      stage,
      startTime,
      timeoutTime,
      actualDuration,
      expectedDuration: config.timeout,
      context,
      recoveryAction: config.recoveryStrategy
    };
    
    this.timeoutEvents.set(timeoutEvent.id, timeoutEvent);
    
    // Update metrics
    this.metrics.totalTimeouts++;
    this.metrics.timeoutsByStage[stage] = (this.metrics.timeoutsByStage[stage] || 0) + 1;
    
    if (actualDuration > config.criticalThreshold) {
      this.metrics.criticalTimeouts++;
    }
    
    // Create processing error for timeout
    const timeoutError = new Error(`Operation timed out after ${actualDuration}ms`);
    const processingError = this.classifyError(sessionId, stage, timeoutError, {
      ...context,
      operationId,
      timeoutDuration: actualDuration,
      expectedDuration: config.timeout
    });
    
    processingError.type = 'timeout';
    
    logger.error(`Operation timeout occurred`, {
      operationId,
      sessionId,
      stage,
      actualDuration,
      expectedDuration: config.timeout,
      recoveryAction: config.recoveryStrategy
    });
    
    // Clean up timeout
    this.activeTimeouts.delete(operationId);
    
    // Emit timeout event
    this.emit('timeout', timeoutEvent);
    
    // Attempt recovery
    const recoveryResult = await this.attemptRecovery(processingError);
    timeoutEvent.userFeedback = recoveryResult.userFeedback;
    
    // Send user feedback for critical timeouts
    if (actualDuration > config.criticalThreshold) {
      await this.sendUserFeedback(processingError, recoveryResult);
    }
  }

  private classifyError(
    sessionId: string,
    stage: ProcessingStage,
    error: Error,
    context: Record<string, any>
  ): ProcessingError {
    const config = this.getTimeoutConfig(stage);
    
    // Classify error type
    let errorType: ErrorType = 'unknown_error';
    let severity: ErrorSeverity = 'medium';
    
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('timeout')) {
      errorType = 'timeout';
      severity = 'high';
    } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      errorType = 'network_error';
      severity = 'high';
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('throttle')) {
      errorType = 'rate_limit';
      severity = 'medium';
    } else if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
      errorType = 'authentication_error';
      severity = 'high';
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      errorType = 'validation_error';
      severity = 'low';
    } else if (errorMessage.includes('memory') || errorMessage.includes('resource')) {
      errorType = 'resource_exhaustion';
      severity = 'critical';
    } else if (errorMessage.includes('protocol') || errorMessage.includes('websocket')) {
      errorType = 'protocol_error';
      severity = 'high';
    } else if (errorMessage.includes('unavailable') || errorMessage.includes('service')) {
      errorType = 'service_unavailable';
      severity = 'high';
    }
    
    // Determine if error is recoverable
    const recoverable = errorType !== 'authentication_error' && 
                       errorType !== 'validation_error' &&
                       severity !== 'critical';
    
    return {
      id: this.generateErrorId(),
      sessionId,
      stage,
      type: errorType,
      severity,
      message: error.message,
      originalError: error,
      timestamp: new Date(),
      context,
      recoverable,
      retryCount: 0,
      maxRetries: config.maxRetries,
      recoveryStrategy: config.recoveryStrategy,
      userNotified: false,
      resolved: false
    };
  }

  private async attemptRecovery(error: ProcessingError): Promise<RecoveryResult> {
    const mechanism = this.recoveryMechanisms.get(error.recoveryStrategy);
    
    if (!mechanism) {
      logger.error(`No recovery mechanism found for strategy: ${error.recoveryStrategy}`);
      return {
        success: false,
        message: `Unknown recovery strategy: ${error.recoveryStrategy}`
      };
    }
    
    if (!mechanism.canRecover(error)) {
      logger.warn(`Recovery mechanism cannot recover error`, {
        errorId: error.id,
        strategy: error.recoveryStrategy,
        retryCount: error.retryCount
      });
      
      return {
        success: false,
        message: 'Error cannot be recovered with current strategy'
      };
    }
    
    try {
      const startTime = Date.now();
      const result = await mechanism.execute(error);
      const recoveryTime = Date.now() - startTime;
      
      // Update metrics
      this.metrics.recoveryStrategiesUsed[error.recoveryStrategy] = 
        (this.metrics.recoveryStrategiesUsed[error.recoveryStrategy] || 0) + 1;
      
      if (result.success) {
        this.metrics.successfulRecoveries++;
        error.resolved = true;
        error.resolvedAt = new Date();
        error.resolutionMethod = error.recoveryStrategy;
      } else {
        this.metrics.failedRecoveries++;
      }
      
      // Update average recovery time
      const totalRecoveries = this.metrics.successfulRecoveries + this.metrics.failedRecoveries;
      this.metrics.averageRecoveryTime = 
        (this.metrics.averageRecoveryTime * (totalRecoveries - 1) + recoveryTime) / totalRecoveries;
      
      logger.info(`Recovery attempt completed`, {
        errorId: error.id,
        strategy: error.recoveryStrategy,
        success: result.success,
        recoveryTime,
        message: result.message
      });
      
      this.emit('recoveryAttempt', {
        error,
        result,
        recoveryTime
      });
      
      return result;
      
    } catch (recoveryError) {
      const errorMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      
      logger.error(`Recovery mechanism failed`, {
        errorId: error.id,
        strategy: error.recoveryStrategy,
        recoveryError: errorMessage
      });
      
      this.metrics.failedRecoveries++;
      
      return {
        success: false,
        message: `Recovery failed: ${errorMessage}`
      };
    }
  }

  private async sendUserFeedback(
    error: ProcessingError,
    recoveryResult: RecoveryResult
  ): Promise<void> {
    if (!error.userNotified && recoveryResult.userFeedback) {
      error.userNotified = true;
      this.metrics.userNotificationsSent++;
      
      logger.info(`Sending user feedback`, {
        errorId: error.id,
        sessionId: error.sessionId,
        feedbackType: recoveryResult.userFeedback.type,
        severity: recoveryResult.userFeedback.severity
      });
      
      this.emit('userFeedback', {
        sessionId: error.sessionId,
        feedback: recoveryResult.userFeedback,
        error,
        recoveryResult
      });
    }
  }

  private updateErrorMetrics(error: ProcessingError): void {
    this.metrics.timeoutsByError[error.type] = (this.metrics.timeoutsByError[error.type] || 0) + 1;
  }

  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default AudioProcessingTimeoutHandler;