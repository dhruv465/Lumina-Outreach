/**
 * Real-Time Health Assessment System
 * 
 * Implements intelligent health assessment logic that combines connection health
 * monitoring with circuit breaker patterns to make real-time decisions about
 * connection stability and reconnection needs.
 * 
 * Requirements: 1.4, 3.4, 5.5
 */

import { ConnectionHealthMonitor, HealthScore, ConnectionError } from './ConnectionHealthMonitor';
import { ConnectionCircuitBreaker, CircuitState } from './ConnectionCircuitBreaker';

export interface HealthThresholds {
  // Reconnection trigger thresholds
  criticalHealthScore: number;      // Trigger immediate reconnection
  poorHealthScore: number;          // Trigger reconnection after grace period
  highLatencyThreshold: number;     // Latency that triggers concern (ms)
  criticalLatencyThreshold: number; // Latency that triggers immediate action (ms)
  
  // Error rate thresholds
  highErrorRate: number;            // Error rate that triggers concern
  criticalErrorRate: number;        // Error rate that triggers immediate action
  
  // Stability thresholds
  maxReconnectionsPerWindow: number; // Max reconnections in time window
  reconnectionWindow: number;        // Time window for reconnection counting (ms)
  
  // Grace periods
  degradationGracePeriod: number;   // Time to wait before acting on poor health (ms)
  recoveryGracePeriod: number;      // Time to wait after recovery before normal operation (ms)
}

export interface ConnectionDegradationEvent {
  type: 'LATENCY_SPIKE' | 'ERROR_BURST' | 'STABILITY_LOSS' | 'CIRCUIT_OPEN' | 'RECOVERY';
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metrics: {
    healthScore: number;
    latency: number;
    errorRate: number;
    circuitState: CircuitState;
  };
  context?: Record<string, any>;
}

export interface ReconnectionDecision {
  shouldReconnect: boolean;
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'immediate';
  recommendedDelay: number; // ms to wait before reconnecting
  fallbackRecommended: boolean;
  context: {
    healthScore: HealthScore;
    circuitState: CircuitState;
    degradationEvents: ConnectionDegradationEvent[];
  };
}

export class RealTimeHealthAssessment {
  private healthMonitor: ConnectionHealthMonitor;
  private circuitBreaker: ConnectionCircuitBreaker;
  private connectionId: string;
  private thresholds: HealthThresholds;
  private degradationEvents: ConnectionDegradationEvent[] = [];
  private lastHealthCheck: Date = new Date();
  private lastReconnectionTime: Date | null = null;
  private isInGracePeriod: boolean = false;
  private gracePeriodStart: Date | null = null;

  // Default thresholds
  private static readonly DEFAULT_THRESHOLDS: HealthThresholds = {
    criticalHealthScore: 20,
    poorHealthScore: 40,
    highLatencyThreshold: 500,
    criticalLatencyThreshold: 2000,
    highErrorRate: 0.1,        // 10%
    criticalErrorRate: 0.25,   // 25%
    maxReconnectionsPerWindow: 3,
    reconnectionWindow: 300000, // 5 minutes
    degradationGracePeriod: 30000,  // 30 seconds
    recoveryGracePeriod: 60000      // 1 minute
  };

