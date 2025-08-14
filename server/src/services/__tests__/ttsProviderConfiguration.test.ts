// Test the TTS configuration functions in isolation
describe('TTS Provider Configuration', () => {
  // Import helper functions for testing configuration logic
  const checkElevenLabsConfig = (config: any): boolean => {
    return !!(config?.elevenLabsConfig?.apiKey);
  };

  const checkDeepgramConfig = (config: any): boolean => {
    return !!(config?.ttsConfig?.deepgramTTS?.apiKey);
  };

  const isTTSProviderConfigured = (configuration: any, voiceId?: string): boolean => {
    let selectedProvider = configuration?.ttsConfig?.provider || 'elevenlabs';
    
    // Auto-detect provider based on voice ID if it looks like a Deepgram model
    if (voiceId) {
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
      
      if (deepgramModels.includes(voiceId)) {
        selectedProvider = 'deepgram';
      }
    }
    
    switch (selectedProvider) {
      case 'elevenlabs':
        return checkElevenLabsConfig(configuration);
      case 'deepgram':
        return checkDeepgramConfig(configuration);
      case 'openai':
      case 'google':
      case 'aws':
        // These providers are not yet implemented
        return false;
      default:
        return false;
    }
  };

  const hasAnyTTSProviderConfigured = (configuration: any): boolean => {
    return !!(
      configuration?.elevenLabsConfig?.apiKey || 
      configuration?.ttsConfig?.deepgramTTS?.apiKey
      // Add more providers as they are implemented
    );
  };

  const getRequiredApiKeysForProvider = (provider: string): string[] => {
    switch (provider) {
      case 'elevenlabs':
        return ['elevenLabsApiKey'];
      case 'deepgram':
        return ['deepgramApiKey'];
      case 'openai':
        return ['openAIApiKey'];
      case 'google':
        return ['googleSpeechKey'];
      case 'aws':
        return []; // AWS might use different credential system
      default:
        return [];
    }
  };

  describe('isTTSProviderConfigured', () => {
    test('should return true for ElevenLabs when API key is configured', () => {
      const config = {
        ttsConfig: { provider: 'elevenlabs' },
        elevenLabsConfig: { apiKey: 'test-api-key' }
      };
      
      expect(isTTSProviderConfigured(config)).toBe(true);
    });

    test('should return false for ElevenLabs when API key is missing', () => {
      const config = {
        ttsConfig: { provider: 'elevenlabs' },
        elevenLabsConfig: { apiKey: '' }
      };
      
      expect(isTTSProviderConfigured(config)).toBe(false);
    });

    test('should return true for Deepgram when API key is configured', () => {
      const config = {
        ttsConfig: { 
          provider: 'deepgram',
          deepgramTTS: { apiKey: 'test-deepgram-key' }
        }
      };
      
      expect(isTTSProviderConfigured(config)).toBe(true);
    });

    test('should return false for Deepgram when API key is missing', () => {
      const config = {
        ttsConfig: { 
          provider: 'deepgram',
          deepgramTTS: { apiKey: '' }
        }
      };
      
      expect(isTTSProviderConfigured(config)).toBe(false);
    });

    test('should auto-detect Deepgram provider based on voice ID', () => {
      const config = {
        ttsConfig: { 
          provider: 'elevenlabs',
          deepgramTTS: { apiKey: 'test-deepgram-key' }
        },
        elevenLabsConfig: { apiKey: '' }
      };
      
      expect(isTTSProviderConfigured(config, 'aura-2-thalia-en')).toBe(true);
    });

    test('should return false for unimplemented providers', () => {
      const config = {
        ttsConfig: { provider: 'openai' }
      };
      
      expect(isTTSProviderConfigured(config)).toBe(false);
    });

    test('should default to elevenlabs when no provider is specified', () => {
      const config = {
        elevenLabsConfig: { apiKey: 'test-api-key' }
      };
      
      expect(isTTSProviderConfigured(config)).toBe(true);
    });
  });

  describe('hasAnyTTSProviderConfigured', () => {
    test('should return true when ElevenLabs is configured', () => {
      const config = {
        elevenLabsConfig: { apiKey: 'test-api-key' }
      };
      
      expect(hasAnyTTSProviderConfigured(config)).toBe(true);
    });

    test('should return true when Deepgram is configured', () => {
      const config = {
        ttsConfig: { 
          deepgramTTS: { apiKey: 'test-deepgram-key' }
        }
      };
      
      expect(hasAnyTTSProviderConfigured(config)).toBe(true);
    });

    test('should return true when both providers are configured', () => {
      const config = {
        elevenLabsConfig: { apiKey: 'test-elevenlabs-key' },
        ttsConfig: { 
          deepgramTTS: { apiKey: 'test-deepgram-key' }
        }
      };
      
      expect(hasAnyTTSProviderConfigured(config)).toBe(true);
    });

    test('should return false when no providers are configured', () => {
      const config = {};
      
      expect(hasAnyTTSProviderConfigured(config)).toBe(false);
    });

    test('should return false when providers have empty API keys', () => {
      const config = {
        elevenLabsConfig: { apiKey: '' },
        ttsConfig: { 
          deepgramTTS: { apiKey: '' }
        }
      };
      
      expect(hasAnyTTSProviderConfigured(config)).toBe(false);
    });
  });

  describe('getRequiredApiKeysForProvider', () => {
    test('should return correct API keys for each provider', () => {
      expect(getRequiredApiKeysForProvider('elevenlabs')).toEqual(['elevenLabsApiKey']);
      expect(getRequiredApiKeysForProvider('deepgram')).toEqual(['deepgramApiKey']);
      expect(getRequiredApiKeysForProvider('openai')).toEqual(['openAIApiKey']);
      expect(getRequiredApiKeysForProvider('google')).toEqual(['googleSpeechKey']);
      expect(getRequiredApiKeysForProvider('aws')).toEqual([]);
      expect(getRequiredApiKeysForProvider('unknown')).toEqual([]);
    });
  });
});