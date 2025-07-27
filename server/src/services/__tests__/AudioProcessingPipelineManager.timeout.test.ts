/**
 * Tests for AudioProcessingPipelineManager timeout and error handling enhancements
 * 
 * Tests the implementation of task 5.2: Add processing timeout and error handling
 * Requirements: 3.2, 3.4, 2.2
 */

import { EventEmitter } from 'events';
import { AudioProcessingPipelineManager } from '../AudioProcessingPipelineManager';
import { LLMService } from '../llmService';
import AudioProcessingTimeoutHandler, { 
  ProcessingStage, 
  ProcessingError, 
  RecoveryStrategy,
  ErrorType,
  ErrorSeverity 
} from '../AudioProcessingTimeoutHandler';

// Mock dependencies
jest.mock('../llmService');
jest.mock('../textToSpeechService');
jest.mock('../audioProcessingPipeline', () => ({
  audioProcessingPipeline: {
    processBuffer: jest.fn().mockResolvedValue({ transcript: 'mock transcript' })
  }
}));
jest.mock('../../utils/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('AudioProcessingPipelineManager - Timeout and Error Handling', () => {
  let pipelineManager: AudioProcessingPipelineManager;
  let mockLLMService: jest.Mocked<LLMService>;

  beforeEach(() => {
    mockLLMService = new LLMService('test-key', 'test-key') as jest.Mocked<LLMService>;
    pipelineManager = new AudioProcessingPipelineManager(mockLLMService);
  });

  afterEach(() => {
    pipelineManager.shutdown();
    jest.clearAllMocks();
  });

  describe('configureProcessingTimeouts', () => {
    it('should configure timeouts for each processing stage', () => {
      const stageConfigs = {
        speech_to_text: {
          timeout: 10000,
          maxRetries: 3,
          recoveryStrategy: 'exponential_backoff' as RecoveryStrategy,
          twilioCompliant: true
        },
        llm_processing: {
          timeout: 25000,
          maxRetries: 2,
          recoveryStrategy: 'circuit_breaker' as RecoveryStrategy,
          twilioCompliant: true
        }
      };

      expect(() => {
        pipelineManager.configureProcessingTimeouts(stageConfigs);
      }).not.toThrow();

      // Verify timeout configurations were applied
      const speechConfig = pipelineManager.getTimeoutHandler().getTimeoutConfig('speech_to_text');
      expect(speechConfig.timeout).toBe(10000);
      expect(speechConfig.maxRetries).toBe(3);
      expect(speechConfig.recoveryStrategy).toBe('exponential_backoff');
    });

    it('should apply Twilio-specific timeout settings', () => {
      const stageConfigs = {
        websocket_send: {
          timeout: 5000,
          maxRetries: 3,
          twilioCompliant: true
        }
      };

      pipelineManager.configureProcessingTimeouts(stageConfigs);

      const config = pipelineManager.getTimeoutHandler().getTimeoutConfig('websocket_send');
      expect(config.backoffMultiplier).toBe(1.5); // Gentler backoff for Twilio
      expect(config.maxBackoffDelay).toBe(15000); // Shorter max delay for Twilio
      expect(config.criticalThreshold).toBe(30000); // Lower threshold for Twilio
    });
  });

  describe('handleTwilioProcessingError', () => {
    it('should handle Twilio protocol errors with detailed logging (Requirement 2.2)', async () => {
      const error = new Error('Malformed message or message not conformant with WebSocket protocol');
      const twilioContext = {
        callSid: 'CA1234567890abcdef1234567890abcdef',
        streamSid: 'MZ1234567890abcdef1234567890abcdef',
        errorCode: 'WEBSOCKET_PROTOCOL_ERROR',
        errorMessage: 'The WebSocket control frame was fragmented',
        protocolViolation: true,
        frameFragmented: true
      };

      const result = await pipelineManager.handleTwilioProcessingError(
        'session123',
        'websocket_send',
        error,
        twilioContext
      );

      expect(result).toBeDefined();
      expect(result.userFeedback?.message).toContain('Call ID:');
      expect(result.userFeedback?.message).toContain('Error: WEBSOCKET_PROTOCOL_ERROR');
    });

    it('should emit frameFragmentationDetected event for fragmented frames (Requirement 3.2)', async () => {
      const error = new Error('The WebSocket control frame was fragmented');
      const twilioContext = {
        frameFragmented: true,
        callSid: 'CA1234567890abcdef1234567890abcdef'
      };

      const frameFragmentationSpy = jest.fn();
      pipelineManager.on('frameFragmentationDetected', frameFragmentationSpy);

      await pipelineManager.handleTwilioProcessingError(
        'session123',
        'websocket_send',
        error,
        twilioContext
      );

      expect(frameFragmentationSpy).toHaveBeenCalledWith({
        sessionId: 'session123',
        stage: 'websocket_send',
        twilioContext: expect.objectContaining({
          frameFragmented: true,
          requiresReconstruction: true
        }),
        requiresReconstruction: true
      });
    });

    it('should emit protocolViolationDetected event without crashing (Requirement 3.4)', async () => {
      const error = new Error('Protocol violation detected');
      const twilioContext = {
        protocolViolation: true,
        errorCode: 'PROTOCOL_ERROR',
        errorMessage: 'Invalid message format'
      };

      const protocolViolationSpy = jest.fn();
      pipelineManager.on('protocolViolationDetected', protocolViolationSpy);

      const result = await pipelineManager.handleTwilioProcessingError(
        'session123',
        'websocket_send',
        error,
        twilioContext
      );

      expect(protocolViolationSpy).toHaveBeenCalledWith({
        sessionId: 'session123',
        stage: 'websocket_send',
        errorCode: 'PROTOCOL_ERROR',
        errorMessage: 'Invalid message format',
        recoveryRequired: true
      });

      // Should not crash and return a result
      expect(result).toBeDefined();
    });
  });

  describe('createTimeoutRecoveryMechanism', () => {
    it('should create custom timeout recovery mechanism', () => {
      const customRecovery = {
        onTimeout: jest.fn().mockResolvedValue({
          success: true,
          message: 'Custom timeout recovery executed'
        }),
        onError: jest.fn().mockResolvedValue({
          success: true,
          message: 'Custom error recovery executed'
        })
      };

      expect(() => {
        pipelineManager.createTimeoutRecoveryMechanism('llm_processing', customRecovery);
      }).not.toThrow();

      // Verify configuration was applied
      const config = pipelineManager.getTimeoutHandler().getTimeoutConfig('llm_processing');
      expect(config.stage).toBe('llm_processing');
      expect(config.userFeedbackEnabled).toBe(true);
    });

    it('should execute custom recovery on timeout events', async () => {
      const customRecovery = {
        onTimeout: jest.fn().mockResolvedValue({
          success: true,
          message: 'Custom timeout recovery executed'
        })
      };

      const customRecoverySpy = jest.fn();
      pipelineManager.on('customRecoveryExecuted', customRecoverySpy);

      pipelineManager.createTimeoutRecoveryMechanism('llm_processing', customRecovery);

      // Simulate timeout event
      const timeoutHandler = pipelineManager.getTimeoutHandler();
      timeoutHandler.emit('timeout', {
        id: 'timeout123',
        sessionId: 'session123',
        stage: 'llm_processing',
        startTime: new Date(),
        timeoutTime: new Date(),
        actualDuration: 35000,
        expectedDuration: 30000,
        context: { test: true },
        recoveryAction: 'exponential_backoff'
      });

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(customRecovery.onTimeout).toHaveBeenCalled();
      expect(customRecoverySpy).toHaveBeenCalledWith({
        stage: 'llm_processing',
        sessionId: 'session123',
        type: 'timeout',
        result: {
          success: true,
          message: 'Custom timeout recovery executed'
        }
      });
    });
  });

  describe('classifyProcessingError', () => {
    it('should classify Twilio-specific errors correctly', () => {
      const error = new Error('Malformed message or message not conformant with WebSocket protocol');
      const context = {
        callSid: 'CA1234567890abcdef1234567890abcdef',
        streamSid: 'MZ1234567890abcdef1234567890abcdef'
      };

      const classification = pipelineManager.classifyProcessingError(error, 'websocket_send', context);

      expect(classification.type).toBe('protocol_error');
      expect(classification.severity).toBe('high');
      expect(classification.twilioSpecific).toBe(true);
      expect(classification.requiresProtocolFix).toBe(true);
      expect(classification.recoverable).toBe(true);
    });

    it('should classify frame fragmentation errors', () => {
      const error = new Error('The WebSocket control frame was fragmented');
      const context = { callSid: 'CA123' };

      const classification = pipelineManager.classifyProcessingError(error, 'websocket_send', context);

      expect(classification.type).toBe('protocol_error');
      expect(classification.severity).toBe('high');
      expect(classification.twilioSpecific).toBe(true);
      expect(classification.requiresProtocolFix).toBe(true);
    });

    it('should classify general timeout errors', () => {
      const error = new Error('Operation timeout exceeded');
      
      const classification = pipelineManager.classifyProcessingError(error, 'llm_processing');

      expect(classification.type).toBe('timeout');
      expect(classification.severity).toBe('medium');
      expect(classification.twilioSpecific).toBe(false);
      expect(classification.recoverable).toBe(true);
    });

    it('should classify resource exhaustion as critical', () => {
      const error = new Error('Memory limit exceeded');
      
      const classification = pipelineManager.classifyProcessingError(error, 'audio_analysis');

      expect(classification.type).toBe('resource_exhaustion');
      expect(classification.severity).toBe('critical');
      expect(classification.recoverable).toBe(false);
    });
  });

  describe('executeErrorRecoveryStrategy', () => {
    let mockError: ProcessingError;

    beforeEach(() => {
      mockError = {
        id: 'error123',
        sessionId: 'session123',
        stage: 'llm_processing',
        type: 'timeout',
        severity: 'medium',
        message: 'Operation timeout',
        timestamp: new Date(),
        context: {},
        recoverable: true,
        retryCount: 0,
        maxRetries: 3,
        recoveryStrategy: 'exponential_backoff',
        userNotified: false,
        resolved: false
      };
    });

    it('should execute immediate retry strategy', async () => {
      const result = await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'immediate_retry'
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Retrying immediately');
      expect(result.userFeedback?.type).toBe('progress');
      expect(result.userFeedback?.progressPercentage).toBe(0);
    });

    it('should execute exponential backoff strategy', async () => {
      mockError.retryCount = 1;
      
      const result = await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'exponential_backoff'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Retrying with');
      expect(result.newTimeout).toBeGreaterThan(0);
      expect(result.userFeedback?.estimatedResolutionTime).toBeGreaterThan(0);
    });

    it('should fail when max retries exceeded', async () => {
      mockError.retryCount = 3;
      mockError.maxRetries = 3;
      
      const result = await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'immediate_retry'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Maximum retries exceeded');
      expect(result.userFeedback?.severity).toBe('error');
      expect(result.userFeedback?.actionRequired).toBe(true);
    });

    it('should execute graceful degradation strategy', async () => {
      const result = await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'graceful_degradation'
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Continuing with reduced functionality');
      expect(result.fallbackUsed).toBe(true);
      expect(result.userFeedback?.severity).toBe('warning');
    });

    it('should execute session reset strategy', async () => {
      const sessionResetSpy = jest.fn();
      pipelineManager.on('sessionResetRequired', sessionResetSpy);

      const result = await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'session_reset'
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Session reset initiated');
      expect(sessionResetSpy).toHaveBeenCalledWith({
        sessionId: 'session123',
        reason: 'Operation timeout',
        stage: 'llm_processing'
      });
    });

    it('should emit recoveryStrategyExecuted event', async () => {
      const recoverySpy = jest.fn();
      pipelineManager.on('recoveryStrategyExecuted', recoverySpy);

      await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'immediate_retry'
      );

      expect(recoverySpy).toHaveBeenCalledWith({
        error: mockError,
        strategy: 'immediate_retry',
        result: expect.objectContaining({
          success: true,
          message: 'Retrying immediately'
        }),
        recoveryTime: expect.any(Number)
      });
    });

    it('should handle unknown recovery strategy', async () => {
      const result = await pipelineManager.executeErrorRecoveryStrategy(
        mockError,
        'unknown_strategy' as RecoveryStrategy
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown recovery strategy');
    });
  });

  describe('Integration with existing timeout handler', () => {
    it('should forward timeout handler events', () => {
      const timeoutSpy = jest.fn();
      const errorSpy = jest.fn();
      const feedbackSpy = jest.fn();
      const recoverySpy = jest.fn();

      pipelineManager.on('taskTimeout', timeoutSpy);
      pipelineManager.on('processingError', errorSpy);
      pipelineManager.on('userFeedback', feedbackSpy);
      pipelineManager.on('recoveryAttempt', recoverySpy);

      const timeoutHandler = pipelineManager.getTimeoutHandler();

      // Simulate events from timeout handler
      timeoutHandler.emit('timeout', { id: 'timeout123' });
      timeoutHandler.emit('processingError', { id: 'error123' });
      timeoutHandler.emit('userFeedback', { sessionId: 'session123' });
      timeoutHandler.emit('recoveryAttempt', { 
        error: {
          id: 'error123',
          sessionId: 'session123',
          stage: 'llm_processing',
          type: 'timeout',
          severity: 'medium',
          message: 'Test error',
          timestamp: new Date(),
          context: {},
          recoverable: true,
          retryCount: 0,
          maxRetries: 3,
          recoveryStrategy: 'exponential_backoff',
          userNotified: false,
          resolved: false
        },
        result: { success: true, message: 'Test recovery' },
        recoveryTime: 100
      });

      expect(timeoutSpy).toHaveBeenCalledWith({ id: 'timeout123' });
      expect(errorSpy).toHaveBeenCalledWith({ id: 'error123' });
      expect(feedbackSpy).toHaveBeenCalledWith({ sessionId: 'session123' });
      expect(recoverySpy).toHaveBeenCalled();
    });

    it('should provide access to timeout metrics', () => {
      const metrics = pipelineManager.getTimeoutMetrics();
      
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalTimeouts).toBe('number');
      expect(typeof metrics.averageRecoveryTime).toBe('number');
      expect(typeof metrics.successfulRecoveries).toBe('number');
      expect(typeof metrics.failedRecoveries).toBe('number');
    });

    it('should provide access to session error history', () => {
      const history = pipelineManager.getSessionErrorHistory('session123', 5);
      
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });
});