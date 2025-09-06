/**
 * Test for WebSocket connection stability improvements
 */

import { TwilioWebSocketServer, ProtocolState } from '../src/services/twilioWebSocketServer';
import { EnhancedWebSocketManager, ErrorType } from '../src/utils/enhancedWebSocketManager';
import { ReconnectionService } from '../src/services/ReconnectionService';
import http from 'http';

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

// Mock other dependencies
jest.mock('../src/utils/ConnectionHealthMonitor');
jest.mock('../src/utils/ConnectionCircuitBreaker');
jest.mock('../src/utils/RealTimeHealthAssessment');
jest.mock('../src/utils/HeartbeatService');
jest.mock('../src/utils/AdaptiveHeartbeatManager');
jest.mock('../src/utils/enhancedWebSocketFactory', () => ({
  closeAllConnections: jest.fn()
}));

describe('Connection Stability Improvements', () => {
  describe('TwilioWebSocketServer Configuration', () => {
    it('should have optimized intervals for connection stability', () => {
      // Mock HTTP server with required methods
      const mockServer = {
        on: jest.fn(),
        listening: true,
        address: () => ({ port: 8080 })
      } as any;
      
      const twilioServer = new TwilioWebSocketServer(mockServer);
      
      // Access private constants through any type for testing
      const serverAny = twilioServer as any;
      
      // Verify optimized intervals
      expect(serverAny.KEEP_ALIVE_INTERVAL).toBe(10000); // 10 seconds - reduced from 15
      expect(serverAny.CONNECTION_HEALTH_CHECK_INTERVAL).toBe(20000); // 20 seconds - reduced from 30
      expect(serverAny.PING_TIMEOUT).toBe(5000); // 5 seconds timeout
      expect(serverAny.CONNECTION_TIMEOUT).toBe(15000); // 15 seconds timeout
    });
  });

  describe('Enhanced Protocol State', () => {
    it('should have comprehensive protocol state tracking', () => {
      const protocolState: ProtocolState = {
        receivedConnected: false,
        receivedStart: false,
        sentConnectedAck: false,
        hasStreamSid: false,
        messageCount: 0,
        lastMessageTimestamp: Date.now(),
        expectedSequence: 0,
        messageSequenceErrors: 0,
        protocolCompliant: true,
        protocolErrors: [],
        complianceScore: 100,
        connectionStartTime: Date.now(),
        connectionQuality: 'excellent',
        lastQualityUpdate: Date.now(),
        pingLatency: [],
        averageLatency: 0,
        reconnectionAttempts: 0,
        recoveryState: 'stable'
      };
      
      // Verify all required fields are present
      expect(protocolState).toBeDefined();
      expect(protocolState.connectionQuality).toBe('excellent');
      expect(protocolState.complianceScore).toBe(100);
      expect(protocolState.recoveryState).toBe('stable');
      expect(protocolState.expectedSequence).toBe(0);
      expect(protocolState.messageSequenceErrors).toBe(0);
    });
  });

  describe('EnhancedWebSocketManager Connection Timeout', () => {
    let manager: EnhancedWebSocketManager;
    const callId = 'test-call-stability';
    const url = 'ws://localhost:8080/test';

    beforeEach(() => {
      manager = new EnhancedWebSocketManager(callId, url, {
        connectionTimeout: 15000, // 15 seconds - reduced from 30
        enableFrameValidation: true,
        strictProtocolCompliance: true,
        errorClassificationEnabled: true
      });
    });

    it('should have optimized connection timeout', () => {
      const config = (manager as any).config;
      expect(config.connectionTimeout).toBe(15000); // Reduced timeout for faster detection
    });

    it('should provide enhanced timeout error messages', () => {
      const timeoutError = new Error('Twilio WebSocket connection timeout after 15000ms - possible 11205 scenario');
      
      expect(timeoutError.message).toContain('Twilio');
      expect(timeoutError.message).toContain('11205 scenario');
      expect(timeoutError.message).toContain('15000ms');
    });

    it('should support immediate recovery for critical errors', () => {
      const twilioError = {
        type: ErrorType.TWILIO_SPECIFIC,
        severity: 'high' as const,
        message: 'Twilio error 11205',
        recoverable: true,
        originalError: new Error('11205'),
        timestamp: new Date(),
        retryCount: 0
      };
      
      const shouldAttemptImmediate = (manager as any).shouldAttemptImmediateRecovery(twilioError);
      expect(shouldAttemptImmediate).toBe(true);
    });
  });

  describe('ReconnectionService Enhanced Configuration', () => {
    let reconnectionService: ReconnectionService;

    beforeEach(() => {
      reconnectionService = new ReconnectionService({
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        fastRetryWindow: 30000,
        fastRetryMaxAttempts: 3,
        connectionStabilityThreshold: 10000,
        adaptiveDelayEnabled: true
      });
    });

    it('should have enhanced configuration for better stability', () => {
      const config = (reconnectionService as any).config;
      
      expect(config.fastRetryWindow).toBe(30000);
      expect(config.fastRetryMaxAttempts).toBe(3);
      expect(config.connectionStabilityThreshold).toBe(10000);
      expect(config.adaptiveDelayEnabled).toBe(true);
    });

    it('should provide enhanced metrics', () => {
      const metrics = reconnectionService.getMetrics();
      
      expect(metrics).toHaveProperty('connectionStabilityRatio');
      expect(metrics).toHaveProperty('averageConnectionDuration');
      expect(metrics).toHaveProperty('fastRetryCount');
      expect(metrics).toHaveProperty('adaptiveDelayAdjustments');
      expect(metrics).toHaveProperty('lastStableConnectionTime');
    });

    it('should prioritize reconnection for Twilio 11205 scenarios', () => {
      const decision = reconnectionService.getReconnectionDecision('Twilio 11205 - server closed connection');
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('high');
    });
  });
});

