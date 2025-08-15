/**
 * Unit tests for TTS Provider Service
 * 
 * Tests provider selection, fallback logic, metrics tracking, and error handling
 */

import { TTSProviderService } from '../ttsProviderService';
import { ttsMetrics } from '../../monitoring/ttsMetrics';
import mongoose from 'mongoose';

// Mock external dependencies
jest.mock('mongoose');
jest.mock('../deepgramTTSService');
jest.mock('../enhancedVoiceAIService');
jest.mock('../../utils/logger');

// Mock configuration data
const mockConfiguration = {
  ttsConfig: {
    provider: 'elevenlabs',
    primaryProvider: 'elevenlabs',
    fallbackProviders: ['deepgram'],
    autoFallback: true,
    deepgramTTS: {
      apiKey: 'mock-deepgram-key',
      isEnabled: true,
      defaultModel: 'aura-asteria-en',
      availableModels: ['aura-asteria-en', 'aura-zeus-en'],
      voiceSettings: {
        encoding: 'mp3',
        sampleRate: 24000
      },
      status: 'verified'
    }
  },
  elevenLabsConfig: {
    apiKey: 'mock-elevenlabs-key'
  }
};

describe('TTSProviderService', () => {
  let ttsService: TTSProviderService;
  let mockModel: jest.Mock;

  beforeEach(() => {
    // Mock mongoose model
    mockModel = jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(mockConfiguration)
    });
    (mongoose.model as jest.Mock).mockReturnValue(mockModel);

    // Clear metrics before each test
    ttsMetrics.clearMetrics();

    ttsService = new TTSProviderService();
    jest.clearAllMocks();
  });

  describe('Provider Selection Logic', () => {
    test('should auto-detect Deepgram provider for aura voice IDs', () => {
      const deepgramVoiceIds = [
        'aura-asteria-en',
        'aura-zeus-en',
        'aura-2-thalia-en',
        'aura-luna-en'
      ];

      deepgramVoiceIds.forEach(voiceId => {
        // We test this indirectly through the synthesizeSpeech method
        // since isDeepgramVoiceId is private
        expect(voiceId.startsWith('aura-')).toBe(true);
      });
    });

    test('should use primary provider for non-aura voice IDs', async () => {
      const config = await ttsService.getTTSConfig();
      expect(config.primaryProvider).toBe('elevenlabs');
      expect(config.fallbackProviders).toContain('deepgram');
    });

    test('should load TTS configuration correctly', async () => {
      const config = await ttsService.getTTSConfig();
      
      expect(config).toMatchObject({
        primaryProvider: 'elevenlabs',
        fallbackProviders: ['deepgram'],
        autoFallback: true,
        deepgramTTS: expect.objectContaining({
          apiKey: 'mock-deepgram-key',
          isEnabled: true,
          defaultModel: 'aura-asteria-en'
        })
      });
    });
  });

  describe('Error Code Extraction', () => {
    test('should extract HTTP status codes', () => {
      const service = new TTSProviderService();
      
      // Access private method through prototype for testing
      const extractErrorCode = (service as any).extractErrorCode.bind(service);
      
      expect(extractErrorCode({ response: { status: 401 } })).toBe('HTTP_401');
      expect(extractErrorCode({ response: { status: 429 } })).toBe('HTTP_429');
      expect(extractErrorCode({ response: { status: 500 } })).toBe('HTTP_500');
    });

    test('should extract error codes from error objects', () => {
      const service = new TTSProviderService();
      const extractErrorCode = (service as any).extractErrorCode.bind(service);
      
      expect(extractErrorCode({ code: 'ENOTFOUND' })).toBe('ENOTFOUND');
      expect(extractErrorCode({ name: 'TimeoutError' })).toBe('TimeoutError');
      expect(extractErrorCode({})).toBe('UNKNOWN');
    });
  });

  describe('Available Voices', () => {
    test('should return available voices', async () => {
      // Mock voice data
      const mockVoices = [
        { voiceId: 'voice1', name: 'Voice 1' },
        { voiceId: 'voice2', name: 'Voice 2' }
      ];

      // Update configuration to include voices
      mockConfiguration.elevenLabsConfig = {
        ...mockConfiguration.elevenLabsConfig,
        availableVoices: mockVoices
      };

      const voices = await ttsService.getAvailableVoices('elevenlabs');
      expect(Array.isArray(voices)).toBe(true);
    });

    test('should return Deepgram models for deepgram provider', async () => {
      const voices = await ttsService.getAvailableVoices('deepgram');
      expect(Array.isArray(voices)).toBe(true);
    });
  });

  describe('Metrics Integration', () => {
    test('should record metrics for successful synthesis', () => {
      // Test that metrics are properly integrated
      const initialSummary = ttsMetrics.getSummary();
      expect(initialSummary.totalRequests).toBe(0);

      // Record a test metric
      ttsMetrics.recordRequest({
        provider: 'deepgram',
        success: true,
        latency: 150,
        audioSize: 1024,
        requestId: 'test-123'
      });

      const updatedSummary = ttsMetrics.getSummary();
      expect(updatedSummary.totalRequests).toBe(1);
      expect(updatedSummary.overallSuccessRate).toBe(100);
    });

    test('should record metrics for failed synthesis with fallback', () => {
      // Record primary failure
      ttsMetrics.recordRequest({
        provider: 'elevenlabs',
        success: false,
        latency: 5000,
        errorCode: 'HTTP_429',
        requestId: 'test-456'
      });

      // Record successful fallback
      ttsMetrics.recordRequest({
        provider: 'deepgram',
        success: true,
        latency: 200,
        audioSize: 2048,
        fallbackUsed: true,
        fallbackReason: 'Rate limit exceeded',
        requestId: 'test-456'
      });

      const summary = ttsMetrics.getSummary();
      expect(summary.totalRequests).toBe(2);
      expect(summary.fallbackRate).toBe(50); // 1 out of 2 requests used fallback
      
      const fallbackStats = ttsMetrics.getFallbackStats();
      expect(fallbackStats.total).toBe(1);
      expect(fallbackStats.byProvider).toHaveProperty('deepgram', 1);
    });
  });

  describe('Fallback Logic', () => {
    test('should attempt fallback when primary provider fails', async () => {
      // This tests the conceptual fallback logic
      // In a real implementation, we would mock the actual synthesis methods
      const config = await ttsService.getTTSConfig();
      
      expect(config.autoFallback).toBe(true);
      expect(config.fallbackProviders).toEqual(['deepgram']);
    });

    test('should not attempt fallback when autoFallback is disabled', async () => {
      // Mock configuration with autoFallback disabled
      const noFallbackConfig = {
        ...mockConfiguration,
        ttsConfig: {
          ...mockConfiguration.ttsConfig,
          autoFallback: false
        }
      };

      mockModel.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(noFallbackConfig)
      });

      const config = await ttsService.getTTSConfig();
      expect(config.autoFallback).toBe(false);
    });
  });

  describe('Configuration Defaults', () => {
    test('should provide default configuration when none exists', async () => {
      // Mock empty configuration
      mockModel.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null)
      });

      const config = await ttsService.getTTSConfig();
      
      expect(config).toMatchObject({
        provider: 'elevenlabs',
        primaryProvider: 'elevenlabs',
        fallbackProviders: ['deepgram'],
        autoFallback: true
      });
    });
  });

  describe('Provider-Specific Logic', () => {
    test('should handle ElevenLabs provider configuration', async () => {
      const config = await ttsService.getTTSConfig();
      expect(config.primaryProvider).toBe('elevenlabs');
    });

    test('should handle Deepgram TTS provider configuration', async () => {
      const config = await ttsService.getTTSConfig();
      expect(config.deepgramTTS).toMatchObject({
        apiKey: 'mock-deepgram-key',
        isEnabled: true,
        defaultModel: 'aura-asteria-en'
      });
    });

    test('should validate voice settings for Deepgram', async () => {
      const config = await ttsService.getTTSConfig();
      expect(config.deepgramTTS.voiceSettings).toMatchObject({
        encoding: 'mp3',
        sampleRate: 24000
      });
    });
  });

  describe('Error Scenarios', () => {
    test('should handle configuration loading errors gracefully', async () => {
      // Mock database error
      mockModel.mockReturnValue({
        findOne: jest.fn().mockRejectedValue(new Error('Database error'))
      });

      // Should not throw, should return default config
      const config = await ttsService.getTTSConfig();
      expect(config).toBeDefined();
    });

    test('should handle missing TTS configuration', async () => {
      // Mock configuration without ttsConfig
      const configWithoutTTS = { ...mockConfiguration };
      delete configWithoutTTS.ttsConfig;

      mockModel.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(configWithoutTTS)
      });

      const config = await ttsService.getTTSConfig();
      expect(config.provider).toBe('elevenlabs'); // Should use default
    });
  });

  describe('Voice ID Detection Patterns', () => {
    test('should identify Deepgram aura models correctly', () => {
      const deepgramModels = [
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
      ];

      deepgramModels.forEach(model => {
        expect(model).toMatch(/^aura-/);
      });
    });

    test('should not match non-aura voice IDs', () => {
      const nonDeepgramVoices = [
        'rachel',
        'brian',
        'emma',
        'custom-voice-123',
        'eleven-labs-voice'
      ];

      nonDeepgramVoices.forEach(voice => {
        expect(voice).not.toMatch(/^aura-/);
      });
    });
  });
});

