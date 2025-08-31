/**
 * Deepgram STT API verification utility
 * Handles validation and testing of Deepgram Speech-to-Text API
 */
import { getDeepgramService } from '../services/deepgramService';
import logger from './logger';
import { getErrorMessage } from './logger';

// Types for Deepgram STT verification
interface DeepgramSTTVerificationResult {
  success: boolean;
  status: 'verified' | 'failed' | 'unverified';
  error?: string;
  errorCode?: string;
  message?: string;
  latency?: number;
  transcript?: string;
  confidence?: number;
}

/**
 * Create a short in-memory silent WAV file for testing
 * Creates a minimal WAV file with 1 second of silence
 * @returns WAV buffer for testing
 */
function createTestWAVBuffer(): Buffer {
  // WAV file header for 16-bit PCM, 16kHz, mono, 1 second of silence
  const sampleRate = 16000;
  const duration = 1; // 1 second
  const numSamples = sampleRate * duration;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const fileSize = 44 + dataSize; // WAV header is 44 bytes

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // WAV Header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // Format chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // PCM format chunk size
  buffer.writeUInt16LE(1, offset); offset += 2; // PCM format
  buffer.writeUInt16LE(1, offset); offset += 2; // Mono
  buffer.writeUInt32LE(sampleRate, offset); offset += 4; // Sample rate
  buffer.writeUInt32LE(sampleRate * bytesPerSample, offset); offset += 4; // Byte rate
  buffer.writeUInt16LE(bytesPerSample, offset); offset += 2; // Block align
  buffer.writeUInt16LE(16, offset); offset += 2; // Bits per sample

  // Data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Fill with silence (zeros) - already done by Buffer.alloc()

  return buffer;
}

/**
 * Test Deepgram STT API by transcribing a short silent audio file
 * @returns Verification result with transcript if successful
 */
export async function testDeepgramSTT(): Promise<DeepgramSTTVerificationResult> {
  const startTime = Date.now();

  try {
    // Get the Deepgram service instance
    const deepgramService = getDeepgramService();
    
    if (!deepgramService) {
      return {
        success: false,
        status: 'failed',
        error: 'Deepgram service not initialized',
        message: 'Deepgram STT service is not available. Please configure your Deepgram API key in the Configuration page.'
      };
    }

    logger.debug('Testing Deepgram STT API with silent test audio');

    // Create a test WAV buffer
    const testAudioBuffer = createTestWAVBuffer();

    // Test transcription with the service
    const result = await deepgramService.transcribeAudio(testAudioBuffer, {
      language: 'en-US',
      model: 'nova-2'
    });

    const latency = Date.now() - startTime;

    // For a silent audio file, we expect an empty or minimal transcript
    const transcript = result.transcript || '';
    const confidence = result.confidence || 0;

    logger.info('Deepgram STT test completed successfully', {
      latency,
      transcriptLength: transcript.length,
      confidence,
      model: result.modelUsed || 'unknown'
    });

    return {
      success: true,
      status: 'verified',
      message: `Deepgram STT API verified successfully. Latency: ${latency}ms. Silent test audio processed correctly.`,
      latency,
      transcript,
      confidence
    };

  } catch (error: any) {
    const latency = Date.now() - startTime;
    let errorMessage = getErrorMessage(error);
    let errorCode = '';

    // Parse Deepgram-specific errors
    if (error.response) {
      const statusCode = error.response.status;
      errorCode = `HTTP_${statusCode}`;

      // Check for common status codes
      if (statusCode === 401) {
        errorMessage = 'Authentication failed. Invalid Deepgram API key.';
      } else if (statusCode === 403) {
        errorMessage = 'Access forbidden. Your account may have insufficient permissions for STT.';
      } else if (statusCode === 429) {
        errorMessage = 'Rate limit exceeded. Too many requests.';
      } else if (statusCode === 400) {
        errorMessage = 'Bad request. Check your STT API configuration.';
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

    // Check for service-specific errors
    if (errorMessage.includes('not properly configured') || errorMessage.includes('not initialized')) {
      errorMessage = 'Deepgram STT service is not properly configured. Please check your API key in the Configuration page.';
    }

    logger.error('Deepgram STT API verification failed', {
      error: errorMessage,
      errorCode,
      latency
    });

    return {
      success: false,
      status: 'failed',
      error: errorMessage,
      errorCode,
      latency,
      message: `Failed to verify Deepgram STT API: ${errorMessage}`
    };
  }
}

export default {
  testDeepgramSTT,
  createTestWAVBuffer
};