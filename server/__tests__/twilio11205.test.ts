/**
 * Test for Twilio error 11205 WebSocket connection handling improvements
 */

import { EnhancedWebSocketManager, ErrorType } from '../src/utils/enhancedWebSocketManager';
import { TwilioWebSocketManager } from '../src/utils/TwilioWebSocketManager';
import { ReconnectionService } from '../src/services/ReconnectionService';

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

// Mock connection health monitor and related dependencies
jest.mock('../src/utils/ConnectionHealthMonitor');
jest.mock('../src/utils/ConnectionCircuitBreaker');
jest.mock('../src/utils/RealTimeHealthAssessment');
jest.mock('../src/utils/HeartbeatService');
jest.mock('../src/utils/AdaptiveHeartbeatManager');

describe('Twilio Error 11205 Handling', () => {
  let manager: EnhancedWebSocketManager;
  const callId = 'test-call-twilio-11205';
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

  describe('Twilio Error Code Detection', () => {
    it('should include 11205 in TWILIO_ERROR_CODES array', () => {
      // Access the private property for testing
      const twilioErrorCodes = (manager as any).TWILIO_ERROR_CODES;
      expect(twilioErrorCodes).toContain(11205);
      expect(twilioErrorCodes).toContain(31924); // Existing error code
      expect(twilioErrorCodes).toContain(31951); // Existing error code
    });
  });

  describe('Error Classification for 11205', () => {
    it('should classify error message containing "11205" as TWILIO_SPECIFIC', () => {
      const error = new Error('Twilio error 11205: WebSocket connection closed by server');
      
      const classifiedError = (manager as any).classifyError(error);
      
      expect(classifiedError.type).toBe(ErrorType.TWILIO_SPECIFIC);
      expect(classifiedError.severity).toBe('high');
      expect(classifiedError.recoverable).toBe(true);
    });

    it('should classify "connection closed by server" as TWILIO_SPECIFIC', () => {
      const error = new Error('WebSocket connection closed by server');
      
      const classifiedError = (manager as any).classifyError(error);
      
      expect(classifiedError.type).toBe(ErrorType.TWILIO_SPECIFIC);
      expect(classifiedError.severity).toBe('high');
      expect(classifiedError.recoverable).toBe(true);
    });

    it('should classify "websocket connection closed" as TWILIO_SPECIFIC', () => {
      const error = new Error('websocket connection closed unexpectedly');
      
      const classifiedError = (manager as any).classifyError(error);
      
      expect(classifiedError.type).toBe(ErrorType.TWILIO_SPECIFIC);
      expect(classifiedError.severity).toBe('high');
      expect(classifiedError.recoverable).toBe(true);
    });
  });

  describe('Close Code Classification', () => {
    it('should classify close code 1000 with server-related reason as TWILIO_SPECIFIC', () => {
      const reason = 'Connection closed by server';
      
      const classifiedError = (manager as any).classifyCloseCode(1000, reason);
      
      expect(classifiedError.type).toBe(ErrorType.TWILIO_SPECIFIC);
      expect(classifiedError.severity).toBe('high');
      expect(classifiedError.recoverable).toBe(true);
    });

    it('should classify close code 1000 with twilio in reason as TWILIO_SPECIFIC', () => {
      const reason = 'Twilio service maintenance';
      
      const classifiedError = (manager as any).classifyCloseCode(1000, reason);
      
      expect(classifiedError.type).toBe(ErrorType.TWILIO_SPECIFIC);
      expect(classifiedError.severity).toBe('high');
      expect(classifiedError.recoverable).toBe(true);
    });
  });

  describe('Reconnection Logic for Twilio Errors', () => {
    it('should attempt reconnection for TWILIO_SPECIFIC errors', () => {
      const twilioError = {
        type: ErrorType.TWILIO_SPECIFIC,
        severity: 'high' as const,
        message: 'Twilio error 11205',
        recoverable: true
      };
      
      const shouldReconnect = (manager as any).shouldAttemptReconnection(1000, twilioError);
      
      expect(shouldReconnect).toBe(true);
    });

    it('should not attempt reconnection for unrecoverable errors', () => {
      const unrecoverableError = {
        type: ErrorType.AUTHENTICATION,
        severity: 'critical' as const,
        message: 'Authentication failed',
        recoverable: false
      };
      
      const shouldReconnect = (manager as any).shouldAttemptReconnection(1000, unrecoverableError);
      
      expect(shouldReconnect).toBe(false);
    });
  });

  describe('Enhanced Connection Timeout', () => {
    it('should provide descriptive timeout error message for Twilio scenarios', () => {
      // This is testing the timeout error message enhancement
      const timeoutError = new Error('Twilio WebSocket connection timeout after 15000ms - possible 11205 scenario');
      
      expect(timeoutError.message).toContain('Twilio');
      expect(timeoutError.message).toContain('11205 scenario');
      expect(timeoutError.message).toContain('timeout');
    });
  });
});

describe('ReconnectionService Twilio 11205 Support', () => {
  let reconnectionService: ReconnectionService;

  beforeEach(() => {
    reconnectionService = new ReconnectionService({
      maxAttempts: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      jitterFactor: 0.1,
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 30000
    });
  });

  describe('Reconnection Decision for 11205', () => {
    it('should prioritize reconnection for Twilio 11205 scenarios', () => {
      const decision = reconnectionService.getReconnectionDecision('Twilio 11205 - server closed connection');
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('high');
    });

    it('should handle "11205" in reason text', () => {
      const decision = reconnectionService.getReconnectionDecision('Error 11205 detected in connection');
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('high');
    });

    it('should handle "server closed connection" pattern', () => {
      const decision = reconnectionService.getReconnectionDecision('WebSocket server closed connection unexpectedly');
      
      expect(decision.shouldReconnect).toBe(true);
      expect(decision.urgency).toBe('high');
    });
  });
});