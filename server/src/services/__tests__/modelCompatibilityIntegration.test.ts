/**
 * Integration tests for Model Compatibility System
 * 
 * Tests the complete workflow of model validation, fallback, and error recovery
 * across different Deepgram account tiers and error scenarios.
 * 
 * Requirements: 1.1, 1.2, 2.4, 3.1
 */

import { ModelCompatibilityService, AccountTier } from '../modelCompatibilityService';
import { DeepgramServiceWithRecovery } from '../deepgramServiceWithRecovery';
import { DeepgramErrorHandler } from '../deepgramErrorHandler';
import { DeepgramErrorType } from '../../types/deepgram';
import { createClient } from '@deepgram/sdk';

// Mock the Deepgram SDK
jest.mock('@deepgram/sdk');
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  getErrorMessage: jest.fn((error) => error.message || 'Unknown error')
}));

// Mock alert system
jest.mock('../../monitoring/alert_system', () => ({
  alertSystem: {
    createAlert: jest.fn()
  },
  AlertLevel: {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical'
  },
  AlertType: {}
}));

// Mock the underlying DeepgramService
jest.mock('../deepgramService', () => ({
  DeepgramService: jest.fn().mockImplementation(() => ({
    transcribeAudio: jest.fn(),
    createTranscriptionStream: jest.fn(),
    validateApiKey: jest.fn(),
    getActiveConnectionIds: jest.fn().mockReturnValue([]),
    on: jest.fn(),
    emit: jest.fn(),
    sendAudioToStream: jest.fn(),
    closeTranscriptionStream: jest.fn(),
    closeAllConnections: jest.fn(),
    updateApiKey: jest.fn()
  })),
  DeepgramEvent: {
    TRANSCRIPT_RECEIVED: 'transcript-received',
    TRANSCRIPT_FINAL: 'transcript-final',
    ERROR: 'error',
    CONNECTION_STATUS: 'connection-status',
    FALLBACK_USED: 'fallback-used'
  }
}));

// Mock recovery service
jest.mock('../deepgramRecoveryService', () => ({
  deepgramRecoveryService: {
    executeWithRecovery: jest.fn(),
    validateModelAccess: jest.fn(),
    getRecommendedModel: jest.fn()
  }
}));

