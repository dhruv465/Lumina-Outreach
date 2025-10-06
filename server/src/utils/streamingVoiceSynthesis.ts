import Configuration from '../models/Configuration';
import Campaign from '../models/Campaign';
import logger from './logger';
import { getErrorMessage } from './logger';
import { getPreferredVoiceId } from './voiceUtils';
import { StreamingTTSService, initializeStreamingTTS, getStreamingTTSService } from '../services/streamingTTSService';
import { StreamingAudioPipeline, initializeStreamingAudioPipeline, getStreamingAudioPipeline } from '../services/streamingAudioPipeline';

export interface StreamingVoiceOptions {
  callId: string;
  conversationId: string;
  text: string;
  voiceId?: string;
  language?: string;
  campaignId?: string;
  enableStreaming?: boolean;
  chunkSize?: number;
  maxChunkSize?: number;
}

export interface StreamingVoiceResult {
  success: boolean;
  method: 'streaming' | 'cloudinary' | 'fallback';
  url?: string;
  totalSize: number;
  chunkCount: number;
  latency: number;
  error?: string;
}

/**
 * Synthesize voice with streaming support for ultra-low latency
 * Streams audio chunks as they're generated instead of waiting for complete synthesis
 */
export async function synthesizeVoiceWithStreaming(
  options: StreamingVoiceOptions,
  sendAudioToTwilio: (audioChunk: Buffer) => void
): Promise<StreamingVoiceResult> {
  const {
    callId,
    conversationId,
    text,
    voiceId: requestedVoiceId,
    language = 'en',
    campaignId,
    enableStreaming = true,
    chunkSize = 1024,
    maxChunkSize = 30 * 1024
  } = options;

  const startTime = Date.now();

  try {
    // Skip if text is empty
    if (!text || text.trim() === '') {
      logger.error('Empty text provided to streaming voice synthesis');
      throw new Error('Empty text provided for voice synthesis');
    }

    logger.info(`Starting streaming voice synthesis for call ${callId}`, {
      textLength: text.length,
      voiceId: requestedVoiceId,
      language,
      enableStreaming,
      chunkSize
    });

    // Get configuration
    const config = await Configuration.findOne();
    if (!config) {
      throw new Error('No configuration found for voice synthesis');
    }

    // Resolve voice ID
    let finalVoiceId = requestedVoiceId;
    if (!finalVoiceId) {
      try {
        if (campaignId) {
          const campaign = await Campaign.findById(campaignId);
          if (campaign?.voiceConfiguration?.voiceId) {
            finalVoiceId = campaign.voiceConfiguration.voiceId;
          }
        }
        
        if (!finalVoiceId) {
          finalVoiceId = await getPreferredVoiceId();
        }
      } catch (error) {
        logger.error(`Error fetching campaign voice: ${getErrorMessage(error)}`);
        finalVoiceId = await getPreferredVoiceId();
      }
    }

    // Check if streaming is enabled and Deepgram is available
    if (enableStreaming && config.ttsConfig?.deepgramTTS?.isEnabled && config.ttsConfig?.deepgramTTS?.apiKey) {
      try {
        // Initialize streaming TTS service if not already done
        let streamingTTS = getStreamingTTSService();
        if (!streamingTTS) {
          streamingTTS = initializeStreamingTTS(config.ttsConfig.deepgramTTS.apiKey);
        }

        // Initialize streaming audio pipeline if not already done
        let streamingPipeline = getStreamingAudioPipeline();
        if (!streamingPipeline) {
          streamingPipeline = initializeStreamingAudioPipeline(streamingTTS);
        }

        // Use streaming audio pipeline
        const result = await streamingPipeline.streamAudioToTwilio(
          {
            callId,
            conversationId,
            text,
            voiceId: finalVoiceId,
            language,
            chunkSize,
            maxChunkSize,
            enableCloudinary: true,
            enableTwilioStreaming: true
          },
          sendAudioToTwilio
        );

        const latency = Date.now() - startTime;
        logger.info(`Streaming voice synthesis completed for call ${callId}`, {
          method: result.method,
          totalSize: result.totalSize,
          chunkCount: result.chunkCount,
          latency,
          success: result.success
        });

        return {
          ...result,
          latency
        };

      } catch (streamingError) {
        logger.error(`Streaming voice synthesis failed for call ${callId}, falling back to standard synthesis`, {
          error: getErrorMessage(streamingError),
          textLength: text.length
        });

        // Fall back to standard synthesis
        return await fallbackToStandardSynthesis(options, sendAudioToTwilio);
      }
    } else {
      logger.info(`Streaming not enabled or Deepgram not available for call ${callId}, using standard synthesis`);
      return await fallbackToStandardSynthesis(options, sendAudioToTwilio);
    }

  } catch (error) {
    const latency = Date.now() - startTime;
    logger.error(`Streaming voice synthesis failed for call ${callId}`, {
      error: getErrorMessage(error),
      textLength: text.length,
      latency
    });

    return {
      success: false,
      method: 'fallback',
      totalSize: 0,
      chunkCount: 0,
      latency,
      error: getErrorMessage(error)
    };
  }
}

/**
 * Fallback to standard voice synthesis when streaming is not available
 */
