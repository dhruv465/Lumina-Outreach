import { createClient } from '@deepgram/sdk';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

export interface DeepgramTTSOptions {
  model?: string;
  encoding?: string;
  container?: string;
  sample_rate?: number;
}

export interface DeepgramStreamOptions extends DeepgramTTSOptions {
  outputFile?: string;
}

export class DeepgramTTSService {
  private client: any;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (apiKey) {
      this.client = createClient(apiKey);
    }
  }

  async synthesizeSpeech(
    text: string, 
    options: DeepgramTTSOptions = {}
  ): Promise<Buffer> {
    if (!this.client || !this.apiKey) {
      throw new Error('Deepgram TTS service not initialized - no API key provided');
    }

    try {
      const defaultOptions = {
        model: 'aura-asteria-en',
        encoding: 'linear16',
        container: 'wav',
        sample_rate: 24000,
        ...options
      };

      logger.debug('Synthesizing speech with Deepgram TTS', {
        textLength: text.length,
        options: defaultOptions
      });

      const response = await this.client.speak.request(
        { text },
        defaultOptions
      );

      // For Deepgram, we need to get the stream and convert to buffer
      const stream = await response.getStream();
      if (!stream) {
        throw new Error('Error generating audio stream from Deepgram');
      }

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      
      const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        
        stream.on('error', (error: Error) => {
          reject(error);
        });
      });
      
      logger.debug('Deepgram TTS synthesis successful', {
        audioBufferSize: audioBuffer.length,
        textLength: text.length
      });

      return audioBuffer;
    } catch (error) {
      logger.error('Deepgram TTS synthesis failed', {
        error: getErrorMessage(error),
        textLength: text.length,
        options
      });
      throw error;
    }
  }

  /**
   * Synthesize speech with streaming support and optional file output
   * Based on the provided Deepgram example code
   */
  async synthesizeSpeechWithStream(
    text: string,
    options: DeepgramStreamOptions = {}
  ): Promise<Buffer> {
    if (!this.client || !this.apiKey) {
      throw new Error('Deepgram TTS service not initialized - no API key provided');
    }

    try {
      const defaultOptions = {
        model: 'aura-2-thalia-en', // Using the model from your example
        encoding: 'mp3',
        // Note: container is not used with mp3 encoding
        sample_rate: 24000,
        ...options
      };

      logger.info('Synthesizing speech with Deepgram TTS streaming', {
        textLength: text.length,
        options: defaultOptions,
        hasOutputFile: !!options.outputFile
      });

      const response = await this.client.speak.request(
        { text },
        defaultOptions
      );

      const stream = await response.getStream();
      
      if (!stream) {
        throw new Error('Error generating audio stream from Deepgram');
      }

      // If output file is specified, write to file and return buffer
      if (options.outputFile) {
        const file = fs.createWriteStream(options.outputFile);
        
        try {
          await pipeline(stream, file);
          logger.info(`Audio file written to ${options.outputFile}`, {
            textLength: text.length
          });
          
          // Read the file back as buffer
          const audioBuffer = fs.readFileSync(options.outputFile);
          return audioBuffer;
        } catch (pipelineError) {
          logger.error('Error writing audio to file:', {
            error: getErrorMessage(pipelineError),
            outputFile: options.outputFile
          });
          throw pipelineError;
        }
      } else {
        // Convert stream to buffer directly
        const chunks: Buffer[] = [];
        
        return new Promise((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          
          stream.on('end', () => {
            const audioBuffer = Buffer.concat(chunks);
            logger.info('Deepgram TTS streaming synthesis successful', {
              audioBufferSize: audioBuffer.length,
              textLength: text.length
            });
            resolve(audioBuffer);
          });
          
          stream.on('error', (error: Error) => {
            logger.error('Stream error during Deepgram TTS synthesis', {
              error: getErrorMessage(error)
            });
            reject(error);
          });
        });
      }
    } catch (error) {
      logger.error('Deepgram TTS streaming synthesis failed', {
        error: getErrorMessage(error),
        textLength: text.length,
        options
      });
      throw error;
    }
  }

  /**
   * Quick synthesis method using the example from your code
   */
  async speak(text: string, outputFile?: string): Promise<Buffer> {
    return this.synthesizeSpeechWithStream(text, {
      model: 'aura-2-thalia-en',
      encoding: 'mp3',
      outputFile
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client || !this.apiKey) {
      return false;
    }

    try {
      // Test with a simple phrase using the streaming method that works
      const response = await this.client.speak.request(
        { text: 'Test' },
        {
          model: 'aura-2-thalia-en',
          encoding: 'mp3'
        }
      );

      // Try to get the stream - if this works, the API key is valid
      const stream = await response.getStream();
      return !!stream;
    } catch (error) {
      logger.warn('Deepgram TTS availability check failed', {
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Get available Deepgram TTS models
   */
  getAvailableModels(): string[] {
    return [
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
  }
}

let deepgramTTSService: DeepgramTTSService | null = null;

export function initializeDeepgramTTS(apiKey: string): DeepgramTTSService {
  deepgramTTSService = new DeepgramTTSService(apiKey);
  return deepgramTTSService;
}

export function getDeepgramTTSService(): DeepgramTTSService | null {
  return deepgramTTSService;
}