import logger from './logger';
import { getErrorMessage } from './logger';
import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import { TTSProviderService } from '../services/ttsProviderService';

/**
 * Factory function to get the appropriate TTS service based on configuration
 */
export async function getTTSService(configuration: any): Promise<any> {
  try {
    const selectedProvider = configuration?.ttsConfig?.provider || 'elevenlabs';
    
    logger.info(`Getting TTS service for provider: ${selectedProvider}`);
    
    switch (selectedProvider) {
      case 'elevenlabs':
        if (configuration?.elevenLabsConfig?.apiKey) {
          return new EnhancedVoiceAIService(configuration.elevenLabsConfig.apiKey);
        } else {
          logger.warn('ElevenLabs selected as TTS provider but no API key available');
          return null;
        }
        
      case 'deepgram':
        if (configuration?.ttsConfig?.deepgramTTS?.apiKey) {
          // Use the TTS Provider Service for Deepgram
          const ttsService = new TTSProviderService();
          return ttsService;
        } else {
          logger.warn('Deepgram selected as TTS provider but no API key available');
          return null;
        }
        
      case 'openai':
      case 'google':
      case 'aws':
        logger.info(`TTS provider ${selectedProvider} not yet implemented`);
        return null;
        
      default:
        logger.warn(`Unknown TTS provider: ${selectedProvider}`);
        return null;
    }
  } catch (error) {
    logger.error(`Error getting TTS service: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Synthesize speech using the configured TTS provider
 */
export async function synthesizeSpeechWithProvider(
  configuration: any,
  text: string,
  voiceId?: string,
  language = 'en',
  options?: { encoding?: string; sampleRate?: number; model?: string }
): Promise<{ audioContent: Buffer | null; method: 'tts' | 'fallback' }> {
  try {
    // Auto-detect provider based on voice ID if it looks like a Deepgram model
    let selectedProvider = configuration?.ttsConfig?.provider || 'elevenlabs';
    
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
      
      // Only override provider if voice ID is explicitly a Deepgram model
      if (deepgramModels.includes(voiceId)) {
        selectedProvider = 'deepgram';
        logger.info(`Auto-detected Deepgram provider based on voice ID: ${voiceId}`);
      }
      // For non-Deepgram voices, keep the configured provider
    }
    
    logger.info(`Synthesizing speech with provider: ${selectedProvider}, voice: ${voiceId}`);
    
    // Use TTSProviderService for unified handling
    const ttsProviderService = new TTSProviderService();
    const response = await ttsProviderService.synthesizeSpeech({
      text,
      voiceId: voiceId || (selectedProvider === 'deepgram' ? 'aura-2-thalia-en' : 'XvRdSQXvmv5jHPGBw0XU'),
      model: options?.model,
      language,
      encoding: options?.encoding,
      sampleRate: options?.sampleRate
    });
    
    return {
      audioContent: response.audioContent,
      method: 'tts'
    };
  } catch (error) {
    logger.error(`Error synthesizing speech: ${getErrorMessage(error)}`);
    return { audioContent: null, method: 'fallback' };
  }
}

/**
 * Check if the selected TTS provider is properly configured
 */
export function isTTSProviderConfigured(configuration: any, voiceId?: string): boolean {
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
      return !!(configuration?.elevenLabsConfig?.apiKey);
    case 'deepgram':
      return !!(configuration?.ttsConfig?.deepgramTTS?.apiKey);
    case 'openai':
    case 'google':
    case 'aws':
      // These providers are not yet implemented
      return false;
    default:
      return false;
  }
}

/**
 * Check if any TTS provider is properly configured, regardless of which one is selected
 */
export function hasAnyTTSProviderConfigured(configuration: any): boolean {
  return !!(
    configuration?.elevenLabsConfig?.apiKey || 
    configuration?.ttsConfig?.deepgramTTS?.apiKey
    // Add more providers as they are implemented
  );
}

/**
 * Get required API keys for a specific TTS provider
 */
export function getRequiredApiKeysForProvider(provider: string): string[] {
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
}