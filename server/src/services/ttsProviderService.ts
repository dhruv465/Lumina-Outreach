import mongoose from 'mongoose';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { getDeepgramTTSService, DeepgramTTSService } from './deepgramTTSService';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';

export type TTSProvider = 'elevenlabs' | 'deepgram' | 'openai' | 'google' | 'aws';

export interface TTSOptions {
  text: string;
  voiceId?: string;
  model?: string;
  language?: string;
  encoding?: string;
  sampleRate?: number;
  speed?: number;
  pitch?: number;
}

export interface TTSResult {
  audioContent: Buffer;
  metadata: {
    provider: string;
    model?: string;
    voiceId?: string;
    encoding?: string;
    duration?: number;
    fallbackUsed?: boolean;
    error?: string;
  };
}

export class TTSProviderService {
  private configuration: any = null;
  private elevenLabsService: EnhancedVoiceAIService | null = null;

  constructor() {
    this.loadConfiguration();
  }

  /**
   * Check if a voice ID looks like a Deepgram model
   */
  private isDeepgramVoiceId(voiceId: string): boolean {
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
    return deepgramModels.includes(voiceId);
  }

  private async loadConfiguration(): Promise<void> {
    try {
      const Configuration = mongoose.model('Configuration');
      this.configuration = await Configuration.findOne();
      
      if (this.configuration?.elevenLabsConfig?.apiKey) {
        this.elevenLabsService = new EnhancedVoiceAIService(
          this.configuration.elevenLabsConfig.apiKey
        );
      }
    } catch (error) {
      logger.error('Failed to load TTS configuration:', getErrorMessage(error));
    }
  }

  /**
   * Get the current TTS provider configuration
   */
  public async getTTSConfig(): Promise<any> {
    if (!this.configuration) {
      await this.loadConfiguration();
    }

    return this.configuration?.ttsConfig || {
      provider: 'elevenlabs',
      primaryProvider: 'elevenlabs',
      fallbackProviders: ['deepgram'],
      autoFallback: true
    };
  }

  /**
   * Synthesize speech using the configured TTS provider
   */
  public async synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
    const config = await this.getTTSConfig();
    let primaryProvider = config.primaryProvider || config.provider || 'elevenlabs';

    // Auto-detect provider based on voice ID if it looks like a Deepgram model
    if (options.voiceId && this.isDeepgramVoiceId(options.voiceId)) {
      primaryProvider = 'deepgram';
      logger.info('Auto-detected Deepgram provider based on voice ID', {
        voiceId: options.voiceId
      });
    }

    logger.info('TTS synthesis request', {
      textLength: options.text.length,
      primaryProvider,
      voiceId: options.voiceId,
      model: options.model
    });

