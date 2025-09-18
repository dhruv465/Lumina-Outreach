/**
 * STT Test Controller
 * Handles Speech-to-Text testing endpoints
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { getDeepgramService } from '../services/deepgramService';
import Configuration from '../models/Configuration';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// Type definitions for request body parsing
interface STTRequestBody {
  audioBase64?: string;
  language?: string;
  model?: string;
}

/**
 * Check if ASR is properly configured by checking database configuration
 */
async function checkASRConfiguration(): Promise<{ 
  configured: boolean; 
  message?: string; 
  config?: any;
  error?: string;
}> {
  try {
    const config = await Configuration.findOne();
    
    // Check for API key in both new asrConfig and legacy deepgramConfig locations
    // Use type assertion to avoid TypeScript errors with potentially undefined properties
    const configAny = config as any;
    const apiKey = (configAny?.asrConfig?.apiKey || config?.deepgramConfig?.apiKey);
    
    if (!config || !apiKey) {
      return {
        configured: false,
        message: 'Deepgram API key not configured. Please configure your Deepgram API key in the Configuration page to enable Speech-to-Text functionality.'
      };
    }

    // Check if the service is initialized
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      return {
        configured: false,
        message: 'Deepgram STT service not initialized. Please check your API key configuration.'
      };
    }

    // Return the config from either asrConfig or deepgramConfig
    const configToReturn = configAny.asrConfig || config.deepgramConfig;

    return {
      configured: true,
      config: configToReturn
    };
  } catch (error) {
    logger.error('Error checking ASR configuration:', getErrorMessage(error));
    return {
      configured: false,
      message: 'Unable to verify ASR configuration. Please try again.',
      error: getErrorMessage(error)
    };
  }
}

/**
 * POST /api/stt/test
 * Single-shot STT test endpoint
 * Accepts either multipart/form-data with field "audio" or JSON with { audioBase64, language?, model? }
 */
