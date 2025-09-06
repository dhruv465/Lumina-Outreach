import { EventEmitter } from 'events';
import logger from '../utils/logger';

export interface ReconnectionConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  jitterFactor: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  // Enhanced configuration for better connection stability
  fastRetryWindow: number; // Time window for fast retries (ms)
  fastRetryMaxAttempts: number; // Max attempts within fast retry window
  connectionStabilityThreshold: number; // Min connection duration to consider stable (ms)
  adaptiveDelayEnabled: boolean; // Enable adaptive delay based on connection patterns
}

export interface ReconnectionAttempt {
  attemptNumber: number;
  timestamp: Date;
  reason: string;
  success: boolean;
  error?: string;
  delay: number;
}

export interface ReconnectionMetrics {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  averageDelay: number;
  lastAttemptTime: Date | null;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  // Enhanced metrics for connection stability analysis
  connectionStabilityRatio: number; // Ratio of stable connections to total attempts
  averageConnectionDuration: number;
  fastRetryCount: number;
  adaptiveDelayAdjustments: number;
  lastStableConnectionTime: Date | null;
}

/**
 * Intelligent reconnection service with exponential backoff and circuit breaker
 * Specifically designed to handle Twilio WebSocket connection issues
 */
export class ReconnectionService extends EventEmitter {
  private config: ReconnectionConfig;
  private attempts: ReconnectionAttempt[] = [];
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private circuitBreakerOpenTime: Date | null = null;
  private consecutiveFailures = 0;
  private isReconnecting = false;

  constructor(config: Partial<ReconnectionConfig> = {}) {
    super();
    
    this.config = {
      maxAttempts: config.maxAttempts || 10,
      baseDelay: config.baseDelay || 1000, // 1 second
      maxDelay: config.maxDelay || 30000, // 30 seconds
      jitterFactor: config.jitterFactor || 0.1,
      circuitBreakerThreshold: config.circuitBreakerThreshold || 5,
      circuitBreakerTimeout: config.circuitBreakerTimeout || 60000, // 1 minute
      // Enhanced default configuration
      fastRetryWindow: config.fastRetryWindow || 30000, // 30 seconds
      fastRetryMaxAttempts: config.fastRetryMaxAttempts || 3,
      connectionStabilityThreshold: config.connectionStabilityThreshold || 10000, // 10 seconds
      adaptiveDelayEnabled: config.adaptiveDelayEnabled ?? true,
      ...config
    };

    logger.info('ReconnectionService initialized', {
      config: this.config
    });
  }

