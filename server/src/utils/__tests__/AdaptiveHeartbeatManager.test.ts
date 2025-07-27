/**
 * Unit tests for AdaptiveHeartbeatManager
 */

import { AdaptiveHeartbeatManager, NetworkCondition, IntensiveOperation } from '../AdaptiveHeartbeatManager';
import { HeartbeatService } from '../HeartbeatService';
import { EventEmitter } from 'events';

// Mock HeartbeatService
class MockHeartbeatService extends EventEmitter {
  public currentInterval = 30000;
  private metrics = {
    isAlive: true,
    currentInterval: 30000,
    averageLatency: 100,
    lastPingTime: new Date(),
    lastPongTime: new Date(),
    missedHeartbeats: 0,
    totalPings: 10,
    totalPongs: 10,
    latencyHistory: [90, 100, 110, 95, 105],
    timeoutCount: 0,
    connectionAge: 60000
  };

  getMetrics() {
    return { ...this.metrics };
  }

  updateMetrics(updates: Partial<typeof this.metrics>) {
    this.metrics = { ...this.metrics, ...updates };
  }

  simulatePong(latency: number) {
    this.emit('pong', { latency, connectionId: 'test-connection' });
  }

  simulateMissedHeartbeat(missedCount: number) {
    this.emit('missedHeartbeat', { missedCount, connectionId: 'test-connection' });
  }

  simulateConnectionDead() {
    this.emit('connectionDead', { connectionId: 'test-connection', missedHeartbeats: 3 });
  }
}

