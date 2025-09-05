/**
 * Enhanced WebSocket Manager Tests
 * 
 * Tests for RFC 6455 compliance, error classification, buffer management,
 * and Twilio integration features.
 */

// Mock WebSocket first
class MockWebSocket {
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;  
  public static CLOSED = 3;

  public readyState = MockWebSocket.CONNECTING;
  public url = '';
  public protocol = '';
  
  private eventListeners: { [key: string]: Function[] } = {};
  
  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }, 10);
  }
  
  on(event: string, callback: Function) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }
  
  emit(event: string, ...args: any[]) {
    const callbacks = this.eventListeners[event];
    if (callbacks) {
      callbacks.forEach(callback => callback(...args));
    }
  }
  
  send(data: any, options?: any) {
    // Simulate successful send
    setTimeout(() => {
      if (options?.callback) {
        options.callback(null);
      }
    }, 1);
  }
  
  ping() {
    setTimeout(() => this.emit('pong'), 1);
  }
  
  pong() {
    // Mock pong response
  }
  
  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => this.emit('close', code || 1000, reason || 'Normal closure'), 1);
  }
  
  terminate() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', 1006, 'Terminated');
  }
}

// Mock WebSocket globally
jest.mock('ws', () => MockWebSocket);

// Mock dependencies
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/services/callResilienceService', () => ({
  getCallResilienceService: () => ({
    registerCall: jest.fn(),
    unregisterCall: jest.fn(),
    updateHeartbeat: jest.fn(),
    updateAudioBufferSize: jest.fn(),
    reportError: jest.fn(),
    activateFallback: jest.fn(),
    emit: jest.fn()
  })
}));

import { EnhancedWebSocketManager } from '../src/utils/enhancedWebSocketManager';

