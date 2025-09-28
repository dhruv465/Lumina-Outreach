import { createClient, DeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { getErrorMessage } from '../utils/logger';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import Configuration from '../models/Configuration';
import { getCircuitBreakerService, CircuitBreakerOptions } from './circuitBreakerService';
import { 
  ModelCompatibilityService, 
  getModelCompatibilityService,
  initializeModelCompatibilityService,
  ModelValidationResult,
  ModelPreferences,
  DeepgramErrorType
} from './modelCompatibilityService';
import { deepgramModelMetrics } from '../monitoring/deepgramModelMetrics';

// Define DeepgramStreamOptions interface directly to avoid circular dependencies
export interface DeepgramStreamOptions {
  language?: string;
  model?: string;
  tier?: string;
  detectLanguage?: boolean;
  punctuate?: boolean;
  profanity_filter?: boolean;
  profanityFilter?: boolean;
  redact?: boolean;
  diarize?: boolean;
  multichannel?: boolean;
  alternatives?: number;
  numerals?: boolean;
  smart_format?: boolean;
  endpointing?: number;
  utteranceEndMs?: number;
  keywords?: string[];
  interim_results?: boolean;
  callback?: string;
}

// Add DeepgramConfig interface
export interface DeepgramConfig {
  apiKey?: string;
  language?: string;
  model?: string;
  primaryModel?: string;
  tier?: string;
  detectLanguage?: boolean;
  features?: {
    punctuate?: boolean;
    diarize?: boolean;
    interim_results?: boolean;
    endpointing?: number;
  };
}

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

export class DeepgramService extends EventEmitter {
  private apiKey: string;
  private client: DeepgramClient;
  private activeConnections: Map<string, any> = new Map();
  private warnedConnections: Set<string> = new Set();
  private defaultModel: string = 'nova-2';
  private fallbackModels: string[] = ['nova', 'base'];
  private modelCompatibilityService: ModelCompatibilityService;
  private defaultOptions: DeepgramStreamOptions = {
    language: 'en',
    model: 'nova-2',
    punctuate: true,
    endpointing: 150, 
    utteranceEndMs: 500
  };
  private readonly CIRCUIT_NAME = 'deepgram-api';

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    this.modelCompatibilityService = initializeModelCompatibilityService(apiKey);
    
    const circuitOptions: CircuitBreakerOptions = {
      resetTimeout: 10000,
      errorThresholdPercentage: 30,
      timeout: 5000
    };
    getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME, circuitOptions);
    
    logger.info('Deepgram Service initialized');
  }

  public updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    this.modelCompatibilityService.updateApiKey(apiKey);
  }

  public async createTranscriptionStream(callId: string, options?: DeepgramStreamOptions): Promise<string> {
    const connectionId = uuidv4();
    const streamOptions = { ...this.defaultOptions, ...options };

    const url = `wss://api.deepgram.com/v1/listen?language=${streamOptions.language}&model=${streamOptions.model}&tier=${streamOptions.tier || 'enhanced'}&punctuate=${streamOptions.punctuate}&diarize=${streamOptions.diarize || false}&multichannel=false&alternatives=1&endpointing=${streamOptions.endpointing}&utterance_end_ms=${streamOptions.utteranceEndMs}&smart_format=true&encoding=linear16&sample_rate=16000&interim_results=true`;

    const connection = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.activeConnections.set(connectionId, { connection, callId, model: streamOptions.model });
    this.setupConnectionHandlers(connection, connectionId, callId, streamOptions.model);
    
    return connectionId;
  }

  private setupConnectionHandlers(connection: WebSocket, connectionId: string, callId: string, model?: string): void {
    connection.on('open', () => {
      logger.info(`Deepgram stream opened for call ${callId}`);
      this.emit(DeepgramEvent.CONNECTION_STATUS, { connectionId, callId, status: 'open' });
    });

    connection.on('message', (data: any) => {
      const message = JSON.parse(data.toString());
      if (message.channel?.alternatives?.[0]) {
        const alt = message.channel.alternatives[0];
        const result: TranscriptResult = {
          id: uuidv4(),
          callId,
          text: alt.transcript || '',
          isFinal: message.is_final || false,
          confidence: alt.confidence || 0,
          words: alt.words?.map((word: any) => ({ word: word.word, start: word.start, end: word.end, confidence: word.confidence })) || [],
          metadata: { startTime: message.start || 0, endTime: message.end || 0, processingLatency: message.audio_meta?.processing_latency_ms || 0 }
        };

        if (result.isFinal) {
          this.emit(DeepgramEvent.TRANSCRIPT_FINAL, result);
        } else {
          this.emit(DeepgramEvent.TRANSCRIPT_RECEIVED, result);
        }
      }
    });

    connection.on('error', (error) => {
      logger.error(`Deepgram stream error for call ${callId}: ${getErrorMessage(error)}`);
      this.emit(DeepgramEvent.ERROR, { connectionId, callId, error: getErrorMessage(error), model });
    });

    connection.on('close', () => {
      logger.info(`Deepgram stream closed for call ${callId}`);
      this.activeConnections.delete(connectionId);
      this.emit(DeepgramEvent.CONNECTION_STATUS, { connectionId, callId, status: 'disconnected' });
    });
  }

  public sendAudioToStream(connectionId: string, audioData: Buffer): void {
    const connectionData = this.activeConnections.get(connectionId);
    if (!connectionData) {
      if (!this.warnedConnections.has(connectionId)) {
        logger.warn(`No active Deepgram connection found for ID ${connectionId}`);
        this.warnedConnections.add(connectionId);
      }
      return;
    }

    const { connection } = connectionData;
    if (connection.readyState === WebSocket.OPEN) {
      connection.send(audioData);
    } else {
      if (!this.warnedConnections.has(connectionId)) {
        logger.warn(`Deepgram connection ${connectionId} is not open (state: ${connection.readyState})`);
        this.warnedConnections.add(connectionId);
      }
    }
  }

  public closeTranscriptionStream(connectionId: string): void {
    const connectionData = this.activeConnections.get(connectionId);
    if (connectionData) {
      connectionData.connection.close();
      this.activeConnections.delete(connectionId);
      this.warnedConnections.delete(connectionId);
      logger.info(`Closed Deepgram connection ${connectionId}`);
    }
  }

  public async validateApiKey(): Promise<boolean> {
    try {
      const compatibleModels = await this.modelCompatibilityService.getCompatibleModels(this.apiKey);
      return compatibleModels.length > 0;
    } catch (error) {
      logger.error(`Deepgram API key validation failed: ${getErrorMessage(error)}`);
      return false;
    }
  }
}

let deepgramServiceInstance: DeepgramService | null = null;

export function initializeDeepgramService(apiKey: string): DeepgramService {
  if (!deepgramServiceInstance) {
    deepgramServiceInstance = new DeepgramService(apiKey);
  } else {
    deepgramServiceInstance.updateApiKey(apiKey);
  }
  return deepgramServiceInstance;
}

export function getDeepgramService(): DeepgramService | null {
  return deepgramServiceInstance;
}