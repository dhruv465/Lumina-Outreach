import { Request, Response } from 'express';
import Configuration from '../models/Configuration';
import { getDeepgramService } from '../services/deepgramService';
import { logger } from '../index';
import { getErrorMessage } from '../utils/logger';

/**
 * Create a short in-memory silent WAV file for testing ASR connectivity
 * Creates approximately 0.6 seconds of silence at 16kHz, mono, 16-bit PCM
 * @returns WAV buffer for testing
 */
function createTestWAVBuffer(): Buffer {
  // WAV file header for 16-bit PCM, 16kHz, mono, ~0.6 seconds of silence
  const sampleRate = 16000;
  const duration = 0.6; // 0.6 seconds as specified in requirements
  const numSamples = Math.floor(sampleRate * duration);
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
 * Test Deepgram ASR connectivity endpoint
 * Performs a quick reachability check using a short silent WAV buffer
 */
export async function testDeepgramASRConnection(req: Request, res: Response) {
  const startTime = Date.now();
  // Define timeout ID at the function scope level
  let timeoutId: NodeJS.Timeout;

  try {
    logger.info('Testing Deepgram ASR connectivity');
    
    // Set a timeout for the request (5 seconds)
    timeoutId = setTimeout(() => {
      logger.warn('Deepgram ASR connectivity test timed out after 5 seconds');
      res.status(504).json({
        success: false,
        message: 'ASR connectivity test timed out after 5 seconds',
        latencyMs: Date.now() - startTime
      });
    }, 5000);

    // Set up special error handling for this test endpoint
    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection in Deepgram test: ${getErrorMessage(reason)}`);
    });

    // Read configuration and verify ASR is configured
    const config = await Configuration.findOne();
    
    if (!config) {
      return res.status(400).json({
        success: false,
        message: 'No configuration found. Please set up your configuration first.'
      });
    }

    // Check for ASR configuration (asrConfig.apiKey or legacy deepgramConfig.apiKey)
    const asrApiKey = (config as any).asrConfig?.apiKey || config.deepgramConfig?.apiKey;
    
    if (!asrApiKey) {
      return res.status(400).json({
        success: false,
        message: 'Deepgram ASR API key not configured. Please configure your Deepgram API key in the system settings.'
      });
    }

    // Initialize service via existing getDeepgramService()
    let deepgramService = getDeepgramService();
    
    // If service is not initialized, try to initialize it now with the API key
    if (!deepgramService) {
      try {
        const { initializeDeepgramService } = await import('../services/deepgramService');
        initializeDeepgramService(asrApiKey);
        deepgramService = getDeepgramService();
        
        // If still not initialized, return error
        if (!deepgramService) {
          throw new Error('Failed to initialize Deepgram service with the provided API key');
        }
        
        logger.info('Deepgram service initialized dynamically for ASR test');
      } catch (initError) {
        logger.error(`Failed to initialize Deepgram service: ${getErrorMessage(initError)}`);
        return res.status(500).json({
          success: false,
          message: 'Deepgram ASR service could not be initialized. Please check your configuration and restart the service.'
        });
      }
    }

    // Generate a short in-memory silent WAV buffer
    const testAudioBuffer = createTestWAVBuffer();
    
    logger.debug('Generated test WAV buffer for ASR connectivity test', {
      bufferSize: testAudioBuffer.length,
      duration: '0.6s'
    });

    // Call deepgramService.transcribeAudio() with specified options
    const model = 'nova-2';
    const language = 'en-US';
    
    const transcriptionResult = await deepgramService.transcribeAudio(testAudioBuffer, {
      model,
      language
    });

    // Log the raw response structure for debugging purposes
    logger.debug('Raw Deepgram transcription result:', 
      typeof transcriptionResult === 'object' 
        ? JSON.stringify(transcriptionResult, null, 2) 
        : transcriptionResult
    );

    // Measure latency
    const latencyMs = Date.now() - startTime;

    // Extract transcript from result, with more robust null/undefined checks
    let transcript = '';
    let responseStructure = 'Unknown';
    
    if (!transcriptionResult) {
      // Instead of throwing an error, handle the null result case
      logger.warn('Empty transcription result returned from Deepgram service. This might be expected for a silent test file.');
      responseStructure = 'Empty result';
    } else if (typeof transcriptionResult === 'string') {
      // Handle string response
      transcript = transcriptionResult;
      responseStructure = 'String response';
      logger.debug('Received string transcription result:', transcript);
    } else if (typeof transcriptionResult !== 'object') {
      // Handle unexpected type
      logger.warn(`Unexpected transcription result type: ${typeof transcriptionResult}`);
      responseStructure = `Unexpected type: ${typeof transcriptionResult}`;
    } else {
      // For object responses, log the raw structure
      logger.debug('Raw transcription result structure:',  
        JSON.stringify(transcriptionResult, null, 2));
      responseStructure = 'Object response';
      
      // Check if result structure contains transcript directly or needs to be extracted from nested properties
      if (transcriptionResult.transcript !== undefined) {
        // Direct transcript property exists
        transcript = transcriptionResult.transcript || '';
        responseStructure = 'Direct transcript property';
      } else if (transcriptionResult.result?.results?.channels) {
        // Extract from nested structure similar to the deepgramService.ts implementation
        const channels = transcriptionResult.result.results.channels;
        const result = channels && channels.length > 0 && channels[0].alternatives && channels[0].alternatives.length > 0 
          ? channels[0].alternatives[0] 
          : null;
        
        transcript = result?.transcript || '';
        responseStructure = 'Nested channels structure';
      } else {
        // Could not determine the structure
        logger.debug('Could not extract transcript from result structure:', 
          JSON.stringify(transcriptionResult));
        responseStructure = 'Unknown structure';
      }
    }

    logger.info('Deepgram ASR connectivity test completed successfully', {
      latencyMs,
      model,
      language,
      transcriptLength: transcript.length,
      hasTranscript: transcript.length > 0
    });

    // Clear the timeout since we've got a response
    clearTimeout(timeoutId);
    
    // Return success response with specified format
    // Even if transcript is empty, consider it a success if we got a response from the service
    res.status(200).json({
      success: true,
      message: 'ASR reachable',
      transcript,
      model,
      language,
      latencyMs,
      responseStructure
    });

  } catch (error: any) {
    // Clear the timeout if we caught an error
    clearTimeout(timeoutId);
    
    const latencyMs = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);

    logger.error('Deepgram ASR connectivity test failed', {
      error: errorMessage,
      latencyMs
    });

    // Handle different types of errors as specified
    if (errorMessage.includes('not properly configured') || 
        errorMessage.includes('not initialized') ||
        errorMessage.includes('API key')) {
      // Configuration issues
      return res.status(400).json({
        success: false,
        message: `Configuration error: ${errorMessage}`
      });
    }

    // Check for Deepgram API errors (HTTP errors, network issues)
    if (error.response || 
        errorMessage.includes('network') || 
        errorMessage.includes('timeout') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ECONNREFUSED')) {
      // Deepgram call errors
      return res.status(502).json({
        success: false,
        message: `Deepgram service error: ${errorMessage}`
      });
    }

    // Unexpected errors
    res.status(500).json({
      success: false,
      message: `Unexpected error during ASR connectivity test: ${errorMessage}`
    });
  }
}