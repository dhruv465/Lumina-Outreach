import { createClient, DeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { getErrorMessage } from '../utils/logger';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import Configuration from '../models/Configuration';
import { getCircuitBreakerService, CircuitBreakerOptions } from './circuitBreakerService';

export enum DeepgramEvent {
  TRANSCRIPT_RECEIVED = 'transcript-received',
  TRANSCRIPT_FINAL = 'transcript-final',
  ERROR = 'error',
  CONNECTION_STATUS = 'connection-status',
  FALLBACK_USED = 'fallback-used'
}

export interface TranscriptResult {
  id: string;
  callId: string;
  text: string;
  isFinal: boolean;
  confidence: number;
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  metadata: {
    startTime: number;
    endTime: number;
    processingLatency: number;
  };
}

interface DeepgramStreamOptions {
  language?: string;
  model?: string;
  tier?: string;
  detectLanguage?: boolean;
  punctuate?: boolean;
  profanityFilter?: boolean;
  redact?: boolean;
  diarize?: boolean;
  keywords?: string[];
  endpointing?: number;
  utteranceEndMs?: number;
}

// Define Deepgram config interface for database
interface DeepgramConfig {
  language?: string;
  model?: string;
  detectLanguage?: boolean;
  apiKey?: string;
}

/**
 * Service for real-time speech-to-text using Deepgram
 * Provides ultra-low latency transcription with WebSocket streaming
 */
export class DeepgramService extends EventEmitter {
  private apiKey: string;
  private client: DeepgramClient;
  private activeConnections: Map<string, any> = new Map();
  private defaultModel: string = 'nova-2';
  private defaultOptions: DeepgramStreamOptions = {
    language: 'en',
    model: 'nova-2',
    punctuate: true,
    endpointing: 150, // 150ms of silence to consider end of speech
    utteranceEndMs: 500 // 500ms to finalize an utterance
  };
  private readonly CIRCUIT_NAME = 'deepgram-api';
  private fallbackProviders: string[] = [];
  // Local cache for transcription results
  private transcriptionCache: Map<string, any> = new Map();

  /**
   * Create a new Deepgram Service instance
   * @param apiKey Deepgram API key
   */
  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    
    // Initialize circuit breaker options
    const circuitOptions: CircuitBreakerOptions = {
      resetTimeout: 10000, // Shorter reset for voice services
      errorThresholdPercentage: 30, // More sensitive for real-time voice
      timeout: 5000 // Voice API calls should be fast
    };
    
    // Get the circuit breaker service
    getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME, circuitOptions);
    
    logger.info('Deepgram Service initialized with in-memory caching and circuit breaker protection');
    
    // Set up periodic cache cleanup (every 30 minutes)
    setInterval(() => this.cleanupCache(), 30 * 60 * 1000);
  }
  
  /**
   * Cleanup the local transcription cache to prevent memory leaks
   */
  private cleanupCache(): void {
    const now = Date.now();
    const MAX_AGE = 60 * 60 * 1000; // 1 hour in milliseconds
    
    for (const [key, value] of this.transcriptionCache.entries()) {
      if (value.timestamp && (now - value.timestamp) > MAX_AGE) {
        this.transcriptionCache.delete(key);
      }
    }
    
    logger.debug(`DeepgramService cache cleanup completed. Current cache size: ${this.transcriptionCache.size}`);
  }

  /**
   * Update the API key
   * @param apiKey New Deepgram API key
   */
  public updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    logger.info('Deepgram API key updated');
  }

  /**
   * Transcribe an audio file with high accuracy
   * @param audioBuffer Audio buffer to transcribe
   * @param options Transcription options
   * @returns Transcription result
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    options?: {
      language?: string;
      model?: string;
      detectLanguage?: boolean;
    }
  ): Promise<any> {
    const circuitBreaker = getCircuitBreakerService();
    
    // Define the main function to execute with circuit breaker
    const transcribeFunction = async () => {
      try {
        const startTime = Date.now();
        
        // Get configuration from database
        const config = await Configuration.findOne();
        const deepgramConfig = (config?.deepgramConfig || {}) as DeepgramConfig;
        
        // Create transcription options
        const transcriptionOptions = {
          language: options?.language || deepgramConfig.language || 'en',
          model: options?.model || deepgramConfig.model || this.defaultModel,
          detect_language: options?.detectLanguage || deepgramConfig.detectLanguage || false,
          punctuate: true,
          smart_format: true
        };

        // Try to get cached result first if available
        const cacheKey = `transcribe:${Buffer.from(audioBuffer).toString('base64').slice(0, 50)}:${JSON.stringify(transcriptionOptions)}`;
        const cachedResult = this.transcriptionCache.get(cacheKey);
        if (cachedResult) {
          logger.info('Using cached transcription result');
          return cachedResult.data;
        }

        // Perform the transcription
        const response = await this.client.listen.prerecorded.transcribeFile(audioBuffer, {
          mimetype: 'audio/wav',
          options: transcriptionOptions
        });

        const endTime = Date.now();
        const latency = endTime - startTime;

        logger.info(`Deepgram transcription completed in ${latency}ms`);

        // Extract result with corrected property access
        const channels = response.result?.results?.channels;
        const result = channels && channels.length > 0 && channels[0].alternatives && channels[0].alternatives.length > 0 
          ? channels[0].alternatives[0] 
          : null;
          
        const transcriptionResult = {
          transcript: result?.transcript || '',
          confidence: result?.confidence || 0,
          words: result?.words || [],
          language: options?.language || 'en',
          latency
        };
        
        // Cache result in memory
        this.transcriptionCache.set(cacheKey, {
          data: transcriptionResult,
          timestamp: Date.now()
        });
        
        return transcriptionResult;
      } catch (error) {
        logger.error(`Error transcribing audio with Deepgram: ${getErrorMessage(error)}`);
        throw new Error(`Transcription failed: ${getErrorMessage(error)}`);
      }
    };
    
    // Define fallback function for when circuit is open
    const fallbackFunction = async (error: Error) => {
      logger.warn(`Using fallback for transcription due to circuit breaker: ${error.message}`);
      this.emit(DeepgramEvent.FALLBACK_USED, { error: error.message });
      
      // Return a minimal result 
      return {
        transcript: '[Transcription temporarily unavailable]',
        confidence: 0,
        words: [],
        language: options?.language || 'en',
        latency: 0,
        fallback: true
      };
    };
    
    // Execute with circuit breaker
    return circuitBreaker.execute(
      this.CIRCUIT_NAME,
      transcribeFunction,
      fallbackFunction
    );
  }

  /**
   * Create a real-time transcription stream with circuit breaker protection
   * @param callId Call ID for tracking
   * @param options Stream options
   * @returns Connection ID
   */
  public createTranscriptionStream(
    callId: string,
    options?: DeepgramStreamOptions
  ): string {
    // Define the main function to execute with circuit breaker
    const createStreamFunction = () => {
      try {
        const connectionId = uuidv4();
        
        // Merge default options with provided options
        const streamOptions = {
          ...this.defaultOptions,
          ...options
        };

        logger.info(`Creating Deepgram transcription stream for call ${callId}`, {
          model: streamOptions.model,
          language: streamOptions.language
        });

        // Create live transcription with latest API
        const connection = this.client.listen.live({
          language: streamOptions.language,
          model: streamOptions.model,
          tier: streamOptions.tier || 'enhanced',
          punctuate: streamOptions.punctuate !== false,
          diarize: streamOptions.diarize || false,
          multichannel: false,
          alternatives: 1,
          endpointing: streamOptions.endpointing !== undefined ? streamOptions.endpointing : this.defaultOptions.endpointing,
          utterance_end_ms: streamOptions.utteranceEndMs !== undefined ? streamOptions.utteranceEndMs : this.defaultOptions.utteranceEndMs,
          smart_format: true,
          encoding: 'linear16',
          sample_rate: 16000,
          interim_results: true,
          keywords: streamOptions.keywords || []
        });

        // Store connection for management
        this.activeConnections.set(connectionId, connection);

        // Emit connection status
        this.emit(DeepgramEvent.CONNECTION_STATUS, {
          connectionId,
          callId,
          status: 'connected'
        });

        // Set up event handlers for the connection
        this.setupConnectionHandlers(connection, connectionId, callId);
        
        return connectionId;
      } catch (error) {
        logger.error(`Error creating Deepgram stream: ${getErrorMessage(error)}`);
        throw new Error(`Failed to create transcription stream: ${getErrorMessage(error)}`);
      }
    };
    
    try {
      // For streaming, we don't use the normal circuit breaker pattern
      // as we need to maintain the connection ID return value
      // Instead, we just check if the circuit is open before attempting
      const circuitBreaker = getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME);
      
      if (circuitBreaker.status.state === 'open') {
        logger.warn(`Deepgram circuit is open, using degraded mode for stream`);
        this.emit(DeepgramEvent.FALLBACK_USED, { 
          callId,
          message: 'Using degraded transcription mode due to service issues'
        });
        
        // Return a special connection ID that indicates we're in fallback mode
        const fallbackId = `fallback-${uuidv4()}`;
        this.activeConnections.set(fallbackId, { isFallback: true });
        return fallbackId;
      }
      
      return createStreamFunction();
    } catch (error) {
      logger.error(`Failed to create transcription stream with circuit check: ${getErrorMessage(error)}`);
      
      // Return a fallback ID if all else fails
      const emergencyFallbackId = `emergency-${uuidv4()}`;
      this.activeConnections.set(emergencyFallbackId, { isEmergencyFallback: true });
      return emergencyFallbackId;
    }
  }
  
  /**
   * Set up event handlers for a Deepgram connection
   * Extracted to a separate method for better code organization
   */
  private setupConnectionHandlers(connection: any, connectionId: string, callId: string): void {
    // Handle transcript results
    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      // Only process if we have valid results
      if (data?.channel?.alternatives?.[0]) {
        const alt = data.channel.alternatives[0];
        
        // Create structured transcript result
        const result: TranscriptResult = {
          id: uuidv4(),
          callId,
          text: alt.transcript || '',
          isFinal: data.is_final || false,
          confidence: alt.confidence || 0,
          words: alt.words?.map((word: any) => ({
            word: word.word,
            start: word.start,
            end: word.end,
            confidence: word.confidence
          })) || [],
          metadata: {
            startTime: data.start || 0,
            endTime: data.end || 0,
            processingLatency: data.audio_meta?.processing_latency_ms || 0
          }
        };

        // Log detailed metrics for final results
        if (result.isFinal) {
          logger.info(`Deepgram final transcript for call ${callId}`, {
            text: result.text,
            confidence: result.confidence,
            latency: result.metadata.processingLatency
          });
          this.emit(DeepgramEvent.TRANSCRIPT_FINAL, result);
        } else {
          // Emit interim results without excessive logging
          this.emit(DeepgramEvent.TRANSCRIPT_RECEIVED, result);
        }
      }
    });

    // Handle errors and mark the circuit as potentially failing
    connection.on(LiveTranscriptionEvents.Error, (error) => {
      logger.error(`Deepgram stream error for call ${callId}: ${getErrorMessage(error)}`);
      
      // Notify the circuit breaker of the failure for tracking
      try {
        getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME).fire(() => {
          throw new Error(getErrorMessage(error));
        }).catch(() => {
          // We expect this to fail, we're just notifying the circuit
        });
      } catch (e) {
        // Ignore any errors from the circuit breaker itself
      }
      
      this.emit(DeepgramEvent.ERROR, {
        connectionId,
        callId,
        error: getErrorMessage(error)
      });
    });

    // Handle close events
    connection.on(LiveTranscriptionEvents.Close, () => {
      logger.info(`Deepgram stream closed for call ${callId}`);
      this.activeConnections.delete(connectionId);
      this.emit(DeepgramEvent.CONNECTION_STATUS, {
        connectionId,
        callId,
        status: 'disconnected'
      });
    });

    // Handle open events
    connection.on(LiveTranscriptionEvents.Open, () => {
      logger.info(`Deepgram stream opened for call ${callId}`);
      this.emit(DeepgramEvent.CONNECTION_STATUS, {
        connectionId,
        callId,
        status: 'open'
      });
    });
  }

  /**
   * Send audio data to an active transcription stream
   * @param connectionId Connection ID
   * @param audioData Audio data as Buffer
   */
  public sendAudioToStream(connectionId: string, audioData: Buffer): void {
    const connection = this.activeConnections.get(connectionId);
    if (!connection) {
      logger.warn(`No active Deepgram connection found for ID ${connectionId}`);
      return;
    }

    try {
      // Check if connection is open before sending
      if (connection.isOpen || connection.getReadyState() === 1) { // 1 = OPEN
        connection.send(audioData);
      } else {
        logger.warn(`Deepgram connection ${connectionId} is not open`);
      }
    } catch (error) {
      logger.error(`Error sending audio to Deepgram: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Close a transcription stream
   * @param connectionId Connection ID
   */
  public closeTranscriptionStream(connectionId: string): void {
    const connection = this.activeConnections.get(connectionId);
    if (!connection) {
      logger.warn(`No active Deepgram connection found for ID ${connectionId}`);
      return;
    }

    try {
      // Close the connection if it's open
      if (connection.isOpen || connection.getReadyState() === 1) { // 1 = OPEN
        connection.finish();
        logger.info(`Closed Deepgram connection ${connectionId}`);
      }
      
      // Clean up the connection
      this.activeConnections.delete(connectionId);
    } catch (error) {
      logger.error(`Error closing Deepgram connection: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get all active connection IDs
   * @returns Array of active connection IDs
   */
  public getActiveConnectionIds(): string[] {
    return Array.from(this.activeConnections.keys());
  }

  /**
   * Close all active connections
   */
  public closeAllConnections(): void {
    const connectionIds = this.getActiveConnectionIds();
    logger.info(`Closing ${connectionIds.length} Deepgram connections`);
    
    connectionIds.forEach(id => {
      this.closeTranscriptionStream(id);
    });
  }

  /**
   * Validate the Deepgram API key
   * @returns Promise<boolean> - True if the API key is valid
   */
  public async validateApiKey(): Promise<boolean> {
    try {
      // Use a simple API call to test if the key is valid
      const circuitBreaker = getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME);
      
      const result = await circuitBreaker.fire(async () => {
        // Simple request to check if key is valid
        await this.client.listen.prerecorded.transcribeUrl(
          { url: 'https://res.cloudinary.com/dvfrcaw1c/video/upload/v1711698492/test-samples/test-sample-en.mp3' },
          { model: 'nova-2', language: 'en' }
        );
        return true;
      });
      
      logger.info('Deepgram API key validation successful');
      return true;
    } catch (error) {
      logger.error(`Deepgram API key validation failed: ${error}`);
      return false;
    }
  }
}

// Singleton instance
let deepgramServiceInstance: DeepgramService | null = null;

/**
 * Initialize the Deepgram Service
 * @param apiKey Deepgram API key
 * @returns Service instance
 */
export function initializeDeepgramService(apiKey: string): DeepgramService {
  if (!deepgramServiceInstance) {
    deepgramServiceInstance = new DeepgramService(apiKey);
  } else {
    // Update API key if service already exists
    deepgramServiceInstance.updateApiKey(apiKey);
  }
  return deepgramServiceInstance;
}

/**
 * Get the Deepgram Service instance
 * @returns Service instance or null if not initialized
 */
export function getDeepgramService(): DeepgramService | null {
  return deepgramServiceInstance;
}
