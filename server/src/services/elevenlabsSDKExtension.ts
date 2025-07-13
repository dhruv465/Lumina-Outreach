/**
 * Extension for ElevenLabsSDKService to add streaming speech generation
 * This extension adds the streamSpeechGeneration method to the ElevenLabsSDKService class
 * It's implemented as a separate file to avoid modifying the original service directly
 */

import { ElevenLabsSDKService } from './elevenlabsSDKService';
import { logger, getErrorMessage } from '../index';
import responseCache from '../utils/responseCache';

/**
 * Extend the ElevenLabsSDKService prototype with the streamSpeechGeneration method
 */
ElevenLabsSDKService.prototype.streamSpeechGeneration = async function(
  text: string,
  voiceId: string,
  onAudioChunk: (chunk: Buffer) => void,
  options?: {
    optimizeLatency?: boolean;
    stability?: number;
    similarityBoost?: number;
    style?: number;
  },
  persistentConversationId?: string
): Promise<void> {
  try {
    // Check cache first for common phrases
    const cacheKey = `${voiceId}_${text}`;
    if (responseCache.has(cacheKey)) {
      const cachedAudio = responseCache.get(cacheKey);
      if (cachedAudio) {
        logger.debug(`Using cached audio for text: "${text.substring(0, 20)}..."`);
        onAudioChunk(cachedAudio);
        return;
      }
    }
    
    // Use optimized settings for latency by default
    const streamOptions = {
      latencyOptimization: options?.optimizeLatency !== false ? 3 : 0, // Maximum optimization
      voiceSettings: {
        stability: options?.stability || 0.5, // Lower stability for faster generation
        similarityBoost: options?.similarityBoost || 0.75,
        style: options?.style || 0.0,
        speakerBoost: true
      }
    };
    
    // Use the provided persistent conversation ID, or determine a stable one
    let conversationId: string;
    if (persistentConversationId) {
      // Use the provided conversation ID to maintain persistent voice settings
      conversationId = persistentConversationId;
      
      // Ensure the conversation exists in our conversations map
      if (!this.conversations.has(conversationId)) {
        // Create the conversation entry with the specific ID
        this.conversations.set(conversationId, {
          id: conversationId,
          createdAt: new Date(),
          lastActivity: new Date(),
          active: true,
          messages: [],
          isGenerating: false
        });
        logger.debug(`Created conversation entry for persistent ID: ${conversationId}`);
      } else {
        logger.debug(`Using existing persistent conversation ID: ${conversationId}`);
      }
    } else {
      // Fallback to existing behavior for backward compatibility
      const existingIds = Array.from(this.conversations.keys());
      if (existingIds.length > 0) {
        // Use the most recent conversation ID to maintain voice settings
        conversationId = existingIds[existingIds.length - 1] as string;
        logger.debug(`Reusing existing conversation ID: ${conversationId}`);
      } else {
        // Create a new persistent conversation if none exists
        conversationId = this.createConversation();
        logger.debug(`Created new persistent conversation ID: ${conversationId}`);
      }
    }
    
    // Use the streamSpeech method to stream the speech
    await this.streamSpeech(
      conversationId,
      text,
      voiceId,
      onAudioChunk,
      streamOptions
    );
    
    // Cache the response if it's short (less than 100 chars)
    if (text.length < 100) {
      try {
        // Generate the complete audio in the background for caching
        this.generateSpeech(text, voiceId, { optimizeLatency: true })
          .then(buffer => {
            responseCache.set(cacheKey, buffer);
            logger.debug(`Cached response for future use: "${text.substring(0, 20)}..."`);
          })
          .catch(err => {
            logger.debug(`Failed to cache response: ${getErrorMessage(err)}`);
          });
      } catch (cacheError) {
        // Ignore cache errors - caching is optional
        logger.debug(`Error in background caching: ${getErrorMessage(cacheError)}`);
      }
    }
  } catch (error) {
    logger.error(`Error streaming speech generation: ${getErrorMessage(error)}`);
    throw new Error(`Failed to stream speech: ${getErrorMessage(error)}`);
  }
};

// Export the modified service to ensure TypeScript picks up the change
export {};
