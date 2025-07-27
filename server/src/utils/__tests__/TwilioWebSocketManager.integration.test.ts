/**
 * Integration tests for TwilioWebSocketManager with ConnectionHealthMonitor
 */

import WebSocket from 'ws';
import { TwilioWebSocketManager } from '../TwilioWebSocketManager';

// Mock WebSocket for testing
class MockWebSocket {
  public readyState = 1; // WebSocket.OPEN
  public sentMessages: any[] = [];
  private listeners: { [event: string]: Function[] } = {};
  
  send(data: any, options?: any) {
    this.sentMessages.push({ data, options });
  }
  
  ping() {
    // Simulate ping
    setTimeout(() => {
      this.emit('pong');
    }, 10);
  }
  
  close(code?: number, reason?: string) {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit('close', code, reason);
  }
  
  setMaxListeners(n: number): this {
    return this;
  }
  
  on(event: string, listener: Function): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
    return this;
  }
  
  emit(event: string, ...args: any[]): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach(listener => listener(...args));
    }
  }
}

describe('TwilioWebSocketManager Integration', () => {
  let mockWs: MockWebSocket;
  let manager: TwilioWebSocketManager;
  const connectionId = 'test-integration-connection';

  beforeEach(() => {
    mockWs = new MockWebSocket();
    manager = new TwilioWebSocketManager(mockWs as any, connectionId);
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('Health Monitoring Integration', () => {
    it('should initialize with health monitoring', () => {
      const healthMetrics = manager.getHealthMetrics();
      
      expect(healthMetrics.connectionId).toBe(connectionId);
      expect(healthMetrics.healthScore).toBeGreaterThan(0);
      expect(healthMetrics.averageLatency).toBe(0); // No latency recorded yet
    });

    it('should record latency from ping/pong', (done) => {
      // Trigger a ping which should record latency
      setTimeout(() => {
        const healthMetrics = manager.getHealthMetrics();
        const healthScore = manager.getHealthScore();
        
        expect(healthScore.latency).toBeGreaterThan(0);
        done();
      }, 50);
    });

    it('should record errors when message validation fails', () => {
      const invalidMessage = {
        event: 'media'
        // Missing required fields
      };

      const success = manager.sendTwilioMessage(invalidMessage);
      
      expect(success).toBe(false);
      
      const healthMetrics = manager.getHealthMetrics();
      expect(healthMetrics.issues.length).toBeGreaterThan(0);
      expect(healthMetrics.issues[0].type).toBe('protocol_error');
    });

    it('should generate comprehensive health report', () => {
      // Send some valid messages
      manager.sendTwilioMessage({
        event: 'connected',
        timestamp: Date.now().toString()
      });

      // Send an invalid message to create an error
      manager.sendTwilioMessage({
        event: 'media'
        // Missing required fields
      });

      const healthReport = manager.getHealthReport();
      
      expect(healthReport.connectionId).toBe(connectionId);
      expect(healthReport.healthScore).toBeDefined();
      expect(healthReport.metrics).toBeDefined();
      expect(healthReport.recommendations).toBeInstanceOf(Array);
      expect(healthReport.alerts.length).toBeGreaterThan(0);
    });

    it('should recommend reconnection for poor health', () => {
      // Simulate multiple errors to degrade health
      for (let i = 0; i < 10; i++) {
        manager.sendTwilioMessage({
          event: 'media'
          // Missing required fields - will cause errors
        });
      }

      const shouldReconnect = manager.shouldReconnect();
      expect(shouldReconnect).toBe(true);
    });

    it('should track connection statistics', () => {
      const stats = manager.getStats();
      
      expect(stats).toHaveProperty('sequenceNumber');
      expect(stats).toHaveProperty('connectionHealth');
      expect(stats).toHaveProperty('isReady');
      expect(stats.connectionHealth).toHaveProperty('isHealthy');
      expect(stats.connectionHealth).toHaveProperty('latency');
      expect(stats.connectionHealth).toHaveProperty('errorCount');
      expect(stats.connectionHealth).toHaveProperty('connectionQuality');
    });
  });

  describe('Audio Sending with Health Monitoring', () => {
    it('should track errors when sending audio without streamSid', () => {
      const audioData = Buffer.from('test audio data');
      
      const success = manager.sendAudioToTwilio(audioData, '');
      
      expect(success).toBe(false);
      
      const healthMetrics = manager.getHealthMetrics();
      expect(healthMetrics.issues.length).toBeGreaterThan(0);
    });

    it('should successfully send audio with valid streamSid', () => {
      const audioData = Buffer.from('test audio data');
      const streamSid = 'MZ1234567890abcdef';
      
      const success = manager.sendAudioToTwilio(audioData, streamSid);
      
      expect(success).toBe(true);
      expect(mockWs.sentMessages.length).toBeGreaterThan(0);
      
      const sentMessage = JSON.parse(mockWs.sentMessages[0].data);
      expect(sentMessage.event).toBe('media');
      expect(sentMessage.streamSid).toBe(streamSid);
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should clean up health monitor on cleanup', () => {
      // Generate some health data
      manager.sendTwilioMessage({
        event: 'connected',
        timestamp: Date.now().toString()
      });

      const healthMetricsBefore = manager.getHealthMetrics();
      expect(healthMetricsBefore).toBeDefined();

      // Cleanup should not throw errors
      expect(() => manager.cleanup()).not.toThrow();
    });
  });
});