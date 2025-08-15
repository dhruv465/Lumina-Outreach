/**
 * Deepgram TTS API verification utility
 * Handles validation, verification, and model management for Deepgram TTS API
 */
import { createClient } from '@deepgram/sdk';
import logger from './logger';
import { getErrorMessage } from './logger';
import Configuration from '../models/Configuration';

// Types for Deepgram TTS verification
interface DeepgramTTSVerificationResult {
  success: boolean;
  status: 'verified' | 'failed' | 'unverified';
  error?: string;
  errorCode?: string;
  message?: string;
  latency?: number;
  availableModels?: string[];
}

/**
 * Verify Deepgram TTS API key by attempting a short synthesis
 * @param apiKey Deepgram API key to verify
 * @returns Verification result with available models if successful
 */
export async function verifyDeepgramTTSApi(apiKey: string): Promise<DeepgramTTSVerificationResult> {
  if (!apiKey || apiKey.trim() === '') {
    return {
      success: false,
      status: 'failed',
      error: 'API key is empty',
      message: 'Please provide a valid Deepgram API key'
    };
  }

  const startTime = Date.now();

  try {
    // Initialize Deepgram client
    const client = createClient(apiKey);

    // Attempt a short test synthesis
    const testText = 'Hello';
    const synthesisOptions = {
      model: 'aura-asteria-en',
      encoding: 'mp3' as const
    };

    logger.debug('Testing Deepgram TTS API with test synthesis', {
      model: synthesisOptions.model,
      encoding: synthesisOptions.encoding
    });

    // Make the TTS request
    const response = await client.speak.request(
      { text: testText },
      synthesisOptions
    );

    const stream = await response.getStream();
    
    if (!stream) {
      return {
        success: false,
        status: 'failed',
        error: 'No audio stream returned',
        message: 'Deepgram TTS API did not return audio data'
      };
    }

    // Convert stream to buffer to verify we got actual audio data
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const audioBuffer = Buffer.concat(chunks);
    
    if (audioBuffer.length === 0) {
      return {
        success: false,
        status: 'failed',
        error: 'Empty audio response',
        message: 'Deepgram TTS API returned empty audio data'
      };
    }

    // Calculate latency
    const latency = Date.now() - startTime;

    // Get available models (static list for Deepgram TTS)
    const availableModels = [
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

    return {
      success: true,
      status: 'verified',
      message: `Deepgram TTS API verified successfully. Latency: ${latency}ms, Audio size: ${audioBuffer.length} bytes`,
      latency,
      availableModels
    };

  } catch (error: any) {
    // Extract error information
    let errorMessage = getErrorMessage(error);
    let errorCode = '';
    const latency = Date.now() - startTime;

    // Parse Deepgram-specific errors
    if (error.response) {
      const statusCode = error.response.status;
      errorCode = `HTTP ${statusCode}`;

      // Check for common status codes
      if (statusCode === 401) {
        errorMessage = 'Authentication failed. Invalid API key.';
      } else if (statusCode === 403) {
        errorMessage = 'Access forbidden. Your account may have insufficient permissions.';
      } else if (statusCode === 429) {
        errorMessage = 'Rate limit exceeded. Too many requests.';
      } else if (statusCode === 400) {
        errorMessage = 'Bad request. Check your API configuration.';
      }

      // Parse error details from response if available
      if (error.response.data) {
        if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (error.response.data.error) {
          errorMessage = error.response.data.error;
        }
      }
    }

    logger.error(`Deepgram TTS API verification failed: ${errorMessage}`, {
      errorCode,
      latency,
      errorDetails: error
    });

    return {
      success: false,
      status: 'failed',
      error: errorMessage,
      errorCode,
      latency,
      message: `Failed to verify Deepgram TTS API: ${errorMessage}`
    };
  }
}

/**
 * Update Deepgram TTS configuration status in the database
 * @param status New status ('verified', 'failed', 'unverified')
 * @param details Additional details to store
 */
export async function updateDeepgramTTSStatus(
  status: 'verified' | 'failed' | 'unverified', 
  details?: any
): Promise<void> {
  try {
    const update: any = {
      'ttsConfig.deepgramTTS.status': status,
      'ttsConfig.deepgramTTS.lastVerified': new Date()
    };

    // Add additional fields if provided
    if (details?.availableModels) {
      update['ttsConfig.deepgramTTS.availableModels'] = details.availableModels;
    }

    if (details?.error) {
      update['ttsConfig.deepgramTTS.lastError'] = details.error;
    }

    // Ensure the ttsConfig exists
    const config = await Configuration.findOne({});
    if (config && !config.ttsConfig) {
      update['ttsConfig'] = {
        provider: 'elevenlabs',
        primaryProvider: 'elevenlabs',
        fallbackProviders: ['deepgram'],
        autoFallback: true,
        deepgramTTS: {
          apiKey: '',
          isEnabled: false,
          defaultModel: 'aura-asteria-en',
          availableModels: details?.availableModels || [],
          voiceSettings: {
            encoding: 'mp3',
            sampleRate: 24000
          },
          status,
          lastVerified: new Date(),
          lastError: details?.error
        }
      };
    }

    // Update the configuration
    await Configuration.findOneAndUpdate({}, update, { new: true });
    
    logger.info(`Updated Deepgram TTS status to ${status}`, { details });
  } catch (updateError) {
    logger.error(`Failed to update Deepgram TTS status: ${getErrorMessage(updateError)}`);
  }
}

/**
 * Verify Deepgram TTS API key and update status in database
 * @param apiKey Deepgram API key to verify
 * @returns Verification result
 */
export async function verifyAndUpdateDeepgramTTSApiStatus(apiKey: string): Promise<DeepgramTTSVerificationResult> {
  try {
    const result = await verifyDeepgramTTSApi(apiKey);
    
    // Update status in database
    await updateDeepgramTTSStatus(result.status, {
      availableModels: result.availableModels,
      error: result.error
    });
    
    return result;
  } catch (error) {
    logger.error(`Error in verifyAndUpdateDeepgramTTSApiStatus: ${getErrorMessage(error)}`);
    
    // Update status to failed
    await updateDeepgramTTSStatus('failed', {
      error: getErrorMessage(error)
    });
    
    return {
      success: false,
      status: 'failed',
      error: getErrorMessage(error),
      message: 'An unexpected error occurred while verifying the Deepgram TTS API key'
    };
  }
}

export default {
  verifyDeepgramTTSApi,
  updateDeepgramTTSStatus,
  verifyAndUpdateDeepgramTTSApiStatus
};