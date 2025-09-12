// Basic Voice Configuration Service - No Training or Hardcoded Data
import { logger, getErrorMessage } from '../index';
import { VoicePersonality } from './enhancedVoiceAIService';

export class VoiceTrainingService {
  constructor() {
    // No initialization needed - rely entirely on external APIs
  }

  // Report that the system relies on external APIs instead of training
  async getSystemStatus(): Promise<{
    isTrainingBased: boolean;
    dependencies: string[];
    message: string;
  }> {
    return {
      isTrainingBased: false,
      dependencies: [
        'ElevenLabs API for voice generation',
        'LLM APIs for conversational AI',
        'Twilio API for telephony'
      ],
      message: 'System uses external APIs only. No local training or hardcoded data.'
    };
  }



  // Legacy method compatibility - returns error indicating no training
  async trainPersonalityAdaptation(): Promise<never> {
    const error = new Error('Training functionality removed. System relies on external APIs only.');
    logger.error('Attempt to use removed training functionality:', error.message);
    throw error;
  }

  // Legacy method compatibility - returns error indicating no training
  async trainBilingualConversation(): Promise<never> {
    const error = new Error('Training functionality removed. System relies on external APIs only.');
    logger.error('Attempt to use removed training functionality:', error.message);
    throw error;
  }

  // Legacy method compatibility - returns error indicating no training
  async trainCompleteVoiceModel(): Promise<never> {
    const error = new Error('Training functionality removed. System relies on external APIs only.');
    logger.error('Attempt to use removed training functionality:', error.message);
    throw error;
  }
}

export default VoiceTrainingService;