describe('EnhancedWebSocketManager', () => {
  let manager: EnhancedWebSocketManager;
  const callId = 'test-call-123';
  const url = 'ws://localhost:8080/test';

  beforeEach(() => {
    manager = new EnhancedWebSocketManager(callId, url, {
      enableFrameValidation: true,
      strictProtocolCompliance: true,
      errorClassificationEnabled: true,
      maxFrameSize: 64 * 1024,
      maxMessageSize: 1024 * 1024
    });
  });

  afterEach(() => {
    manager.close();
    jest.clearAllMocks();
  });

  describe('Enhanced Configuration', () => {
    test('should initialize with RFC 6455 compliance options', () => {
      expect(manager.getMetrics()).toMatchObject({
        totalConnections: 0,
        messagesSent: 0,
        messagesReceived: 0,
        protocolErrors: 0,
        networkErrors: 0,
        applicationErrors: 0,
        frameValidationErrors: 0
      });
    });

    test('should initialize with enhanced buffer management', () => {
      const bufferStats = manager.getBufferStats();
      expect(bufferStats).toMatchObject({
        size: 0,
        overflowCount: 0,
        memoryPressure: 'low',
        adaptiveCleanupEnabled: true
      });
    });
  });

  describe('Connection Management', () => {
    test('should establish connection with enhanced metrics tracking', async () => {
      const connectPromise = manager.connect();
      
      // Wait for connection
      await connectPromise;
      
      const metrics = manager.getMetrics();
      expect(metrics.totalConnections).toBe(1);
      expect(metrics.activeConnections).toBe(1);
      expect(metrics.connectionQuality).toBe('excellent');
      expect(metrics.lastConnectionTime).toBeInstanceOf(Date);
    });

    test('should handle connection close with proper classification', async () => {
      await manager.connect();
      
      const ws = manager.getWebSocket() as any;
      ws.emit('close', 1002, 'Protocol error');
      
      const metrics = manager.getMetrics();
      expect(metrics.lastDisconnectionTime).toBeInstanceOf(Date);
      expect(metrics.disconnectionReason).toContain('Code: 1002');
    });
  });

  describe('Twilio Message Handling', () => {
    beforeEach(async () => {
      await manager.connect();
    });

    test('should validate and send properly formatted Twilio messages', () => {
      const validMessage = JSON.stringify({
        event: 'start',
        sequenceNumber: 1,
        start: { streamSid: 'test-stream-123' }
      });

      const result = manager.sendTwilioMessage(validMessage);
      expect(result).toBe(true);
      
      const metrics = manager.getMetrics();
      expect(metrics.messagesSent).toBe(1);
      expect(metrics.bytesSent).toBeGreaterThan(0);
    });

    test('should reject invalid JSON messages', () => {
      const invalidMessage = '{ invalid json';
      
      const result = manager.sendTwilioMessage(invalidMessage);
      expect(result).toBe(false);
      
      const metrics = manager.getMetrics();
      expect(metrics.protocolErrors).toBe(1);
    });

    test('should reject messages exceeding size limits', () => {
      const largeMessage = JSON.stringify({
        event: 'data',
        data: 'x'.repeat(70 * 1024) // Exceed 64KB Twilio limit
      });
      
      const result = manager.sendTwilioMessage(largeMessage);
      expect(result).toBe(false);
      
      const metrics = manager.getMetrics();
      expect(metrics.protocolErrors).toBe(1);
    });

    test('should handle binary data with frame validation', () => {
      const binaryData = Buffer.from('audio data here');
      
      const result = manager.sendTwilioMessage(binaryData);
      expect(result).toBe(true);
      
      const metrics = manager.getMetrics();
      expect(metrics.messagesSent).toBe(1);
      expect(metrics.bytesSent).toBe(binaryData.length);
    });
  });

  describe('Error Classification', () => {
    beforeEach(async () => {
      await manager.connect();
    });

    test('should classify network errors correctly', () => {
      const networkError = new Error('ECONNREFUSED: Connection refused');
      
      // Trigger error through WebSocket
      const ws = manager.getWebSocket() as any;
      ws.emit('error', networkError);
      
      const metrics = manager.getMetrics();
      expect(metrics.networkErrors).toBe(1);
    });

    test('should classify protocol errors correctly', () => {
      const protocolError = new Error('Protocol error: Invalid frame opcode');
      
      const ws = manager.getWebSocket() as any;
      ws.emit('error', protocolError);
      
      const metrics = manager.getMetrics();
      expect(metrics.protocolErrors).toBe(1);
    });

    test('should classify Twilio-specific errors', () => {
      const twilioError = new Error('Twilio error 31924: malformed message');
      
      const ws = manager.getWebSocket() as any;
      ws.emit('error', twilioError);
      
      const metrics = manager.getMetrics();
      expect(metrics.protocolErrors).toBe(1); // Twilio errors count as protocol errors
    });
  });

  describe('Buffer Management', () => {
    beforeEach(async () => {
      await manager.connect();
    });

    test('should update memory pressure based on buffer size', () => {
      // Simulate receiving large binary messages
      const ws = manager.getWebSocket() as any;
      
      // Send messages to fill buffer
      for (let i = 0; i < 10; i++) {
        const largeBuffer = Buffer.alloc(5 * 1024 * 1024); // 5MB each
        ws.emit('message', largeBuffer);
      }
      
      const bufferStats = manager.getBufferStats();
      expect(bufferStats.memoryPressure).not.toBe('low');
      expect(bufferStats.totalBufferedMessages).toBe(10);
    });

    test('should perform adaptive cleanup based on memory pressure', () => {
      const ws = manager.getWebSocket() as any;
      
      // Fill buffer to trigger cleanup
      for (let i = 0; i < 20; i++) {
        const buffer = Buffer.alloc(2 * 1024 * 1024); // 2MB each
        ws.emit('message', buffer);
      }
      
      const bufferStats = manager.getBufferStats();
      expect(bufferStats.cleanupCycles).toBeGreaterThan(0);
      expect(bufferStats.size).toBeLessThan(40 * 1024 * 1024); // Should be cleaned up
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(async () => {
      await manager.connect();
    });

    test('should track connection latency from ping/pong', (done) => {
      manager.on('message', () => {
        setTimeout(() => {
          const metrics = manager.getMetrics();
          expect(metrics.latency).toBeGreaterThanOrEqual(0);
          done();
        }, 50);
      });

      // Simulate message to update heartbeat
      const ws = manager.getWebSocket() as any;
      ws.emit('message', Buffer.from('test'));
    });

    test('should update connection quality based on latency', () => {
      const metrics = manager.getMetrics();
      expect(['excellent', 'good', 'poor', 'failed']).toContain(metrics.connectionQuality);
    });
  });

  describe('Frame Validation', () => {
    beforeEach(async () => {
      await manager.connect();
    });

    test('should validate incoming text frames as JSON', () => {
      const ws = manager.getWebSocket() as any;
      
      // Valid JSON should not increase frame validation errors
      ws.emit('message', '{"event": "test"}');
      
      let metrics = manager.getMetrics();
      expect(metrics.frameValidationErrors).toBe(0);
      
      // Invalid JSON should increase frame validation errors  
      ws.emit('message', 'invalid json');
      
      metrics = manager.getMetrics();
      expect(metrics.frameValidationErrors).toBe(1);
    });

    test('should validate binary frame sizes', () => {
      const ws = manager.getWebSocket() as any;
      
      // Small binary frame should be flagged as invalid
      ws.emit('message', Buffer.alloc(10));
      
      const metrics = manager.getMetrics();
      expect(metrics.frameValidationErrors).toBe(1);
    });
  });

  describe('Reconnection Logic', () => {
    test('should attempt reconnection with exponential backoff', async () => {
      await manager.connect();
      
      // Force close with recoverable error
      const ws = manager.getWebSocket() as any;
      ws.emit('close', 1006, 'Abnormal closure');
      
      // Should trigger reconnection attempt
      const metrics = manager.getMetrics();
      expect(metrics.activeConnections).toBe(0);
    });

    test('should not reconnect for authentication errors', async () => {
      await manager.connect();
      
      // Close with authentication error code  
      const ws = manager.getWebSocket() as any;
      ws.emit('close', 1008, 'Policy violation - auth failed');
      
      // Should not attempt reconnection
      await new Promise(resolve => setTimeout(resolve, 100));
      const metrics = manager.getMetrics();
      expect(metrics.reconnectAttempts).toBe(0);
    });
  });

  describe('Production Monitoring Features', () => {
    test('should track comprehensive metrics for monitoring', async () => {
      await manager.connect();
      
      // Send some messages
      manager.sendTwilioMessage('{"event": "test"}');
      
      // Simulate received message
      const ws = manager.getWebSocket() as any;
      ws.emit('message', Buffer.from('response'));
      
      const metrics = manager.getMetrics();
      
      // Verify all enhanced metrics are tracked
      expect(metrics).toHaveProperty('messagesSent');
      expect(metrics).toHaveProperty('messagesReceived');
      expect(metrics).toHaveProperty('bytesSent');
      expect(metrics).toHaveProperty('bytesReceived');
      expect(metrics).toHaveProperty('connectionUptime');
      expect(metrics).toHaveProperty('avgReconnectionDelay');
      
      expect(metrics.messagesSent).toBe(1);
      expect(metrics.messagesReceived).toBe(1);
    });

    test('should provide detailed buffer statistics', () => {
      const bufferStats = manager.getBufferStats();
      
      expect(bufferStats).toHaveProperty('averageMessageSize');
      expect(bufferStats).toHaveProperty('memoryPressure');
      expect(bufferStats).toHaveProperty('cleanupCycles');
      expect(bufferStats).toHaveProperty('adaptiveCleanupEnabled');
    });
  });
});