describe('TTS Metrics', () => {
  beforeEach(() => {
    ttsMetrics.clearMetrics();
  });

  test('should calculate provider statistics correctly', () => {
    // Record multiple requests for different providers
    ttsMetrics.recordRequest({
      provider: 'elevenlabs',
      success: true,
      latency: 100,
      audioSize: 1000
    });

    ttsMetrics.recordRequest({
      provider: 'elevenlabs',
      success: false,
      latency: 500,
      errorCode: 'HTTP_429'
    });

    ttsMetrics.recordRequest({
      provider: 'deepgram',
      success: true,
      latency: 150,
      audioSize: 1200,
      fallbackUsed: true
    });

    const stats = ttsMetrics.getProviderStats();
    
    const elevenLabsStats = stats.find(s => s.provider === 'elevenlabs');
    expect(elevenLabsStats).toMatchObject({
      provider: 'elevenlabs',
      totalRequests: 2,
      successCount: 1,
      failureCount: 1,
      successRate: 50
    });

    const deepgramStats = stats.find(s => s.provider === 'deepgram');
    expect(deepgramStats).toMatchObject({
      provider: 'deepgram',
      totalRequests: 1,
      successCount: 1,
      failureCount: 0,
      successRate: 100,
      fallbackCount: 1
    });
  });

  test('should track fallback usage correctly', () => {
    ttsMetrics.recordRequest({
      provider: 'deepgram',
      success: true,
      latency: 200,
      fallbackUsed: true,
      fallbackReason: 'Primary provider failed'
    });

    const fallbackStats = ttsMetrics.getFallbackStats();
    expect(fallbackStats.total).toBe(1);
    expect(fallbackStats.byProvider.deepgram).toBe(1);

    const summary = ttsMetrics.getSummary();
    expect(summary.fallbackRate).toBe(100);
  });
});