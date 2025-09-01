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
  options?: { encoding?: string; sampleRate?: number; model?: string; provider?: string }
): Promise<{ audioContent: Buffer | null; method: 'tts' | 'fallback' }> {
  try {
    // Use the explicitly provided provider if available, otherwise use the system default
    const selectedProvider = options?.provider || configuration?.ttsConfig?.provider || 'elevenlabs';
    
    logger.info(`Synthesizing speech with provider: ${selectedProvider}, voice: ${voiceId}`);
    
    // Use TTSProviderService for unified handling
    const ttsProviderService = new TTSProviderService();
    const response = await ttsProviderService.synthesizeSpeech({
      text,
      voiceId,
      model: options?.model,
      language,
      encoding: options?.encoding,
      sampleRate: options?.sampleRate,
      provider: selectedProvider // Explicitly pass the provider
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
  const selectedProvider = configuration?.ttsConfig?.provider || 'elevenlabs';
  
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