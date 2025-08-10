import { synthesizeSpeechWithProvider, isTTSProviderConfigured } from '../../utils/ttsServiceFactory';

// Mock configuration with both ElevenLabs and Deepgram setup
const mockConfiguration = {
  ttsConfig: {
    provider: 'elevenlabs', // Global setting is ElevenLabs
    deepgramTTS: {
      apiKey: 'mock-deepgram-key'
    }
  },
  elevenLabsConfig: {
    apiKey: 'mock-elevenlabs-key',
    isEnabled: true
  }
};

// Mock TTSProviderService
jest.mock('../ttsProviderService', () => ({
  TTSProviderService: jest.fn().mockImplementation(() => ({
    synthesizeSpeech: jest.fn().mockImplementation(({ voiceId }) => {
      // Mock different behavior based on voice ID
      if (voiceId && voiceId.includes('aura')) {
        return Promise.resolve({
          audioContent: Buffer.from('mock-deepgram-audio'),
          metadata: { provider: 'deepgram', model: voiceId }
        });
      } else {
        return Promise.resolve({
          audioContent: Buffer.from('mock-elevenlabs-audio'),
          metadata: { provider: 'elevenlabs', model: voiceId }
        });
      }
    })
  }))
}));

describe('Deepgram Voice Auto-Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should auto-detect Deepgram provider for Deepgram voice IDs', async () => {
    const deepgramVoiceId = 'aura-2-thalia-en';
    const text = 'Hello, this is a test message.';
    
    const result = await synthesizeSpeechWithProvider(
      mockConfiguration,
      text,
      deepgramVoiceId,
      'en'
    );

    expect(result.audioContent).toBeDefined();
    expect(result.method).toBe('tts');
    // The mock should return a result indicating Deepgram was used
    expect(result.audioContent.toString()).toBe('mock-deepgram-audio');
  });

  test('should use ElevenLabs for non-Deepgram voice IDs', async () => {
    const elevenLabsVoiceId = 'pFZP5JQG7iQjIQuC4Bku';
    const text = 'Hello, this is a test message.';
    
    const result = await synthesizeSpeechWithProvider(
      mockConfiguration,
      text,
      elevenLabsVoiceId,
      'en'
    );

    expect(result.audioContent).toBeDefined();
    expect(result.method).toBe('tts');
    // The mock should return a result indicating ElevenLabs was used
    expect(result.audioContent.toString()).toBe('mock-elevenlabs-audio');
  });

  test('should recognize all Deepgram voice models', async () => {
    const deepgramVoices = [
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

    for (const voiceId of deepgramVoices) {
      const result = await synthesizeSpeechWithProvider(
        mockConfiguration,
        'Test message',
        voiceId,
        'en'
      );

      expect(result.audioContent).toBeDefined();
      expect(result.audioContent.toString()).toBe('mock-deepgram-audio');
    }
  });

  test('should check TTS provider configuration correctly', () => {
    // Test Deepgram voice ID detection in configuration check
    const deepgramVoiceId = 'aura-2-thalia-en';
    const elevenLabsVoiceId = 'pFZP5JQG7iQjIQuC4Bku';

    // Should detect Deepgram and check Deepgram config
    const deepgramConfigured = isTTSProviderConfigured(mockConfiguration, deepgramVoiceId);
    expect(deepgramConfigured).toBe(true); // Should be true because we have Deepgram API key

    // Should use ElevenLabs config for non-Deepgram voices
    const elevenLabsConfigured = isTTSProviderConfigured(mockConfiguration, elevenLabsVoiceId);
    expect(elevenLabsConfigured).toBe(true); // Should be true because we have ElevenLabs API key
  });

  test('should handle missing Deepgram configuration gracefully', () => {
    const configWithoutDeepgram = {
      ttsConfig: {
        provider: 'elevenlabs'
        // No deepgramTTS config
      },
      elevenLabsConfig: {
        apiKey: 'mock-elevenlabs-key',
        isEnabled: true
      }
    };

    const deepgramVoiceId = 'aura-2-thalia-en';
    const configured = isTTSProviderConfigured(configWithoutDeepgram, deepgramVoiceId);
    
    // Should return false because Deepgram API key is missing
    expect(configured).toBe(false);
  });
});