export async function testSTT(req: FastifyRequest, res: FastifyReply): Promise<void> {
  const startTime = Date.now();
  const testId = uuidv4();

  try {
    logger.info('STT test request received', { testId });

    // Check ASR configuration
    const asrCheck = await checkASRConfiguration();
    if (!asrCheck.configured) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        testId,
        asrConfigured: false,
        message: asrCheck.message,
        latencyMs
      });
      return;
    }

    // Get audio buffer from request
    let audioBuffer: Buffer;
    let language = 'en-US';
    let model = 'nova-2';

    // Parse request body with proper type assertion
    const requestBody = req.body as STTRequestBody;
    
    // Extract parameters with validation and defaults
    language = requestBody?.language?.trim() || language;
    model = requestBody?.model?.trim() || model;
    
    // Validate language parameter format
    if (language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        testId,
        asrConfigured: true,
        message: 'Invalid language format. Expected format: "en-US" or "en"',
        latencyMs
      });
      return;
    }
    
    // Check if this is multipart/form-data with file upload
    try {
      const data = await (req as any).file();
      if (data) {
        audioBuffer = await data.toBuffer();
        
        logger.debug('Received audio file upload', { 
          testId,
          filename: data.filename,
          mimetype: data.mimetype,
          size: audioBuffer.length 
        });
      }
    } catch (fileError) {
      // Not a multipart request or no file, continue to check for JSON
    }
    
    // If no file was processed, check for JSON with base64 audio
    if (!audioBuffer) { 
      // Check if this is JSON with base64 audio
      if (requestBody?.audioBase64) {
        try {
          // Validate base64 format before decoding
          const base64Data = requestBody.audioBase64.trim();
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
            throw new Error('Invalid base64 format');
          }
          
          audioBuffer = Buffer.from(base64Data, 'base64');
          
          // Validate that the decoded buffer is not empty
          if (audioBuffer.length === 0) {
            throw new Error('Empty audio data after base64 decoding');
          }
        
          logger.debug('Received base64 audio data', { 
            testId,
            size: audioBuffer.length 
          });
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          res.status(400).send({
            success: false,
            testId,
            asrConfigured: true,
            message: `Invalid base64 audio data provided: ${getErrorMessage(error)}`,
            error: getErrorMessage(error),
            latencyMs
          });
          return;
        }
      } 
      // No valid audio data provided
      else {
        const latencyMs = Date.now() - startTime;
        res.status(400).send({
          success: false,
          testId,
          asrConfigured: true,
          message: 'No audio data provided. Please provide either a file upload (multipart/form-data with field "audio") or JSON with "audioBase64" field.',
          latencyMs
        });
        return;
      }
    }

    // Validate audio buffer size (max 10MB)
    if (audioBuffer.length > 10 * 1024 * 1024) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        testId,
        asrConfigured: true,
        message: 'Audio file too large. Maximum size is 10MB.',
        latencyMs
      });
      return;
    }

    // Get Deepgram service
    let deepgramService = getDeepgramService();
    if (!deepgramService) {
      // Try to initialize it with the API key from configuration
      const dbConfig = await Configuration.findOne();
      const configAny = dbConfig as any;
      const apiKey = configAny?.asrConfig?.apiKey || dbConfig?.deepgramConfig?.apiKey;
      
      if (apiKey) {
        try {
          // Initialize the service with the API key
          const { initializeDeepgramService } = await import('../services/deepgramService');
          initializeDeepgramService(apiKey);
          
          // Try again to get the service
          deepgramService = getDeepgramService();
          if (!deepgramService) {
            throw new Error('Failed to initialize Deepgram service');
          }
          
          logger.info('Deepgram service initialized for STT test');
        } catch (initError) {
          const latencyMs = Date.now() - startTime;
          logger.error(`Failed to initialize Deepgram service: ${getErrorMessage(initError)}`);
          res.status(500).send({
            success: false,
            testId,
            asrConfigured: false,
            message: 'Failed to initialize Deepgram STT service',
            error: getErrorMessage(initError),
            latencyMs
          });
          return;
        }
      } else {
        const latencyMs = Date.now() - startTime;
        res.status(500).send({
          success: false,
          testId,
          asrConfigured: false,
          message: 'Deepgram STT service not available',
          latencyMs
        });
        return;
      }
    }

    logger.info('Starting STT transcription', { 
      testId, 
      language, 
      model, 
      audioSize: audioBuffer.length 
    });

    // Perform transcription
    const transcriptionResult = await deepgramService.transcribeAudio(audioBuffer, {
      language,
      model
    });

    const latencyMs = Date.now() - startTime;

    logger.info('STT transcription completed', { 
      testId,
      latencyMs,
      transcriptLength: transcriptionResult.transcript?.length || 0,
      confidence: transcriptionResult.confidence,
      modelUsed: transcriptionResult.modelUsed || model
    });

    // Return successful result
    res.send({
      success: true,
      testId,
      asrConfigured: true,
      model: transcriptionResult.modelUsed || model,
      language,
      latencyMs,
      transcript: transcriptionResult.transcript || '',
      confidence: transcriptionResult.confidence || 0,
      fallbackUsed: transcriptionResult.fallback || false
    });

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);
    
    logger.error('STT test failed', { 
      testId, 
      error: errorMessage, 
      latencyMs 
    });

    res.status(500).send({
      success: false,
      testId,
      asrConfigured: true,
      message: 'STT transcription failed',
      error: errorMessage,
      latencyMs
    });
  }
}

/**
 * POST /api/stt/stream-chunk
 * Chunked near real-time STT endpoint
 * Accepts multipart/form-data with field "audio" (short chunks, e.g., 1s from MediaRecorder)
 */
