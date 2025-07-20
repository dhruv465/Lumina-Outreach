/**
 * Unit tests for Deepgram Recovery Service
 * 
 * Tests recovery operations, model fallback, and integration with error handler
 */

import { DeepgramRecoveryService } from '../deepgramRecoveryService';
import { DeepgramErrorType } from '../../types/deepgram';

// Mock the error handler
jest.mock('../deepgramErrorHandler', () => ({
  deepgramErrorHandler: {
    executeRecovery: jest.fn(),
    classifyError: jest.fn()
  }
}));

describe('DeepgramRecoveryService', () => {
  let recoveryService: DeepgramRecoveryService;

  beforeEach(() => {
    recoveryService = new DeepgramRecoveryService();
    jest.clearAllMocks();
  });

  describe('executeWithRecovery', () => {
    test('should succeed on first attempt without fallback', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      // Mock the error handler to succeed on first try
      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.executeRecovery.mockResolvedValue('success');
      
      const result = await recoveryService.executeWithRecovery(
        mockOperation,
        'nova-2',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.fallbackUsed).toBe(false);
      expect(result.modelUsed).toBe('nova-2');
      expect(result.attemptsUsed).toBe(1);
    });

    test('should fallback to compatible model on permission error', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce({
          status: 403,
          message: 'Insufficient permissions for nova-2'
        })
        .mockResolvedValueOnce('success with fallback');

      // Mock the error handler
      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.executeRecovery
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce('success with fallback');
      
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: DeepgramErrorType.INSUFFICIENT_PERMISSIONS,
        isRecoverable: true,
        retryable: false
      });

      const result = await recoveryService.executeWithRecovery(
        mockOperation,
        'nova-2',
        'test-api-key'
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success with fallback');
      expect(result.fallbackUsed).toBe(true);
      expect(result.modelUsed).toBe('nova'); // First fallback for nova-2
      expect(result.attemptsUsed).toBe(2);
    });

    test('should try multiple fallback models', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValue(new Error('Model not available'));

      // Mock the error handler to always fail
      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.executeRecovery.mockRejectedValue(new Error('Model not available'));
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: DeepgramErrorType.INVALID_MODEL,
        isRecoverable: true,
        retryable: false
      });

      const result = await recoveryService.executeWithRecovery(
        mockOperation,
        'nova-2',
        'test-api-key',
        { maxFallbackAttempts: 2 }
      );

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.attemptsUsed).toBeGreaterThan(1);
    });

    test('should respect maxFallbackAttempts option', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Always fails'));

      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.executeRecovery.mockRejectedValue(new Error('Always fails'));
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: DeepgramErrorType.NETWORK_ERROR,
        isRecoverable: true,
        retryable: true
      });

      const result = await recoveryService.executeWithRecovery(
        mockOperation,
        'nova-2',
        'test-api-key',
        { maxFallbackAttempts: 1 }
      );

      expect(result.success).toBe(false);
      expect(result.attemptsUsed).toBeLessThanOrEqual(2); // Initial + 1 fallback
    });
  });

  describe('validateModelAccess', () => {
    test('should validate model access successfully', async () => {
      const mockTestOperation = jest.fn().mockResolvedValue('test success');

      const isValid = await recoveryService.validateModelAccess(
        'nova',
        'test-api-key',
        mockTestOperation
      );

      expect(isValid).toBe(true);
      expect(mockTestOperation).toHaveBeenCalledWith('nova');
    });

    test('should return false for permission errors', async () => {
      const mockTestOperation = jest.fn().mockRejectedValue({
        status: 403,
        message: 'Insufficient permissions'
      });

      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: DeepgramErrorType.INSUFFICIENT_PERMISSIONS
      });

      const isValid = await recoveryService.validateModelAccess(
        'nova-2',
        'test-api-key',
        mockTestOperation
      );

      expect(isValid).toBe(false);
    });

    test('should return true for network errors (temporary)', async () => {
      const mockTestOperation = jest.fn().mockRejectedValue({
        code: 'ECONNRESET',
        message: 'Connection reset'
      });

      const { deepgramErrorHandler } = require('../deepgramErrorHandler');
      deepgramErrorHandler.classifyError.mockReturnValue({
        errorType: DeepgramErrorType.NETWORK_ERROR
      });

      const isValid = await recoveryService.validateModelAccess(
        'nova',
        'test-api-key',
        mockTestOperation
      );

      expect(isValid).toBe(true); // Network errors are considered temporary
    });

    test('should validate against model registry when no test operation provided', async () => {
      const isValid = await recoveryService.validateModelAccess('nova', 'test-api-key');
      expect(isValid).toBe(true); // nova exists in registry

      const isInvalid = await recoveryService.validateModelAccess('nonexistent-model', 'test-api-key');
      expect(isInvalid).toBe(false); // nonexistent-model not in registry
    });
  });

  describe('getRecommendedModel', () => {
    test('should recommend highest tier model for general use case', () => {
      const availableModels = ['base', 'nova', 'nova-2'];
      
      const recommended = recoveryService.getRecommendedModel(
        availableModels,
        'general'
      );

      expect(recommended).toBe('nova-2'); // Highest tier
    });

    test('should recommend model suitable for specific use case', () => {
      const availableModels = ['base', 'nova-meeting', 'nova-phonecall'];
      
      const recommended = recoveryService.getRecommendedModel(
        availableModels,
        'meeting'
      );

      expect(recommended).toBe('nova-meeting'); // Specific to meeting use case
    });

    test('should prefer realtime-capable models when requested', () => {
      const availableModels = ['base', 'nova', 'nova-2-conversationalai'];
      
      const recommended = recoveryService.getRecommendedModel(
        availableModels,
        'conversational',
        true // prefer realtime
      );

      expect(recommended).toBe('nova-2-conversationalai'); // Has realtime capability
    });

    test('should fallback to base model when no suitable models found', () => {
      const availableModels = ['unknown-model'];
      
      const recommended = recoveryService.getRecommendedModel(
        availableModels,
        'general'
      );

      expect(recommended).toBe('base'); // Fallback
    });
  });

  describe('createRecoveryContext', () => {
    test('should create recovery context with correct properties', () => {
      const context = recoveryService.createRecoveryContext(
        'nova-2',
        'test-api-key',
        'premium'
      );

      expect(context.currentModel).toBe('nova-2');
      expect(context.apiKey).toBe('test-api-key');
      expect(context.accountTier).toBe('premium');
      expect(context.attemptNumber).toBe(0);
      expect(context.previousErrors).toEqual([]);
    });
  });
});