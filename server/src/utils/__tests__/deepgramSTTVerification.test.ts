/**
 * Unit tests for Deepgram STT Verification
 * 
 * Tests STT API verification, error handling, and test audio generation
 */

import { testDeepgramSTT } from '../../utils/deepgramSTTVerification';
import { getDeepgramService } from '../../services/deepgramService';

// Mock external dependencies
jest.mock('../../services/deepgramService');
jest.mock('../../utils/logger');

// Mock the getDeepgramService function
const mockGetDeepgramService = getDeepgramService as jest.MockedFunction<typeof getDeepgramService>;

// Mock Deepgram service
const mockDeepgramService = {
  transcribeAudio: jest.fn()
};

describe('Deepgram STT Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('testDeepgramSTT', () => {
    test('should fail when Deepgram service is not initialized', async () => {
      mockGetDeepgramService.mockReturnValue(null);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Deepgram service not initialized',
        message: 'Deepgram STT service is not available. Please configure your Deepgram API key in the Configuration page.'
      });
    });

    test('should succeed with valid Deepgram service and successful transcription', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      // Mock successful transcription response
      mockDeepgramService.transcribeAudio.mockResolvedValue({
        transcript: '',
        confidence: 0.95,
        language: 'en-US',
        latency: 150,
        modelUsed: 'nova-2',
        fallback: false
      });

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: true,
        status: 'verified',
        transcript: '',
        confidence: 0.95
      });

      expect(result.latency).toBeGreaterThan(0);
      expect(result.message).toContain('Deepgram STT API verified successfully');
      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledWith(
        expect.any(Buffer),
        {
          language: 'en-US',
          model: 'nova-2'
        }
      );
    });

    test('should handle authentication errors correctly', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const authError = {
        response: {
          status: 401,
          data: { message: 'Invalid API key' }
        }
      };

      mockDeepgramService.transcribeAudio.mockRejectedValue(authError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Authentication failed. Invalid Deepgram API key.',
        errorCode: 'HTTP_401'
      });

      expect(result.latency).toBeGreaterThan(0);
    });

    test('should handle forbidden access errors', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const forbiddenError = {
        response: {
          status: 403,
          data: { message: 'Access forbidden' }
        }
      };

      mockDeepgramService.transcribeAudio.mockRejectedValue(forbiddenError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Access forbidden. Your account may have insufficient permissions for STT.',
        errorCode: 'HTTP_403'
      });
    });

    test('should handle rate limiting errors', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const rateLimitError = {
        response: {
          status: 429,
          data: { message: 'Rate limit exceeded' }
        }
      };

      mockDeepgramService.transcribeAudio.mockRejectedValue(rateLimitError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Rate limit exceeded. Too many requests.',
        errorCode: 'HTTP_429'
      });
    });

    test('should handle bad request errors', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const badRequestError = {
        response: {
          status: 400,
          data: { message: 'Bad request parameters' }
        }
      };

      mockDeepgramService.transcribeAudio.mockRejectedValue(badRequestError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Bad request. Check your STT API configuration.',
        errorCode: 'HTTP_400'
      });
    });

    test('should handle service configuration errors', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const configError = new Error('Deepgram is not properly configured');
      mockDeepgramService.transcribeAudio.mockRejectedValue(configError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Deepgram STT service is not properly configured. Please check your API key in the Configuration page.'
      });
    });

    test('should handle network errors', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const networkError = new Error('Network connection failed');
      networkError.name = 'NetworkError';
      mockDeepgramService.transcribeAudio.mockRejectedValue(networkError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Network connection failed'
      });
    });

    test('should measure latency correctly', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      mockDeepgramService.transcribeAudio.mockResolvedValue({
        transcript: 'test transcript',
        confidence: 0.9,
        language: 'en-US',
        latency: 100,
        modelUsed: 'nova-2'
      });

      const startTime = Date.now();
      const result = await testDeepgramSTT();
      const endTime = Date.now();
      
      expect(result.latency).toBeGreaterThan(0);
      expect(result.latency).toBeLessThan(endTime - startTime + 100); // Allow for some variance
    });

    test('should handle transcription with actual content', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      mockDeepgramService.transcribeAudio.mockResolvedValue({
        transcript: 'hello world',
        confidence: 0.98,
        language: 'en-US',
        latency: 120,
        modelUsed: 'nova-2',
        fallback: false
      });

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: true,
        status: 'verified',
        transcript: 'hello world',
        confidence: 0.98
      });

      expect(result.message).toContain('verified successfully');
    });

    test('should handle response with missing optional fields', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      // Response with minimal required fields
      mockDeepgramService.transcribeAudio.mockResolvedValue({
        transcript: undefined,
        confidence: undefined,
        language: 'en-US'
      });

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: true,
        status: 'verified',
        transcript: '',
        confidence: 0
      });
    });

    test('should parse error message from response data string', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const stringResponseError = {
        response: {
          status: 400,
          data: 'Invalid audio format'
        }
      };

      mockDeepgramService.transcribeAudio.mockRejectedValue(stringResponseError);

      const result = await testDeepgramSTT();
      
      expect(result).toMatchObject({
        success: false,
        status: 'failed',
        error: 'Invalid audio format',
        errorCode: 'HTTP_400'
      });
    });

    test('should parse nested error message from response data', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      const nestedResponseError = {
        response: {
          status: 500,
          data: {
            error: 'Internal server error occurred'
          }
        }
      };

      mockDeepgramService.transcribeAudio.mockRejectedValue(nestedResponseError);

      const result = await testDeepgramSTT();
      
      expect(result.error).toBe('Internal server error occurred');
    });
  });

  describe('WAV Buffer Generation', () => {
    test('should create a valid WAV buffer for testing', async () => {
      mockGetDeepgramService.mockReturnValue(mockDeepgramService as any);
      
      mockDeepgramService.transcribeAudio.mockResolvedValue({
        transcript: '',
        confidence: 1.0,
        language: 'en-US'
      });

      const result = await testDeepgramSTT();
      
      // Verify that transcribeAudio was called with a Buffer
      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Object)
      );

      const calledBuffer = mockDeepgramService.transcribeAudio.mock.calls[0][0];
      
      // Verify it's a valid WAV buffer (starts with RIFF header)
      expect(calledBuffer.subarray(0, 4).toString()).toBe('RIFF');
      expect(calledBuffer.subarray(8, 12).toString()).toBe('WAVE');
      
      // Should be exactly the size for 1 second of 16kHz mono audio + 44 byte header
      const expectedSize = 44 + (16000 * 2); // 44 bytes header + 16000 samples * 2 bytes per sample
      expect(calledBuffer.length).toBe(expectedSize);
    });
  });
});