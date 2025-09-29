import { Readable, Transform } from 'stream';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import cloudinaryService from '../utils/cloudinaryService';
import { StreamingTTSService, StreamingTTSOptions } from './streamingTTSService';

export interface StreamingAudioOptions {
  callId: string;
  conversationId: string;
  text: string;
  voiceId?: string;
  language?: string;
  chunkSize?: number;
  maxChunkSize?: number;
  enableCloudinary?: boolean;
  enableTwilioStreaming?: boolean;
}

export interface StreamingAudioResult {
  success: boolean;
  method: 'streaming' | 'cloudinary' | 'fallback';
  url?: string;
  totalSize: number;
  chunkCount: number;
  latency: number;
  error?: string;
}

export class StreamingAudioPipeline {
  private streamingTTS: StreamingTTSService;
  private activeStreams: Map<string, Readable> = new Map();

  constructor(streamingTTS: StreamingTTSService) {
    this.streamingTTS = streamingTTS;
  }

  /**
   * Stream audio to Twilio with ultra-low latency
   * Processes audio chunks as they're generated and streams them immediately
   */
  async streamAudioToTwilio(
    options: StreamingAudioOptions,
    sendAudioToTwilio: (audioChunk: Buffer) => void
  ): Promise<StreamingAudioResult> {
    const startTime = Date.now();
    const {
      callId,
      conversationId,
      text,
      voiceId = 'aura-asteria-en',
      language = 'en',
      chunkSize = 1024,
      maxChunkSize = 30 * 1024, // 30KB max for TwiML
      enableCloudinary = true,
      enableTwilioStreaming = true
    } = options;

    let totalSize = 0;
    let chunkCount = 0;
    const audioChunks: Buffer[] = [];

    try {
      logger.info('Starting streaming audio pipeline', {
        callId,
        conversationId,
        textLength: text.length,
        voiceId,
        chunkSize,
        enableCloudinary,
        enableTwilioStreaming
      });

      // TTS options optimized for streaming
      const ttsOptions: StreamingTTSOptions = {
        model: voiceId,
        encoding: 'mp3',
        chunkSize,
        onChunk: (chunk: Buffer) => {
          try {
            totalSize += chunk.length;
            chunkCount++;
            audioChunks.push(chunk);

            // Stream to Twilio immediately if enabled
            if (enableTwilioStreaming && totalSize <= maxChunkSize) {
              sendAudioToTwilio(chunk);
              logger.debug(`Streamed audio chunk ${chunkCount} to Twilio: ${chunk.length} bytes`);
            }

            // Log progress
            if (chunkCount % 10 === 0) {
              logger.debug(`Streaming progress: ${chunkCount} chunks, ${totalSize} bytes`);
            }
          } catch (error) {
            logger.error('Error processing audio chunk', {
              error: getErrorMessage(error),
              chunkCount,
              totalSize
            });
          }
        },
        onComplete: (finalSize: number) => {
          const latency = Date.now() - startTime;
          logger.info('Streaming audio pipeline completed', {
            callId,
            conversationId,
            totalSize: finalSize,
            chunkCount,
            latency,
            averageChunkSize: Math.round(finalSize / chunkCount)
          });
        },
        onError: (error: Error) => {
          logger.error('Streaming audio pipeline error', {
            callId,
            conversationId,
            error: getErrorMessage(error),
            chunkCount,
            totalSize
          });
        }
      };

      // Use immediate processing for ultra-low latency
      const { processChunks, getTotalSize } = await this.streamingTTS.synthesizeSpeechWithImmediateProcessing(
        text,
        ttsOptions
      );

      // Process chunks immediately
      const finalBuffer = await processChunks((chunk: Buffer) => {
        // Additional processing if needed
        if (enableTwilioStreaming && getTotalSize() <= maxChunkSize) {
          sendAudioToTwilio(chunk);
        }
      });

      const latency = Date.now() - startTime;
      const finalSize = getTotalSize();

      // If audio is too large for direct streaming, upload to Cloudinary
      if (finalSize > maxChunkSize && enableCloudinary) {
        try {
          logger.info('Audio too large for direct streaming, uploading to Cloudinary', {
            callId,
            finalSize,
            maxChunkSize
          });

          const cloudinaryUrl = await cloudinaryService.uploadAudioBuffer(finalBuffer, 'voice-recordings');
          
          return {
            success: true,
            method: 'cloudinary',
            url: cloudinaryUrl,
            totalSize: finalSize,
            chunkCount,
            latency
          };
        } catch (cloudinaryError) {
          logger.error('Cloudinary upload failed, using fallback', {
            callId,
            error: getErrorMessage(cloudinaryError),
            finalSize
          });

          return {
            success: false,
            method: 'fallback',
            totalSize: finalSize,
            chunkCount,
            latency,
            error: getErrorMessage(cloudinaryError)
          };
        }
      }

      // Success - audio was streamed directly
      return {
        success: true,
        method: 'streaming',
        totalSize: finalSize,
        chunkCount,
        latency
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Streaming audio pipeline failed', {
        callId,
        conversationId,
        error: getErrorMessage(error),
        chunkCount,
        totalSize,
        latency
      });

      return {
        success: false,
        method: 'fallback',
        totalSize,
        chunkCount,
        latency,
        error: getErrorMessage(error)
      };
    }
  }

  /**
   * Stream audio with WebSocket for real-time applications
   * Uses WebSocket connection for ultra-low latency
   */
  async streamAudioWebSocket(
    options: StreamingAudioOptions,
    sendAudioToTwilio: (audioChunk: Buffer) => void
  ): Promise<{
    start: () => void;
    stop: () => void;
    onProgress: (callback: (progress: { chunkCount: number; totalSize: number }) => void) => void;
  }> {
    const {
      callId,
      conversationId,
      text,
      voiceId = 'aura-asteria-en',
      chunkSize = 1024
    } = options;

    let totalSize = 0;
    let chunkCount = 0;
    let progressCallback: ((progress: { chunkCount: number; totalSize: number }) => void) | null = null;
    let isActive = false;

    try {
      logger.info('Starting WebSocket streaming audio pipeline', {
        callId,
        conversationId,
        textLength: text.length,
        voiceId,
        chunkSize
      });

      // TTS options for WebSocket streaming
      const ttsOptions: StreamingTTSOptions = {
        model: voiceId,
        encoding: 'mp3',
        chunkSize
      };

      // Create WebSocket streaming
      const webSocketStream = await this.streamingTTS.synthesizeSpeechWebSocket(text, ttsOptions);

      // Set up event handlers
      webSocketStream.onChunk((chunk: Buffer) => {
        if (isActive) {
          totalSize += chunk.length;
          chunkCount++;
          
          // Send to Twilio immediately
          sendAudioToTwilio(chunk);
          
          // Call progress callback
          if (progressCallback) {
            progressCallback({ chunkCount, totalSize });
          }

          logger.debug(`WebSocket audio chunk ${chunkCount}: ${chunk.length} bytes`);
        }
      });

      webSocketStream.onComplete((finalSize: number) => {
        logger.info('WebSocket streaming completed', {
          callId,
          conversationId,
          totalSize: finalSize,
          chunkCount
        });
      });

      webSocketStream.onError((error: Error) => {
        logger.error('WebSocket streaming error', {
          callId,
          conversationId,
          error: getErrorMessage(error),
          chunkCount,
          totalSize
        });
      });

      return {
        start: () => {
          isActive = true;
          webSocketStream.start();
          logger.info('WebSocket streaming started', { callId, conversationId });
        },
        stop: () => {
          isActive = false;
          logger.info('WebSocket streaming stopped', { callId, conversationId });
        },
        onProgress: (callback: (progress: { chunkCount: number; totalSize: number }) => void) => {
          progressCallback = callback;
        }
      };

    } catch (error) {
      logger.error('WebSocket streaming setup failed', {
        callId,
        conversationId,
        error: getErrorMessage(error)
      });

      throw error;
    }
  }

  /**
   * Get streaming statistics for monitoring
   */
  getStreamingStats(): {
    activeStreams: number;
    totalChunks: number;
    averageChunkSize: number;
  } {
    return {
      activeStreams: this.activeStreams.size,
      totalChunks: 0, // Would need to track this
      averageChunkSize: 0 // Would need to track this
    };
  }

  /**
   * Clean up active streams
   */
  cleanup(): void {
    this.activeStreams.forEach((stream, callId) => {
      try {
        stream.destroy();
        logger.debug(`Cleaned up stream for call ${callId}`);
      } catch (error) {
        logger.error(`Error cleaning up stream for call ${callId}`, {
          error: getErrorMessage(error)
        });
      }
    });
    this.activeStreams.clear();
  }
}

// Singleton instance
let streamingAudioPipeline: StreamingAudioPipeline | null = null;

export function initializeStreamingAudioPipeline(streamingTTS: StreamingTTSService): StreamingAudioPipeline {
  streamingAudioPipeline = new StreamingAudioPipeline(streamingTTS);
  return streamingAudioPipeline;
}

export function getStreamingAudioPipeline(): StreamingAudioPipeline | null {
  return streamingAudioPipeline;
}