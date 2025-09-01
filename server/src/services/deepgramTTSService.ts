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
      // Default to linear16 with wav container for compatibility
      const encoding = options.encoding || 'linear16';
      const defaultOptions = {
        model: 'aura-asteria-en',
        encoding: encoding,
        container: options.container || (encoding === 'linear16' ? 'wav' : undefined),
        // Only include sample_rate for non-mp3 encodings
        ...(encoding !== 'mp3' && { sample_rate: options.sample_rate || 24000 }),
        ...options
      };

      logger.debug('Synthesizing speech with Deepgram TTS', {
        textLength: text.length,
        options: defaultOptions
      });

      // Use the exact format from Deepgram documentation
      const response = await this.client.speak.request(
        { text: text },
        defaultOptions
      );

      // Get the stream as per documentation
      const stream = await response.getStream();
      if (!stream) {
        throw new Error('Error generating audio stream from Deepgram');
      }

      // Convert stream to buffer using the helper function from Deepgram docs
      const audioBuffer = await this.getAudioBuffer(stream);
      
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
      // Use the exact format from Deepgram documentation
      // Note: sample_rate is not applicable when encoding=mp3
      const encoding = options.encoding || 'mp3';
      
      // Make sure we're using the specifically requested model from options if provided
      const defaultOptions = {
        model: options.model || 'aura-2-thalia-en',
        encoding: encoding,
        ...(options.container && { container: options.container }),
        // Only include sample_rate for non-mp3 encodings
        ...(encoding !== 'mp3' && options.sample_rate && { sample_rate: options.sample_rate })
      };

      logger.info('Synthesizing speech with Deepgram TTS streaming', {
        textLength: text.length,
        requestedModel: options.model, // Log the specifically requested model
        actualModel: defaultOptions.model, // Log what we're actually using
        options: defaultOptions,
        hasOutputFile: !!options.outputFile
      });

      // Use the exact format from the documentation: { text: "Hello, how can I help you today?" }
      const response = await this.client.speak.request(
        { text: text },
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
        // Convert stream to buffer using the helper function
        const audioBuffer = await this.getAudioBuffer(stream);
        
        logger.info('Deepgram TTS streaming synthesis successful', {
          audioBufferSize: audioBuffer.length,
          textLength: text.length
        });
        
        return audioBuffer;
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
      // Note: sample_rate is automatically excluded for mp3 encoding
      outputFile
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client || !this.apiKey) {
      return false;
    }

    try {
      // Test with a simple phrase using the correct format (no sample_rate with mp3)
      const response = await this.client.speak.request(
        { text: 'Test' },
        {
          model: 'aura-2-thalia-en',
          encoding: 'mp3'
          // Note: sample_rate is not included with mp3 encoding
        }
      );

      // Try to get the stream - if this works, the API key is valid
      const stream = await response.getStream();
      if (!stream) {
        return false;
      }
      
      // Try to read a small amount to verify the stream works
      try {
        const reader = stream.getReader();
        const { done, value } = await reader.read();
        return true; // If we can read from the stream, it's working
      } catch (streamError) {
        logger.warn('Deepgram TTS stream test failed', {
          error: getErrorMessage(streamError)
        });
        return false;
      }
    } catch (error) {
      logger.warn('Deepgram TTS availability check failed', {
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Helper function to convert stream to audio buffer
   * Based on Deepgram SDK documentation
   */
  private async getAudioBuffer(response: any): Promise<Buffer> {
    const reader = response.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const dataArray = chunks.reduce(
      (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
      new Uint8Array(0)
    );

    return Buffer.from(dataArray.buffer);
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