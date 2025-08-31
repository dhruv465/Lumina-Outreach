/**
 * STT Test Controller
 * Handles Speech-to-Text testing endpoints
 */
import { Request, Response } from 'express';
import { getDeepgramService } from '../services/deepgramService';
import Configuration from '../models/Configuration';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Check if ASR is properly configured by checking database configuration
 */
async function checkASRConfiguration(): Promise<{ 
  configured: boolean; 
  message?: string; 
  config?: any 
}> {
  try {
    const config = await Configuration.findOne();
    
    if (!config || !config.deepgramConfig?.apiKey) {
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

    return {
      configured: true,
      config: config.deepgramConfig
    };
  } catch (error) {
    logger.error('Error checking ASR configuration:', getErrorMessage(error));
    return {
      configured: false,
      message: 'Unable to verify ASR configuration. Please try again.'
    };
  }
}

/**
 * POST /api/stt/test
 * Single-shot STT test endpoint
 * Accepts either multipart/form-data with field "audio" or JSON with { audioBase64, language?, model? }
 */
export async function testSTT(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const testId = uuidv4();

  try {
    logger.info('STT test request received', { testId });

    // Check ASR configuration
    const asrCheck = await checkASRConfiguration();
    if (!asrCheck.configured) {
      res.status(400).json({
        success: false,
        testId,
        asrConfigured: false,
        message: asrCheck.message
      });
      return;
    }

    // Get audio buffer from request
    let audioBuffer: Buffer;
    let language = 'en-US';
    let model = 'nova-2';

    // Check if this is multipart/form-data with file upload
    if (req.file && req.file.buffer) {
      audioBuffer = req.file.buffer;
      language = req.body.language || language;
      model = req.body.model || model;
      
      logger.debug('Received audio file upload', { 
        testId,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size 
      });
    } 
    // Check if this is JSON with base64 audio
    else if (req.body.audioBase64) {
      try {
        audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
        language = req.body.language || language;
        model = req.body.model || model;
        
        logger.debug('Received base64 audio data', { 
          testId,
          size: audioBuffer.length 
        });
      } catch (error) {
        res.status(400).json({
          success: false,
          testId,
          asrConfigured: true,
          message: 'Invalid base64 audio data provided'
        });
        return;
      }
    } 
    // No valid audio data provided
    else {
      res.status(400).json({
        success: false,
        testId,
        asrConfigured: true,
        message: 'No audio data provided. Please provide either a file upload (multipart/form-data with field "audio") or JSON with "audioBase64" field.'
      });
      return;
    }

    // Validate audio buffer size (max 10MB)
    if (audioBuffer.length > 10 * 1024 * 1024) {
      res.status(400).json({
        success: false,
        testId,
        asrConfigured: true,
        message: 'Audio file too large. Maximum size is 10MB.'
      });
      return;
    }

    // Get Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      res.status(500).json({
        success: false,
        testId,
        asrConfigured: false,
        message: 'Deepgram STT service not available'
      });
      return;
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
    res.json({
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

    res.status(500).json({
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
export async function transcribeStreamChunk(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const chunkId = uuidv4();

  try {
    logger.debug('STT stream chunk request received', { chunkId });

    // Check ASR configuration
    const asrCheck = await checkASRConfiguration();
    if (!asrCheck.configured) {
      res.status(400).json({
        success: false,
        chunkId,
        asrConfigured: false,
        message: asrCheck.message
      });
      return;
    }

    // Get audio buffer from multipart upload
    if (!req.file || !req.file.buffer) {
      res.status(400).json({
        success: false,
        chunkId,
        asrConfigured: true,
        message: 'No audio chunk provided. Please provide audio data in multipart/form-data with field "audio".'
      });
      return;
    }

    const audioBuffer = req.file.buffer;
    const language = req.body.language || 'en-US';
    const model = req.body.model || 'nova-2';

    // Validate chunk size (max 5MB for streaming)
    if (audioBuffer.length > 5 * 1024 * 1024) {
      res.status(400).json({
        success: false,
        chunkId,
        asrConfigured: true,
        message: 'Audio chunk too large. Maximum size for streaming is 5MB.'
      });
      return;
    }

    // Get Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      res.status(500).json({
        success: false,
        chunkId,
        asrConfigured: false,
        message: 'Deepgram STT service not available'
      });
      return;
    }

    logger.debug('Processing STT stream chunk', { 
      chunkId, 
      language, 
      model, 
      chunkSize: audioBuffer.length,
      mimetype: req.file.mimetype
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
    res.json({
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

    res.status(500).json({
      success: false,
      chunkId,
      asrConfigured: true,
      message: 'STT chunk transcription failed',
      error: errorMessage,
      latencyMs
    });
  }
}