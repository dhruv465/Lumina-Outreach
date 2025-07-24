/**
 * WebCallAudioPipeline
 * 
 * Optimized audio processing pipeline for web call testing
 * This service handles audio processing, buffering, and optimization
 * to reduce latency in the web call testing feature.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';
import webCallMetricsService from './webCallMetricsService';
import { getDeepgramServiceWithRecovery } from './deepgramServiceWithRecovery';
import { RateLimitAwareOptions } from '../utils/circuitBreaker';
import webCallCircuitBreaker from './webCallCircuitBreaker';

/**
 * Audio processing options
 */
export interface AudioProcessingOptions {
  // Audio format options
  sampleRate?: number;
  channels?: number;
  encoding?: 'LINEAR16' | 'OPUS' | 'MULAW';

  // Processing options
  vadEnabled?: boolean;
  vadSensitivity?: number;
  silenceThreshold?: number;
  silenceTimeout?: number;

  // Performance options
  bufferSize?: number;
  maxBufferCount?: number;
  processingInterval?: number;
  useWorker?: boolean;

  // Circuit breaker options
  circuitBreaker?: RateLimitAwareOptions;
}

/**
 * Audio processing result
 */
export interface AudioProcessingResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
  processingTime: number;
  audioLength: number;
}

/**
 * WebCallAudioPipeline class
 */
export class WebCallAudioPipeline extends EventEmitter {
  private options: Required<AudioProcessingOptions>;
  private audioBuffers: Map<string, Buffer[]> = new Map();
  private processingTimers: Map<string, NodeJS.Timeout> = new Map();
  private isProcessing: Map<string, boolean> = new Map();
  private vadState: Map<string, { isSpeaking: boolean, silenceStart: number | null }> = new Map();
  private metrics: Map<string, {
    totalProcessingTime: number;
    processedChunks: number;
    totalAudioLength: number;
    peakLatency: number;
  }> = new Map();

  constructor(options: AudioProcessingOptions = {}) {
    super();

    // Set default options
    this.options = {
      sampleRate: options.sampleRate || 16000,
      channels: options.channels || 1,
      encoding: options.encoding || 'LINEAR16',
      vadEnabled: options.vadEnabled !== undefined ? options.vadEnabled : true,
      vadSensitivity: options.vadSensitivity || 0.5,
      silenceThreshold: options.silenceThreshold || 0.05,
      silenceTimeout: options.silenceTimeout || 1500,
      bufferSize: options.bufferSize || 4096,
      maxBufferCount: options.maxBufferCount || 10,
      processingInterval: options.processingInterval || 300,
      useWorker: options.useWorker !== undefined ? options.useWorker : false,
      circuitBreaker: options.circuitBreaker || {
        timeout: 30000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        volumeThreshold: 10,
        rollingCountTimeout: 60000,
        rollingCountBuckets: 10,
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        jitter: true
      }
    };

    logger.info('WebCallAudioPipeline initialized with options:', {
      sampleRate: this.options.sampleRate,
      channels: this.options.channels,
      vadEnabled: this.options.vadEnabled,
      processingInterval: this.options.processingInterval,
      useWorker: this.options.useWorker
    });
  }

  /**
   * Initialize a session for audio processing
   * @param sessionId The session ID
   */
  public initializeSession(sessionId: string): void {
    // Initialize buffers and state
    this.audioBuffers.set(sessionId, []);
    this.isProcessing.set(sessionId, false);
    this.vadState.set(sessionId, { isSpeaking: false, silenceStart: null });

    // Initialize metrics
    this.metrics.set(sessionId, {
      totalProcessingTime: 0,
      processedChunks: 0,
      totalAudioLength: 0,
      peakLatency: 0
    });

    // Set up processing timer
    const timer = setInterval(() => {
      this.processAudioBuffers(sessionId);
    }, this.options.processingInterval);

    this.processingTimers.set(sessionId, timer);

    logger.info(`Audio pipeline initialized for session ${sessionId}`);
  }

  /**
   * Add audio data to the processing pipeline
   * @param sessionId The session ID
   * @param audioBuffer Audio buffer to process
   */
  public async addAudioData(sessionId: string, audioBuffer: Buffer): Promise<void> {
    // Check if session exists
    if (!this.audioBuffers.has(sessionId)) {
      this.initializeSession(sessionId);
    }

    // Get buffer array
    const buffers = this.audioBuffers.get(sessionId)!;

    // Add buffer to array
    buffers.push(audioBuffer);

    // Limit buffer size to prevent memory issues
    if (buffers.length > this.options.maxBufferCount) {
      buffers.shift();
      logger.warn(`Audio buffer overflow for session ${sessionId}, dropping oldest chunk`);
    }

    // If VAD is enabled, check for speech
    if (this.options.vadEnabled) {
      const isSpeaking = await this.detectSpeech(audioBuffer);
      const vadState = this.vadState.get(sessionId)!;

      if (isSpeaking) {
        // Reset silence start if we detect speech
        vadState.silenceStart = null;

        if (!vadState.isSpeaking) {
          vadState.isSpeaking = true;
          this.emit('speechStart', { sessionId, timestamp: Date.now() });
        }
      } else if (vadState.isSpeaking) {
        // Start tracking silence
        if (vadState.silenceStart === null) {
          vadState.silenceStart = Date.now();
        } else {
          // Check if silence has lasted long enough
          const silenceDuration = Date.now() - vadState.silenceStart;
          if (silenceDuration >= this.options.silenceTimeout) {
            vadState.isSpeaking = false;
            this.emit('speechEnd', {
              sessionId,
              timestamp: Date.now(),
              duration: silenceDuration
            });

            // Process immediately when speech ends
            this.processAudioBuffers(sessionId);
          }
        }
      }
    }
  }