describe('Model Compatibility Integration Tests', () => {
  let mockClient: any;
  let modelCompatibilityService: ModelCompatibilityService;
  let enhancedService: DeepgramServiceWithRecovery;
  let errorHandler: DeepgramErrorHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock client
    mockClient = {
      listen: {
        prerecorded: {
          transcribeUrl: jest.fn()
        }
      }
    };
    
    mockCreateClient.mockReturnValue(mockClient);
    
    // Initialize services
    modelCompatibilityService = new ModelCompatibilityService('test-api-key');
    enhancedService = new DeepgramServiceWithRecovery('test-api-key');
    errorHandler = new DeepgramErrorHandler();
  });

  describe('Free Account Tier Scenarios', () => {
    test('should handle free account with nova-2 permission error and fallback to base', async () => {
      // Mock permission error for premium model
      const permissionError = new Error('Insufficient permissions for model nova-2');
      (permissionError as any).status = 403;
      
      // Mock successful validation for base model
      mockClient.listen.prerecorded.transcribeUrl
        .mockRejectedValueOnce(permissionError) // nova-2 fails
        .mockRejectedValueOnce(permissionError) // nova-2-general fails
        .mockRejectedValueOnce(permissionError) // nova-2-meeting fails
        .mockRejectedValueOnce(permissionError) // nova-2-phonecall fails
        .mockRejectedValueOnce(permissionError) // nova fails
        .mockRejectedValueOnce(permissionError) // nova-general fails
        .mockResolvedValueOnce({ // base succeeds
          result: { results: { channels: [{ alternatives: [{ transcript: 'test', confidence: 0.8 }] }] } }
        })
        .mockResolvedValueOnce({ // base-general succeeds
          result: { results: { channels: [{ alternatives: [{ transcript: 'test', confidence: 0.8 }] }] } }
        });

      // Test model validation
      const validationResult = await modelCompatibilityService.validateModelAccess('test-key', 'nova-2');
      expect(validationResult.isValid).toBe(false);
      expect(validationResult.tier).toBe('premium');
      expect(validationResult.suggestedAlternatives).toContain('base');

      // Test account capabilities detection
      const capabilities = await modelCompatibilityService.getAccountCapabilities('test-key');
      expect(capabilities.tier).toBe('free');
      expect(capabilities.availableModels).toContain('base');
      expect(capabilities.availableModels).not.toContain('nova-2');
      expect(capabilities.limits.hoursPerMonth).toBe(12);

      // Test model fallback
      const fallbackModel = modelCompatibilityService.handleModelFallback('nova-2', permissionError);
      expect(fallbackModel).toBe('nova');
    });

    test('should successfully transcribe with fallback model on free account', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      // Mock recovery service to simulate fallback success
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: {
          text: 'Hello world from base model',
          confidence: 0.85,
          words: [],
          language: 'en',
          latency: 200,
          id: 'transcript-123',
          callId: 'call-456'
        },
        fallbackUsed: true,
        modelUsed: 'base',
        attemptsUsed: 2
      });

      const audioBuffer = Buffer.from('mock audio data');
      const result = await enhancedService.transcribeAudioWithRecovery(audioBuffer, {
        model: 'nova-2'
      });

      expect(result.text).toBe('Hello world from base model');
      expect(result.fallbackUsed).toBe(true);
      expect(result.modelUsed).toBe('base');
      expect(result.recoveryAttempts).toBe(2);
    });
  });

  describe('Basic Account Tier Scenarios', () => {
    test('should handle basic account with access to nova models but not nova-2', async () => {
      // Mock permission error for premium models, success for basic models
      const permissionError = new Error('Insufficient permissions for model nova-2');
      (permissionError as any).status = 403;
      
      mockClient.listen.prerecorded.transcribeUrl
        .mockRejectedValueOnce(permissionError) // nova-2 fails
        .mockRejectedValueOnce(permissionError) // nova-2-general fails
        .mockRejectedValueOnce(permissionError) // nova-2-meeting fails
        .mockRejectedValueOnce(permissionError) // nova-2-phonecall fails
        .mockResolvedValueOnce({ // nova succeeds
          result: { results: { channels: [{ alternatives: [{ transcript: 'test', confidence: 0.9 }] }] } }
        });

      const capabilities = await modelCompatibilityService.getAccountCapabilities('test-key');
      
      expect(capabilities.tier).toBe('basic');
      expect(capabilities.availableModels).toContain('nova');
      expect(capabilities.availableModels).not.toContain('nova-2');
      expect(capabilities.features.realtime).toBe(true); // Nova supports realtime
      expect(capabilities.limits.requestsPerMinute).toBe(100);
    });

    test('should select optimal model for basic account preferences', () => {
      const availableModels = ['nova', 'nova-general', 'base', 'base-general'];
      const preferences = {
        preferredModels: ['nova-2', 'nova'],
        useCase: 'general' as const,
        language: 'en',
        realtime: false
      };

      const selectedModel = modelCompatibilityService.selectBestModel(availableModels, preferences);
      expect(selectedModel).toBe('nova'); // Best available from preferences
    });
  });

  describe('Premium Account Tier Scenarios', () => {
    test('should handle premium account with full model access', async () => {
      // Mock success for all models
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test', confidence: 0.95 }] }] } }
      });

      const capabilities = await modelCompatibilityService.getAccountCapabilities('test-key');
      
      expect(capabilities.tier).toBe('premium');
      expect(capabilities.availableModels).toContain('nova-2');
      expect(capabilities.availableModels).toContain('nova');
      expect(capabilities.availableModels).toContain('base');
      expect(capabilities.features.realtime).toBe(true);
      expect(capabilities.limits.requestsPerMinute).toBe(1000);
    });

    test('should use preferred premium model without fallback', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: true,
        result: {
          text: 'High quality transcription from nova-2',
          confidence: 0.95,
          words: [],
          language: 'en',
          latency: 150,
          id: 'transcript-789',
          callId: 'call-101'
        },
        fallbackUsed: false,
        modelUsed: 'nova-2',
        attemptsUsed: 1
      });

      const audioBuffer = Buffer.from('mock audio data');
      const result = await enhancedService.transcribeAudioWithRecovery(audioBuffer, {
        model: 'nova-2'
      });

      expect(result.text).toBe('High quality transcription from nova-2');
      expect(result.fallbackUsed).toBe(false);
      expect(result.modelUsed).toBe('nova-2');
      expect(result.recoveryAttempts).toBe(1);
    });
  });

  describe('Error Recovery Scenarios', () => {
    test('should handle network errors with retry logic', async () => {
      const networkError = new Error('Connection timeout');
      (networkError as any).code = 'ETIMEDOUT';

      const classification = errorHandler.classifyError(networkError);
      expect(classification.errorType).toBe(DeepgramErrorType.NETWORK_ERROR);
      expect(classification.retryable).toBe(true);

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(DeepgramErrorType.NETWORK_ERROR, context);
      expect(strategy.type).toBe('retry');
      expect(strategy.maxAttempts).toBe(3);
    });

    test('should handle quota exceeded errors with appropriate delay', async () => {
      const quotaError = new Error('Rate limit exceeded');
      (quotaError as any).status = 429;

      const classification = errorHandler.classifyError(quotaError);
      expect(classification.errorType).toBe(DeepgramErrorType.QUOTA_EXCEEDED);

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(DeepgramErrorType.QUOTA_EXCEEDED, context);
      expect(strategy.type).toBe('retry');
      expect(strategy.parameters.delayMs).toBe(60000); // 1 minute delay
    });

    test('should handle authentication errors as non-recoverable', async () => {
      const authError = new Error('Invalid API key');
      (authError as any).status = 401;

      const classification = errorHandler.classifyError(authError);
      expect(classification.errorType).toBe(DeepgramErrorType.AUTHENTICATION_ERROR);
      expect(classification.isRecoverable).toBe(false);
      expect(classification.retryable).toBe(false);

      const context = {
        currentModel: 'nova',
        apiKey: 'invalid-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(DeepgramErrorType.AUTHENTICATION_ERROR, context);
      expect(strategy.type).toBe('fail');
      expect(strategy.maxAttempts).toBe(0);
    });
  });

  describe('Stream Creation with Model Validation', () => {
    test('should create stream with validated model', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      // Mock successful model validation
      deepgramRecoveryService.validateModelAccess.mockResolvedValue(true);
      
      // Mock stream creation
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.createTranscriptionStream = jest.fn().mockResolvedValue('connection-123');

      const result = await enhancedService.createTranscriptionStreamWithRecovery('call-456', {
        model: 'nova-2'
      });

      expect(result.connectionId).toBe('connection-123');
      expect(result.modelUsed).toBe('nova-2');
      expect(result.fallbackUsed).toBe(false);
    });

    test('should create stream with fallback model when validation fails', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      // Mock model validation failure then success
      deepgramRecoveryService.validateModelAccess
        .mockResolvedValueOnce(false) // nova-2 fails
        .mockResolvedValueOnce(true);  // nova succeeds
      
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.createTranscriptionStream = jest.fn().mockResolvedValue('connection-456');

      const result = await enhancedService.createTranscriptionStreamWithRecovery('call-789', {
        model: 'nova-2'
      });

      expect(result.connectionId).toBe('connection-456');
      expect(result.modelUsed).toBe('nova');
      expect(result.fallbackUsed).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    test('should validate complete configuration successfully', async () => {
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockResolvedValue(true);

      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      deepgramRecoveryService.validateModelAccess.mockResolvedValue(true);

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(true);
      expect(result.model).toBe('nova-2');
      expect(result.issues).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    test('should detect and report configuration issues', async () => {
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.validateApiKey = jest.fn().mockResolvedValue(false);

      const result = await enhancedService.validateConfiguration('nova-2');

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Invalid API key');
      expect(result.recommendations).toContain('Check your Deepgram API key configuration');
    });

    test('should suggest model alternatives for incompatible models', async () => {
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
  });

  describe('Performance and Caching', () => {
    test('should cache model validation results for performance', async () => {
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // First validation
      await modelCompatibilityService.validateModelAccess('test-key', 'nova-2');
      
      // Second validation should use cache
      await modelCompatibilityService.validateModelAccess('test-key', 'nova-2');

      // API should only be called once due to caching
      expect(mockClient.listen.prerecorded.transcribeUrl).toHaveBeenCalledTimes(1);
    });

    test('should clear cache when API key changes', async () => {
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // First validation
      await modelCompatibilityService.validateModelAccess('test-key', 'nova-2');
      
      // Update API key (should clear cache)
      modelCompatibilityService.updateApiKey('new-key');
      
      // Second validation should not use cache
      await modelCompatibilityService.validateModelAccess('new-key', 'nova-2');

      expect(mockClient.listen.prerecorded.transcribeUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    test('should handle complete service failure gracefully', async () => {
      const { deepgramRecoveryService } = require('../deepgramRecoveryService');
      
      deepgramRecoveryService.executeWithRecovery.mockResolvedValue({
        success: false,
        error: new Error('All recovery attempts failed'),
        fallbackUsed: true,
        modelUsed: 'nova-2',
        attemptsUsed: 3
      });

      const audioBuffer = Buffer.from('mock audio data');
      
      await expect(
        enhancedService.transcribeAudioWithRecovery(audioBuffer)
      ).rejects.toThrow('All recovery attempts failed');
    });

    test('should handle malformed API responses', async () => {
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        // Malformed response missing expected structure
        invalid: 'response'
      });

      const result = await modelCompatibilityService.validateModelAccess('test-key', 'nova-2');
      
      // Should still complete validation (service handles malformed responses)
      expect(result.isValid).toBe(true);
      expect(result.model).toBe('nova-2');
    });

    test('should handle concurrent validation requests', async () => {
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // Make multiple concurrent validation requests
      const promises = [
        modelCompatibilityService.validateModelAccess('test-key', 'nova-2'),
        modelCompatibilityService.validateModelAccess('test-key', 'nova'),
        modelCompatibilityService.validateModelAccess('test-key', 'base')
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('Service Statistics and Monitoring', () => {
    test('should provide accurate service statistics', () => {
      const mockDeepgramService = enhancedService['deepgramService'];
      mockDeepgramService.getActiveConnectionIds = jest.fn().mockReturnValue(['conn1', 'conn2', 'conn3']);

      const stats = enhancedService.getServiceStats();

      expect(stats.activeConnections).toBe(3);
      expect(stats.errorClassificationEnabled).toBe(true);
      expect(stats.recoveryEnabled).toBe(true);
    });

    test('should track model registry access', () => {
      const registry = modelCompatibilityService.getModelRegistry();

      expect(registry.models).toHaveProperty('nova-2');
      expect(registry.models).toHaveProperty('nova');
      expect(registry.models).toHaveProperty('base');
      
      // Verify model information structure
      expect(registry.models['nova-2'].tier).toBe('premium');
      expect(registry.models['nova'].tier).toBe('basic');
      expect(registry.models['base'].tier).toBe('free');
    });
  });
});