  /**
   * Calculate delay for next reconnection attempt using exponential backoff with jitter
   */
  private calculateDelay(attemptNumber: number): number {
    // Exponential backoff: baseDelay * 2^attemptNumber
    const exponentialDelay = this.config.baseDelay * Math.pow(2, attemptNumber - 1);
    
    // Apply maximum delay limit
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * this.config.jitterFactor * Math.random();
    
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Check if circuit breaker should be opened
   */
  private shouldOpenCircuitBreaker(): boolean {
    return this.consecutiveFailures >= this.config.circuitBreakerThreshold;
  }

  /**
   * Check if circuit breaker should transition to half-open
   */
  private shouldTryHalfOpen(): boolean {
    if (this.circuitBreakerState !== 'open' || !this.circuitBreakerOpenTime) {
      return false;
    }
    
    const timeSinceOpen = Date.now() - this.circuitBreakerOpenTime.getTime();
    return timeSinceOpen >= this.config.circuitBreakerTimeout;
  }

  /**
   * Update circuit breaker state based on attempt result
   */
  private updateCircuitBreaker(success: boolean): void {
    if (success) {
      // Reset on success
      this.consecutiveFailures = 0;
      this.circuitBreakerState = 'closed';
      this.circuitBreakerOpenTime = null;
      
      logger.info('Circuit breaker closed - connection successful');
    } else {
      this.consecutiveFailures++;
      
      if (this.circuitBreakerState === 'closed' && this.shouldOpenCircuitBreaker()) {
        this.circuitBreakerState = 'open';
        this.circuitBreakerOpenTime = new Date();
        
        logger.warn('Circuit breaker opened due to consecutive failures', {
          consecutiveFailures: this.consecutiveFailures,
          threshold: this.config.circuitBreakerThreshold
        });
        
        this.emit('circuitBreakerOpened', {
          consecutiveFailures: this.consecutiveFailures,
          threshold: this.config.circuitBreakerThreshold
        });
      } else if (this.circuitBreakerState === 'half-open') {
        // Failed in half-open state, go back to open
        this.circuitBreakerState = 'open';
        this.circuitBreakerOpenTime = new Date();
        
        logger.warn('Circuit breaker reopened after failed half-open attempt');
      }
    }
  }

  /**
   * Attempt reconnection with intelligent backoff and circuit breaker
   */
  async attemptReconnection(
    connectionFunction: () => Promise<void>,
    reason: string,
    sessionId?: string
  ): Promise<boolean> {
    if (this.isReconnecting) {
      logger.warn('Reconnection already in progress', { reason, sessionId });
      return false;
    }

    // Check circuit breaker state
    if (this.circuitBreakerState === 'open') {
      if (this.shouldTryHalfOpen()) {
        this.circuitBreakerState = 'half-open';
        logger.info('Circuit breaker transitioning to half-open state');
      } else {
        logger.warn('Circuit breaker is open, skipping reconnection attempt', {
          reason,
          sessionId,
          timeSinceOpen: this.circuitBreakerOpenTime ? 
            Date.now() - this.circuitBreakerOpenTime.getTime() : 0
        });
        return false;
      }
    }

    this.isReconnecting = true;
    const attemptNumber = this.attempts.length + 1;

    // Check if we've exceeded max attempts
    if (attemptNumber > this.config.maxAttempts) {
      logger.error('Maximum reconnection attempts exceeded', {
        maxAttempts: this.config.maxAttempts,
        reason,
        sessionId
      });
      
      this.emit('maxAttemptsExceeded', {
        maxAttempts: this.config.maxAttempts,
        reason,
        sessionId
      });
      
      this.isReconnecting = false;
      return false;
    }

    const delay = this.calculateDelay(attemptNumber);
    
    logger.info(`Starting reconnection attempt ${attemptNumber}`, {
      reason,
      sessionId,
      delay,
      circuitBreakerState: this.circuitBreakerState
    });

    // Wait for calculated delay
    await new Promise(resolve => setTimeout(resolve, delay));

    const attempt: ReconnectionAttempt = {
      attemptNumber,
      timestamp: new Date(),
      reason,
      success: false,
      delay
    };

    try {
      // Emit reconnection started event
      this.emit('reconnectionStarted', {
        attemptNumber,
        reason,
        sessionId,
        delay
      });

      // Attempt the connection
      await connectionFunction();
      
      // Success
      attempt.success = true;
      this.attempts.push(attempt);
      this.updateCircuitBreaker(true);
      
      logger.info(`Reconnection attempt ${attemptNumber} successful`, {
        reason,
        sessionId,
        totalAttempts: this.attempts.length
      });

      this.emit('reconnectionSuccess', {
        attemptNumber,
        reason,
        sessionId,
        totalAttempts: this.attempts.length
      });

      this.isReconnecting = false;
      return true;

    } catch (error) {
      // Failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      attempt.error = errorMessage;
      this.attempts.push(attempt);
      this.updateCircuitBreaker(false);
      
      logger.error(`Reconnection attempt ${attemptNumber} failed`, {
        reason,
        sessionId,
        error: errorMessage,
        consecutiveFailures: this.consecutiveFailures,
        circuitBreakerState: this.circuitBreakerState
      });

      this.emit('reconnectionFailed', {
        attemptNumber,
        reason,
        sessionId,
        error: errorMessage,
        consecutiveFailures: this.consecutiveFailures
      });

      this.isReconnecting = false;
      return false;
    }
  }

  /**
   * Get current reconnection metrics
   */
  getMetrics(): ReconnectionMetrics {
    const successfulAttempts = this.attempts.filter(a => a.success).length;
    const failedAttempts = this.attempts.filter(a => !a.success).length;
    const totalDelay = this.attempts.reduce((sum, a) => sum + a.delay, 0);
    
    // Calculate enhanced metrics
    const stableConnections = 0; // This would need to be tracked separately in a real implementation
    const connectionStabilityRatio = successfulAttempts > 0 ? stableConnections / successfulAttempts : 0;
    
    return {
      totalAttempts: this.attempts.length,
      successfulAttempts,
      failedAttempts,
      averageDelay: this.attempts.length > 0 ? totalDelay / this.attempts.length : 0,
      lastAttemptTime: this.attempts.length > 0 ? 
        this.attempts[this.attempts.length - 1].timestamp : null,
      circuitBreakerState: this.circuitBreakerState,
      consecutiveFailures: this.consecutiveFailures,
      // Enhanced metrics (placeholder values - would be properly tracked in production)
      connectionStabilityRatio,
      averageConnectionDuration: 0,
      fastRetryCount: 0,
      adaptiveDelayAdjustments: 0,
      lastStableConnectionTime: null
    };
  }

  /**
   * Get reconnection decision based on current state
   */
  getReconnectionDecision(reason: string): {
    shouldReconnect: boolean;
    urgency: 'low' | 'medium' | 'high' | 'immediate';
    estimatedDelay: number;
    fallbackRecommended: boolean;
  } {
    const metrics = this.getMetrics();
    
    // Don't reconnect if circuit breaker is open and not ready for half-open
    if (this.circuitBreakerState === 'open' && !this.shouldTryHalfOpen()) {
      return {
        shouldReconnect: false,
        urgency: 'low',
        estimatedDelay: 0,
        fallbackRecommended: true
      };
    }

    // Don't reconnect if max attempts exceeded
    if (metrics.totalAttempts >= this.config.maxAttempts) {
      return {
        shouldReconnect: false,
        urgency: 'low',
        estimatedDelay: 0,
        fallbackRecommended: true
      };
    }

    // Don't reconnect if already reconnecting
    if (this.isReconnecting) {
      return {
        shouldReconnect: false,
        urgency: 'low',
        estimatedDelay: 0,
        fallbackRecommended: false
      };
    }

    const nextAttemptNumber = metrics.totalAttempts + 1;
    const estimatedDelay = this.calculateDelay(nextAttemptNumber);
    
    // Determine urgency based on reason and failure history
    let urgency: 'low' | 'medium' | 'high' | 'immediate' = 'medium';
    
    if (reason.includes('protocol') || reason.includes('31924')) {
      urgency = 'high'; // Twilio protocol errors need quick resolution
    } else if (reason.includes('11205') || reason.includes('server closed connection') ||
               reason.includes('Twilio 11205')) {
      urgency = 'high'; // Twilio 11205 needs quick reconnection to resume service
      logger.info('Detected Twilio 11205 scenario - prioritizing reconnection', {
        reason,
        consecutiveFailures: metrics.consecutiveFailures
      });
    } else if (reason.includes('timeout') || reason.includes('ping')) {
      urgency = 'medium'; // Network issues
    } else if (reason.includes('close') || reason.includes('disconnect')) {
      urgency = 'immediate'; // Connection drops need immediate attention
    }

    // Reduce urgency if we've had many failures
    if (metrics.consecutiveFailures > 3) {
      urgency = urgency === 'immediate' ? 'high' : 
                urgency === 'high' ? 'medium' : 'low';
    }

    return {
      shouldReconnect: true,
      urgency,
      estimatedDelay,
      fallbackRecommended: metrics.consecutiveFailures > 2
    };
  }

  /**
   * Reset reconnection state (useful for testing or manual reset)
   */
  reset(): void {
    this.attempts = [];
    this.circuitBreakerState = 'closed';
    this.circuitBreakerOpenTime = null;
    this.consecutiveFailures = 0;
    this.isReconnecting = false;
    
    logger.info('ReconnectionService state reset');
  }

  /**
   * Check if currently reconnecting
   */
  isCurrentlyReconnecting(): boolean {
    return this.isReconnecting;
  }

  /**
   * Get recent reconnection attempts (last N attempts)
   */
  getRecentAttempts(count: number = 5): ReconnectionAttempt[] {
    return this.attempts.slice(-count);
  }
}

// Export a default instance for global use
export const globalReconnectionService = new ReconnectionService();