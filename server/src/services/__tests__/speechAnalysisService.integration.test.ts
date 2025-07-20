/**
 * Integration tests for Speech Analysis Service with Model Compatibility
 */

import { SpeechAnalysisService } from '../speechAnalysisService';
import { ModelCompatibilityService } from '../modelCompatibilityService';

// Mock the Deepgram SDK
jest.mock('@deepgram/sdk', () => ({
  createClient: jest.fn(() => ({
    listen: {
      prerecorded: {
        transcribeFile: jest.fn()
      }
    }
  }))
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  getErrorMessage: jest.fn((error) => error?.message || String(error))
}));

// Mock the index logger
jest.mock('../../index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('SpeechAnalysisService Integration with Model Compatibility', () => {
  let speechService: SpeechAnalysisService;
  const mockApiKey = 'test-deepgram-api-key-1234567890';
  const mockOpenAIKey = 'test-openai-key';

  beforeEach(() => {
    jest.clearAllMocks();
    speechService = new SpeechAnalysisService(mockOpenAIKey, undefined, mockApiKey);
  });

  describe('Model Compatibility Integration', () => {
    test('should initialize with model compatibility service', () => {
      expect(speechService).toBeDefined();
      expect(speechService.isDeepgramConfigured()).toBe(true);
    });

    test('should update preferred model and validate availability', async () => {
      const result = await speechService.updatePreferredModel('nova');
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('actualModel');
      expect(result).toHaveProperty('message');
    });

    test('should get model status with compatibility information', async () => {
      const status = await speechService.getModelStatus();
      
      expect(status).toHaveProperty('currentModel');
      expect(status).toHaveProperty('isValid');
      expect(status).toHaveProperty('compatibleModels');
      expect(status).toHaveProperty('lastValidation');
      expect(Array.isArray(status.compatibleModels)).toBe(true);
    });

    test('should validate configuration and provide recommendations', async () => {
      const validation = await speechService.validateConfiguration();
      
      expect(validation).toHaveProperty('isValid');
      expect(validation).toHaveProperty('issues');
      expect(validation).toHaveProperty('recommendations');
      expect(validation).toHaveProperty('modelStatus');
      expect(Array.isArray(validation.issues)).toBe(true);
      expect(Array.isArray(validation.recommendations)).toBe(true);
    });

    test('should handle API key updates and reinitialize services', () => {
      const newApiKey = 'new-deepgram-api-key-0987654321';
      
      speechService.updateApiKeys(mockOpenAIKey, undefined, newApiKey);
      
      expect(speechService.getDeepgramApiKey()).toBe(newApiKey);
      expect(speechService.isDeepgramConfigured()).toBe(true);
    });
  });

  describe('Transcription with Model Fallback', () => {
    test('should include model information in transcription result', async () => {
      // Mock a successful transcription response
      const mockResponse = {
        result: {
          results: {
            channels: [{
              alternatives: [{
                transcript: 'Hello world',
                confidence: 0.95
              }]
            }]
          }
        }
      };

      const mockDeepgramClient = require('@deepgram/sdk').createClient();
      mockDeepgramClient.listen.prerecorded.transcribeFile.mockResolvedValue(mockResponse);

      const audioBuffer = Buffer.from('mock audio data');
      const result = await speechService.transcribeAudio(audioBuffer);

      expect(result).toHaveProperty('transcript');
      expect(result).toHaveProperty('language');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('hasVoiceActivity');
      expect(result).toHaveProperty('modelUsed');
      expect(result).toHaveProperty('fallbackUsed');
    });

    test('should handle transcription errors gracefully', async () => {
      // Mock a failed transcription
      const mockDeepgramClient = require('@deepgram/sdk').createClient();
      mockDeepgramClient.listen.prerecorded.transcribeFile.mockRejectedValue(
        new Error('Mock transcription error')
      );

      const audioBuffer = Buffer.from('mock audio data');
      const result = await speechService.transcribeAudio(audioBuffer);

      expect(result).toHaveProperty('transcript', '');
      expect(result).toHaveProperty('confidence', 0);
      expect(result).toHaveProperty('modelUsed');
      expect(result).toHaveProperty('fallbackUsed');
    });
  });

  describe('Voice Activity Detection', () => {
    test('should detect voice activity in audio buffer', () => {
      // Create a buffer with some variation to simulate voice activity
      const audioBuffer = Buffer.alloc(1000);
      for (let i = 0; i < audioBuffer.length; i++) {
        audioBuffer[i] = Math.floor(Math.random() * 255);
      }

      const hasActivity = speechService.detectVoiceActivity(audioBuffer);
      expect(typeof hasActivity).toBe('boolean');
    });

    test('should handle empty audio buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      const hasActivity = speechService.detectVoiceActivity(emptyBuffer);
      expect(hasActivity).toBe(false);
    });
  });

  describe('Configuration Management', () => {
    test('should provide current API keys', () => {
      expect(speechService.getOpenAIApiKey()).toBe(mockOpenAIKey);
      expect(speechService.getDeepgramApiKey()).toBe(mockApiKey);
    });

    test('should check Deepgram configuration status', () => {
      expect(speechService.isDeepgramConfigured()).toBe(true);
    });
  });
});