import mongoose from 'mongoose';
import logger from './logger';

/**
 * Get the preferred voice ID from system configuration
 * 
 * This function retrieves the preferred voice ID with fallback strategies:
 * 1. First tries to get the selectedVoiceId from elevenLabsConfig
 * 2. Then tries to get the defaultVoiceId from voiceAIConfig.conversationalAI
 * 3. Falls back to the first available voice in the system
 * 4. If specified, returns the hardcoded fallback voiceId
 * 
 * @param fallbackVoiceId Optional fallback voice ID to use if no configuration is found
 * @returns Promise<string> The preferred voice ID
 */
export async function getPreferredVoiceId(fallbackVoiceId = 'pFZP5JQG7iQjIQuC4Bku'): Promise<string> {
  try {
    const configuration = await mongoose.model('Configuration').findOne();
    
    if (!configuration) {
      logger.warn('No configuration found when getting preferred voice ID, using fallback');
      return fallbackVoiceId;
    }

    // Priority 1: Check elevenLabsConfig.selectedVoiceId
    if (configuration.elevenLabsConfig?.selectedVoiceId) {
      logger.info(`Using selectedVoiceId from elevenLabsConfig: ${configuration.elevenLabsConfig.selectedVoiceId}`);
      return configuration.elevenLabsConfig.selectedVoiceId;
    }
    
    // Priority 2: Check voiceAIConfig.conversationalAI.defaultVoiceId
    if (configuration.voiceAIConfig?.conversationalAI?.defaultVoiceId) {
      logger.info(`Using defaultVoiceId from voiceAIConfig: ${configuration.voiceAIConfig.conversationalAI.defaultVoiceId}`);
      return configuration.voiceAIConfig.conversationalAI.defaultVoiceId;
    }
    
    // Priority 3: Use the first available voice in the system
    if (configuration.elevenLabsConfig?.availableVoices?.length > 0) {
      const firstVoice = configuration.elevenLabsConfig.availableVoices[0].voiceId;
      logger.info(`Using first available voice from elevenLabsConfig: ${firstVoice}`);
      return firstVoice;
    }
    
    // Priority 4: Use the fallback voiceId
    logger.warn(`No voice ID found in configuration, using fallback: ${fallbackVoiceId}`);
    return fallbackVoiceId;
  } catch (error) {
    logger.error(`Error getting preferred voice ID: ${error instanceof Error ? error.message : String(error)}`);
    return fallbackVoiceId;
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