  /**
   * Process audio buffers for a session
   * @param sessionId The session ID
   */
  private async processAudioBuffers(sessionId: string): Promise<void> {
    // Check if session exists and has buffers
    if (!this.audioBuffers.has(sessionId) || this.audioBuffers.get(sessionId)!.length === 0) {
      return;
    }

    // Check if already processing
    if (this.isProcessing.get(sessionId)) {
      return;
    }

    try {
      // Set processing flag
      this.isProcessing.set(sessionId, true);

      // Get buffers
      const buffers = this.audioBuffers.get(sessionId)!;

      // Combine buffers
      const combinedBuffer = Buffer.concat(buffers);

      // Clear buffer array
      this.audioBuffers.set(sessionId, []);

      // Start processing timer
      const startTime = Date.now();

      // Process audio
      const result = await this.processAudio(sessionId, combinedBuffer);

      // Calculate processing time
      const processingTime = Date.now() - startTime;

      // Update metrics
      const sessionMetrics = this.metrics.get(sessionId)!;
      sessionMetrics.totalProcessingTime += processingTime;
      sessionMetrics.processedChunks++;
      sessionMetrics.totalAudioLength += combinedBuffer.length;
      sessionMetrics.peakLatency = Math.max(sessionMetrics.peakLatency, processingTime);

      // Record metrics in service
      webCallMetricsService.recordComponentLatency(sessionId, 'audioProcessing' as any, processingTime);

      // Emit result
      this.emit('processingComplete', {
        sessionId,
        result,
        processingTime,
        timestamp: Date.now()
      });

      // Log processing time if it's high
      if (processingTime > 500) {
        logger.warn(`High audio processing latency for session ${sessionId}: ${processingTime}ms`);
      }
    } catch (error) {
      logger.error(`Error processing audio for session ${sessionId}: ${error.message}`);

      // Emit error
      this.emit('processingError', {
        sessionId,
        error,
        timestamp: Date.now()
      });
    } finally {
      // Reset processing flag
      this.isProcessing.set(sessionId, false);
    }
  }

  /**
   * Process audio data
   * @param sessionId The session ID
   * @param audioBuffer Audio buffer to process
   * @returns Processing result
   */
  private async processAudio(sessionId: string, audioBuffer: Buffer): Promise<AudioProcessingResult> {
    try {
      // Use circuit breaker to handle service failures
      return await webCallCircuitBreaker.executeWithBreaker(
        'speechToText',
        async () => {
          // Get Deepgram service
          const deepgramService = await getDeepgramServiceWithRecovery();

          // Transcribe audio
          const transcription = await deepgramService.transcribeAudioWithRecovery(audioBuffer, {
            model: 'nova-2',
            language: 'en'
          });

          return {
            transcript: (transcription as any).transcript || '',
            isFinal: true,
            confidence: (transcription as any).confidence || 0,
            processingTime: Date.now() - (transcription as any).startTime,
            audioLength: audioBuffer.length
          };
        },
        this.options.circuitBreaker
      );
    } catch (error) {
      logger.error(`Error in audio processing for session ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Detect speech in audio buffer
   * @param audioBuffer Audio buffer to analyze
   * @returns True if speech is detected, false otherwise
   */
  private async detectSpeech(audioBuffer: Buffer): Promise<boolean> {
    // Simple energy-based VAD
    // In a real implementation, this would use a more sophisticated VAD algorithm

    // Convert buffer to 16-bit PCM samples
    const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 2);

    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += Math.abs(samples[i]);
    }

    const average = sum / samples.length;
    const normalizedEnergy = average / 32768; // Normalize to 0-1 range

    // Compare to threshold
    return normalizedEnergy > this.options.silenceThreshold;
  }

  /**
   * Get metrics for a session
   * @param sessionId The session ID
   * @returns Session metrics
   */
  public getMetrics(sessionId: string): any {
    if (!this.metrics.has(sessionId)) {
      return null;
    }

    const metrics = this.metrics.get(sessionId)!;

    return {
      ...metrics,
      averageProcessingTime: metrics.processedChunks > 0 ?
        metrics.totalProcessingTime / metrics.processedChunks : 0,
      averageChunkSize: metrics.processedChunks > 0 ?
        metrics.totalAudioLength / metrics.processedChunks : 0
    };
  }

  /**
   * Clean up resources for a session
   * @param sessionId The session ID
   */
  public cleanupSession(sessionId: string): void {
    // Clear timer
    if (this.processingTimers.has(sessionId)) {
      clearInterval(this.processingTimers.get(sessionId)!);
      this.processingTimers.delete(sessionId);
    }

    // Clear buffers
    this.audioBuffers.delete(sessionId);
    this.isProcessing.delete(sessionId);
    this.vadState.delete(sessionId);

    logger.info(`Audio pipeline cleaned up for session ${sessionId}`);
  }

  /**
   * Update processing options
   * @param options New options
   */
  public updateOptions(options: Partial<AudioProcessingOptions>): void {
    // Update options
    Object.assign(this.options, options);

    logger.info('Audio pipeline options updated:', options);
  }
}

// Create singleton instance
const webCallAudioPipeline = new WebCallAudioPipeline();

export default webCallAudioPipeline;