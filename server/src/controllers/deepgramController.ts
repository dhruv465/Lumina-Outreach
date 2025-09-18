import { FastifyRequest, FastifyReply } from 'fastify';
import { getDeepgramService, initializeDeepgramService, DeepgramEvent, TranscriptResult } from '../services/deepgramService';
import logger, { getErrorMessage } from '../utils/logger';
import Configuration from '../models/Configuration';
import { Socket } from 'socket.io';
import { EventEmitter } from 'events';
import Call from '../models/Call';
import { getCircuitBreakerService } from '../services/circuitBreakerService';

// Event emitter for real-time transcription updates
const transcriptionEvents = new EventEmitter();

/**
 * Initialize the Deepgram service with API key from configuration
 */
export async function initializeDeepgramController(): Promise<void> {
  try {
    const config = await Configuration.findOne();
    if (!config?.deepgramConfig?.apiKey) {
      logger.warn('No Deepgram API key found in configuration');
      return;
    }
    
    logger.info(`Initializing Deepgram controller with API key (length: ${config.deepgramConfig.apiKey.length})`);

    // Initialize the Deepgram service
    const deepgramService = initializeDeepgramService(config.deepgramConfig.apiKey);
    
    // Set up event handlers
    setupDeepgramEventHandlers(deepgramService);
    
    // Initialize the circuit breaker service for Deepgram
    getCircuitBreakerService();
    
    // Verify the API key is valid
    try {
      const isValid = await deepgramService.validateApiKey();
      
      // Update configuration status based on validation result
      config.deepgramConfig.status = isValid ? 'verified' : 'failed';
      config.deepgramConfig.lastVerified = new Date();
      
      if (!isValid) {
        config.deepgramConfig.lastError = 'API key validation failed';
        logger.warn('Deepgram API key validation failed');
      } else {
        logger.info('Deepgram API key validated successfully');
      }
      
      await config.save();
    } catch (validationError) {
      logger.error(`Error validating Deepgram API key: ${getErrorMessage(validationError)}`);
      
      // Update configuration to mark validation failure
      config.deepgramConfig.status = 'failed';
      config.deepgramConfig.lastVerified = new Date();
      config.deepgramConfig.lastError = `Validation error: ${getErrorMessage(validationError)}`;
      await config.save();
    }
    
    // Verify that the service has been properly initialized
    if (deepgramService) {
      logger.info('Deepgram controller initialized with circuit breaker protection');
    } else {
      logger.warn('Deepgram service failed to initialize');
    }
  } catch (error) {
    logger.error(`Error initializing Deepgram controller: ${getErrorMessage(error)}`);
  }
}

/**
 * Set up event handlers for Deepgram events
 */
function setupDeepgramEventHandlers(deepgramService: any): void {
  // Forward transcript events
  deepgramService.on(DeepgramEvent.TRANSCRIPT_RECEIVED, (result: TranscriptResult) => {
    transcriptionEvents.emit(`transcript:${result.callId}`, result);
  });

  // Forward final transcript events
  deepgramService.on(DeepgramEvent.TRANSCRIPT_FINAL, async (result: TranscriptResult) => {
    transcriptionEvents.emit(`transcript-final:${result.callId}`, result);
    
    // Update call record with transcript
    try {
      await Call.findOneAndUpdate(
        { callId: result.callId, active: true },
        { 
          $push: { 
            transcripts: {
              text: result.text,
              timestamp: Date.now(),
              confidence: result.confidence,
              source: 'deepgram',
              latency: result.metadata.processingLatency
            } 
          } 
        }
      );
    } catch (err) {
      logger.error(`Error updating call record with transcript: ${getErrorMessage(err)}`);
    }
  });

  // Forward error events
  deepgramService.on(DeepgramEvent.ERROR, (error: any) => {
    logger.error(`Deepgram error: ${JSON.stringify(error)}`);
    transcriptionEvents.emit(`error:${error.callId}`, error);
  });

  // Forward connection status events
  deepgramService.on(DeepgramEvent.CONNECTION_STATUS, (status: any) => {
    transcriptionEvents.emit(`connection:${status.callId}`, status);
  });
  
  // Handle fallback events when circuit breaker trips
  deepgramService.on(DeepgramEvent.FALLBACK_USED, (fallbackInfo: any) => {
    logger.warn(`Deepgram fallback used: ${JSON.stringify(fallbackInfo)}`);
    transcriptionEvents.emit(`fallback:${fallbackInfo.callId || 'global'}`, fallbackInfo);
    
    // Notify clients of degraded service
    if (fallbackInfo.callId) {
      transcriptionEvents.emit(`service-degraded:${fallbackInfo.callId}`, {
        service: 'transcription',
        provider: 'deepgram',
        status: 'degraded',
        message: fallbackInfo.message || 'Transcription service is temporarily degraded'
      });
    }
  });
}

