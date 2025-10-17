import mongoose from 'mongoose';
import logger from './logger';

/**
 * Get the preferred voice ID from system configuration
 * 
 * This function retrieves the preferred voice ID with fallback strategies based on the selected TTS provider:
 * 1. Checks the selected TTS provider (Deepgram or ElevenLabs)
 * 2. Returns appropriate voice ID for that provider
 * 3. Falls back to provider-specific defaults
 * 
 * @param fallbackVoiceId Optional fallback voice ID to use if no configuration is found
 * @returns Promise<string> The preferred voice ID
 */
export async function getPreferredVoiceId(fallbackVoiceId?: string): Promise<string> {
  try {
    const configuration = await mongoose.model('Configuration').findOne();
    
    if (!configuration) {
      logger.warn('No configuration found when getting preferred voice ID, using fallback');
      return fallbackVoiceId || 'pFZP5JQG7iQjIQuC4Bku';
    }

    // Check which TTS provider is selected
    const ttsProvider = configuration.ttsConfig?.provider || 'elevenlabs';
    logger.info(`Getting preferred voice ID for TTS provider: ${ttsProvider}`);

    if (ttsProvider === 'deepgram') {
      // Deepgram voice ID logic
      // Priority 1: Check deepgramConfig.selectedVoiceId
      if (configuration.deepgramConfig?.selectedVoiceId) {
        logger.info(`Using selectedVoiceId from deepgramConfig: ${configuration.deepgramConfig.selectedVoiceId}`);
        return configuration.deepgramConfig.selectedVoiceId;
      }
      
      // Priority 2: Check voiceAIConfig.conversationalAI.defaultVoiceId (if it's a Deepgram voice)
      const defaultVoiceId = configuration.voiceAIConfig?.conversationalAI?.defaultVoiceId;
      if (defaultVoiceId && defaultVoiceId.startsWith('aura-')) {
        logger.info(`Using Deepgram defaultVoiceId from voiceAIConfig: ${defaultVoiceId}`);
        return defaultVoiceId;
      }
      
      // Priority 3: Use Deepgram default
      const deepgramDefault = 'aura-asteria-en';
      logger.info(`Using Deepgram default voice: ${deepgramDefault}`);
      return deepgramDefault;
    } else {
      // ElevenLabs voice ID logic
      // Priority 1: Check elevenLabsConfig.selectedVoiceId
      if (configuration.elevenLabsConfig?.selectedVoiceId) {
        logger.info(`Using selectedVoiceId from elevenLabsConfig: ${configuration.elevenLabsConfig.selectedVoiceId}`);
        return configuration.elevenLabsConfig.selectedVoiceId;
      }
      
      // Priority 2: Check voiceAIConfig.conversationalAI.defaultVoiceId (if it's an ElevenLabs voice)
      const defaultVoiceId = configuration.voiceAIConfig?.conversationalAI?.defaultVoiceId;
      if (defaultVoiceId && !defaultVoiceId.startsWith('aura-')) {
        logger.info(`Using ElevenLabs defaultVoiceId from voiceAIConfig: ${defaultVoiceId}`);
        return defaultVoiceId;
      }
      
      // Priority 3: Use the first available voice in the system
      if (configuration.elevenLabsConfig?.availableVoices?.length > 0) {
        const firstVoice = configuration.elevenLabsConfig.availableVoices[0].voiceId;
        logger.info(`Using first available voice from elevenLabsConfig: ${firstVoice}`);
        return firstVoice;
      }
      
      // Priority 4: Use the fallback voiceId
      const elevenLabsFallback = fallbackVoiceId || 'pFZP5JQG7iQjIQuC4Bku';
      logger.warn(`No voice ID found in configuration, using ElevenLabs fallback: ${elevenLabsFallback}`);
      return elevenLabsFallback;
    }
  } catch (error) {
    logger.error(`Error getting preferred voice ID: ${error instanceof Error ? error.message : String(error)}`);
    return fallbackVoiceId || 'pFZP5JQG7iQjIQuC4Bku';
  }
}

/**
 * Validate if a voice ID exists in the system configuration
 * 
 * @param voiceId The voice ID to validate
 * @returns Promise<boolean> True if the voice ID exists in the system
 */
export async function isValidVoiceId(voiceId: string): Promise<boolean> {
  try {
    const configuration = await mongoose.model('Configuration').findOne();
    
    if (!configuration || !configuration.elevenLabsConfig?.availableVoices) {
      return false;
    }
    
    return configuration.elevenLabsConfig.availableVoices.some(voice => voice.voiceId === voiceId);
  } catch (error) {
    logger.error(`Error validating voice ID: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
