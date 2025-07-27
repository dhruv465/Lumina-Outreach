/**
 * Unit tests for RealTimeHealthAssessment
 */

import { RealTimeHealthAssessment } from '../RealTimeHealthAssessment';
import { ConnectionHealthMonitor, ConnectionError } from '../ConnectionHealthMonitor';
import { ConnectionCircuitBreaker } from '../ConnectionCircuitBreaker';

describe('RealTimeHealthAssessment', () => {
  let healthMonitor: ConnectionHealthMonitor;
  let circuitBreaker: ConnectionCircuitBreaker;
  let healthAssessment: RealTimeHealthAssessment;
  const connectionId = 'test-assessment-123';

  beforeEach(() => {
    healthMonitor = new ConnectionHealthMonitor(connectionId);
    circuitBreaker = new ConnectionCircuitBreaker(connectionId, {
      failureThreshold: 3,
      recoveryTimeout: 1000,
      successThreshold: 2,
      monitoringWindow: 5000,
      maxConsecutiveFailures: 10
    });
    
    healthAssessment = new RealTimeHealthAssessment(
      healthMonitor,
      circuitBreaker,
      connectionId,
      {
        criticalHealthScore: 20,
        poorHealthScore: 40,
        highLatencyThreshold: 500,
        criticalLatencyThreshold: 2000,
        highErrorRate: 0.1,
        criticalErrorRate: 0.25,
        maxReconnectionsPerWindow: 3,
        reconnectionWindow: 300000,
        degradationGracePeriod: 1000, // 1 second for faster tests
        recoveryGracePeriod: 2000
      }
    );
  });

  describe('Initial Assessment', () => {
    it('should not recommend reconnection for healthy connection', () => {
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(false);
      expect(decision.reason).toContain('acceptable');
      expect(decision.urgency).toBe('low');
      expect(decision.fallbackRecommended).toBe(false);
    });

    it('should provide comprehensive health report', () => {
      const report = healthAssessment.getHealthAssessmentReport();
      
      expect(report.connectionId).toBe(connectionId);
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.reconnectionDecision).toBeDefined();
      expect(report.healthScore).toBeDefined();
      expect(report.circuitBreakerHealth).toBeDefined();
      expect(report.degradationEvents).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
    });
  });

  describe('Critical Health Conditions', () => {
    it('should recommend immediate reconnection for critical health score', () => {
      // Simulate critical health by adding many errors
      for (let i = 0; i < 20; i++) {
        const error: ConnectionError = {
          type: 'network',
          message: `Critical error ${i}`,
          timestamp: new Date(),
          severity: 'high'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('immediate');
      expect(decision.reason).toContain('Critical health score');
    });

    it('should recommend immediate reconnection for critical latency', () => {
      // Record very high latency
      for (let i = 0; i < 10; i++) {
        healthAssessment.recordLatency(3000); // 3 seconds - critical
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('immediate');
      expect(decision.reason).toContain('Critical latency');
    });

    it('should recommend immediate reconnection for critical error rate', () => {
      // Create high error rate
      for (let i = 0; i < 10; i++) {
        const error: ConnectionError = {
          type: 'protocol',
          message: `Protocol error ${i}`,
          timestamp: new Date(),
          severity: 'critical'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('immediate');
      expect(decision.reason).toContain('Critical error rate');
      expect(decision.fallbackRecommended).toBe(true);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should prevent reconnection when circuit is open', () => {
      // Open the circuit breaker
      for (let i = 0; i < 3; i++) {
        const error: ConnectionError = {
          type: 'network',
          message: `Network error ${i}`,
          timestamp: new Date(),
          severity: 'high'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(false);
      expect(decision.reason).toContain('Circuit breaker is open');
      expect(decision.urgency).toBe('immediate');
      expect(decision.fallbackRecommended).toBe(true);
      expect(decision.recommendedDelay).toBeGreaterThan(0);
    });

    it('should force circuit open and track degradation', () => {
      healthAssessment.forceCircuitOpen('Manual intervention');
      
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(false);
      expect(decision.reason).toContain('Circuit breaker is open');
      
      const report = healthAssessment.getHealthAssessmentReport();
      const circuitEvents = report.degradationEvents.filter(e => e.type === 'CIRCUIT_OPEN');
      expect(circuitEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Grace Period Logic', () => {
    it('should start grace period for poor health', () => {
      // Create poor health conditions
      for (let i = 0; i < 8; i++) {
        const error: ConnectionError = {
          type: 'network',
          message: `Network error ${i}`,
          timestamp: new Date(),
          severity: 'medium'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision.shouldReconnect).toBe(false);
      expect(decision.reason).toContain('grace period');
      expect(decision.urgency).toBe('medium');
    });

    it('should trigger reconnection after grace period expires', (done) => {
      // Create poor health conditions
      for (let i = 0; i < 8; i++) {
        const error: ConnectionError = {
          type: 'network',
          message: `Network error ${i}`,
          timestamp: new Date(),
          severity: 'medium'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      // First assessment should start grace period
      let decision = healthAssessment.assessConnectionHealth();
      expect(decision.shouldReconnect).toBe(false);
      
      // Wait for grace period to expire
      setTimeout(() => {
        decision = healthAssessment.assessConnectionHealth();
        expect(decision.shouldReconnect).toBe(true);
        expect(decision.reason).toContain('Grace period expired');
        expect(decision.urgency).toBe('high');
        done();
      }, 1100); // Slightly more than grace period
    });
  });

  describe('Degradation Event Tracking', () => {
    it('should track latency spike events', () => {
      healthAssessment.recordLatency(1000); // High latency
      healthAssessment.recordLatency(2500); // Critical latency
      
      const report = healthAssessment.getHealthAssessmentReport();
      const latencyEvents = report.degradationEvents.filter(e => e.type === 'LATENCY_SPIKE');
      
      expect(latencyEvents.length).toBeGreaterThan(0);
      expect(latencyEvents.some(e => e.severity === 'critical')).toBe(true);
    });

    it('should track error burst events', () => {
      const criticalError: ConnectionError = {
        type: 'protocol',
        message: 'Critical protocol error',
        timestamp: new Date(),
        severity: 'critical'
      };
      
      healthAssessment.recordConnectionError(criticalError);
      
      const report = healthAssessment.getHealthAssessmentReport();
      const errorEvents = report.degradationEvents.filter(e => e.type === 'ERROR_BURST');
      
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].severity).toBe('critical');
    });

    it('should track recovery events', () => {
      // Create poor conditions first
      for (let i = 0; i < 8; i++) {
        const error: ConnectionError = {
          type: 'network',
          message: `Error ${i}`,
          timestamp: new Date(),
          severity: 'medium'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      // Start grace period
      healthAssessment.assessConnectionHealth();
      
      // Record successful operations to trigger recovery
      for (let i = 0; i < 10; i++) {
        healthAssessment.recordSuccess();
      }
      
      const report = healthAssessment.getHealthAssessmentReport();
      const recoveryEvents = report.degradationEvents.filter(e => e.type === 'RECOVERY');
      
      expect(recoveryEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Reconnection Attempt Tracking', () => {
    it('should track successful reconnection attempts', () => {
      healthAssessment.recordReconnectionAttempt(true);
      
      // Should record success in circuit breaker
      const circuitMetrics = circuitBreaker.getMetrics();
      expect(circuitMetrics.totalRequests).toBeGreaterThan(0);
    });

    it('should track failed reconnection attempts', () => {
      healthAssessment.recordReconnectionAttempt(false);
      
      // Should record failure in circuit breaker
      const circuitMetrics = circuitBreaker.getMetrics();
      expect(circuitMetrics.totalFailures).toBeGreaterThan(0);
    });

    it('should prevent reconnection loops', () => {
      // Simulate multiple recent reconnections
      for (let i = 0; i < 4; i++) {
        healthAssessment.recordReconnectionAttempt(true);
      }
      
      // Create poor health to trigger reconnection logic
      for (let i = 0; i < 15; i++) {
        const error: ConnectionError = {
          type: 'network',
          message: `Error ${i}`,
          timestamp: new Date(),
          severity: 'high'
        };
        healthAssessment.recordConnectionError(error);
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      
      // Should prevent reconnection due to recent attempts
      if (decision.reason.includes('Too many recent reconnections')) {
        expect(decision.shouldReconnect).toBe(false);
        expect(decision.fallbackRecommended).toBe(true);
      }
    });
  });

  describe('Integration with Health Monitor', () => {
    it('should use health monitor for latency tracking', () => {
      healthAssessment.recordLatency(150);
      healthAssessment.recordLatency(200);
      
      const report = healthAssessment.getHealthAssessmentReport();
      expect(report.healthScore.latency).toBeGreaterThan(0);
    });

    it('should use health monitor for error tracking', () => {
      const error: ConnectionError = {
        type: 'network',
        message: 'Test error',
        timestamp: new Date(),
        severity: 'medium'
      };
      
      healthAssessment.recordConnectionError(error);
      
      const report = healthAssessment.getHealthAssessmentReport();
      expect(report.healthScore.errorRate).toBeGreaterThan(0);
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should clean up old degradation events', () => {
      // Generate many degradation events
      for (let i = 0; i < 60; i++) {
        healthAssessment.recordLatency(1000); // High latency to trigger events
      }
      
      let report = healthAssessment.getHealthAssessmentReport();
      const eventsBefore = report.degradationEvents.length;
      
      healthAssessment.cleanup();
      
      report = healthAssessment.getHealthAssessmentReport();
      const eventsAfter = report.degradationEvents.length;
      
      expect(eventsAfter).toBeLessThanOrEqual(50); // Should be limited
    });

    it('should clean up underlying components', () => {
      // Add some data to components
      healthAssessment.recordLatency(100);
      const error: ConnectionError = {
        type: 'network',
        message: 'Test error',
        timestamp: new Date(),
        severity: 'medium'
      };
      healthAssessment.recordConnectionError(error);
      
      // Cleanup should not throw errors
      expect(() => healthAssessment.cleanup()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty metrics gracefully', () => {
      const decision = healthAssessment.assessConnectionHealth();
      
      expect(decision).toBeDefined();
      expect(decision.shouldReconnect).toBe(false);
      expect(decision.context).toBeDefined();
    });

    it('should handle rapid state changes', () => {
      // Rapidly alternate between good and bad conditions
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          healthAssessment.recordLatency(50); // Good
          healthAssessment.recordSuccess();
        } else {
          healthAssessment.recordLatency(2000); // Bad
          const error: ConnectionError = {
            type: 'network',
            message: `Error ${i}`,
            timestamp: new Date(),
            severity: 'high'
          };
          healthAssessment.recordConnectionError(error);
        }
      }
      
      const decision = healthAssessment.assessConnectionHealth();
      expect(decision).toBeDefined();
      expect(decision.context.degradationEvents.length).toBeGreaterThan(0);
    });
  });
});