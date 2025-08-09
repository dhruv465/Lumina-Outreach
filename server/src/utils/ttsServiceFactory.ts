import logger from './logger';
import { getErrorMessage } from '../index';
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
  language: string = 'en'
): Promise<{ audioContent: Buffer | null; method: 'tts' | 'fallback' }> {
  try {
    const ttsService = await getTTSService(configuration);
    
    if (!ttsService) {
      logger.warn('No TTS service available, using fallback');
      return { audioContent: null, method: 'fallback' };
    }
    
    const selectedProvider = configuration?.ttsConfig?.provider || 'elevenlabs';
    
    if (selectedProvider === 'elevenlabs') {
      // Use ElevenLabs service
      const response = await ttsService.synthesizeAdaptiveVoice({
        text,
        personalityId: voiceId || 'XvRdSQXvmv5jHPGBw0XU',
        language
      });
      
      return {
        audioContent: response.audioContent,
        method: 'tts'
      };
    } else if (selectedProvider === 'deepgram') {
      // Use TTS Provider Service for Deepgram
      const response = await ttsService.synthesizeSpeech({
        text,
        voiceId: voiceId || 'aura-2-thalia-en',
        language
      });
      
      return {
        audioContent: response.audioContent,
        method: 'tts'
      };
    } else {
      logger.warn(`TTS synthesis not implemented for provider: ${selectedProvider}`);
      return { audioContent: null, method: 'fallback' };
    }
  } catch (error) {
    logger.error(`Error synthesizing speech: ${getErrorMessage(error)}`);
    return { audioContent: null, method: 'fallback' };
  }
}

/**
 * Check if the selected TTS provider is properly configured
 */
export function isTTSProviderConfigured(configuration: any): boolean {
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