  constructor(
    healthMonitor: ConnectionHealthMonitor,
    circuitBreaker: ConnectionCircuitBreaker,
    connectionId: string,
    thresholds?: Partial<HealthThresholds>
  ) {
    this.healthMonitor = healthMonitor;
    this.circuitBreaker = circuitBreaker;
    this.connectionId = connectionId;
    this.thresholds = { ...RealTimeHealthAssessment.DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Perform real-time health assessment and determine if reconnection is needed
   */
  public assessConnectionHealth(): ReconnectionDecision {
    const healthScore = this.healthMonitor.assessConnectionHealth();
    const circuitMetrics = this.circuitBreaker.getMetrics();
    const now = new Date();
    
    // Update last health check time
    this.lastHealthCheck = now;
    
    // Detect and record degradation events
    this.detectDegradationEvents(healthScore, circuitMetrics.state);
    
    // Check circuit breaker state first
    if (circuitMetrics.state === 'OPEN') {
      return {
        shouldReconnect: false, // Circuit breaker prevents reconnection
        reason: 'Circuit breaker is open - connection blocked',
        urgency: 'immediate',
        recommendedDelay: this.calculateCircuitBreakerDelay(circuitMetrics),
        fallbackRecommended: true,
        context: {
          healthScore,
          circuitState: circuitMetrics.state,
          degradationEvents: this.getRecentDegradationEvents()
        }
      };
    }
    
    // Check for immediate reconnection triggers
    const immediateReconnection = this.checkImmediateReconnectionTriggers(healthScore, circuitMetrics);
    if (immediateReconnection) {
      return immediateReconnection;
    }
    
    // Check for grace period conditions
    const gracePeriodDecision = this.checkGracePeriodConditions(healthScore, circuitMetrics);
    if (gracePeriodDecision) {
      return gracePeriodDecision;
    }
    
    // Check for preventive reconnection
    const preventiveDecision = this.checkPreventiveReconnection(healthScore, circuitMetrics);
    if (preventiveDecision) {
      return preventiveDecision;
    }
    
    // No reconnection needed
    return {
      shouldReconnect: false,
      reason: 'Connection health is acceptable',
      urgency: 'low',
      recommendedDelay: 0,
      fallbackRecommended: false,
      context: {
        healthScore,
        circuitState: circuitMetrics.state,
        degradationEvents: this.getRecentDegradationEvents()
      }
    };
  }

  /**
   * Record a connection error for health assessment
   */
  public recordConnectionError(error: ConnectionError): void {
    this.healthMonitor.recordError(error);
    this.circuitBreaker.recordFailure(error.message);
    
    // Check if this error triggers immediate degradation detection
    if (error.severity === 'critical') {
      this.recordDegradationEvent({
        type: 'ERROR_BURST',
        timestamp: new Date(),
        severity: error.severity,
        metrics: this.getCurrentMetrics(),
        context: { error: error.message, errorType: error.type }
      });
    }
  }

  /**
   * Record a successful operation
   */
  public recordSuccess(): void {
    this.circuitBreaker.recordSuccess();
    
    // Check if we're recovering from degradation
    const healthScore = this.healthMonitor.assessConnectionHealth();
    if (healthScore.overall > this.thresholds.poorHealthScore && this.isInGracePeriod) {
      this.recordDegradationEvent({
        type: 'RECOVERY',
        timestamp: new Date(),
        severity: 'low',
        metrics: this.getCurrentMetrics(),
        context: { recoveredFrom: 'degradation' }
      });
      
      this.endGracePeriod();
    }
  }

  /**
   * Record latency measurement
   */
  public recordLatency(latency: number): void {
    this.healthMonitor.recordLatency(latency);
    
    // Check for latency spikes
    if (latency > this.thresholds.criticalLatencyThreshold) {
      this.recordDegradationEvent({
        type: 'LATENCY_SPIKE',
        timestamp: new Date(),
        severity: 'critical',
        metrics: this.getCurrentMetrics(),
        context: { latency, threshold: this.thresholds.criticalLatencyThreshold }
      });
    } else if (latency > this.thresholds.highLatencyThreshold) {
      this.recordDegradationEvent({
        type: 'LATENCY_SPIKE',
        timestamp: new Date(),
        severity: 'medium',
        metrics: this.getCurrentMetrics(),
        context: { latency, threshold: this.thresholds.highLatencyThreshold }
      });
    }
  }

  /**
   * Record a reconnection attempt
   */
  public recordReconnectionAttempt(success: boolean): void {
    this.healthMonitor.recordReconnection(success);
    this.lastReconnectionTime = new Date();
    
    if (success) {
      this.circuitBreaker.recordSuccess();
      this.startRecoveryGracePeriod();
    } else {
      this.circuitBreaker.recordFailure('Reconnection failed');
    }
  }

  /**
   * Get comprehensive health assessment report
   */
  public getHealthAssessmentReport(): {
    connectionId: string;
    timestamp: Date;
    reconnectionDecision: ReconnectionDecision;
    healthScore: HealthScore;
    circuitBreakerHealth: any;
    degradationEvents: ConnectionDegradationEvent[];
    recommendations: string[];
  } {
    const reconnectionDecision = this.assessConnectionHealth();
    const healthScore = this.healthMonitor.assessConnectionHealth();
    const circuitBreakerHealth = this.circuitBreaker.getHealthAssessment();
    
    const recommendations = [
      ...this.healthMonitor.generateHealthReport().recommendations,
      ...circuitBreakerHealth.recommendations
    ];
    
    return {
      connectionId: this.connectionId,
      timestamp: new Date(),
      reconnectionDecision,
      healthScore,
      circuitBreakerHealth,
      degradationEvents: this.getRecentDegradationEvents(),
      recommendations
    };
  }

  /**
   * Force circuit breaker open (for external triggers)
   */
  public forceCircuitOpen(reason: string): void {
    this.circuitBreaker.forceOpen(reason);
    
    this.recordDegradationEvent({
      type: 'CIRCUIT_OPEN',
      timestamp: new Date(),
      severity: 'critical',
      metrics: this.getCurrentMetrics(),
      context: { reason, forced: true }
    });
  }

  /**
   * Clean up old events and reset counters
   */
  public cleanup(): void {
    this.healthMonitor.cleanup();
    this.circuitBreaker.cleanup();
    
    // Clean up old degradation events (keep last 50)
    if (this.degradationEvents.length > 50) {
      this.degradationEvents = this.degradationEvents.slice(-50);
    }
    
    // Reset grace period if it's been too long
    if (this.isInGracePeriod && this.gracePeriodStart) {
      const gracePeriodDuration = Date.now() - this.gracePeriodStart.getTime();
      if (gracePeriodDuration > this.thresholds.recoveryGracePeriod * 2) {
        this.endGracePeriod();
      }
    }
  }

  // Private helper methods

  private detectDegradationEvents(healthScore: HealthScore, circuitState: CircuitState): void {
    const now = new Date();
    
    // Check for overall health degradation
    if (healthScore.overall < this.thresholds.criticalHealthScore) {
      this.recordDegradationEvent({
        type: 'STABILITY_LOSS',
        timestamp: now,
        severity: 'critical',
        metrics: this.getCurrentMetrics(),
        context: { healthScore: healthScore.overall, threshold: this.thresholds.criticalHealthScore }
      });
    } else if (healthScore.overall < this.thresholds.poorHealthScore) {
      this.recordDegradationEvent({
        type: 'STABILITY_LOSS',
        timestamp: now,
        severity: 'high',
        metrics: this.getCurrentMetrics(),
        context: { healthScore: healthScore.overall, threshold: this.thresholds.poorHealthScore }
      });
    }
    
    // Check for circuit state changes
    const lastEvent = this.degradationEvents[this.degradationEvents.length - 1];
    if (!lastEvent || lastEvent.metrics.circuitState !== circuitState) {
      if (circuitState === 'OPEN') {
        this.recordDegradationEvent({
          type: 'CIRCUIT_OPEN',
          timestamp: now,
          severity: 'critical',
          metrics: this.getCurrentMetrics(),
          context: { circuitState, previousState: lastEvent?.metrics.circuitState }
        });
      }
    }
  }

  private checkImmediateReconnectionTriggers(
    healthScore: HealthScore, 
    circuitMetrics: any
  ): ReconnectionDecision | null {
    // Critical health score
    if (healthScore.overall < this.thresholds.criticalHealthScore) {
      return {
        shouldReconnect: true,
        reason: `Critical health score: ${healthScore.overall}`,
        urgency: 'immediate',
        recommendedDelay: 1000, // 1 second
        fallbackRecommended: true,
        context: {
          healthScore,
          circuitState: circuitMetrics.state,
          degradationEvents: this.getRecentDegradationEvents()
        }
      };
    }
    
    // Critical latency
    const metrics = this.healthMonitor.getMetrics();
    if (metrics.averageLatency > this.thresholds.criticalLatencyThreshold) {
      return {
        shouldReconnect: true,
        reason: `Critical latency: ${metrics.averageLatency}ms`,
        urgency: 'immediate',
        recommendedDelay: 2000, // 2 seconds
        fallbackRecommended: false,
        context: {
          healthScore,
          circuitState: circuitMetrics.state,
          degradationEvents: this.getRecentDegradationEvents()
        }
      };
    }
    
    // Critical error rate
    if (metrics.errorRate > this.thresholds.criticalErrorRate) {
      return {
        shouldReconnect: true,
        reason: `Critical error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
        urgency: 'immediate',
        recommendedDelay: 3000, // 3 seconds
        fallbackRecommended: true,
        context: {
          healthScore,
          circuitState: circuitMetrics.state,
          degradationEvents: this.getRecentDegradationEvents()
        }
      };
    }
    
    return null;
  }

  private checkGracePeriodConditions(
    healthScore: HealthScore, 
    circuitMetrics: any
  ): ReconnectionDecision | null {
    const now = new Date();
    
    // Check if we should start grace period
    if (!this.isInGracePeriod && healthScore.overall < this.thresholds.poorHealthScore) {
      this.startGracePeriod();
      return {
        shouldReconnect: false,
        reason: 'Poor health detected - starting grace period',
        urgency: 'medium',
        recommendedDelay: this.thresholds.degradationGracePeriod,
        fallbackRecommended: false,
        context: {
          healthScore,
          circuitState: circuitMetrics.state,
          degradationEvents: this.getRecentDegradationEvents()
        }
      };
    }
    
    // Check if grace period has expired
    if (this.isInGracePeriod && this.gracePeriodStart) {
      const gracePeriodDuration = now.getTime() - this.gracePeriodStart.getTime();
      
      if (gracePeriodDuration > this.thresholds.degradationGracePeriod) {
        if (healthScore.overall < this.thresholds.poorHealthScore) {
          this.endGracePeriod();
          return {
            shouldReconnect: true,
            reason: 'Grace period expired with poor health',
            urgency: 'high',
            recommendedDelay: 5000, // 5 seconds
            fallbackRecommended: false,
            context: {
              healthScore,
              circuitState: circuitMetrics.state,
              degradationEvents: this.getRecentDegradationEvents()
            }
          };
        } else {
          this.endGracePeriod();
        }
      }
    }
    
    return null;
  }

  private checkPreventiveReconnection(
    healthScore: HealthScore, 
    circuitMetrics: any
  ): ReconnectionDecision | null {
    // Check for too many recent reconnections
    if (this.hasExceededReconnectionLimit()) {
      return {
        shouldReconnect: false,
        reason: 'Too many recent reconnections - preventing reconnection loop',
        urgency: 'low',
        recommendedDelay: this.thresholds.reconnectionWindow,
        fallbackRecommended: true,
        context: {
          healthScore,
          circuitState: circuitMetrics.state,
          degradationEvents: this.getRecentDegradationEvents()
        }
      };
    }
    
    return null;
  }

  private hasExceededReconnectionLimit(): boolean {
    if (!this.lastReconnectionTime) {
      return false;
    }
    
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.thresholds.reconnectionWindow);
    
    const recentReconnections = this.degradationEvents.filter(
      event => event.timestamp >= windowStart && 
               (event.type === 'RECOVERY' || event.context?.reconnection)
    );
    
    return recentReconnections.length >= this.thresholds.maxReconnectionsPerWindow;
  }

  private calculateCircuitBreakerDelay(circuitMetrics: any): number {
    if (circuitMetrics.nextAttemptTime) {
      return Math.max(circuitMetrics.nextAttemptTime.getTime() - Date.now(), 0);
    }
    return 30000; // Default 30 seconds
  }

  private getCurrentMetrics() {
    const healthScore = this.healthMonitor.assessConnectionHealth();
    const healthMetrics = this.healthMonitor.getMetrics();
    const circuitMetrics = this.circuitBreaker.getMetrics();
    
    return {
      healthScore: healthScore.overall,
      latency: healthMetrics.averageLatency,
      errorRate: healthMetrics.errorRate,
      circuitState: circuitMetrics.state
    };
  }

  private recordDegradationEvent(event: ConnectionDegradationEvent): void {
    this.degradationEvents.push(event);
    
    // Keep history manageable
    if (this.degradationEvents.length > 100) {
      this.degradationEvents = this.degradationEvents.slice(-80);
    }
  }

  private getRecentDegradationEvents(limit: number = 10): ConnectionDegradationEvent[] {
    return this.degradationEvents.slice(-limit);
  }

  private startGracePeriod(): void {
    this.isInGracePeriod = true;
    this.gracePeriodStart = new Date();
  }

  private endGracePeriod(): void {
    this.isInGracePeriod = false;
    this.gracePeriodStart = null;
  }

  private startRecoveryGracePeriod(): void {
    // Similar to grace period but for recovery
    setTimeout(() => {
      // Recovery grace period ended
    }, this.thresholds.recoveryGracePeriod);
  }
}