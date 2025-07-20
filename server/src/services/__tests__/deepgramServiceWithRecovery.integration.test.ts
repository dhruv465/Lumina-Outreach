/**
 * Integration tests for Enhanced Deepgram Service with Recovery
 * 
 * Tests the complete error classification and recovery workflow
 * Requirements: 1.2, 1.4, 3.2
 */

import { DeepgramServiceWithRecovery } from '../deepgramServiceWithRecovery';
import { DeepgramEvent } from '../deepgramService';

// Mock the underlying services
jest.mock('../deepgramService', () => ({
  DeepgramService: jest.fn().mockImplementation(() => ({
    transcribeAudio: jest.fn(),
    createTranscriptionStream: jest.fn(),
    validateApiKey: jest.fn(),
    getActiveConnectionIds: jest.fn(),
    on: jest.fn(),
    emit: jest.fn()
  })),
  DeepgramEvent: {
    TRANSCRIPT_RECEIVED: 'transcript-received',
    TRANSCRIPT_FINAL: 'transcript-final',
    ERROR: 'error',
    CONNECTION_STATUS: 'connection-status',
    FALLBACK_USED: 'fallback-used'
  }
}));

jest.mock('../deepgramRecoveryService', () => ({
  deepgramRecoveryService: {
    executeWithRecovery: jest.fn(),
    validateModelAccess: jest.fn(),
    getRecommendedModel: jest.fn()
  }
}));

jest.mock('../deepgramErrorHandler', () => ({
  deepgramErrorHandler: {
    classifyError: jest.fn()
  }
}));