export async function transcribeStreamChunk(req: FastifyRequest, res: FastifyReply): Promise<void> {
  const startTime = Date.now();
  const chunkId = uuidv4();

  try {
    logger.debug('STT stream chunk request received', { chunkId });

    // Check ASR configuration
    const asrCheck = await checkASRConfiguration();
    if (!asrCheck.configured) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        chunkId,
        asrConfigured: false,
        message: asrCheck.message,
        latencyMs
      });
      return;
    }

    // Get audio buffer from multipart upload
    let audioBuffer: Buffer;
    let language = 'en-US';
    let model = 'nova-2';
    
    // Parse request body with proper type assertion
    const requestBody = req.body as STTRequestBody;
    
    // Extract parameters with validation and defaults
    language = requestBody?.language?.trim() || language;
    model = requestBody?.model?.trim() || model;
    
    // Validate language parameter format
    if (language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        chunkId,
        asrConfigured: true,
        message: 'Invalid language format. Expected format: "en-US" or "en"',
        latencyMs
      });
      return;
    }
    
    try {
      const data = await (req as any).file();
      if (!data) {
        const latencyMs = Date.now() - startTime;
        res.status(400).send({
          success: false,
          chunkId,
          asrConfigured: true,
          message: 'No audio chunk provided. Please provide audio data in multipart/form-data with field "audio".',
          latencyMs
        });
        return;
      }

      audioBuffer = await data.toBuffer();
      
      // Log chunk metadata using Fastify patterns
      logger.debug('Received audio chunk upload', { 
        chunkId,
        filename: data.filename,
        mimetype: data.mimetype,
        size: audioBuffer.length 
      });
      
      // Validate that the buffer is not empty
      if (audioBuffer.length === 0) {
        const latencyMs = Date.now() - startTime;
        res.status(400).send({
          success: false,
          chunkId,
          asrConfigured: true,
          message: 'Empty audio chunk received. Please provide valid audio data.',
          latencyMs
        });
        return;
      }
    } catch (fileError) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        chunkId,
        asrConfigured: true,
        message: `Failed to process audio chunk: ${getErrorMessage(fileError)}`,
        error: getErrorMessage(fileError),
        latencyMs
      });
      return;
    }

    // Validate chunk size (max 5MB for streaming)
    if (audioBuffer.length > 5 * 1024 * 1024) {
      const latencyMs = Date.now() - startTime;
      res.status(400).send({
        success: false,
        chunkId,
        asrConfigured: true,
        message: 'Audio chunk too large. Maximum size for streaming is 5MB.',
        latencyMs
      });
      return;
    }

    // Get Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      const latencyMs = Date.now() - startTime;
      res.status(500).send({
        success: false,
        chunkId,
        asrConfigured: false,
        message: 'Deepgram STT service not available',
        latencyMs
      });
      return;
    }

    logger.debug('Processing STT stream chunk', { 
      chunkId, 
      language, 
      model, 
      chunkSize: audioBuffer.length
    });

    // Perform transcription on the chunk
    const transcriptionResult = await deepgramService.transcribeAudio(audioBuffer, {
      language,
      model
    });

    const latencyMs = Date.now() - startTime;

    logger.debug('STT stream chunk processed', { 
      chunkId,
      latencyMs,
      transcriptLength: transcriptionResult.transcript?.length || 0,
      confidence: transcriptionResult.confidence
    });

    // Return immediate transcript for the chunk
    res.send({
      success: true,
      chunkId,
      asrConfigured: true,
      model: transcriptionResult.modelUsed || model,
      language,
      latencyMs,
      transcript: transcriptionResult.transcript || '',
      confidence: transcriptionResult.confidence || 0,
      fallbackUsed: transcriptionResult.fallback || false
    });

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);
    
    logger.error('STT stream chunk failed', { 
      chunkId, 
      error: errorMessage, 
      latencyMs 
    });

    res.status(500).send({
      success: false,
      chunkId,
      asrConfigured: true,
      message: 'STT chunk transcription failed',
      error: errorMessage,
      latencyMs
    });
  }
}