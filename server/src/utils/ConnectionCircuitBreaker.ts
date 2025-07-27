/**
 * Connection Circuit Breaker
 * 
 * Implements circuit breaker pattern for WebSocket connections to prevent
 * cascading failures and provide graceful degradation during persistent issues.
 * 
 * Requirements: 1.4, 3.4, 5.5
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening circuit
  recoveryTimeout: number;       // Time to wait before attempting recovery (ms)
  successThreshold: number;      // Number of successes needed to close circuit
  monitoringWindow: number;      // Time window for failure counting (ms)
  maxConsecutiveFailures: number; // Max failures before permanent circuit open
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  nextAttemptTime: Date | null;
  totalRequests: number;
  totalFailures: number;
  uptime: number;
}

export interface CircuitBreakerEvent {
  type: 'STATE_CHANGE' | 'FAILURE' | 'SUCCESS' | 'TIMEOUT';
  timestamp: Date;
  previousState?: CircuitState;
  newState?: CircuitState;
  context?: Record<string, any>;
}

export class ConnectionCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private consecutiveFailures: number = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttemptTime: Date | null = null;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private createdAt: Date = new Date();
  private eventHistory: CircuitBreakerEvent[] = [];
  private config: CircuitBreakerConfig;
  private connectionId: string;

  // Default configuration
  private static readonly DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,           // Open after 5 failures
    recoveryTimeout: 30000,        // Wait 30 seconds before retry
    successThreshold: 3,           // Need 3 successes to close
    monitoringWindow: 60000,       // 1 minute window
    maxConsecutiveFailures: 20     // Permanent failure after 20 consecutive failures
  };

  constructor(connectionId: string, config?: Partial<CircuitBreakerConfig>) {
    this.connectionId = connectionId;
    this.config = { ...ConnectionCircuitBreaker.DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if the circuit allows requests
   */
  public canExecute(): boolean {
    this.updateStateBasedOnTime();
    
    switch (this.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        return false;
      case 'HALF_OPEN':
        return true;
      default:
        return false;
    }
  }

  /**
   * Record a successful operation
   */
  public recordSuccess(): void {
    this.totalRequests++;
    this.lastSuccessTime = new Date();
    
    this.addEvent({
      type: 'SUCCESS',
      timestamp: new Date(),
      context: { state: this.state }
    });

    switch (this.state) {
      case 'CLOSED':
        this.resetFailureCount();
        break;
      case 'HALF_OPEN':
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transitionTo('CLOSED');
          this.resetCounters();
        }
        break;
      case 'OPEN':
        // Success in OPEN state shouldn't happen, but reset if it does
        this.resetFailureCount();
        break;
    }
  }

  /**
   * Record a failed operation
   */
  public recordFailure(error?: string): void {
    this.totalRequests++;
    this.totalFailures++;
    this.lastFailureTime = new Date();
    this.consecutiveFailures++;
    
    this.addEvent({
      type: 'FAILURE',
      timestamp: new Date(),
      context: { 
        state: this.state, 
        error,
        consecutiveFailures: this.consecutiveFailures
      }
    });

    // Check for permanent failure condition
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.transitionTo('OPEN');
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout * 5); // Extended timeout
      return;
    }

    switch (this.state) {
      case 'CLOSED':
        this.failureCount++;
        if (this.shouldOpenCircuit()) {
          this.transitionTo('OPEN');
          this.scheduleRecoveryAttempt();
        }
        break;
      case 'HALF_OPEN':
        this.transitionTo('OPEN');
        this.scheduleRecoveryAttempt();
        break;
      case 'OPEN':
        // Already open, just update failure count
        this.failureCount++;
        break;
    }
  }

  /**
   * Force circuit to open (for external health assessment)
   */
  public forceOpen(reason?: string): void {
    this.transitionTo('OPEN');
    this.scheduleRecoveryAttempt();
    
    this.addEvent({
      type: 'STATE_CHANGE',
      timestamp: new Date(),
      newState: 'OPEN',
      context: { reason: reason || 'Forced open by external health assessment' }
    });
  }

  /**
   * Force circuit to close (for manual recovery)
   */
  public forceClose(): void {
    this.transitionTo('CLOSED');
    this.resetCounters();
    
    this.addEvent({
      type: 'STATE_CHANGE',
      timestamp: new Date(),
      newState: 'CLOSED',
      context: { reason: 'Manually forced closed' }
    });
  }

  /**
   * Get current circuit breaker metrics
   */
  public getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      uptime: this.calculateUptime()
    };
  }

  /**
   * Get recent events for debugging
   */
  public getRecentEvents(limit: number = 10): CircuitBreakerEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Check if circuit is in a healthy state
   */
  public isHealthy(): boolean {
    const metrics = this.getMetrics();
    
    // Circuit is unhealthy if:
    // 1. It's open
    // 2. Too many consecutive failures
    // 3. High failure rate in recent history
    
    if (this.state === 'OPEN') {
      return false;
    }
    
    if (this.consecutiveFailures > this.config.failureThreshold / 2) {
      return false;
    }
    
    const recentFailureRate = this.calculateRecentFailureRate();
    if (recentFailureRate > 0.5) { // More than 50% failure rate
      return false;
    }
    
    return true;
  }

  /**
   * Get health assessment with recommendations
   */
  public getHealthAssessment(): {
    isHealthy: boolean;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    recommendations: string[];
    metrics: CircuitBreakerMetrics;
  } {
    const metrics = this.getMetrics();
    const isHealthy = this.isHealthy();
    const recentFailureRate = this.calculateRecentFailureRate();
    
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    const recommendations: string[] = [];
    
    // Assess risk level
    if (this.state === 'OPEN') {
      riskLevel = 'critical';
      recommendations.push('Circuit is open - connection is blocked');
      recommendations.push('Wait for automatic recovery or investigate underlying issues');
    } else if (this.consecutiveFailures >= this.config.maxConsecutiveFailures / 2) {
      riskLevel = 'high';
      recommendations.push('High number of consecutive failures detected');
      recommendations.push('Consider manual intervention or connection reset');
    } else if (recentFailureRate > 0.3) {
      riskLevel = 'medium';
      recommendations.push('Elevated failure rate detected');
      recommendations.push('Monitor connection stability closely');
    } else if (this.state === 'HALF_OPEN') {
      riskLevel = 'medium';
      recommendations.push('Circuit is in recovery mode');
      recommendations.push('Monitor next few operations carefully');
    }
    
    // Add general recommendations
    if (this.totalRequests > 0 && (this.totalFailures / this.totalRequests) > 0.1) {
      recommendations.push('Overall failure rate is high - consider connection optimization');
    }
    
    return {
      isHealthy,
      riskLevel,
      recommendations,
      metrics
    };
  }

  /**
   * Clean up old events and reset counters if needed
   */
  public cleanup(): void {
    // Keep only recent events (last 100)
    if (this.eventHistory.length > 100) {
      this.eventHistory = this.eventHistory.slice(-100);
    }
    
    // Reset failure count if it's been a while since last failure
    const now = new Date();
    if (this.lastFailureTime && 
        (now.getTime() - this.lastFailureTime.getTime()) > this.config.monitoringWindow * 2) {
      this.resetFailureCount();
    }
  }

  // Private helper methods

  private updateStateBasedOnTime(): void {
    if (this.state === 'OPEN' && this.nextAttemptTime) {
      const now = new Date();
      if (now.getTime() >= this.nextAttemptTime.getTime()) {
        this.transitionTo('HALF_OPEN');
        this.nextAttemptTime = null;
        this.successCount = 0;
      }
    }
  }

  private shouldOpenCircuit(): boolean {
    // Open circuit if failure threshold is exceeded within monitoring window
    if (this.failureCount >= this.config.failureThreshold) {
      return true;
    }
    
    return false; // Don't open based on failure rate alone for now
  }

  private calculateRecentFailureRate(): number {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.config.monitoringWindow);
    
    const recentEvents = this.eventHistory.filter(
      event => event.timestamp >= windowStart
    );
    
    if (recentEvents.length === 0) {
      return 0;
    }
    
    const failures = recentEvents.filter(event => event.type === 'FAILURE').length;
    return failures / recentEvents.length;
  }

  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;
    
    this.addEvent({
      type: 'STATE_CHANGE',
      timestamp: new Date(),
      previousState,
      newState,
      context: {
        failureCount: this.failureCount,
        consecutiveFailures: this.consecutiveFailures
      }
    });
  }

  private scheduleRecoveryAttempt(): void {
    const backoffMultiplier = Math.min(this.consecutiveFailures / 5, 5); // Max 5x backoff
    const timeout = this.config.recoveryTimeout * (1 + backoffMultiplier);
    this.nextAttemptTime = new Date(Date.now() + timeout);
  }

  private resetFailureCount(): void {
    this.failureCount = 0;
    this.consecutiveFailures = 0;
  }

  private resetCounters(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
  }

  private calculateUptime(): number {
    const now = new Date();
    const totalTime = now.getTime() - this.createdAt.getTime();
    
    // Calculate downtime based on OPEN state duration
    let downtime = 0;
    let openStartTime: Date | null = null;
    
    for (const event of this.eventHistory) {
      if (event.type === 'STATE_CHANGE') {
        if (event.newState === 'OPEN') {
          openStartTime = event.timestamp;
        } else if ((event.newState === 'CLOSED' || event.newState === 'HALF_OPEN') && openStartTime) {
          downtime += event.timestamp.getTime() - openStartTime.getTime();
          openStartTime = null;
        }
      }
    }
    
    // If currently open, add current open duration
    if (this.state === 'OPEN' && openStartTime) {
      downtime += now.getTime() - openStartTime.getTime();
    }
    
    return Math.max(totalTime - downtime, 0);
  }

  private addEvent(event: CircuitBreakerEvent): void {
    this.eventHistory.push(event);
    
    // Keep history manageable
    if (this.eventHistory.length > 150) {
      this.eventHistory = this.eventHistory.slice(-100);
    }
  }
}