/**
 * Unit tests for Deepgram TTS Verification
 * 
 * Tests API key verification, error handling, and status updates
 */

import { 
  verifyDeepgramTTSApi, 
  updateDeepgramTTSStatus,
  verifyAndUpdateDeepgramTTSApiStatus 
} from '../../utils/deepgramTTSVerification';
import Configuration from '../../models/Configuration';

// Mock external dependencies
jest.mock('@deepgram/sdk');
jest.mock('../../models/Configuration');
jest.mock('../../utils/logger');

// Mock Deepgram SDK
const mockCreateClient = jest.fn();
const mockClient = {
  speak: {
    request: jest.fn()
  }
};

jest.mock('@deepgram/sdk', () => ({
  createClient: () => mockClient
}));

// Mock Configuration model
const mockConfiguration = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
};
(Configuration as any) = mockConfiguration;

describe('Deepgram TTS Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('verifyDeepgramTTSApi', () => {
    test('should fail verification for empty API key', async () => {
      const result = await verifyDeepgramTTSApi('');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'API key is empty',
        message: 'Please provide a valid Deepgram API key'
      });
    });

    test('should fail verification for whitespace-only API key', async () => {
      const result = await verifyDeepgramTTSApi('   ');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'API key is empty'
      });
    });

    test('should succeed with valid API key and successful synthesis', async () => {
      // Mock successful synthesis response
      const mockStream = {
        getReader: () => ({
          read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5, 6]) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: jest.fn()
        })
      };

      const mockResponse = {
        getStream: jest.fn().mockResolvedValue(mockStream)
      };

      mockClient.speak.request.mockResolvedValue(mockResponse);

      const result = await verifyDeepgramTTSApi('valid-api-key');
      
      expect(result).toMatchObject({
        success: true,
        status: 'verified',
        availableModels: expect.arrayContaining([
          'aura-asteria-en',
          'aura-zeus-en'
        ])
      });

      expect(result.latency).toBeGreaterThan(0);
      expect(result.message).toContain('Deepgram TTS API verified successfully');
    });

    test('should handle authentication errors correctly', async () => {
      const authError = {
        response: {
          status: 401,
          data: { message: 'Invalid API key' }
        }
      };

      mockClient.speak.request.mockRejectedValue(authError);

      const result = await verifyDeepgramTTSApi('invalid-api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Authentication failed. Invalid API key.',
        errorCode: 'HTTP_401'
      });
    });

    test('should handle rate limiting errors', async () => {
      const rateLimitError = {
        response: {
          status: 429,
          data: { message: 'Rate limit exceeded' }
        }
      };

      mockClient.speak.request.mockRejectedValue(rateLimitError);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Rate limit exceeded. Too many requests.',
        errorCode: 'HTTP_429'
      });
    });

    test('should handle forbidden access errors', async () => {
      const forbiddenError = {
        response: {
          status: 403,
          data: { message: 'Access forbidden' }
        }
      };

      mockClient.speak.request.mockRejectedValue(forbiddenError);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Access forbidden. Your account may have insufficient permissions.',
        errorCode: 'HTTP_403'
      });
    });

    test('should handle bad request errors', async () => {
      const badRequestError = {
        response: {
          status: 400,
          data: { message: 'Bad request parameters' }
        }
      };

      mockClient.speak.request.mockRejectedValue(badRequestError);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Bad request. Check your API configuration.',
        errorCode: 'HTTP_400'
      });
    });

    test('should handle empty audio response', async () => {
      // Mock empty stream
      const mockStream = {
        getReader: () => ({
          read: jest.fn().mockResolvedValue({ done: true }),
          releaseLock: jest.fn()
        })
      };

      const mockResponse = {
        getStream: jest.fn().mockResolvedValue(mockStream)
      };

      mockClient.speak.request.mockResolvedValue(mockResponse);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Empty audio response',
        message: 'Deepgram TTS API returned empty audio data'
      });
    });

    test('should handle null stream response', async () => {
      const mockResponse = {
        getStream: jest.fn().mockResolvedValue(null)
      };

      mockClient.speak.request.mockResolvedValue(mockResponse);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'No audio stream returned',
        message: 'Deepgram TTS API did not return audio data'
      });
    });

    test('should handle network errors', async () => {
      const networkError = new Error('Network connection failed');
      networkError.name = 'NetworkError';

      mockClient.speak.request.mockRejectedValue(networkError);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Network connection failed',
        errorCode: 'NetworkError'
      });
    });

    test('should measure latency correctly', async () => {
      const mockStream = {
        getReader: () => ({
          read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: jest.fn()
        })
      };

      const mockResponse = {
        getStream: jest.fn().mockResolvedValue(mockStream)
      };

      mockClient.speak.request.mockResolvedValue(mockResponse);

      const startTime = Date.now();
      const result = await verifyDeepgramTTSApi('api-key');
      const endTime = Date.now();
      
      expect(result.latency).toBeGreaterThan(0);
      expect(result.latency).toBeLessThan(endTime - startTime + 100); // Allow for some variance
    });
  });

  describe('updateDeepgramTTSStatus', () => {
    test('should update status to verified with available models', async () => {
      const mockConfig = { ttsConfig: { deepgramTTS: {} } };
      mockConfiguration.findOne.mockResolvedValue(mockConfig);
      mockConfiguration.findOneAndUpdate.mockResolvedValue({});

      await updateDeepgramTTSStatus('verified', {
        availableModels: ['aura-asteria-en', 'aura-zeus-en']
      });

      expect(mockConfiguration.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          'ttsConfig.deepgramTTS.status': 'verified',
          'ttsConfig.deepgramTTS.lastVerified': expect.any(Date),
          'ttsConfig.deepgramTTS.availableModels': ['aura-asteria-en', 'aura-zeus-en']
        }),
        { new: true }
      );
    });

    test('should update status to failed with error message', async () => {
      const mockConfig = { ttsConfig: { deepgramTTS: {} } };
      mockConfiguration.findOne.mockResolvedValue(mockConfig);
      mockConfiguration.findOneAndUpdate.mockResolvedValue({});

      await updateDeepgramTTSStatus('failed', {
        error: 'Authentication failed'
      });

      expect(mockConfiguration.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          'ttsConfig.deepgramTTS.status': 'failed',
          'ttsConfig.deepgramTTS.lastError': 'Authentication failed'
        }),
        { new: true }
      );
    });

    test('should create default ttsConfig if missing', async () => {
      const mockConfig = {}; // No ttsConfig
      mockConfiguration.findOne.mockResolvedValue(mockConfig);
      mockConfiguration.findOneAndUpdate.mockResolvedValue({});

      await updateDeepgramTTSStatus('verified', {
        availableModels: ['aura-asteria-en']
      });

      expect(mockConfiguration.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          'ttsConfig': expect.objectContaining({
            provider: 'elevenlabs',
            primaryProvider: 'elevenlabs',
            fallbackProviders: ['deepgram'],
            autoFallback: true,
            deepgramTTS: expect.objectContaining({
              status: 'verified',
              availableModels: ['aura-asteria-en']
            })
          })
        }),
        { new: true }
      );
    });

    test('should handle database update errors gracefully', async () => {
      mockConfiguration.findOne.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(updateDeepgramTTSStatus('verified')).resolves.toBeUndefined();
    });
  });

  describe('verifyAndUpdateDeepgramTTSApiStatus', () => {
    test('should verify API and update status on success', async () => {
      // Mock successful verification
      const mockStream = {
        getReader: () => ({
          read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: jest.fn()
        })
      };

      const mockResponse = {
        getStream: jest.fn().mockResolvedValue(mockStream)
      };

      mockClient.speak.request.mockResolvedValue(mockResponse);

      // Mock configuration update
      const mockConfig = { ttsConfig: { deepgramTTS: {} } };
      mockConfiguration.findOne.mockResolvedValue(mockConfig);
      mockConfiguration.findOneAndUpdate.mockResolvedValue({});

      const result = await verifyAndUpdateDeepgramTTSApiStatus('valid-api-key');
      
      expect(result).toMatchObject({
        success: true,
        status: 'verified'
      });

      expect(mockConfiguration.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          'ttsConfig.deepgramTTS.status': 'verified'
        }),
        { new: true }
      );
    });

    test('should handle verification failure and update status', async () => {
      const authError = {
        response: {
          status: 401
        }
      };

      mockClient.speak.request.mockRejectedValue(authError);

      // Mock configuration update
      const mockConfig = { ttsConfig: { deepgramTTS: {} } };
      mockConfiguration.findOne.mockResolvedValue(mockConfig);
      mockConfiguration.findOneAndUpdate.mockResolvedValue({});

      const result = await verifyAndUpdateDeepgramTTSApiStatus('invalid-api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed'
      });

      expect(mockConfiguration.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          'ttsConfig.deepgramTTS.status': 'failed'
        }),
        { new: true }
      );
    });

    test('should handle unexpected errors during verification', async () => {
      // Mock unexpected error during verification
      mockClient.speak.request.mockRejectedValue(new Error('Unexpected error'));

      // Mock configuration update
      mockConfiguration.findOne.mockResolvedValue({});
      mockConfiguration.findOneAndUpdate.mockResolvedValue({});

      const result = await verifyAndUpdateDeepgramTTSApiStatus('api-key');
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Unexpected error',
        message: 'An unexpected error occurred while verifying the Deepgram TTS API key'
      });
    });
  });

  describe('Available Models', () => {
    test('should return complete list of Deepgram TTS models', async () => {
      const mockStream = {
        getReader: () => ({
          read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: jest.fn()
        })
      };

      const mockResponse = {
        getStream: jest.fn().mockResolvedValue(mockStream)
      };

      mockClient.speak.request.mockResolvedValue(mockResponse);

      const result = await verifyDeepgramTTSApi('api-key');
      
      expect(result.availableModels).toEqual([
        'aura-2-thalia-en',
        'aura-asteria-en',
        'aura-luna-en',
        'aura-stella-en',
        'aura-athena-en',
        'aura-hera-en',
        'aura-orion-en',
        'aura-arcas-en',
        'aura-perseus-en',
        'aura-angus-en',
        'aura-orpheus-en',
        'aura-helios-en',
        'aura-zeus-en'
      ]);
    });
  });
});