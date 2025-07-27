/**
 * Unit tests for ConnectionCircuitBreaker
 */

import { ConnectionCircuitBreaker, CircuitState } from '../ConnectionCircuitBreaker';

describe('ConnectionCircuitBreaker', () => {
  let circuitBreaker: ConnectionCircuitBreaker;
  const connectionId = 'test-circuit-123';

  beforeEach(() => {
    circuitBreaker = new ConnectionCircuitBreaker(connectionId, {
      failureThreshold: 3,
      recoveryTimeout: 1000, // 1 second for faster tests
      successThreshold: 2,
      monitoringWindow: 5000,
      maxConsecutiveFailures: 10
    });
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.canExecute()).toBe(true);
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.state).toBe('CLOSED');
      expect(metrics.failureCount).toBe(0);
      expect(metrics.successCount).toBe(0);
    });

    it('should be healthy initially', () => {
      expect(circuitBreaker.isHealthy()).toBe(true);
      
      const assessment = circuitBreaker.getHealthAssessment();
      expect(assessment.isHealthy).toBe(true);
      expect(assessment.riskLevel).toBe('low');
    });
  });

  describe('Failure Handling', () => {
    it('should remain closed with few failures', () => {
      circuitBreaker.recordFailure('Test error 1');
      circuitBreaker.recordFailure('Test error 2');
      
      expect(circuitBreaker.canExecute()).toBe(true);
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.state).toBe('CLOSED');
      expect(metrics.failureCount).toBe(2);
    });

    it('should open after reaching failure threshold', () => {
      circuitBreaker.recordFailure('Test error 1');
      circuitBreaker.recordFailure('Test error 2');
      circuitBreaker.recordFailure('Test error 3');
      
      expect(circuitBreaker.canExecute()).toBe(false);
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.state).toBe('OPEN');
      expect(metrics.failureCount).toBe(3);
    });

    it('should track consecutive failures', () => {
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.consecutiveFailures).toBe(5);
      expect(metrics.state).toBe('OPEN');
    });

    it('should prevent execution when open', () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
      
      expect(circuitBreaker.canExecute()).toBe(false);
    });
  });

  describe('Recovery Process', () => {
    beforeEach(() => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
    });

    it('should transition to HALF_OPEN after timeout', (done) => {
      expect(circuitBreaker.canExecute()).toBe(false);
      
      // Wait for recovery timeout
      setTimeout(() => {
        expect(circuitBreaker.canExecute()).toBe(true);
        
        const metrics = circuitBreaker.getMetrics();
        expect(metrics.state).toBe('HALF_OPEN');
        done();
      }, 1100); // Slightly more than recovery timeout
    });

    it('should close after successful operations in HALF_OPEN', (done) => {
      // Wait for HALF_OPEN state
      setTimeout(() => {
        expect(circuitBreaker.canExecute()).toBe(true);
        
        // Record successful operations
        circuitBreaker.recordSuccess();
        circuitBreaker.recordSuccess();
        
        const metrics = circuitBreaker.getMetrics();
        expect(metrics.state).toBe('CLOSED');
        expect(metrics.failureCount).toBe(0);
        expect(metrics.consecutiveFailures).toBe(0);
        done();
      }, 1100);
    });

    it('should reopen on failure in HALF_OPEN state', (done) => {
      // Wait for HALF_OPEN state
      setTimeout(() => {
        expect(circuitBreaker.canExecute()).toBe(true);
        
        // Record a failure
        circuitBreaker.recordFailure('Recovery failed');
        
        expect(circuitBreaker.canExecute()).toBe(false);
        
        const metrics = circuitBreaker.getMetrics();
        expect(metrics.state).toBe('OPEN');
        done();
      }, 1100);
    });
  });

  describe('Success Handling', () => {
    it('should reset failure count on success in CLOSED state', () => {
      circuitBreaker.recordFailure('Test error 1');
      circuitBreaker.recordFailure('Test error 2');
      
      expect(circuitBreaker.getMetrics().failureCount).toBe(2);
      
      circuitBreaker.recordSuccess();
      
      expect(circuitBreaker.getMetrics().failureCount).toBe(0);
      expect(circuitBreaker.getMetrics().consecutiveFailures).toBe(0);
    });

    it('should track total requests and failures', () => {
      circuitBreaker.recordSuccess();
      circuitBreaker.recordFailure('Test error');
      circuitBreaker.recordSuccess();
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.totalFailures).toBe(1);
    });
  });

  describe('Health Assessment', () => {
    it('should be unhealthy when circuit is open', () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
      
      expect(circuitBreaker.isHealthy()).toBe(false);
      
      const assessment = circuitBreaker.getHealthAssessment();
      expect(assessment.isHealthy).toBe(false);
      expect(assessment.riskLevel).toBe('critical');
      expect(assessment.recommendations.length).toBeGreaterThan(0);
    });

    it('should provide risk assessment based on consecutive failures', () => {
      // Add some failures but not enough to open circuit
      circuitBreaker.recordFailure('Test error 1');
      circuitBreaker.recordFailure('Test error 2');
      
      const assessment = circuitBreaker.getHealthAssessment();
      expect(assessment.riskLevel).toMatch(/medium|high|critical/);
    });

    it('should provide recommendations based on state', () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
      
      const assessment = circuitBreaker.getHealthAssessment();
      expect(assessment.recommendations).toContain('Circuit is open - connection is blocked');
    });
  });

  describe('Force Operations', () => {
    it('should allow forcing circuit open', () => {
      expect(circuitBreaker.canExecute()).toBe(true);
      
      circuitBreaker.forceOpen('Manual intervention');
      
      expect(circuitBreaker.canExecute()).toBe(false);
      expect(circuitBreaker.getMetrics().state).toBe('OPEN');
    });

    it('should allow forcing circuit closed', () => {
      // Open the circuit first
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
      
      expect(circuitBreaker.canExecute()).toBe(false);
      
      circuitBreaker.forceClose();
      
      expect(circuitBreaker.canExecute()).toBe(true);
      expect(circuitBreaker.getMetrics().state).toBe('CLOSED');
    });
  });

  describe('Event Tracking', () => {
    it('should track state change events', () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(`Test error ${i + 1}`);
      }
      
      const events = circuitBreaker.getRecentEvents();
      const stateChangeEvents = events.filter(e => e.type === 'STATE_CHANGE');
      
      expect(stateChangeEvents.length).toBeGreaterThan(0);
      expect(stateChangeEvents[stateChangeEvents.length - 1].newState).toBe('OPEN');
    });

    it('should track failure and success events', () => {
      circuitBreaker.recordFailure('Test error');
      circuitBreaker.recordSuccess();
      
      const events = circuitBreaker.getRecentEvents();
      
      expect(events.some(e => e.type === 'FAILURE')).toBe(true);
      expect(events.some(e => e.type === 'SUCCESS')).toBe(true);
    });

    it('should limit event history size', () => {
      // Generate many events
      for (let i = 0; i < 250; i++) {
        if (i % 2 === 0) {
          circuitBreaker.recordFailure(`Error ${i}`);
        } else {
          circuitBreaker.recordSuccess();
        }
      }
      
      const events = circuitBreaker.getRecentEvents(300);
      expect(events.length).toBeLessThanOrEqual(150); // Should be limited
    });
  });

  describe('Cleanup', () => {
    it('should clean up old events', () => {
      // Generate some events
      for (let i = 0; i < 10; i++) {
        circuitBreaker.recordFailure(`Error ${i}`);
      }
      
      const eventsBefore = circuitBreaker.getRecentEvents(20);
      expect(eventsBefore.length).toBeGreaterThan(0);
      
      circuitBreaker.cleanup();
      
      // Events should still be there (not old enough)
      const eventsAfter = circuitBreaker.getRecentEvents(20);
      expect(eventsAfter.length).toBe(eventsBefore.length);
    });

    it('should reset failure count after long period without failures', () => {
      circuitBreaker.recordFailure('Test error 1');
      circuitBreaker.recordFailure('Test error 2');
      
      expect(circuitBreaker.getMetrics().failureCount).toBe(2);
      
      // Simulate time passing by manually setting last failure time
      const metrics = circuitBreaker.getMetrics();
      if (metrics.lastFailureTime) {
        // This is a bit of a hack for testing, but simulates old failures
        (circuitBreaker as any).lastFailureTime = new Date(Date.now() - 20000); // 20 seconds ago
      }
      
      circuitBreaker.cleanup();
      
      // Failure count should be reset
      expect(circuitBreaker.getMetrics().failureCount).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle maximum consecutive failures', () => {
      // Exceed max consecutive failures
      for (let i = 0; i < 15; i++) {
        circuitBreaker.recordFailure(`Error ${i}`);
      }
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.state).toBe('OPEN');
      expect(metrics.consecutiveFailures).toBe(15);
      
      // Next attempt time should be extended
      expect(metrics.nextAttemptTime).toBeDefined();
      if (metrics.nextAttemptTime) {
        const delay = metrics.nextAttemptTime.getTime() - Date.now();
        expect(delay).toBeGreaterThan(1000); // Should be longer than normal timeout
      }
    });

    it('should handle rapid success/failure cycles', () => {
      for (let i = 0; i < 10; i++) {
        circuitBreaker.recordFailure('Error');
        circuitBreaker.recordSuccess();
      }
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalRequests).toBe(20);
      expect(metrics.totalFailures).toBe(10);
    });
  });
});