import logger from './logger';
import { getErrorMessage } from './logger';
import { synthesizeSpeechWithProvider, isTTSProviderConfigured } from './ttsServiceFactory';
import Configuration from '../models/Configuration';
import Campaign from '../models/Campaign';
import { getPreferredVoiceId } from './voiceUtils';

/**
 * Synthesize speech with proper TTS provider fallback chain
 * This ensures we use configured TTS providers before falling back to Twilio voices
 */
export async function synthesizeWithTTSChain(
  text: string,
  options: {
    callId?: string;
    campaignId?: string;
    voiceId?: string;
    language?: string;
  } = {}
): Promise<{
  success: boolean;
  audioContent?: Buffer;
  shouldUseTwilioFallback: boolean;
  twilioVoiceConfig?: {
    voice: string;
    language: string;
  };
}> {
  const { callId, campaignId, voiceId, language = 'en' } = options;
  
  try {
    // Get configuration
    const config = await Configuration.findOne();
    if (!config) {
      logger.warn(`No configuration found for TTS synthesis in call ${callId}`);
      return { 
        success: false, 
        shouldUseTwilioFallback: true,
        twilioVoiceConfig: {
          voice: 'alice',
          language: language === 'hi' ? 'hi-IN' : 'en-US'
        }
      };
    }

    // Get campaign if available for voice settings
    let campaign = null;
    if (campaignId) {
      campaign = await Campaign.findById(campaignId);
    }

    // Determine voice ID to use
    let resolvedVoiceId = voiceId;
    if (!resolvedVoiceId && campaign?.voiceConfiguration?.voiceId) {
      resolvedVoiceId = campaign.voiceConfiguration.voiceId;
    }
    if (!resolvedVoiceId) {
      resolvedVoiceId = await getPreferredVoiceId();
    }

    logger.info(`Attempting TTS synthesis with voice: ${resolvedVoiceId} for call ${callId}`);

    // Check if any TTS provider is configured
    if (!isTTSProviderConfigured(config, resolvedVoiceId)) {
      logger.warn(`No TTS provider configured for voice ${resolvedVoiceId} in call ${callId}`);
      return { 
        success: false, 
        shouldUseTwilioFallback: true,
        twilioVoiceConfig: {
          voice: 'alice',
          language: campaign?.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US'
        }
      };
    }

    // Try synthesis with the configured provider
    const speechResponse = await synthesizeSpeechWithProvider(
      config,
      text,
      resolvedVoiceId,
      language
    );

    if (speechResponse.audioContent && speechResponse.method === 'tts') {
      logger.info(`TTS synthesis successful with provider for call ${callId}`);
      return {
        success: true,
        audioContent: speechResponse.audioContent,
        shouldUseTwilioFallback: false
      };
    } else {
      logger.warn(`TTS synthesis failed for call ${callId}, no audio content returned`);
      return { 
        success: false, 
        shouldUseTwilioFallback: true,
        twilioVoiceConfig: {
          voice: 'alice',
          language: campaign?.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US'
        }
      };
    }

  } catch (error) {
    logger.error(`Error in TTS synthesis chain for call ${callId}: ${getErrorMessage(error)}`);
    return { 
      success: false, 
      shouldUseTwilioFallback: true,
      twilioVoiceConfig: {
        voice: 'alice',
        language: language === 'hi' ? 'hi-IN' : 'en-US'
      }
    };
  }
}

/**
 * Split text into chunks for chunked TTS synthesis
 */
export function splitTextIntoChunks(text: string, maxChunkSize = 300): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: string[] = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;
    
    // If adding this sentence would exceed the limit, save the current chunk
    if (currentChunk.length + trimmedSentence.length + 1 > maxChunkSize) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = trimmedSentence;
    } else {
      currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
    }
  }
  
  // Add the final chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // If no chunks were created (e.g., single very long sentence), force split
  if (chunks.length === 0 && text.trim()) {
    const words = text.trim().split(' ');
    let chunk = '';
    
    for (const word of words) {
      if (chunk.length + word.length + 1 > maxChunkSize) {
        if (chunk.trim()) {
          chunks.push(chunk.trim());
        }
        chunk = word;
      } else {
        chunk += (chunk ? ' ' : '') + word;
      }
    }
    
    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }
  }
  
  return chunks;
}