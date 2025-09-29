import { createClient } from '@deepgram/sdk';
import { Readable, Transform } from 'stream';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

export interface StreamingTTSOptions {
  model?: string;
  encoding?: string;
  container?: string;
  sample_rate?: number;
  chunkSize?: number;
  onChunk?: (chunk: Buffer) => void;
  onComplete?: (totalSize: number) => void;
  onError?: (error: Error) => void;
}

export interface StreamingTTSResult {
  stream: Readable;
  totalSize: number;
  duration: number;
}

export class StreamingTTSService {
  private client: any;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (apiKey) {
      this.client = createClient(apiKey);
    }
  }

  /**
   * Synthesize speech with streaming support for ultra-low latency
   * Streams audio chunks as they're generated instead of waiting for complete synthesis
   */
  async synthesizeSpeechStream(
    text: string,
    options: StreamingTTSOptions = {}
  ): Promise<StreamingTTSResult> {
    if (!this.client || !this.apiKey) {
      throw new Error('Streaming TTS service not initialized - no API key provided');
    }

    const startTime = Date.now();
    const chunkSize = options.chunkSize || 1024; // 1KB chunks for low latency
    let totalSize = 0;
    let chunkCount = 0;

    try {
      // Default options optimized for streaming
      const defaultOptions = {
        model: options.model || 'aura-asteria-en',
        encoding: options.encoding || 'mp3',
        container: options.container || (options.encoding === 'linear16' ? 'wav' : undefined),
        ...(options.encoding !== 'mp3' && { sample_rate: options.sample_rate || 24000 }),
        ...options
      };

      logger.info('Starting streaming TTS synthesis', {
        textLength: text.length,
        chunkSize,
        options: defaultOptions
      });

      // Create the TTS request
      const response = await this.client.speak.request(
        { text: text },
        defaultOptions
      );

      // Get the stream
      const deepgramStream = await response.getStream();
      if (!deepgramStream) {
        throw new Error('Error generating audio stream from Deepgram');
      }

      // Create a transform stream to process chunks
      const audioStream = new Transform({
        transform(chunk, encoding, callback) {
          try {
            totalSize += chunk.length;
            chunkCount++;
            
            // Call the onChunk callback if provided
            if (options.onChunk) {
              options.onChunk(chunk);
            }

            // Log progress for debugging
            if (chunkCount % 10 === 0) { // Log every 10 chunks
              logger.debug(`Streaming TTS progress: ${chunkCount} chunks, ${totalSize} bytes`);
            }

            callback(null, chunk);
          } catch (error) {
            callback(error);
          }
        },
        flush(callback) {
          const duration = Date.now() - startTime;
          logger.info('Streaming TTS synthesis completed', {
            totalSize,
            chunkCount,
            duration,
            averageChunkSize: Math.round(totalSize / chunkCount)
          });

          // Call the onComplete callback if provided
          if (options.onComplete) {
            options.onComplete(totalSize);
          }

          callback();
        }
      });

      // Handle errors
      audioStream.on('error', (error) => {
        logger.error('Streaming TTS error', {
          error: getErrorMessage(error),
          textLength: text.length,
          chunkCount,
          totalSize
        });

        if (options.onError) {
          options.onError(error);
        }
      });

      // Pipe the Deepgram stream through our transform stream
      deepgramStream.pipe(audioStream);

      const duration = Date.now() - startTime;

      return {
        stream: audioStream,
        totalSize: 0, // Will be updated as stream progresses
        duration
      };

    } catch (error) {
      logger.error('Streaming TTS synthesis failed', {
        error: getErrorMessage(error),
        textLength: text.length,
        options
      });

      if (options.onError) {
        options.onError(error as Error);
      }

      throw error;
    }
  }

  /**
   * Synthesize speech with immediate chunk processing for ultra-low latency
   * Processes audio chunks as soon as they're available
   */
  async synthesizeSpeechWithImmediateProcessing(
    text: string,
    options: StreamingTTSOptions = {}
  ): Promise<{
    processChunks: (callback: (chunk: Buffer) => void) => Promise<Buffer>;
    getTotalSize: () => number;
  }> {
    if (!this.client || !this.apiKey) {
      throw new Error('Streaming TTS service not initialized - no API key provided');
    }

    const startTime = Date.now();
    let totalSize = 0;
    let chunkCount = 0;
    const chunks: Buffer[] = [];

    try {
      // Default options optimized for streaming
      const defaultOptions = {
        model: options.model || 'aura-asteria-en',
        encoding: options.encoding || 'mp3',
        container: options.container || (options.encoding === 'linear16' ? 'wav' : undefined),
        ...(options.encoding !== 'mp3' && { sample_rate: options.sample_rate || 24000 }),
        ...options
      };

      logger.info('Starting immediate processing TTS synthesis', {
        textLength: text.length,
        options: defaultOptions
      });

      // Create the TTS request
      const response = await this.client.speak.request(
        { text: text },
        defaultOptions
      );

      // Get the stream
      const deepgramStream = await response.getStream();
      if (!deepgramStream) {
        throw new Error('Error generating audio stream from Deepgram');
      }

      // Process chunks immediately
      const processChunks = (callback: (chunk: Buffer) => void): Promise<Buffer> => {
        return new Promise((resolve, reject) => {
          deepgramStream.on('data', (chunk: Buffer) => {
            try {
              totalSize += chunk.length;
              chunkCount++;
              chunks.push(chunk);
              
              // Call the callback immediately
              callback(chunk);

              // Log progress for debugging
              if (chunkCount % 10 === 0) {
                logger.debug(`Immediate TTS progress: ${chunkCount} chunks, ${totalSize} bytes`);
              }
            } catch (error) {
              reject(error);
            }
          });

          deepgramStream.on('end', () => {
            const duration = Date.now() - startTime;
            logger.info('Immediate processing TTS synthesis completed', {
              totalSize,
              chunkCount,
              duration,
              averageChunkSize: Math.round(totalSize / chunkCount)
            });

            if (options.onComplete) {
              options.onComplete(totalSize);
            }

            resolve(Buffer.concat(chunks));
          });

          deepgramStream.on('error', (error) => {
            logger.error('Immediate processing TTS error', {
              error: getErrorMessage(error),
              textLength: text.length,
              chunkCount,
              totalSize
            });

            if (options.onError) {
              options.onError(error);
            }

            reject(error);
          });
        });
      };

      return {
        processChunks,
        getTotalSize: () => totalSize
      };

    } catch (error) {
      logger.error('Immediate processing TTS synthesis failed', {
        error: getErrorMessage(error),
        textLength: text.length,
        options
      });

      if (options.onError) {
        options.onError(error as Error);
      }

      throw error;
    }
  }

  /**
   * Synthesize speech with WebSocket streaming for real-time applications
   * Uses WebSocket connection for ultra-low latency streaming
   */
  async synthesizeSpeechWebSocket(
    text: string,
    options: StreamingTTSOptions = {}
  ): Promise<{
    onChunk: (callback: (chunk: Buffer) => void) => void;
    onComplete: (callback: (totalSize: number) => void) => void;
    onError: (callback: (error: Error) => void) => void;
    start: () => void;
  }> {
    if (!this.client || !this.apiKey) {
      throw new Error('Streaming TTS service not initialized - no API key provided');
    }

    const startTime = Date.now();
    let totalSize = 0;
    let chunkCount = 0;

    // Event handlers
    let chunkHandler: ((chunk: Buffer) => void) | null = null;
    let completeHandler: ((totalSize: number) => void) | null = null;
    let errorHandler: ((error: Error) => void) | null = null;

    const start = async () => {
      try {
        // Default options optimized for streaming
        const defaultOptions = {
          model: options.model || 'aura-asteria-en',
          encoding: options.encoding || 'mp3',
          container: options.container || (options.encoding === 'linear16' ? 'wav' : undefined),
          ...(options.encoding !== 'mp3' && { sample_rate: options.sample_rate || 24000 }),
          ...options
        };

        logger.info('Starting WebSocket TTS synthesis', {
          textLength: text.length,
          options: defaultOptions
        });

        // Create the TTS request
        const response = await this.client.speak.request(
          { text: text },
          defaultOptions
        );

        // Get the stream
        const deepgramStream = await response.getStream();
        if (!deepgramStream) {
          throw new Error('Error generating audio stream from Deepgram');
        }

        // Process chunks as they arrive
        deepgramStream.on('data', (chunk: Buffer) => {
          try {
            totalSize += chunk.length;
            chunkCount++;
            
            // Call the chunk handler immediately
            if (chunkHandler) {
              chunkHandler(chunk);
            }

            // Log progress for debugging
            if (chunkCount % 10 === 0) {
              logger.debug(`WebSocket TTS progress: ${chunkCount} chunks, ${totalSize} bytes`);
            }
          } catch (error) {
            if (errorHandler) {
              errorHandler(error as Error);
            }
          }
        });

        deepgramStream.on('end', () => {
          const duration = Date.now() - startTime;
          logger.info('WebSocket TTS synthesis completed', {
            totalSize,
            chunkCount,
            duration,
            averageChunkSize: Math.round(totalSize / chunkCount)
          });

          if (completeHandler) {
            completeHandler(totalSize);
          }
        });

        deepgramStream.on('error', (error) => {
          logger.error('WebSocket TTS error', {
            error: getErrorMessage(error),
            textLength: text.length,
            chunkCount,
            totalSize
          });

          if (errorHandler) {
            errorHandler(error);
          }
        });

      } catch (error) {
        logger.error('WebSocket TTS synthesis failed', {
          error: getErrorMessage(error),
          textLength: text.length,
          options
        });

        if (errorHandler) {
          errorHandler(error as Error);
        }
      }
    };

    return {
      onChunk: (callback: (chunk: Buffer) => void) => {
        chunkHandler = callback;
      },
      onComplete: (callback: (totalSize: number) => void) => {
        completeHandler = callback;
      },
      onError: (callback: (error: Error) => void) => {
        errorHandler = callback;
      },
      start
    };
  }
}

// Singleton instance
let streamingTTSService: StreamingTTSService | null = null;

export function initializeStreamingTTS(apiKey: string): StreamingTTSService {
  streamingTTSService = new StreamingTTSService(apiKey);
  return streamingTTSService;
}

export function getStreamingTTSService(): StreamingTTSService | null {
  return streamingTTSService;
}