/**
 * Get circuit breaker status for Deepgram
 */
export async function getCircuitStatus(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const circuitBreaker = getCircuitBreakerService();
    const deepgramCircuit = circuitBreaker.getStats().find(stat => stat.name === 'deepgram-api');
    
    if (!deepgramCircuit) {
      reply.code(404).send({ error: 'Deepgram circuit not found' });
      return;
    }
    
    reply.code(200).send(deepgramCircuit);
  } catch (error) {
    logger.error(`Error getting circuit status: ${getErrorMessage(error)}`);
    reply.code(500).send({ error: 'Failed to get circuit status' });
  }
}

/**
 * Reset the circuit breaker for Deepgram
 */
export async function resetCircuit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const circuitBreaker = getCircuitBreakerService();
    const result = circuitBreaker.resetCircuit('deepgram-api');
    
    if (result) {
      reply.code(200).send({ success: true, message: 'Circuit reset successfully' });
    } else {
      reply.code(404).send({ error: 'Deepgram circuit not found' });
    }
  } catch (error) {
    logger.error(`Error resetting circuit: ${getErrorMessage(error)}`);
    reply.code(500).send({ error: 'Failed to reset circuit' });
  }
}

/**
 * Start real-time transcription for a call
 */
export async function startTranscription(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { callId } = req.params as any;
    const { language = 'en', model = 'nova-2' } = req.body as any;

    if (!callId) {
      reply.code(400).send({ error: 'Call ID is required' });
      return;
    }

    // Get the Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      reply.code(500).send({ error: 'Deepgram service not initialized' });
      return;
    }

    // Check circuit breaker status before proceeding
    const circuitBreaker = getCircuitBreakerService();
    const deepgramCircuit = circuitBreaker.getStats().find(stat => stat.name === 'deepgram-api');
    
    let usingFallback = false;
    if (deepgramCircuit && deepgramCircuit.state === 'open') {
      logger.warn(`Deepgram circuit is open, using fallback for call ${callId}`);
      usingFallback = true;
    }

    // Create a transcription stream
    const connectionId = await deepgramService.createTranscriptionStream(callId, {
      language,
      model,
      punctuate: true,
      diarize: false,
      endpointing: 150
    });

    // Check if we're using a fallback connection
    if (connectionId.startsWith('fallback-') || connectionId.startsWith('emergency-')) {
      usingFallback = true;
    }

    // Update call record with transcription info
    try {
      await Call.findOneAndUpdate(
        { callId, active: true },
        { 
          $set: { 
            transcriptionActive: true,
            transcriptionProvider: 'deepgram',
            transcriptionConnectionId: connectionId,
            'metadata.transcription': {
              provider: 'deepgram',
              language,
              model,
              startTime: Date.now(),
              usingFallback
            }
          } 
        }
      );
    } catch (err) {
      logger.error(`Error updating call record with transcription info: ${getErrorMessage(err)}`);
    }

    reply.code(200).send({ 
      success: true, 
      connectionId,
      usingFallback,
      message: usingFallback ? 'Transcription started in degraded mode' : 'Transcription started'
    });
  } catch (error) {
    logger.error(`Error starting transcription: ${getErrorMessage(error)}`);
    reply.code(500).send({ error: 'Failed to start transcription' });
  }
}

/**
 * Stop real-time transcription for a call
 */
export async function stopTranscription(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { callId } = req.params as any;
    const { connectionId } = req.body as any;

    if (!callId) {
      reply.code(400).send({ error: 'Call ID is required' });
      return;
    }

    // Get the Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      reply.code(500).send({ error: 'Deepgram service not initialized' });
      return;
    }

    // If connection ID was not provided, get it from the call record
    let connId = connectionId;
    if (!connId) {
      const call = await Call.findOne({ callId, active: true });
      connId = call?.metadata?.transcription?.connectionId;
    }

    if (!connId) {
      reply.code(400).send({ error: 'Connection ID is required' });
      return;
    }

    // Close the transcription stream
    deepgramService.closeTranscriptionStream(connId);

    // Update call record
    try {
      await Call.findOneAndUpdate(
        { callId, active: true },
        { 
          $set: { 
            transcriptionActive: false,
            'metadata.transcription.endTime': Date.now()
          },
          $unset: { transcriptionConnectionId: "" }
        }
      );
    } catch (err) {
      logger.error(`Error updating call record when stopping transcription: ${getErrorMessage(err)}`);
    }

    reply.code(200).send({ 
      success: true, 
      message: 'Transcription stopped'
    });
  } catch (error) {
    logger.error(`Error stopping transcription: ${getErrorMessage(error)}`);
    reply.code(500).send({ error: 'Failed to stop transcription' });
  }
}