describe('AdaptiveHeartbeatManager', () => {
  let mockHeartbeatService: MockHeartbeatService;
  let adaptiveManager: AdaptiveHeartbeatManager;
  const connectionId = 'test-adaptive-123';

  beforeEach(() => {
    mockHeartbeatService = new MockHeartbeatService();
    adaptiveManager = new AdaptiveHeartbeatManager(
      mockHeartbeatService as any,
      connectionId,
      {
        excellentInterval: 60000,
        goodInterval: 30000,
        fairInterval: 20000,
        poorInterval: 15000,
        criticalInterval: 10000,
        adaptationSensitivity: 0.8,
        stabilityWindow: 60000, // 1 minute for faster tests
        jitterThreshold: 50,
        pauseDuringIntensiveOps: true,
        intensiveOpThreshold: 80,
        resumeDelay: 1000, // 1 second for faster tests
        predictiveAdaptation: true,
        learningEnabled: true,
        timeOfDayOptimization: false
      }
    );
  });

  afterEach(() => {
    adaptiveManager.stop();
  });

  describe('Initialization', () => {
    it('should initialize with default network condition', () => {
      const metrics = adaptiveManager.getMetrics();
      
      expect(metrics.currentCondition.type).toBe('good');
      expect(metrics.currentCondition.stability).toBe(1.0);
      expect(metrics.performanceScore).toBeGreaterThan(0);
    });

    it('should start and stop properly', () => {
      adaptiveManager.start();
      adaptiveManager.stop();
      
      // Should not throw errors
      expect(true).toBe(true);
    });
  });

  describe('Network Condition Analysis', () => {
    it('should detect excellent network conditions', () => {
      // Simulate excellent conditions
      mockHeartbeatService.updateMetrics({
        averageLatency: 50,
        totalPings: 20,
        totalPongs: 20,
        missedHeartbeats: 0
      });

      // Simulate low jitter
      for (let i = 0; i < 10; i++) {
        mockHeartbeatService.simulatePong(50 + (i % 3)); // Low jitter
      }

      setTimeout(() => {
        const metrics = adaptiveManager.getMetrics();
        expect(metrics.currentCondition.type).toBe('excellent');
        expect(metrics.recommendedInterval).toBeGreaterThan(30000);
      }, 100);
    });

    it('should detect poor network conditions', () => {
      // Simulate poor conditions
      mockHeartbeatService.updateMetrics({
        averageLatency: 800,
        totalPings: 20,
        totalPongs: 15,
        missedHeartbeats: 2
      });

      // Simulate high jitter
      for (let i = 0; i < 10; i++) {
        mockHeartbeatService.simulatePong(800 + (i * 100)); // High jitter
      }

      setTimeout(() => {
        const metrics = adaptiveManager.getMetrics();
        expect(metrics.currentCondition.type).toBe('poor');
        expect(metrics.recommendedInterval).toBeLessThan(30000);
      }, 100);
    });

    it('should detect critical network conditions', () => {
      // Simulate critical conditions
      mockHeartbeatService.updateMetrics({
        averageLatency: 2000,
        totalPings: 20,
        totalPongs: 8,
        missedHeartbeats: 5
      });

      mockHeartbeatService.simulateConnectionDead();

      setTimeout(() => {
        const metrics = adaptiveManager.getMetrics();
        expect(metrics.currentCondition.type).toBe('critical');
        expect(metrics.recommendedInterval).toBe(10000);
      }, 100);
    });
  });

  describe('Adaptive Interval Adjustment', () => {
    it('should adjust interval based on network conditions', (done) => {
      let intervalChanged = false;
      
      adaptiveManager.on('intervalChanged', (data) => {
        intervalChanged = true;
        expect(data.connectionId).toBe(connectionId);
        expect(data.newInterval).toBeDefined();
        expect(data.reason).toBeDefined();
        done();
      });

      // Force condition change
      adaptiveManager.forceAdaptation({
        type: 'poor',
        latency: 600,
        jitter: 100
      }, 'Test condition change');
    });

    it('should not make small interval adjustments', () => {
      const initialMetrics = adaptiveManager.getMetrics();
      const initialInterval = initialMetrics.actualInterval;

      // Force small change
      adaptiveManager.forceAdaptation({
        latency: initialMetrics.currentCondition.latency + 10 // Small change
      }, 'Small change test');

      setTimeout(() => {
        const newMetrics = adaptiveManager.getMetrics();
        expect(newMetrics.actualInterval).toBe(initialInterval); // Should not change
      }, 100);
    });
  });

  describe('Intensive Operations Management', () => {
    it('should pause heartbeat during intensive operations', (done) => {
      let heartbeatPaused = false;
      
      adaptiveManager.on('heartbeatPaused', (data) => {
        heartbeatPaused = true;
        expect(data.connectionId).toBe(connectionId);
        expect(data.reason).toBeDefined();
        done();
      });

      const intensiveOp: IntensiveOperation = {
        id: 'test-op-1',
        type: 'audio_processing',
        priority: 'high',
        estimatedDuration: 5000,
        startTime: new Date(),
        pauseHeartbeat: true
      };

      adaptiveManager.registerIntensiveOperation(intensiveOp);
    });

    it('should resume heartbeat after intensive operations complete', (done) => {
      let heartbeatResumed = false;
      
      adaptiveManager.on('heartbeatResumed', (data) => {
        heartbeatResumed = true;
        expect(data.connectionId).toBe(connectionId);
        done();
      });

      const intensiveOp: IntensiveOperation = {
        id: 'test-op-2',
        type: 'llm_request',
        priority: 'medium',
        estimatedDuration: 100, // Short duration for test
        startTime: new Date(),
        pauseHeartbeat: true
      };

      adaptiveManager.registerIntensiveOperation(intensiveOp);
      
      // Complete operation after short delay
      setTimeout(() => {
        adaptiveManager.completeIntensiveOperation(intensiveOp.id);
      }, 150);
    });

    it('should track multiple intensive operations', () => {
      const op1: IntensiveOperation = {
        id: 'op-1',
        type: 'audio_processing',
        priority: 'high',
        estimatedDuration: 5000,
        startTime: new Date(),
        pauseHeartbeat: true
      };

      const op2: IntensiveOperation = {
        id: 'op-2',
        type: 'tts_generation',
        priority: 'medium',
        estimatedDuration: 3000,
        startTime: new Date(),
        pauseHeartbeat: false
      };

      adaptiveManager.registerIntensiveOperation(op1);
      adaptiveManager.registerIntensiveOperation(op2);

      const metrics = adaptiveManager.getMetrics();
      expect(metrics.pausedOperations).toContain('op-1');
      expect(metrics.pausedOperations).toContain('op-2');
    });
  });

  describe('Learning and Prediction', () => {
    it('should learn optimal intervals from performance data', (done) => {
      // Simulate performance data over time
      for (let i = 0; i < 10; i++) {
        mockHeartbeatService.updateMetrics({
          averageLatency: 100 + (i * 10),
          totalPings: 10 + i,
          totalPongs: 10 + i,
          currentInterval: 30000 - (i * 1000)
        });
        
        mockHeartbeatService.simulatePong(100 + (i * 10));
      }

      setTimeout(() => {
        const metrics = adaptiveManager.getMetrics();
        expect(metrics.learningData.optimalIntervals.size).toBeGreaterThan(0);
        done();
      }, 200);
    });

    it('should provide performance score', () => {
      const metrics = adaptiveManager.getMetrics();
      expect(metrics.performanceScore).toBeGreaterThanOrEqual(0);
      expect(metrics.performanceScore).toBeLessThanOrEqual(100);
    });

    it('should track adaptation history', () => {
      adaptiveManager.forceAdaptation({
        type: 'fair',
        latency: 300
      }, 'Test adaptation');

      const metrics = adaptiveManager.getMetrics();
      expect(metrics.adaptationHistory.length).toBeGreaterThan(0);
      
      const lastAdaptation = metrics.adaptationHistory[metrics.adaptationHistory.length - 1];
      expect(lastAdaptation.type).toBe('CONDITION_CHANGE');
      expect(lastAdaptation.reason).toContain('Test adaptation');
    });
  });

  describe('Manual Control', () => {
    it('should allow manual pause and resume', (done) => {
      let pauseReceived = false;
      let resumeReceived = false;
      
      adaptiveManager.on('heartbeatPaused', () => {
        pauseReceived = true;
        
        // Resume after pause
        setTimeout(() => {
          adaptiveManager.resumeHeartbeat('manual-resume', 'Test resume');
        }, 50);
      });
      
      adaptiveManager.on('heartbeatResumed', () => {
        resumeReceived = true;
        expect(pauseReceived).toBe(true);
        expect(resumeReceived).toBe(true);
        done();
      });

      adaptiveManager.pauseHeartbeat('manual-pause', 'Test pause');
    });

    it('should allow forced adaptation', () => {
      const initialCondition = adaptiveManager.getMetrics().currentCondition;
      
      adaptiveManager.forceAdaptation({
        type: 'critical',
        latency: 2000,
        jitter: 500,
        packetLoss: 0.3,
        stability: 0.2
      }, 'Forced critical condition');

      const newCondition = adaptiveManager.getMetrics().currentCondition;
      expect(newCondition.type).toBe('critical');
      expect(newCondition.type).not.toBe(initialCondition.type);
    });
  });

  describe('Recommendations', () => {
    it('should provide recommendations for high latency', () => {
      mockHeartbeatService.updateMetrics({
        averageLatency: 1500
      });

      const recommendations = adaptiveManager.getRecommendations();
      expect(recommendations.some(rec => rec.includes('latency'))).toBe(true);
    });

    it('should provide recommendations for missed heartbeats', () => {
      mockHeartbeatService.updateMetrics({
        missedHeartbeats: 2
      });

      const recommendations = adaptiveManager.getRecommendations();
      expect(recommendations.some(rec => rec.includes('missed'))).toBe(true);
    });

    it('should provide recommendations for intensive operations', () => {
      const intensiveOp: IntensiveOperation = {
        id: 'test-op',
        type: 'audio_processing',
        priority: 'high',
        estimatedDuration: 5000,
        startTime: new Date(),
        pauseHeartbeat: true
      };

      adaptiveManager.registerIntensiveOperation(intensiveOp);

      const recommendations = adaptiveManager.getRecommendations();
      expect(recommendations.some(rec => rec.includes('Intensive operations'))).toBe(true);
    });
  });

  describe('Cleanup and Memory Management', () => {
    it('should clean up old data', () => {
      // Generate lots of adaptation events
      for (let i = 0; i < 150; i++) {
        adaptiveManager.forceAdaptation({
          latency: 100 + i
        }, `Test adaptation ${i}`);
      }

      const metricsBefore = adaptiveManager.getMetrics();
      expect(metricsBefore.adaptationHistory.length).toBeGreaterThan(100);

      adaptiveManager.cleanup();

      const metricsAfter = adaptiveManager.getMetrics();
      expect(metricsAfter.adaptationHistory.length).toBeLessThanOrEqual(100);
    });

    it('should clean up completed operations', () => {
      const oldOp: IntensiveOperation = {
        id: 'old-op',
        type: 'audio_processing',
        priority: 'low',
        estimatedDuration: 100, // Very short
        startTime: new Date(Date.now() - 10000), // 10 seconds ago
        pauseHeartbeat: false
      };

      adaptiveManager.registerIntensiveOperation(oldOp);
      
      // Wait for operation to be considered completed
      setTimeout(() => {
        adaptiveManager.cleanup();
        
        const metrics = adaptiveManager.getMetrics();
        expect(metrics.pausedOperations).not.toContain('old-op');
      }, 200);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty performance history', () => {
      const metrics = adaptiveManager.getMetrics();
      expect(metrics.performanceScore).toBe(50); // Neutral score
    });

    it('should handle invalid network conditions gracefully', () => {
      adaptiveManager.forceAdaptation({
        type: 'good',
        latency: -100, // Invalid latency
        jitter: -50,   // Invalid jitter
        packetLoss: 2.0, // Invalid packet loss (> 1.0)
        stability: 1.5   // Invalid stability (> 1.0)
      }, 'Invalid condition test');

      // Should not crash
      const metrics = adaptiveManager.getMetrics();
      expect(metrics.currentCondition).toBeDefined();
    });

    it('should handle rapid condition changes', () => {
      const conditions = ['excellent', 'good', 'fair', 'poor', 'critical'] as const;
      
      conditions.forEach((condition, index) => {
        adaptiveManager.forceAdaptation({
          type: condition,
          latency: 100 * (index + 1)
        }, `Rapid change ${index}`);
      });

      const metrics = adaptiveManager.getMetrics();
      expect(metrics.adaptationHistory.length).toBeGreaterThan(conditions.length);
    });
  });
});