describe('DeepgramServiceWithRecovery Integration', () => {
  let enhancedService: DeepgramServiceWithRecovery;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    enhancedService = new DeepgramServiceWithRecovery(mockApiKey);
    jest.clearAllMocks();
  });

  describe('transcribeAudioWithRecovery', () => {
    test('should successfully transcribe audio without fallback', async () => {
      const mockAudioBuffer = Buffer.from('mock audio data');
      const mockTranscriptResult = {
        text: 'Hello world',
        confidence: 0.95,
        words: [],
        language: 'en',
        latency: 100
      };

      // Mock successful recovery
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: mockTranscriptResult,
        fallbackUsed: false,
        modelUsed: 'nova-2',
        attemptsUsed: 1
      });

      const result = await enhancedService.transcribeAudioWithRecovery(mockAudioBuffer);

      expect(result.text).toBe('Hello world');
      expect(result.confidence).toBe(0.95);
      expect(result.fallbackUsed).toBe(false);
      expect(result.modelUsed).toBe('nova-2');
      expect(result.recoveryAttempts).toBe(1);
    });

    test('should successfully transcribe with fallback model', async () => {
      const mockAudioBuffer = Buffer.from('mock audio data');
      const mockTranscriptResult = {
        text: 'Hello world with fallback',
        confidence: 0.85,
        words: [],
        language: 'en',
        latency: 150
      };

      // Mock recovery with fallback
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: mockTranscriptResult,
        fallbackUsed: true,
        modelUsed: 'nova',
        attemptsUsed: 2
      });

      let fallbackEventEmitted = false;
      enhancedService.on(DeepgramEvent.FALLBACK_USED, (info) => {
        fallbackEventEmitted = true;
        expect(info.originalModel).toBe('nova-2');
        expect(info.fallbackModel).toBe('nova');
      });

      const result = await enhancedService.transcribeAudioWithRecovery(mockAudioBuffer);

      expect(result.text).toBe('Hello world with fallback');
      expect(result.fallbackUsed).toBe(true);
      expect(result.modelUsed).toBe('nova');
      expect(result.recoveryAttempts).toBe(2);
      expect(fallbackEventEmitted).toBe(true);
    });

    test('should throw error when all recovery attempts fail', async () => {
      const mockAudioBuffer = Buffer.from('mock audio data');

      // Mock failed recovery
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: false,
        error: new Error('All models failed'),
        fallbackUsed: true,
        modelUsed: 'nova-2',
        attemptsUsed: 3
      });

      await expect(
        enhancedService.transcribeAudioWithRecovery(mockAudioBuffer)
      ).rejects.toThrow('All models failed');
    });
  });

  describe('createTranscriptionStreamWithRecovery', () => {
    test('should create stream with original model when valid', async () => {
      const callId = 'test-call-123';

      // Mock successful model validation
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.validateModelAccess.mockResolvedValue(true);

      // Mock stream creation - access the service instance properly
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.createTranscriptionStream = jest.fn().mockResolvedValue('connection-123');

      const result = await enhancedService.createTranscriptionStreamWithRecovery(callId);

      expect(result.connectionId).toBe('connection-123');
      expect(result.modelUsed).toBe('nova-2');
      expect(result.fallbackUsed).toBe(false);
    });

    test('should create stream with fallback model when original fails validation', async () => {
      const callId = 'test-call-456';

      // Mock model validation - first fails, second succeeds
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.validateModelAccess
        .mockResolvedValueOnce(false) // nova-2 fails
        .mockResolvedValueOnce(true);  // nova succeeds

      // Mock stream creation
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.createTranscriptionStream = jest.fn().mockResolvedValue('connection-456');

      let fallbackEventEmitted = false;
      enhancedService.on(DeepgramEvent.FALLBACK_USED, (info) => {
        fallbackEventEmitted = true;
        expect(info.callId).toBe(callId);
        expect(info.originalModel).toBe('nova-2');
        expect(info.fallbackModel).toBe('nova');
      });

      const result = await enhancedService.createTranscriptionStreamWithRecovery(callId);

      expect(result.connectionId).toBe('connection-456');
      expect(result.modelUsed).toBe('nova');
      expect(result.fallbackUsed).toBe(true);
      expect(fallbackEventEmitted).toBe(true);
    });
  });

  describe('validateConfiguration', () => {
    test('should validate configuration successfully', async () => {
      // Mock successful API key validation
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockResolvedValue(true);

      // Mock successful model validation
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.validateModelAccess.mockResolvedValue(true);

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(true);
      expect(result.model).toBe('nova-2');
      expect(result.issues).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    test('should detect invalid API key', async () => {
      // Mock failed API key validation
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockResolvedValue(false);

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Invalid API key');
      expect(result.recommendations).toContain('Check your Deepgram API key configuration');
    });

    test('should detect invalid model and suggest alternatives', async () => {
      // Mock successful API key but failed model validation
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockResolvedValue(true);

      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.validateModelAccess.mockResolvedValue(false);
      deepgramRecoveryService.getRecommendedModel.mockReturnValue('nova');

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Model nova-2 is not accessible with current account');
      expect(result.recommendations).toContain('Consider using model: nova');
    });

    test('should handle validation errors gracefully', async () => {
      // Mock API key validation throwing error
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockRejectedValue(new Error('Network error'));

      // Mock error classification
      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: 'NETWORK_ERROR',
        suggestedAction: 'Check network connectivity'
      });

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(false);
      expect(result.issues[0]).toContain('Configuration validation failed');
      expect(result.recommendations).toContain('Check network connectivity');
    });
  });

  describe('getServiceStats', () => {
    test('should return service statistics', () => {
      // Mock active connections
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.getActiveConnectionIds = jest.fn().mockReturnValue(['conn1', 'conn2']);

      const stats = enhancedService.getServiceStats();

      expect(stats.activeConnections).toBe(2);
      expect(stats.errorClassificationEnabled).toBe(true);
      expect(stats.recoveryEnabled).toBe(true);
    });
  });

  describe('Advanced Recovery Scenarios', () => {
    test('should handle multiple consecutive failures with different error types', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      // Simulate multiple failure types before success
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: {
          text: 'Finally successful after multiple failures',
          confidence: 0.8,
          words: [],
          language: 'en',
          latency: 300,
          id: 'transcript-recovery',
          callId: 'call-recovery'
        },
        fallbackUsed: true,
        modelUsed: 'base',
        attemptsUsed: 4
      });

      const audioBuffer = Buffer.from('mock audio data');
      const result = await enhancedService.transcribeAudioWithRecovery(audioBuffer, {
        model: 'nova-2',
        maxFallbackAttempts: 5
      });

      expect(result.text).toBe('Finally successful after multiple failures');
      expect(result.fallbackUsed).toBe(true);
      expect(result.modelUsed).toBe('base');
      expect(result.recoveryAttempts).toBe(4);
    });

    test('should emit fallback events for monitoring', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: {
          text: 'Transcribed with fallback',
          confidence: 0.85,
          words: [],
          language: 'en',
          latency: 250,
          id: 'transcript-fallback',
          callId: 'call-fallback'
        },
        fallbackUsed: true,
        modelUsed: 'nova',
        attemptsUsed: 2
      });

      let fallbackEventData: any = null;
      enhancedService.on(DeepgramEvent.FALLBACK_USED, (data) => {
        fallbackEventData = data;
      });

      const audioBuffer = Buffer.from('mock audio data');
      await enhancedService.transcribeAudioWithRecovery(audioBuffer, {
        model: 'nova-2'
      });

      expect(fallbackEventData).not.toBeNull();
      expect(fallbackEventData.originalModel).toBe('nova-2');
      expect(fallbackEventData.fallbackModel).toBe('nova');
      expect(fallbackEventData.reason).toBe('Model compatibility or permission issue');
    });

    test('should handle stream creation with multiple validation failures', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      // Mock multiple model validation failures then success
      deepgramRecoveryService.validateModelAccess
        .mockResolvedValueOnce(false) // nova-2 fails
        .mockResolvedValueOnce(false) // nova fails
        .mockResolvedValueOnce(true);  // base succeeds

      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.createTranscriptionStream = jest.fn().mockResolvedValue('connection-fallback');

      let fallbackEventData: any = null;
      enhancedService.on(DeepgramEvent.FALLBACK_USED, (data) => {
        fallbackEventData = data;
      });

      const result = await enhancedService.createTranscriptionStreamWithRecovery('call-multi-fallback', {
        model: 'nova-2'
      });

      expect(result.connectionId).toBe('connection-fallback');
      expect(result.modelUsed).toBe('base');
      expect(result.fallbackUsed).toBe(true);
      expect(fallbackEventData).not.toBeNull();
      expect(fallbackEventData.callId).toBe('call-multi-fallback');
    });
  });

  describe('Error Handling Edge Cases', () => {
    test('should handle configuration validation with network errors', async () => {
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockRejectedValue(new Error('Network timeout'));

      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: 'NETWORK_ERROR',
        suggestedAction: 'Check network connectivity and retry'
      });

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(false);
      expect(result.issues[0]).toContain('Configuration validation failed');
      expect(result.recommendations).toContain('Check network connectivity and retry');
    });

    test('should handle partial service degradation gracefully', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      // Mock partial failure - some operations work, others don't
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: {
          text: 'Partial transcription with degraded quality',
          confidence: 0.6, // Lower confidence indicating degradation
          words: [],
          language: 'en',
          latency: 500, // Higher latency
          id: 'transcript-degraded',
          callId: 'call-degraded'
        },
        fallbackUsed: true,
        modelUsed: 'base',
        attemptsUsed: 3
      });

      const audioBuffer = Buffer.from('mock audio data');
      const result = await enhancedService.transcribeAudioWithRecovery(audioBuffer);

      expect(result.text).toBe('Partial transcription with degraded quality');
      expect(result.confidence).toBe(0.6);
      expect(result.fallbackUsed).toBe(true);
      expect(result.recoveryAttempts).toBe(3);
    });

    test('should handle service method delegation correctly', () => {
      const mockDeepgramService = enhancedService['deepgramService'];
      
      // Add missing mock methods
      mockDeepgramService.sendAudioToStream = jest.fn();
      mockDeepgramService.closeTranscriptionStream = jest.fn();
      mockDeepgramService.closeAllConnections = jest.fn();
      mockDeepgramService.updateApiKey = jest.fn();
      
      // Test method delegation
      enhancedService.sendAudioToStream('conn-123', Buffer.from('audio'));
      expect(mockDeepgramService.sendAudioToStream).toHaveBeenCalledWith('conn-123', expect.any(Buffer));

      enhancedService.closeTranscriptionStream('conn-123');
      expect(mockDeepgramService.closeTranscriptionStream).toHaveBeenCalledWith('conn-123');

      enhancedService.closeAllConnections();
      expect(mockDeepgramService.closeAllConnections).toHaveBeenCalled();

      enhancedService.updateApiKey('new-key');
      expect(mockDeepgramService.updateApiKey).toHaveBeenCalledWith('new-key');
    });
  });
});