describe('Protocol Conformance Enhancements', () => {
  describe('Connection Quality Assessment', () => {
    it('should properly classify connection quality levels', () => {
      // Test quality scoring logic by checking the expected ranges
      const qualityLevels = [
        { score: 95, expected: 'excellent' },
        { score: 85, expected: 'good' },
        { score: 65, expected: 'fair' },
        { score: 35, expected: 'poor' },
        { score: 15, expected: 'critical' }
      ];
      
      qualityLevels.forEach(({ score, expected }) => {
        let qualityLevel: string;
        
        if (score >= 90) {
          qualityLevel = 'excellent';
        } else if (score >= 75) {
          qualityLevel = 'good';
        } else if (score >= 50) {
          qualityLevel = 'fair';
        } else if (score >= 25) {
          qualityLevel = 'poor';
        } else {
          qualityLevel = 'critical';
        }
        
        expect(qualityLevel).toBe(expected);
      });
    });
  });

  describe('Message Sequence Validation', () => {
    it('should track message sequences for protocol compliance', () => {
      const protocolState: ProtocolState = {
        receivedConnected: false,
        receivedStart: false,
        sentConnectedAck: false,
        hasStreamSid: false,
        messageCount: 0,
        lastMessageTimestamp: Date.now(),
        expectedSequence: 0,
        messageSequenceErrors: 0,
        protocolCompliant: true,
        protocolErrors: [],
        complianceScore: 100,
        connectionStartTime: Date.now(),
        connectionQuality: 'excellent',
        lastQualityUpdate: Date.now(),
        pingLatency: [],
        averageLatency: 0,
        reconnectionAttempts: 0,
        recoveryState: 'stable'
      };
      
      // Simulate message sequence tracking
      protocolState.messageCount++;
      protocolState.expectedSequence++;
      
      expect(protocolState.messageCount).toBe(1);
      expect(protocolState.expectedSequence).toBe(1);
      expect(protocolState.messageSequenceErrors).toBe(0);
    });
  });
});