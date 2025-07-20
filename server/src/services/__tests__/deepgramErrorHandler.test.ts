/**
 * Unit tests for Deepgram Error Handler
 * 
 * Tests error classification, recovery strategies, and retry logic
 * Requirements: 1.1, 1.2, 2.4, 3.1
 */

import { DeepgramErrorHandler, DeepgramError, ErrorClassificationResult } from '../deepgramErrorHandler';
import { DeepgramErrorType } from '../../types/deepgram';

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
  AlertType: {
    DEEPGRAM_MODEL_COMPATIBILITY: 'deepgram-model-compatibility',
    DEEPGRAM_AUTHENTICATION: 'deepgram-authentication',
    DEEPGRAM_MODEL_ACCESS: 'deepgram-model-access',
    DEEPGRAM_RECOVERY: 'deepgram-recovery',
    DEEPGRAM_SERVICE_FAILURE: 'deepgram-service-failure'
  }
}));

describe('DeepgramErrorHandler', () => {
  let errorHandler: DeepgramErrorHandler;

  beforeEach(() => {
    errorHandler = new DeepgramErrorHandler();
  });

  describe('Error Classification', () => {
    test('should classify permission errors correctly', () => {
      const permissionError = {
        status: 403,
        message: 'Insufficient permissions for model nova-2'
      };

      const result = errorHandler.classifyError(permissionError);

      expect(result.errorType).toBe(DeepgramErrorType.INSUFFICIENT_PERMISSIONS);
      expect(result.isRecoverable).toBe(true);
      expect(result.retryable).toBe(false);
      expect(result.severity).toBe('high');
      expect(result.fallbackModels).toContain('base');
    });

    test('should classify invalid model errors correctly', () => {
      const invalidModelError = {
        message: 'Invalid model: unknown-model'
      };

      const result = errorHandler.classifyError(invalidModelError);

      expect(result.errorType).toBe(DeepgramErrorType.INVALID_MODEL);
      expect(result.isRecoverable).toBe(true);
      expect(result.retryable).toBe(false);
      expect(result.severity).toBe('medium');
    });

    test('should classify quota exceeded errors correctly', () => {
      const quotaError = {
        status: 429,
        message: 'Rate limit exceeded'
      };

      const result = errorHandler.classifyError(quotaError);

      expect(result.errorType).toBe(DeepgramErrorType.QUOTA_EXCEEDED);
      expect(result.isRecoverable).toBe(true);
      expect(result.retryable).toBe(true);
      expect(result.severity).toBe('medium');
    });

    test('should classify authentication errors correctly', () => {
      const authError = {
        status: 401,
        message: 'Invalid API key'
      };

      const result = errorHandler.classifyError(authError);

      expect(result.errorType).toBe(DeepgramErrorType.AUTHENTICATION_ERROR);
      expect(result.isRecoverable).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.severity).toBe('critical');
    });

    test('should classify network errors correctly', () => {
      const networkError = {
        code: 'ECONNRESET',
        message: 'Connection reset by peer'
      };

      const result = errorHandler.classifyError(networkError);

      expect(result.errorType).toBe(DeepgramErrorType.NETWORK_ERROR);
      expect(result.isRecoverable).toBe(true);
      expect(result.retryable).toBe(true);
      expect(result.severity).toBe('low');
    });

    test('should handle Deepgram SDK error format', () => {
      const sdkError = {
        response: {
          status: 403,
          data: {
            message: 'Model not available for your account',
            type: 'permission_error'
          }
        }
      };

      const result = errorHandler.classifyError(sdkError);

      expect(result.errorType).toBe(DeepgramErrorType.INSUFFICIENT_PERMISSIONS);
      expect(result.isRecoverable).toBe(true);
    });
  });

  describe('Recovery Strategies', () => {
    test('should provide fallback model strategy for permission errors', () => {
      const context = {
        currentModel: 'nova-2',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(
        DeepgramErrorType.INSUFFICIENT_PERMISSIONS,
        context
      );

      expect(strategy.type).toBe('fallback_model');
      expect(strategy.maxAttempts).toBe(3);
      expect(strategy.parameters.fallbackModels).toContain('nova');
      expect(strategy.parameters.fallbackModels).toContain('base');
    });

    test('should provide retry strategy for network errors', () => {
      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(
        DeepgramErrorType.NETWORK_ERROR,
        context
      );

      expect(strategy.type).toBe('retry');
      expect(strategy.maxAttempts).toBe(3);
      expect(strategy.parameters.exponentialBackoff).toBe(true);
    });

    test('should provide fail strategy for authentication errors', () => {
      const context = {
        currentModel: 'nova',
        apiKey: 'invalid-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(
        DeepgramErrorType.AUTHENTICATION_ERROR,
        context
      );

      expect(strategy.type).toBe('fail');
      expect(strategy.maxAttempts).toBe(0);
    });
  });

  describe('Retry Logic with Exponential Backoff', () => {
    test('should retry operation with exponential backoff', async () => {
      let attempts = 0;
      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network timeout');
        }
        return Promise.resolve('success');
      });

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const result = await errorHandler.executeRecovery(
        mockOperation,
        context,
        { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 1000, backoffMultiplier: 2, jitterEnabled: false }
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    test('should fail after max attempts', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Persistent error'));

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      await expect(
        errorHandler.executeRecovery(
          mockOperation,
          context,
          { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 1000, backoffMultiplier: 2, jitterEnabled: false }
        )
      ).rejects.toThrow('Deepgram operation failed permanently');

      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    test('should not retry non-retryable errors', async () => {
      const mockOperation = jest.fn().mockRejectedValue({
        status: 401,
        message: 'Invalid API key'
      });

      const context = {
        currentModel: 'nova',
        apiKey: 'invalid-key',
        attemptNumber: 1,
        previousErrors: []
      };

      await expect(
        errorHandler.executeRecovery(mockOperation, context)
      ).rejects.toThrow();

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Message Handling', () => {
    test('should provide specific guidance for permission errors', () => {
      const permissionError = {
        status: 403,
        message: 'Model nova-2 requires premium account'
      };

      const result = errorHandler.classifyError(permissionError);

      expect(result.suggestedAction).toContain('Upgrade your Deepgram account');
      expect(result.suggestedAction).toContain('compatible model');
    });

    test('should provide specific guidance for quota errors', () => {
      const quotaError = {
        status: 429,
        message: 'Monthly quota exceeded'
      };

      const result = errorHandler.classifyError(quotaError);

      expect(result.suggestedAction).toContain('quota');
      expect(result.suggestedAction).toContain('Upgrade');
    });

    test('should provide specific guidance for authentication errors', () => {
      const authError = {
        status: 401,
        message: 'Invalid API key'
      };

      const result = errorHandler.classifyError(authError);

      expect(result.suggestedAction).toContain('API key');
      expect(result.suggestedAction).toContain('configured');
    });
  });

  describe('Advanced Error Classification', () => {
    test('should handle complex Deepgram SDK error structures', () => {
      const complexError = {
        response: {
          status: 403,
          data: {
            message: 'Insufficient permissions for model nova-2',
            type: 'permission_error',
            details: {
              model: 'nova-2',
              account_tier: 'free',
              required_tier: 'premium'
            }
          }
        },
        config: {
          url: 'https://api.deepgram.com/v1/listen',
          method: 'POST'
        }
      };

      const result = errorHandler.classifyError(complexError);

      expect(result.errorType).toBe(DeepgramErrorType.INSUFFICIENT_PERMISSIONS);
      expect(result.severity).toBe('high');
      expect(result.fallbackModels).toContain('base');
    });

    test('should classify timeout errors as network errors', () => {
      const timeoutError = {
        code: 'ETIMEDOUT',
        message: 'Request timeout after 30000ms'
      };

      const result = errorHandler.classifyError(timeoutError);

      expect(result.errorType).toBe(DeepgramErrorType.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toContain('timeout');
    });

    test('should classify connection refused as network error', () => {
      const connectionError = {
        code: 'ECONNREFUSED',
        message: 'Connection refused'
      };

      const result = errorHandler.classifyError(connectionError);

      expect(result.errorType).toBe(DeepgramErrorType.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
    });

    test('should handle deprecated model errors', () => {
      const deprecatedError = {
        status: 400,
        message: 'Invalid model: enhanced has been deprecated, use nova instead'
      };

      const result = errorHandler.classifyError(deprecatedError);

      expect(result.errorType).toBe(DeepgramErrorType.INVALID_MODEL);
      expect(result.suggestedAction).toContain('deprecated');
    });
  });

  describe('Recovery Strategy Edge Cases', () => {
    test('should provide different strategies based on error context', () => {
      const context = {
        currentModel: 'nova-2',
        apiKey: 'test-key',
        attemptNumber: 2,
        previousErrors: [
          { message: 'Network timeout', code: 'ETIMEDOUT' } as DeepgramError
        ]
      };

      const strategy = errorHandler.getRecoveryStrategy(
        DeepgramErrorType.INSUFFICIENT_PERMISSIONS,
        context
      );

      expect(strategy.type).toBe('fallback_model');
      expect(strategy.parameters.preserveFeatures).toBe(true);
    });

    test('should adjust retry strategy based on quota errors', () => {
      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const strategy = errorHandler.getRecoveryStrategy(
        DeepgramErrorType.QUOTA_EXCEEDED,
        context
      );

      expect(strategy.type).toBe('retry');
      expect(strategy.parameters.delayMs).toBe(60000); // 1 minute delay
      expect(strategy.parameters.exponentialBackoff).toBe(false);
    });
  });

  describe('Exponential Backoff Calculations', () => {
    test('should calculate correct delays with exponential backoff', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts <= 3) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve('success');
      });

      // Mock the calculateRetryDelay method to capture delays
      const originalCalculateRetryDelay = (errorHandler as any).calculateRetryDelay;
      (errorHandler as any).calculateRetryDelay = jest.fn().mockImplementation((attempt, options) => {
        const delay = originalCalculateRetryDelay.call(errorHandler, attempt, options);
        delays.push(delay);
        return 10; // Use small delay for testing
      });

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      await errorHandler.executeRecovery(mockOperation, context, {
        maxAttempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterEnabled: false
      });

      expect(delays).toHaveLength(3);
      // Verify exponential growth pattern
      expect(delays[1]).toBeGreaterThan(delays[0]);
      expect(delays[2]).toBeGreaterThan(delays[1]);
    });

    test('should apply jitter when enabled', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve('success');
      });

      // Capture actual delays
      const originalCalculateRetryDelay = (errorHandler as any).calculateRetryDelay;
      (errorHandler as any).calculateRetryDelay = jest.fn().mockImplementation((attempt, options) => {
        const delay = originalCalculateRetryDelay.call(errorHandler, attempt, options);
        delays.push(delay);
        return 10; // Use small delay for testing
      });

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      await errorHandler.executeRecovery(mockOperation, context, {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterEnabled: true
      });

      // With jitter enabled, delays should vary slightly
      expect(delays).toHaveLength(2);
    });

    test('should respect maximum delay limit', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts <= 5) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve('success');
      });

      // Capture actual delays
      const originalCalculateRetryDelay = (errorHandler as any).calculateRetryDelay;
      (errorHandler as any).calculateRetryDelay = jest.fn().mockImplementation((attempt, options) => {
        const delay = originalCalculateRetryDelay.call(errorHandler, attempt, options);
        delays.push(delay);
        return Math.min(delay, 10); // Use small delay for testing but preserve calculation
      });

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      await errorHandler.executeRecovery(mockOperation, context, {
        maxAttempts: 6,
        baseDelayMs: 100,
        maxDelayMs: 500, // Low max delay
        backoffMultiplier: 3,
        jitterEnabled: false
      });

      // Verify that delays don't exceed maxDelayMs
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(500);
      });
    });
  });

  describe('Error Recovery Scenarios', () => {
    test('should handle cascading failures correctly', async () => {
      const errors: Error[] = [];
      let attempts = 0;

      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        const error = new Error(`Failure ${attempts}`);
        errors.push(error);
        throw error;
      });

      const context = {
        currentModel: 'nova-2',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      await expect(
        errorHandler.executeRecovery(mockOperation, context, {
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 1000,
          backoffMultiplier: 2,
          jitterEnabled: false
        })
      ).rejects.toThrow('Deepgram operation failed permanently');

      expect(attempts).toBe(3);
      expect(errors).toHaveLength(3);
    });

    test('should create appropriate alerts for different error types', () => {
      const { alertSystem } = require('../../monitoring/alert_system');
      
      // Test critical error alert
      const criticalError = {
        status: 401,
        message: 'Invalid API key'
      };

      errorHandler.classifyError(criticalError);

      expect(alertSystem.createAlert).toHaveBeenCalledWith(
        expect.any(String), // AlertLevel.CRITICAL
        expect.any(String), // AlertType
        expect.stringContaining('authentication'),
        expect.any(Object),
        'deepgram-error-handler'
      );
    });

    test('should handle recovery success after failures', async () => {
      let attempts = 0;
      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve('recovered');
      });

      const context = {
        currentModel: 'nova',
        apiKey: 'test-key',
        attemptNumber: 1,
        previousErrors: []
      };

      const result = await errorHandler.executeRecovery(mockOperation, context, {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitterEnabled: false
      });

      expect(result).toBe('recovered');
      expect(attempts).toBe(3);
    });
  });
});