async function fallbackToStandardSynthesis(
  options: StreamingVoiceOptions,
  sendAudioToTwilio: (audioChunk: Buffer) => void
): Promise<StreamingVoiceResult> {
  const { callId, conversationId, text, voiceId, language, campaignId } = options;
  const startTime = Date.now();

  try {
    // Use the existing TTS service factory
    const { synthesizeSpeechWithProvider } = await import('./ttsServiceFactory');
    
    // Get configuration
    const config = await Configuration.findOne();
    if (!config) {
      throw new Error('No configuration found for voice synthesis');
    }

    // Resolve voice ID
    let finalVoiceId = voiceId;
    if (!finalVoiceId) {
      try {
        if (campaignId) {
          const campaign = await Campaign.findById(campaignId);
          if (campaign?.voiceConfiguration?.voiceId) {
            finalVoiceId = campaign.voiceConfiguration.voiceId;
          }
        }
        
        if (!finalVoiceId) {
          finalVoiceId = await getPreferredVoiceId();
        }
      } catch (error) {
        logger.error(`Error fetching campaign voice: ${getErrorMessage(error)}`);
        finalVoiceId = await getPreferredVoiceId();
      }
    }

    // Synthesize speech using standard method
    const speechResponse = await synthesizeSpeechWithProvider(
      config,
      text,
      finalVoiceId,
      language
    );

    if (speechResponse.audioContent && speechResponse.method === 'tts') {
      // Send the complete audio as a single chunk
      sendAudioToTwilio(speechResponse.audioContent);
      
      const latency = Date.now() - startTime;
      logger.info(`Standard voice synthesis completed for call ${callId}`, {
        totalSize: speechResponse.audioContent.length,
        latency
      });

      return {
        success: true,
        method: 'streaming', // Mark as streaming since we sent it
        totalSize: speechResponse.audioContent.length,
        chunkCount: 1,
        latency
      };
    } else {
      throw new Error('Standard TTS synthesis failed or returned empty content');
    }

  } catch (error) {
    const latency = Date.now() - startTime;
    logger.error(`Standard voice synthesis failed for call ${callId}`, {
      error: getErrorMessage(error),
      textLength: text.length,
      latency
    });

    return {
      success: false,
      method: 'fallback',
      totalSize: 0,
      chunkCount: 0,
      latency,
      error: getErrorMessage(error)
    };
  }
}

/**
 * Synthesize voice with WebSocket streaming for real-time applications
 */
export async function synthesizeVoiceWebSocket(
  options: StreamingVoiceOptions,
  sendAudioToTwilio: (audioChunk: Buffer) => void
): Promise<{
  start: () => void;
  stop: () => void;
  onProgress: (callback: (progress: { chunkCount: number; totalSize: number }) => void) => void;
}> {
  const { callId, conversationId, text, voiceId, language, campaignId } = options;

  try {
    // Get configuration
    const config = await Configuration.findOne();
    if (!config) {
      throw new Error('No configuration found for voice synthesis');
    }

    // Check if Deepgram is available
    if (!config.ttsConfig?.deepgramTTS?.isEnabled || !config.ttsConfig?.deepgramTTS?.apiKey) {
      throw new Error('Deepgram TTS not available for WebSocket streaming');
    }

    // Initialize streaming TTS service if not already done
    let streamingTTS = getStreamingTTSService();
    if (!streamingTTS) {
      streamingTTS = initializeStreamingTTS(config.ttsConfig.deepgramTTS.apiKey);
    }

    // Initialize streaming audio pipeline if not already done
    let streamingPipeline = getStreamingAudioPipeline();
    if (!streamingPipeline) {
      streamingPipeline = initializeStreamingAudioPipeline(streamingTTS);
    }

    // Resolve voice ID
    let finalVoiceId = voiceId;
    if (!finalVoiceId) {
      try {
        if (campaignId) {
          const campaign = await Campaign.findById(campaignId);
          if (campaign?.voiceConfiguration?.voiceId) {
            finalVoiceId = campaign.voiceConfiguration.voiceId;
          }
        }
        
        if (!finalVoiceId) {
          finalVoiceId = await getPreferredVoiceId();
        }
      } catch (error) {
        logger.error(`Error fetching campaign voice: ${getErrorMessage(error)}`);
        finalVoiceId = await getPreferredVoiceId();
      }
    }

    // Use WebSocket streaming
    return await streamingPipeline.streamAudioWebSocket(
      {
        callId,
        conversationId,
        text,
        voiceId: finalVoiceId,
        language,
        chunkSize: 1024
      },
      sendAudioToTwilio
    );

  } catch (error) {
    logger.error(`WebSocket voice synthesis setup failed for call ${callId}`, {
      error: getErrorMessage(error),
      textLength: text.length
    });

    throw error;
  }
}

/**
 * Get streaming statistics for monitoring
 */
export function getStreamingStats(): {
  activeStreams: number;
  totalChunks: number;
  averageChunkSize: number;
} {
  const pipeline = getStreamingAudioPipeline();
  if (pipeline) {
    return pipeline.getStreamingStats();
  }
  
  return {
    activeStreams: 0,
    totalChunks: 0,
    averageChunkSize: 0
  };
}

/**
 * Clean up streaming resources
 */
export function cleanupStreaming(): void {
  const pipeline = getStreamingAudioPipeline();
  if (pipeline) {
    pipeline.cleanup();
  }
}