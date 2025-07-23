/**
 * Implements transcription functions for the DeepgramService
 */

import { DeepgramService } from './deepgramService';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { DeepgramStreamOptions } from './deepgramService';

// Singleton instance
let deepgramService: DeepgramService | null = null;

/**
 * Initialize the DeepgramTranscriptionHelper with a DeepgramService instance
 */
export function initializeDeepgramHelper(service: DeepgramService) {
  deepgramService = service;
  logger.info('DeepgramTranscriptionHelper initialized');
}

/**
 * Get the DeepgramService instance
 */
export function getDeepgramService(): DeepgramService {
  if (!deepgramService) {
    throw new Error('DeepgramTranscriptionHelper not initialized');
  }
  return deepgramService;
}

/**
 * Create a real-time transcription stream for raw audio data
 * @param callId Unique identifier for the call
 * @param options Configuration options for the stream
 * @returns EventEmitter for transcription events
 */
export async function createRawTranscriptionStream(
  callId: string,
  options: DeepgramStreamOptions = {}
): Promise<EventEmitter> {
  if (!deepgramService) {
    throw new Error('DeepgramTranscriptionHelper not initialized');
  }
  
  try {
    // Get the connection ID from the service
    const connectionId = await deepgramService.createTranscriptionStream(callId, options);
    
    // Get the actual connection object from the service
    const connectionData = deepgramService.getConnection(connectionId);
    if (connectionData && connectionData.connection) {
      return connectionData.connection;
    } else {
      throw new Error('Failed to retrieve connection object');
    }
  } catch (error) {
    logger.error(`Error creating transcription stream: ${error}`);
    const emitter = new EventEmitter();
    emitter.emit('error', { error: 'Failed to create transcription stream' });
    return emitter;
  }
}

/**
 * Transcribe an audio buffer using Deepgram
 * @param audioBuffer Buffer containing audio data
 * @param options Transcription options
 * @returns Transcription result with text and confidence
 */
export async function transcribeBuffer(
  audioBuffer: Buffer,
  options: DeepgramStreamOptions = {}
): Promise<{ transcript: string; confidence: number }> {
  if (!deepgramService) {
    throw new Error('DeepgramTranscriptionHelper not initialized');
  }
  
  try {
    return await deepgramService.transcribeBuffer(audioBuffer, options);
  } catch (error) {
    logger.error(`Error transcribing buffer: ${error}`);
    return { transcript: '', confidence: 0 };
  }
}

/**
 * Transcribe audio from a URL using Deepgram
 * @param audioUrl URL to the audio file
 * @param options Transcription options
 * @returns Transcription result with text and confidence
 */
export async function transcribeUrl(
  audioUrl: string,
  options: DeepgramStreamOptions = {}
): Promise<{ transcript: string; confidence: number }> {
  if (!deepgramService) {
    throw new Error('DeepgramTranscriptionHelper not initialized');
  }
  
  try {
    return await deepgramService.transcribeUrl(audioUrl, options);
  } catch (error) {
    logger.error(`Error transcribing URL: ${error}`);
    return { transcript: '', confidence: 0 };
  }
}
