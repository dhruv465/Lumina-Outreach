import mongoose from 'mongoose';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { getDeepgramTTSService, DeepgramTTSService } from './deepgramTTSService';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import { ttsMetrics } from '../monitoring/ttsMetrics';

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

  /**
   * Extract error code from error object for metrics tracking
   */
  private extractErrorCode(error: any): string {
    if (error?.response?.status) {
      return `HTTP_${error.response.status}`;
    }
    if (error?.code) {
      return error.code;
    }
    if (error?.name) {
      return error.name;
    }
    return 'UNKNOWN';
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
   * Get available fallback providers excluding disabled ones
   */
  private getAvailableFallbackProviders(config: any, primaryProvider: string): string[] {
    const allProviders = ['elevenlabs', 'deepgram'];
    const availableProviders: string[] = [];

    for (const provider of allProviders) {
      if (provider === primaryProvider) continue; // Skip primary provider

      // Check if provider is enabled
      if (provider === 'elevenlabs') {
        if (this.configuration?.elevenLabsConfig?.isEnabled && this.configuration?.elevenLabsConfig?.apiKey) {
          availableProviders.push(provider);
        }
      } else if (provider === 'deepgram') {
        if (this.configuration?.ttsConfig?.deepgramTTS?.isEnabled && this.configuration?.ttsConfig?.deepgramTTS?.apiKey) {
          availableProviders.push(provider);
        }
      }
    }

    logger.info(`Available fallback providers for primary ${primaryProvider}:`, availableProviders);
    return availableProviders;
  }

  /**
   * Synthesize speech using the configured TTS provider
   */
  public async synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
    const config = await this.getTTSConfig();
    let primaryProvider = config.primaryProvider || config.provider || 'elevenlabs';
    const startTime = Date.now();
    const requestId = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Auto-detect provider based on voice ID if it looks like a Deepgram model
    if (options.voiceId && this.isDeepgramVoiceId(options.voiceId)) {
      primaryProvider = 'deepgram';
      logger.info('Auto-detected Deepgram provider based on voice ID', {
        voiceId: options.voiceId,
        requestId
      });
    }

    logger.info('TTS synthesis request', {
      textLength: options.text.length,
      primaryProvider,
      voiceId: options.voiceId,
      model: options.model,
      requestId
    });

    // Try primary provider first
    try {
      const result = await this.synthesizeWithProvider(primaryProvider, options);
      const latency = Date.now() - startTime;
      
      // Record successful metric
      ttsMetrics.recordRequest({
        provider: primaryProvider,
        success: true,
        latency,
        audioSize: result.audioContent.length,
        fallbackUsed: false,
        requestId
      });

      logger.info('TTS synthesis successful with primary provider', {
        provider: primaryProvider,
        audioSize: result.audioContent.length,
        latency,
        requestId
      });
      return result;
    } catch (primaryError) {
      const primaryLatency = Date.now() - startTime;
      const primaryErrorMessage = getErrorMessage(primaryError);
      
      // Record primary provider failure
      ttsMetrics.recordRequest({
        provider: primaryProvider,
        success: false,
        latency: primaryLatency,
        fallbackUsed: false,
        errorCode: this.extractErrorCode(primaryError),
        requestId
      });

      logger.warn(`Primary TTS provider ${primaryProvider} failed`, {
        error: primaryErrorMessage,
        latency: primaryLatency,
        requestId
      });

      // Try fallback providers if auto-fallback is enabled
      if (config.autoFallback) {
        const availableFallbackProviders = this.getAvailableFallbackProviders(config, primaryProvider);
        
        if (availableFallbackProviders.length === 0) {
          logger.warn(`No available fallback providers for primary ${primaryProvider} - skipping fallback attempt`, {
            requestId,
            primaryError: primaryErrorMessage
          });
        } else {
          for (const fallbackProvider of availableFallbackProviders) {
            try {
            const fallbackStartTime = Date.now();
            logger.info(`Attempting TTS fallback to ${fallbackProvider}`, { requestId });
            
            const result = await this.synthesizeWithProvider(fallbackProvider, options);
            const fallbackLatency = Date.now() - fallbackStartTime;
            const totalLatency = Date.now() - startTime;
            
            result.metadata.fallbackUsed = true;
            result.metadata.error = `Primary provider ${primaryProvider} failed: ${primaryErrorMessage}`;
            
            // Record successful fallback
            ttsMetrics.recordRequest({
              provider: fallbackProvider,
              success: true,
              latency: fallbackLatency,
              audioSize: result.audioContent.length,
              fallbackUsed: true,
              fallbackReason: primaryErrorMessage,
              requestId
            });
            
            logger.info('TTS synthesis successful with fallback provider', {
              provider: fallbackProvider,
              audioSize: result.audioContent.length,
              fallbackLatency,
              totalLatency,
              requestId
            });
            return result;
          } catch (fallbackError) {
            const fallbackLatency = Date.now() - Date.now(); // Will be very short for failed attempts
            
            // Record fallback failure
            ttsMetrics.recordRequest({
              provider: fallbackProvider,
              success: false,
              latency: fallbackLatency,
              fallbackUsed: true,
              fallbackReason: primaryErrorMessage,
              errorCode: this.extractErrorCode(fallbackError),
              requestId
            });
            
            logger.warn(`TTS fallback provider ${fallbackProvider} also failed`, {
              error: getErrorMessage(fallbackError),
              requestId
            });
          }
        }
        } // Close the else block for available fallback providers
      }

      // All providers failed
      const totalLatency = Date.now() - startTime;
      
      logger.error('All TTS providers failed', {
        primaryProvider,
        primaryError: primaryErrorMessage,
        totalLatency,
        requestId
      });
      
      throw new Error(`All TTS providers failed. Primary: ${primaryErrorMessage}`);
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
    // Get the full configuration, not just ttsConfig
    if (!this.configuration) {
      await this.loadConfiguration();
    }
    
    const deepgramConfig = this.configuration?.ttsConfig?.deepgramTTS || {};

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
        // Get the full configuration, not just ttsConfig 
        if (!this.configuration) {
          await this.loadConfiguration();
        }
        const deepgramConfig = this.configuration?.ttsConfig?.deepgramTTS;
        
        // Always return available Deepgram models, even without API key
        // Users need to see available voices to make a selection
        try {
          // If there's a valid API key, test it to ensure it works
          if (deepgramConfig?.apiKey) {
            try {
              const tempService = new DeepgramTTSService(deepgramConfig.apiKey);
              const isAvailable = await tempService.isAvailable();
              if (isAvailable) {
                const models = tempService.getAvailableModels();
                return models.map(model => ({
                  voiceId: model,
                  name: model.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                  provider: 'deepgram',
                  status: 'verified'
                }));
              }
            } catch (error) {
              logger.warn('Deepgram TTS API key validation failed, returning models without verification', {
                error: getErrorMessage(error)
              });
            }
          }
          
          // Return available models even without API key or if validation failed
          // This allows users to see and select voices before configuring API key
          const tempService = new DeepgramTTSService('dummy-key'); // Use dummy key to get models list
          const models = tempService.getAvailableModels();
          return models.map(model => ({
            voiceId: model,
            name: model.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            provider: 'deepgram',
            status: deepgramConfig?.apiKey ? 'unverified' : 'needs_api_key'
          }));
        } catch (error) {
          logger.error('Failed to get Deepgram TTS models', {
            error: getErrorMessage(error)
          });
          return [];
        }

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