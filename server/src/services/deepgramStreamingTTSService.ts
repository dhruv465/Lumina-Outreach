import { createClient, LiveTTSEvents } from '@deepgram/sdk';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

export interface DeepgramStreamingTTSOptions {
  model?: string;
  encoding?: string;
  sample_rate?: number;
}

export class DeepgramStreamingTTSService extends EventEmitter {
  private client: any;
  private apiKey: string;
  private connection: any = null;
  private isConnected: boolean = false;
  private audioBuffer: Buffer = Buffer.alloc(0);

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
    if (apiKey) {
      this.client = createClient(apiKey);
    }
  }

  async connect(options: DeepgramStreamingTTSOptions = {}): Promise<boolean> {
    if (!this.client || !this.apiKey) {
      throw new Error('Deepgram streaming TTS service not initialized - no API key provided');
    }

    try {
      const defaultOptions = {
        model: options.model || 'aura-2-thalia-en',
        encoding: options.encoding || 'linear16',
        sample_rate: options.sample_rate || 48000
      };

      logger.info('Connecting to Deepgram streaming TTS', {
        options: defaultOptions
      });

      this.connection = this.client.speak.live(defaultOptions);

      // Set up event handlers
      this.connection.on(LiveTTSEvents.Open, () => {
        logger.info('Deepgram streaming TTS connection opened');
        this.isConnected = true;
        this.emit('connected');
      });

      this.connection.on(LiveTTSEvents.Close, () => {
        logger.info('Deepgram streaming TTS connection closed');
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.connection.on(LiveTTSEvents.Audio, (data) => {
        logger.debug('Deepgram streaming TTS audio data received', {
          dataLength: data.length
        });
        
        // Convert data to Buffer and emit
        const buffer = Buffer.from(data);
        this.audioBuffer = Buffer.concat([this.audioBuffer, buffer]);
        this.emit('audio', buffer);
      });

      this.connection.on(LiveTTSEvents.Flushed, () => {
        logger.debug('Deepgram streaming TTS flushed');
        this.emit('flushed', this.audioBuffer);
        // Reset buffer after flushing
        this.audioBuffer = Buffer.alloc(0);
      });

      this.connection.on(LiveTTSEvents.Metadata, (data) => {
        logger.debug('Deepgram streaming TTS metadata received', data);
        this.emit('metadata', data);
      });

      this.connection.on(LiveTTSEvents.Error, (error) => {
        logger.error('Deepgram streaming TTS error', {
          error: getErrorMessage(error)
        });
        this.emit('error', error);
      });

      return true;
    } catch (error) {
      logger.error('Failed to connect to Deepgram streaming TTS', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  sendText(text: string): void {
    if (!this.connection || !this.isConnected) {
      throw new Error('Deepgram streaming TTS not connected');
    }

    try {
      logger.debug('Sending text to Deepgram streaming TTS', {
        textLength: text.length,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });

      this.connection.sendText(text);
    } catch (error) {
      logger.error('Failed to send text to Deepgram streaming TTS', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  flush(): void {
    if (!this.connection || !this.isConnected) {
      throw new Error('Deepgram streaming TTS not connected');
    }

    try {
      logger.debug('Flushing Deepgram streaming TTS');
      this.connection.flush();
    } catch (error) {
      logger.error('Failed to flush Deepgram streaming TTS', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  disconnect(): void {
    if (this.connection) {
      try {
        logger.info('Disconnecting from Deepgram streaming TTS');
        this.connection.finish();
        this.isConnected = false;
      } catch (error) {
        logger.error('Error disconnecting from Deepgram streaming TTS', {
          error: getErrorMessage(error)
        });
      }
    }
  }

  isConnectionActive(): boolean {
    return this.isConnected;
  }

  getAudioBuffer(): Buffer {
    return this.audioBuffer;
  }

  clearAudioBuffer(): void {
    this.audioBuffer = Buffer.alloc(0);
  }
}

// Factory function for creating streaming TTS service instances
export function createDeepgramStreamingTTS(apiKey: string, options?: DeepgramStreamingTTSOptions): DeepgramStreamingTTSService {
  return new DeepgramStreamingTTSService(apiKey);
}