    // Try primary provider first
    try {
      const result = await this.synthesizeWithProvider(primaryProvider, options);
      logger.info('TTS synthesis successful with primary provider', {
        provider: primaryProvider,
        audioSize: result.audioContent.length
      });
      return result;
    } catch (primaryError) {
      logger.warn(`Primary TTS provider ${primaryProvider} failed`, {
        error: getErrorMessage(primaryError)
      });

      // Try fallback providers if auto-fallback is enabled
      if (config.autoFallback && config.fallbackProviders?.length > 0) {
        for (const fallbackProvider of config.fallbackProviders) {
          if (fallbackProvider === primaryProvider) continue; // Skip if same as primary

          try {
            logger.info(`Attempting TTS fallback to ${fallbackProvider}`);
            const result = await this.synthesizeWithProvider(fallbackProvider, options);
            result.metadata.fallbackUsed = true;
            result.metadata.error = `Primary provider ${primaryProvider} failed: ${getErrorMessage(primaryError)}`;
            
            logger.info('TTS synthesis successful with fallback provider', {
              provider: fallbackProvider,
              audioSize: result.audioContent.length
            });
            return result;
          } catch (fallbackError) {
            logger.warn(`TTS fallback provider ${fallbackProvider} also failed`, {
              error: getErrorMessage(fallbackError)
            });
          }
        }
      }

      // All providers failed
      throw new Error(`All TTS providers failed. Primary: ${getErrorMessage(primaryError)}`);
    }
  }

  /**
   * Synthesize speech with a specific provider
   */
  private async synthesizeWithProvider(provider: TTSProvider, options: TTSOptions): Promise<TTSResult> {
    switch (provider) {
      case 'elevenlabs':
        return this.synthesizeWithElevenLabs(options);
      
      case 'deepgram':
        return this.synthesizeWithDeepgram(options);
      
      case 'openai':
      case 'google':
      case 'aws':
        throw new Error(`TTS provider ${provider} not yet implemented`);
      
      default:
        throw new Error(`Unknown TTS provider: ${provider}`);
    }
  }

  /**
   * Synthesize speech using ElevenLabs
   */
  private async synthesizeWithElevenLabs(options: TTSOptions): Promise<TTSResult> {
    if (!this.elevenLabsService) {
      throw new Error('ElevenLabs service not initialized');
    }

    // Get configuration voice settings to pass to synthesis
    const config = await this.getTTSConfig();
    const campaignVoiceSettings = config?.elevenLabsConfig ? {
      speed: config.elevenLabsConfig.voiceSpeed,
      stability: config.elevenLabsConfig.voiceStability,
      clarity: config.elevenLabsConfig.voiceClarity
    } : undefined;

    logger.info('TTS synthesis with voice settings:', {
      voiceId: options.voiceId,
      campaignVoiceSettings,
      textLength: options.text.length
    });

    const result = await this.elevenLabsService.synthesizeAdaptiveVoice({
      text: options.text,
      personalityId: options.voiceId || 'default-voice-id',
      language: options.language || 'en',
      campaignVoiceSettings
    });

    return {
      audioContent: result.audioContent,
      metadata: {
        provider: 'elevenlabs',
        model: result.metadata.voiceId,
        voiceId: options.voiceId,
        encoding: 'mp3',
        duration: result.metadata.duration,
        fallbackUsed: false
      }
    };
  }

  /**
   * Synthesize speech using Deepgram TTS
   */
  private async synthesizeWithDeepgram(options: TTSOptions): Promise<TTSResult> {
    const config = await this.getTTSConfig();
    const deepgramConfig = config.deepgramTTS || {};

    if (!deepgramConfig.apiKey) {
      throw new Error('Deepgram TTS API key not configured');
    }

    // Create a new instance with the current API key from configuration
    const deepgramTTS = new DeepgramTTSService(deepgramConfig.apiKey);

    const encoding = options.encoding || deepgramConfig.voiceSettings?.encoding || 'mp3';
    const synthesisOptions = {
      model: options.voiceId || options.model || deepgramConfig.defaultModel || 'aura-2-thalia-en',
      encoding: encoding,
      // Only include sample_rate for non-mp3 encodings (per Deepgram documentation)
      ...(encoding !== 'mp3' && { 
        sample_rate: options.sampleRate || deepgramConfig.voiceSettings?.sampleRate || 24000 
      })
    };

    logger.info('Deepgram TTS synthesis request', {
      textLength: options.text.length,
      model: synthesisOptions.model,
      encoding: synthesisOptions.encoding,
      sampleRate: synthesisOptions.sample_rate,
      hasApiKey: !!deepgramConfig.apiKey
    });

    const audioBuffer = await deepgramTTS.synthesizeSpeechWithStream(
      options.text,
      synthesisOptions
    );

    return {
      audioContent: audioBuffer,
      metadata: {
        provider: 'deepgram',
        model: synthesisOptions.model,
        voiceId: options.voiceId,
        encoding: synthesisOptions.encoding,
        duration: Math.ceil(options.text.length / 15), // Rough estimate
        fallbackUsed: false
      }
    };
  }

  /**
   * Get available voices for the current provider
   */
  public async getAvailableVoices(provider?: TTSProvider): Promise<any[]> {
    const config = await this.getTTSConfig();
    const targetProvider = provider || config.primaryProvider || 'elevenlabs';

    switch (targetProvider) {
      case 'elevenlabs':
        if (this.configuration?.elevenLabsConfig?.availableVoices) {
          return this.configuration.elevenLabsConfig.availableVoices;
        }
        return [];

      case 'deepgram':
        const deepgramConfig = config.deepgramTTS;
        
        // Only return voices if Deepgram TTS has a valid API key
        if (deepgramConfig?.apiKey) {
          try {
            // Create a temporary service instance with the current API key to test
            const tempService = new DeepgramTTSService(deepgramConfig.apiKey);
            
            // Test if the API key is valid by checking service availability
            const isAvailable = await tempService.isAvailable();
            if (isAvailable) {
              const models = tempService.getAvailableModels();
              return models.map(model => ({
                voiceId: model,
                name: model.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                provider: 'deepgram'
              }));
            }
          } catch (error) {
            logger.warn('Deepgram TTS API key validation failed', {
              error: getErrorMessage(error)
            });
          }
        }
        return [];

      default:
        return [];
    }
  }

  /**
   * Test TTS provider availability
   */
  public async testProvider(provider: TTSProvider): Promise<boolean> {
    try {
      const testResult = await this.synthesizeWithProvider(provider, {
        text: 'Test synthesis',
        voiceId: 'test'
      });
      return testResult.audioContent.length > 0;
    } catch (error) {
      logger.warn(`TTS provider ${provider} test failed`, {
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Update TTS configuration
   */
  public async updateTTSConfig(newConfig: any): Promise<void> {
    try {
      const Configuration = mongoose.model('Configuration');
      
      // Get existing configuration to merge properly
      let existingConfig = await Configuration.findOne();
      if (!existingConfig) {
        existingConfig = new Configuration();
      }

      // Prepare the update object with proper nested structure
      const updateObject: any = {
        'ttsConfig.provider': newConfig.provider,
        'ttsConfig.primaryProvider': newConfig.primaryProvider,
        'ttsConfig.fallbackProviders': newConfig.fallbackProviders,
        'ttsConfig.autoFallback': newConfig.autoFallback
      };

      // Handle deepgramTTS configuration if provided
      if (newConfig.deepgramTTS) {
        updateObject['ttsConfig.deepgramTTS'] = {
          ...existingConfig.ttsConfig?.deepgramTTS,
          ...newConfig.deepgramTTS
        };
      }

      await Configuration.findOneAndUpdate(
        {},
        { $set: updateObject },
        { upsert: true, new: true }
      );
      
      // Reload configuration
      await this.loadConfiguration();
      
      logger.info('TTS configuration updated', {
        provider: newConfig.provider,
        primaryProvider: newConfig.primaryProvider,
        fallbackProviders: newConfig.fallbackProviders,
        deepgramTTSUpdated: !!newConfig.deepgramTTS
      });
    } catch (error) {
      logger.error('Failed to update TTS configuration', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }
}

// Singleton instance
let ttsProviderService: TTSProviderService | null = null;

export function getTTSProviderService(): TTSProviderService {
  if (!ttsProviderService) {
    ttsProviderService = new TTSProviderService();
  }
  return ttsProviderService;
}

export function initializeTTSProviderService(): TTSProviderService {
  ttsProviderService = new TTSProviderService();
  return ttsProviderService;
}