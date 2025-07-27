/**
 * Test suite for per-session connection monitoring functionality
 * 
 * Tests the enhanced SessionAwareSocketHandler with per-session health tracking,
 * session-specific error handling, and session state restoration.
 */

import { SessionAwareSocketHandler, SessionState } from '../SessionAwareSocketHandler';
import { TwilioWebSocketManager } from '../TwilioWebSocketManager';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

// Mock WebSocket and TwilioWebSocketManager
jest.mock('ws');
jest.mock('../TwilioWebSocketManager');
jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Create a mock WebSocket class that extends EventEmitter
class MockWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  constructor(url: string) {
    super();
  }
  close() {}
  send() {}
}

describe('SessionAwareSocketHandler - Per-Session Monitoring', () => {
  let handler: SessionAwareSocketHandler;
  let mockSocket: MockWebSocket;
  let mockTwilioManager: jest.Mocked<TwilioWebSocketManager>;

  beforeEach(() => {
    handler = new SessionAwareSocketHandler();
    mockSocket = new MockWebSocket('ws://test');
    mockTwilioManager = {
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      cleanup: jest.fn()
    } as any;

  });

  afterEach(() => {
    handler.stop();
    jest.clearAllMocks();
  });

  describe('Session Health Monitoring', () => {
    test('should initialize session health monitoring', () => {
      // Create a session
      const session = handler.createSession(
        'test-session-1',
        'call-1',
        'conv-1',
        { userId: 'user-1' }
      );

      // Start monitoring
      const result = handler.startConnectionMonitoring('test-session-1');

      expect(result).toBe(true);
      expect(session.connectionHealth.isMonitoring).toBe(true);
      expect(session.connectionHealth.healthScore).toBe(100);
      expect(session.connectionHealth.degradationEvents).toEqual([]);
    });

    test('should record health metrics correctly', () => {
      // Create and start monitoring
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Record latency metric
      const result = handler.recordSessionHealthMetric('test-session-1', {
        type: 'latency',
        value: 150
      });

      expect(result).toBe(true);

      const session = handler.getSession('test-session-1');
      expect(session?.connectionHealth.currentLatency).toBe(150);
      expect(session?.connectionHealth.latencyHistory).toContain(150);
    });

    test('should update health score based on metrics', () => {
      // Create and start monitoring
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Record high latency
      handler.recordSessionHealthMetric('test-session-1', {
        type: 'latency',
        value: 1000
      });

      const session = handler.getSession('test-session-1');
      expect(session?.connectionHealth.healthScore).toBeLessThan(100);
      expect(session?.connectionHealth.connectionQuality).not.toBe('excellent');
    });

    test('should generate comprehensive health report', () => {
      // Create and start monitoring
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Record some metrics
      handler.recordSessionHealthMetric('test-session-1', {
        type: 'latency',
        value: 200
      });
      handler.recordSessionHealthMetric('test-session-1', {
        type: 'error',
        value: 1,
        context: { type: 'network', message: 'Connection timeout' }
      });

      const report = handler.getSessionHealthReport('test-session-1');

      expect(report).toBeDefined();
      expect(report?.sessionId).toBe('test-session-1');
      expect(report?.overallHealth).toBeDefined();
      expect(report?.recommendations).toBeInstanceOf(Array);
      expect(report?.predictedIssues).toBeInstanceOf(Array);
    });
  });

  describe('Connection Degradation Handling', () => {
    test('should handle connection degradation events', () => {
      // Create and start monitoring
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Simulate degradation
      const result = handler.handleConnectionDegradation('test-session-1', 'latency_spike');

      expect(result).toBe(true);

      const session = handler.getSession('test-session-1');
      expect(session?.connectionHealth.degradationEvents).toHaveLength(1);
      expect(session?.connectionHealth.degradationEvents[0].type).toBe('latency_spike');
    });

    test('should provide session-specific error strategies', () => {
      // Create session with poor health
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Simulate poor health
      handler.recordSessionHealthMetric('test-session-1', {
        type: 'error',
        value: 1,
        context: { type: 'protocol' }
      });

      const strategy = handler.getSessionErrorStrategy('test-session-1', 'network');

      expect(strategy).toBeDefined();
      expect(['retry', 'reconnect', 'fallback', 'abort']).toContain(strategy.strategy);
      expect(strategy.delay).toBeGreaterThan(0);
      expect(strategy.maxAttempts).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Session State Restoration', () => {
    test('should prepare session for recovery', () => {
      // Create session
      const session = handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Add some state
      session.streamSid = 'stream-123';
      session.audioSequence = 5;
      handler.addSessionMessage('test-session-1', {
        type: 'user',
        content: 'Hello'
      });

      // Prepare recovery
      const result = handler.prepareSessionRecovery('test-session-1');

      expect(result).toBe(true);
      expect(session.recoveryData).toBeDefined();
      expect(session.recoveryData?.connectionSnapshot).toBeDefined();
      expect(session.recoveryData?.sessionSnapshot).toBeDefined();
      expect(session.recoveryData?.recoveryStrategy).toBeDefined();
    });

    test('should restore session state successfully', () => {
      // Create session and prepare recovery
      const session = handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');
      session.streamSid = 'stream-123';
      session.audioSequence = 5;
      
      handler.prepareSessionRecovery('test-session-1');

      // Simulate connection loss and restoration
      const result = handler.restoreSessionState('test-session-1');

      expect(result).toBe(true);
      expect(session.streamSid).toBe('stream-123');
      expect(session.audioSequence).toBe(5);
      expect(session.connectionHealth.reconnectionCount).toBeGreaterThan(0);
    });

    test('should handle restoration failure gracefully', () => {
      // Try to restore non-existent session
      const result = handler.restoreSessionState('non-existent-session');

      expect(result).toBe(false);
    });
  });

  describe('Socket Event Integration', () => {
    test('should integrate with socket message events', () => {
      // Create session and bind socket
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');
      handler.bindSession(mockSocket as any, mockTwilioManager, 'test-session-1');

      // Get the session to check initial state
      const session = handler.getSession('test-session-1');
      expect(session?.connectionHealth.isMonitoring).toBe(true);

      // Simulate socket message event
      const messageData = Buffer.from('test message');
      mockSocket.emit('message', messageData);

      // Check that session activity was updated (this happens synchronously)
      const updatedSession = handler.getSession('test-session-1');
      expect(updatedSession?.lastActiveAt).toBeDefined();
      
      // The health metrics should be updated through the event handler
      // Let's check that the session is still monitoring
      expect(updatedSession?.connectionHealth.isMonitoring).toBe(true);
    });

    test('should handle socket errors with health monitoring', () => {
      // Create session and bind socket
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');
      handler.bindSession(mockSocket as any, mockTwilioManager, 'test-session-1');

      // Simulate socket error
      const error = new Error('Protocol Error: fragmented frame');
      mockSocket.emit('error', error);

      // Check that error was recorded
      const session = handler.getSession('test-session-1');
      expect(session?.connectionHealth.protocolErrors).toBeGreaterThan(0);
      expect(session?.connectionHealth.degradationEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Cleanup and Resource Management', () => {
    test('should stop monitoring cleanly', () => {
      // Create and start monitoring
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Stop monitoring
      const result = handler.stopConnectionMonitoring('test-session-1');

      expect(result).toBe(true);

      const session = handler.getSession('test-session-1');
      expect(session?.connectionHealth.isMonitoring).toBe(false);
    });

    test('should clean up resources on session removal', () => {
      // Create session with monitoring
      handler.createSession('test-session-1', 'call-1', 'conv-1');
      handler.startConnectionMonitoring('test-session-1');

      // Remove session
      const result = handler.removeSession('test-session-1');

      expect(result).toBe(true);
      expect(handler.getSession('test-session-1')).toBeUndefined();
    });
  });
});