/**
 * Send audio data to an active transcription stream
 */
export async function processAudio(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { connectionId } = req.params as any;
    
    if (!connectionId) {
      reply.code(400).send({ error: 'Connection ID is required' });
      return;
    }

    if (!req.body || !Buffer.isBuffer(req.body as any)) {
      reply.code(400).send({ error: 'Request body must be audio buffer' });
      return;
    }

    // Get the Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      reply.code(500).send({ error: 'Deepgram service not initialized' });
      return;
    }

    // Send audio data to the transcription stream
    deepgramService.sendAudioToStream(connectionId, req.body);

    reply.code(200).send({ success: true });
  } catch (error) {
    logger.error(`Error processing audio for transcription: ${getErrorMessage(error)}`);
    reply.code(500).send({ error: 'Failed to process audio' });
  }
}

/**
 * Transcribe an audio file and return the result
 */
export async function transcribeAudioFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const data = await (req as any).file();
    if (!data) {
      reply.code(400).send({ error: 'No audio file provided' });
      return;
    }

    const audioBuffer = await data.toBuffer();
    const { language, model } = req.body as any;

    // Get the Deepgram service
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      reply.code(500).send({ error: 'Deepgram service not initialized' });
      return;
    }

    // Transcribe the audio file
    const result = await deepgramService.transcribeAudio(audioBuffer, {
      language,
      model,
      detectLanguage: !language
    });

    reply.code(200).send(result);
  } catch (error) {
    logger.error(`Error transcribing audio file: ${getErrorMessage(error)}`);
    reply.code(500).send({ error: 'Failed to transcribe audio file' });
  }
}

/**
 * Subscribe a socket to real-time transcription events for a call
 */
export function subscribeToTranscription(socket: Socket, callId: string): void {
  if (!socket || !callId) return;

  const onTranscript = (result: TranscriptResult) => {
    socket.emit('transcript', result);
  };

  const onFinalTranscript = (result: TranscriptResult) => {
    socket.emit('transcript-final', result);
  };

  const onError = (error: any) => {
    socket.emit('transcript-error', error);
  };

  const onConnectionStatus = (status: any) => {
    socket.emit('transcript-connection', status);
  };
  
  const onFallback = (fallbackInfo: any) => {
    socket.emit('transcript-fallback', fallbackInfo);
  };
  
  const onServiceDegraded = (degradedInfo: any) => {
    socket.emit('service-degraded', degradedInfo);
  };

  // Subscribe to events
  transcriptionEvents.on(`transcript:${callId}`, onTranscript);
  transcriptionEvents.on(`transcript-final:${callId}`, onFinalTranscript);
  transcriptionEvents.on(`error:${callId}`, onError);
  transcriptionEvents.on(`connection:${callId}`, onConnectionStatus);
  transcriptionEvents.on(`fallback:${callId}`, onFallback);
  transcriptionEvents.on(`service-degraded:${callId}`, onServiceDegraded);
  
  // Also listen to global fallback events
  transcriptionEvents.on(`fallback:global`, onFallback);

  // Clean up when socket disconnects
  socket.on('disconnect', () => {
    transcriptionEvents.off(`transcript:${callId}`, onTranscript);
    transcriptionEvents.off(`transcript-final:${callId}`, onFinalTranscript);
    transcriptionEvents.off(`error:${callId}`, onError);
    transcriptionEvents.off(`connection:${callId}`, onConnectionStatus);
    transcriptionEvents.off(`fallback:${callId}`, onFallback);
    transcriptionEvents.off(`fallback:global`, onFallback);
    transcriptionEvents.off(`service-degraded:${callId}`, onServiceDegraded);
  });

  // Also clean up when client unsubscribes
  socket.on('unsubscribe-transcription', () => {
    transcriptionEvents.off(`transcript:${callId}`, onTranscript);
    transcriptionEvents.off(`transcript-final:${callId}`, onFinalTranscript);
    transcriptionEvents.off(`error:${callId}`, onError);
    transcriptionEvents.off(`connection:${callId}`, onConnectionStatus);
    transcriptionEvents.off(`fallback:${callId}`, onFallback);
    transcriptionEvents.off(`fallback:global`, onFallback);
    transcriptionEvents.off(`service-degraded:${callId}`, onServiceDegraded);
  });
}