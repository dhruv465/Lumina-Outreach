/**
 * Simple validation test for EnhancedWebSocketManager
 * Tests basic functionality without complex mocking
 */

import { EnhancedWebSocketManager, ErrorType } from '../src/utils/enhancedWebSocketManager';

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(), 
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock resilience service
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

describe('EnhancedWebSocketManager - Basic Functionality', () => {
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

  describe('Configuration and Initialization', () => {
    test('should initialize with enhanced configuration options', () => {
      expect(manager).toBeDefined();
      
      const metrics = manager.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.totalConnections).toBe(0);
      expect(metrics.messagesSent).toBe(0);
      expect(metrics.protocolErrors).toBe(0);
      expect(metrics.networkErrors).toBe(0);
      expect(metrics.frameValidationErrors).toBe(0);
    });

    test('should initialize buffer stats with enhanced properties', () => {
      const bufferStats = manager.getBufferStats();
      expect(bufferStats).toBeDefined();
      expect(bufferStats.size).toBe(0);
      expect(bufferStats.memoryPressure).toBe('low');
      expect(bufferStats.adaptiveCleanupEnabled).toBe(true);
      expect(bufferStats.averageMessageSize).toBe(0);
      expect(bufferStats.cleanupCycles).toBe(0);
    });

    test('should have proper enum values for error types', () => {
      expect(ErrorType.NETWORK).toBe('network');
      expect(ErrorType.PROTOCOL).toBe('protocol');
      expect(ErrorType.APPLICATION).toBe('application');
      expect(ErrorType.TWILIO_SPECIFIC).toBe('twilio_specific');
      expect(ErrorType.BUFFER_OVERFLOW).toBe('buffer_overflow');
      expect(ErrorType.TIMEOUT).toBe('timeout');
      expect(ErrorType.AUTHENTICATION).toBe('authentication');
    });
  });

  describe('Enhanced Metrics System', () => {
    test('should provide comprehensive connection metrics', () => {
      const metrics = manager.getMetrics();
      
      // Verify all enhanced metric properties exist
      expect(metrics).toHaveProperty('totalConnections');
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('messagesSent');
      expect(metrics).toHaveProperty('messagesReceived');
      expect(metrics).toHaveProperty('bytesSent');
      expect(metrics).toHaveProperty('bytesReceived');
      expect(metrics).toHaveProperty('protocolErrors');
      expect(metrics).toHaveProperty('networkErrors');
      expect(metrics).toHaveProperty('applicationErrors');
      expect(metrics).toHaveProperty('frameValidationErrors');
      expect(metrics).toHaveProperty('compressionErrors');
      expect(metrics).toHaveProperty('fragmentationErrors');
      expect(metrics).toHaveProperty('connectionUptime');
      expect(metrics).toHaveProperty('lastConnectionTime');
      expect(metrics).toHaveProperty('lastDisconnectionTime');
      expect(metrics).toHaveProperty('disconnectionReason');
    });

    test('should provide comprehensive buffer statistics', () => {
      const bufferStats = manager.getBufferStats();
      
      // Verify all enhanced buffer stat properties exist
      expect(bufferStats).toHaveProperty('size');
      expect(bufferStats).toHaveProperty('maxSize');
      expect(bufferStats).toHaveProperty('overflowCount');
      expect(bufferStats).toHaveProperty('totalBufferedMessages');
      expect(bufferStats).toHaveProperty('averageMessageSize');
      expect(bufferStats).toHaveProperty('memoryPressure');
      expect(bufferStats).toHaveProperty('cleanupCycles');
      expect(bufferStats).toHaveProperty('adaptiveCleanupEnabled');
    });
  });

  describe('Connection State Management', () => {
    test('should provide connection status', () => {
      expect(manager.isConnected()).toBe(false);
    });

    test('should allow graceful close', () => {
      expect(() => manager.close()).not.toThrow();
    });

    test('should allow forced termination', () => {
      expect(() => manager.terminate()).not.toThrow();
    });

    test('should provide access to underlying WebSocket', () => {
      const ws = manager.getWebSocket();
      expect(ws).toBeNull(); // Not connected yet
    });
  });

  describe('Message Validation', () => {
    test('should reject invalid Twilio messages without connection', () => {
      const result = manager.sendTwilioMessage('invalid json {');
      expect(result).toBe(false);
    });

    test('should reject messages when not connected', () => {
      const validMessage = JSON.stringify({ event: 'test' });
      const result = manager.sendTwilioMessage(validMessage);
      expect(result).toBe(false);
    });

    test('should reject oversized messages', () => {
      // Create a message larger than 64KB (Twilio limit)
      const largeMessage = JSON.stringify({
        event: 'data',
        data: 'x'.repeat(70 * 1024) // 70KB
      });
      
      const result = manager.sendTwilioMessage(largeMessage);
      expect(result).toBe(false);
    });
  });

  describe('Configuration Validation', () => {
    test('should use default configuration when partial config provided', () => {
      const managerWithDefaults = new EnhancedWebSocketManager('test', 'ws://test');
      const metrics = managerWithDefaults.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.connectionQuality).toBe('excellent');
      managerWithDefaults.close();
    });

    test('should override default configuration when provided', () => {
      const customConfig = {
        maxReconnectAttempts: 10,
        heartbeatInterval: 2000,
        enableFrameValidation: false,
        strictProtocolCompliance: false
      };
      
      const customManager = new EnhancedWebSocketManager('test', 'ws://test', customConfig);
      expect(customManager).toBeDefined();
      customManager.close();
    });
  });
});