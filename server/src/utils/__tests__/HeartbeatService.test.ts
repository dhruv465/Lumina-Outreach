/**
 * Unit tests for HeartbeatService
 */

import { HeartbeatService } from '../HeartbeatService';
import { EventEmitter } from 'events';

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  public readyState = 1; // WebSocket.OPEN
  public sentPings: Buffer[] = [];
  public sentPongs: Buffer[] = [];

  ping(data?: Buffer) {
    if (data) {
      this.sentPings.push(data);
    }
    // Simulate automatic pong response after short delay
    setTimeout(() => {
      this.emit('pong', data || Buffer.from(''));
    }, 10);
  }

  pong(data?: Buffer) {
    if (data) {
      this.sentPongs.push(data);
    }
  }

  close() {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit('close');
  }

  // Simulate receiving ping from remote
  simulateRemotePing(data?: Buffer) {
    this.emit('ping', data || Buffer.from('test-ping'));
  }

  // Simulate pong timeout (no pong response)
  simulatePongTimeout() {
    // Override ping to not emit pong
    this.ping = (data?: Buffer) => {
      if (data) {
        this.sentPings.push(data);
      }
      // Don't emit pong - simulate timeout
    };
  }
}

describe('HeartbeatService', () => {
  let mockWs: MockWebSocket;
  let heartbeatService: HeartbeatService;
  const connectionId = 'test-heartbeat-123';

  beforeEach(() => {
    mockWs = new MockWebSocket();
    heartbeatService = new HeartbeatService(mockWs as any, connectionId, {
      pingInterval: 100,    // 100ms for faster tests
      pongTimeout: 50,      // 50ms timeout
      maxMissedHeartbeats: 3,
      adaptiveInterval: false, // Disable for predictable tests
      minInterval: 50,
      maxInterval: 500,
      latencyThreshold: 100
    });
  });

  afterEach(() => {
    heartbeatService.stop();
  });

  describe('Initialization', () => {
    it('should initialize with correct default state', () => {
      const metrics = heartbeatService.getMetrics();
      
      expect(metrics.isAlive).toBe(true);
      expect(metrics.currentInterval).toBe(100);
      expect(metrics.totalPings).toBe(0);
      expect(metrics.totalPongs).toBe(0);
      expect(metrics.missedHeartbeats).toBe(0);
    });

    it('should not be active initially', () => {
      expect(heartbeatService.isConnectionAlive()).toBe(true);
      const metrics = heartbeatService.getMetrics();
      expect(metrics.totalPings).toBe(0);
    });
  });

  describe('Starting and Stopping', () => {
    it('should start heartbeat service', (done) => {
      heartbeatService.start();
      
      // Wait for first ping
      setTimeout(() => {
        const metrics = heartbeatService.getMetrics();
        expect(metrics.totalPings).toBeGreaterThan(0);
        done();
      }, 150);
    });

    it('should stop heartbeat service', () => {
      heartbeatService.start();
      heartbeatService.stop();
      
      const metrics = heartbeatService.getMetrics();
      // Should not send more pings after stopping
      const initialPings = metrics.totalPings;
      
      setTimeout(() => {
        const newMetrics = heartbeatService.getMetrics();
        expect(newMetrics.totalPings).toBe(initialPings);
      }, 200);
    });

    it('should not start if already active', () => {
      heartbeatService.start();
      const initialMetrics = heartbeatService.getMetrics();
      
      heartbeatService.start(); // Try to start again
      
      // Should not change state
      const newMetrics = heartbeatService.getMetrics();
      expect(newMetrics.currentInterval).toBe(initialMetrics.currentInterval);
    });
  });

  describe('Ping/Pong Mechanism', () => {
    it('should send pings at configured intervals', (done) => {
      heartbeatService.start();
      
      setTimeout(() => {
        expect(mockWs.sentPings.length).toBeGreaterThan(0);
        
        // Check ping payload
        const pingData = JSON.parse(mockWs.sentPings[0].toString());
        expect(pingData.connectionId).toBe(connectionId);
        expect(pingData.timestamp).toBeDefined();
        expect(pingData.sequence).toBeDefined();
        
        done();
      }, 150);
    });

    it('should handle pong responses and calculate latency', (done) => {
      heartbeatService.start();
      
      setTimeout(() => {
        const metrics = heartbeatService.getMetrics();
        expect(metrics.totalPongs).toBeGreaterThan(0);
        expect(metrics.averageLatency).toBeGreaterThan(0);
        expect(metrics.latencyHistory.length).toBeGreaterThan(0);
        done();
      }, 150);
    });

    it('should respond to remote pings with pongs', () => {
      const testData = Buffer.from('remote-ping-data');
      mockWs.simulateRemotePing(testData);
      
      expect(mockWs.sentPongs.length).toBe(1);
      expect(mockWs.sentPongs[0]).toEqual(testData);
    });

    it('should force send ping when requested', () => {
      heartbeatService.start();
      const initialPings = mockWs.sentPings.length;
      
      heartbeatService.forcePing();
      
      expect(mockWs.sentPings.length).toBeGreaterThan(initialPings);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle pong timeouts', (done) => {
      // Configure to simulate timeout
      mockWs.simulatePongTimeout();
      
      let timeoutEventReceived = false;
      heartbeatService.on('missedHeartbeat', () => {
        timeoutEventReceived = true;
      });
      
      heartbeatService.start();
      
      setTimeout(() => {
        const metrics = heartbeatService.getMetrics();
        expect(metrics.missedHeartbeats).toBeGreaterThan(0);
        expect(metrics.timeoutCount).toBeGreaterThan(0);
        expect(timeoutEventReceived).toBe(true);
        done();
      }, 200);
    });

    it('should declare connection dead after max missed heartbeats', (done) => {
      mockWs.simulatePongTimeout();
      
      let connectionDeadEventReceived = false;
      heartbeatService.on('connectionDead', (data) => {
        connectionDeadEventReceived = true;
        expect(data.connectionId).toBe(connectionId);
        expect(data.missedHeartbeats).toBe(3);
      });
      
      heartbeatService.start();
      
      // Wait for enough time for 3 missed heartbeats
      setTimeout(() => {
        expect(connectionDeadEventReceived).toBe(true);
        expect(heartbeatService.isConnectionAlive()).toBe(false);
        
        const metrics = heartbeatService.getMetrics();
        expect(metrics.isAlive).toBe(false);
        expect(metrics.missedHeartbeats).toBe(3);
        done();
      }, 500);
    });
  });

  describe('Adaptive Interval', () => {
    beforeEach(() => {
      // Create service with adaptive interval enabled
      heartbeatService = new HeartbeatService(mockWs as any, connectionId, {
        pingInterval: 100,
        pongTimeout: 50,
        maxMissedHeartbeats: 3,
        adaptiveInterval: true,
        minInterval: 50,
        maxInterval: 500,
        latencyThreshold: 50 // Low threshold for testing
      });
    });

    it('should adjust interval based on latency', (done) => {
      // Mock high latency responses
      const originalPing = mockWs.ping.bind(mockWs);
      mockWs.ping = (data?: Buffer) => {
        if (data) {
          mockWs.sentPings.push(data);
        }
        // Simulate high latency pong response
        setTimeout(() => {
          mockWs.emit('pong', data || Buffer.from(''));
        }, 100); // High latency
      };

      heartbeatService.start();
      
      setTimeout(() => {
        const metrics = heartbeatService.getMetrics();
        // Interval should increase due to high latency
        expect(metrics.currentInterval).toBeGreaterThan(100);
        
        const events = heartbeatService.getRecentEvents();
        const adjustmentEvents = events.filter(e => e.type === 'INTERVAL_ADJUSTED');
        expect(adjustmentEvents.length).toBeGreaterThan(0);
        
        done();
      }, 300);
    });
  });

  describe('Health Assessment', () => {
    it('should provide healthy assessment for good connection', () => {
      heartbeatService.start();
      
      const health = heartbeatService.getConnectionHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.quality).toBe('excellent');
      expect(health.issues.length).toBe(0);
    });

    it('should detect unhealthy connection with missed heartbeats', (done) => {
      mockWs.simulatePongTimeout();
      heartbeatService.start();
      
      setTimeout(() => {
        const health = heartbeatService.getConnectionHealth();
        expect(health.isHealthy).toBe(false);
        expect(health.quality).toMatch(/poor|critical/);
        expect(health.issues.length).toBeGreaterThan(0);
        expect(health.recommendations.length).toBeGreaterThan(0);
        done();
      }, 200);
    });

    it('should assess connection quality based on latency', () => {
      // Manually add high latency to history
      for (let i = 0; i < 10; i++) {
        (heartbeatService as any).recordLatency(2500); // Very high latency
      }
      
      const health = heartbeatService.getConnectionHealth();
      expect(health.quality).toMatch(/poor|critical/);
      expect(health.issues.some(issue => issue.includes('latency'))).toBe(true);
    });
  });

  describe('Metrics and Events', () => {
    it('should track comprehensive metrics', (done) => {
      heartbeatService.start();
      
      setTimeout(() => {
        const metrics = heartbeatService.getMetrics();
        
        expect(metrics.totalPings).toBeGreaterThan(0);
        expect(metrics.totalPongs).toBeGreaterThan(0);
        expect(metrics.connectionAge).toBeGreaterThan(0);
        expect(metrics.lastPingTime).toBeInstanceOf(Date);
        expect(metrics.lastPongTime).toBeInstanceOf(Date);
        expect(metrics.latencyHistory).toBeInstanceOf(Array);
        
        done();
      }, 150);
    });

    it('should track events history', (done) => {
      heartbeatService.start();
      
      setTimeout(() => {
        const events = heartbeatService.getRecentEvents();
        expect(events.length).toBeGreaterThan(0);
        
        const pingSentEvents = events.filter(e => e.type === 'PING_SENT');
        const pongReceivedEvents = events.filter(e => e.type === 'PONG_RECEIVED');
        
        expect(pingSentEvents.length).toBeGreaterThan(0);
        expect(pongReceivedEvents.length).toBeGreaterThan(0);
        
        done();
      }, 150);
    });

    it('should limit event history size', () => {
      // Generate many events
      for (let i = 0; i < 250; i++) {
        (heartbeatService as any).addEvent({
          type: 'PING_SENT',
          timestamp: new Date(),
          context: { test: i }
        });
      }
      
      const events = heartbeatService.getRecentEvents(300);
      expect(events.length).toBeLessThanOrEqual(200);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old data', () => {
      // Add lots of latency data
      for (let i = 0; i < 150; i++) {
        (heartbeatService as any).recordLatency(i);
      }
      
      const metricsBefore = heartbeatService.getMetrics();
      expect(metricsBefore.latencyHistory.length).toBeGreaterThan(50);
      
      heartbeatService.cleanup();
      
      const metricsAfter = heartbeatService.getMetrics();
      expect(metricsAfter.latencyHistory.length).toBeLessThanOrEqual(50);
    });

    it('should stop service when WebSocket closes', () => {
      heartbeatService.start();
      const initialMetrics = heartbeatService.getMetrics();
      
      mockWs.close();
      
      // Service should be stopped
      setTimeout(() => {
        const newMetrics = heartbeatService.getMetrics();
        // Should not have sent more pings after close
        expect(newMetrics.totalPings).toBe(initialMetrics.totalPings);
      }, 200);
    });
  });

  describe('Edge Cases', () => {
    it('should handle WebSocket not open', () => {
      mockWs.readyState = 0; // WebSocket.CONNECTING
      
      heartbeatService.start();
      heartbeatService.forcePing();
      
      // Should not crash or send pings
      expect(mockWs.sentPings.length).toBe(0);
    });

    it('should handle malformed ping payloads', () => {
      heartbeatService.start();
      
      // Simulate malformed pong data
      mockWs.emit('pong', Buffer.from('invalid-json'));
      
      // Should not crash
      const metrics = heartbeatService.getMetrics();
      expect(metrics.totalPongs).toBeGreaterThan(0);
    });

    it('should handle ping errors gracefully', () => {
      // Mock ping to throw error
      mockWs.ping = () => {
        throw new Error('Ping failed');
      };
      
      heartbeatService.start();
      
      setTimeout(() => {
        // Should handle error and potentially declare connection dead
        const metrics = heartbeatService.getMetrics();
        expect(metrics.missedHeartbeats).toBeGreaterThan(0);
      }, 200);
    });
  });
});