import { EventEmitter } from 'events';
import { logger } from '../index';
import { getVoiceAIService } from '.';
import { realTimeCallStateMachine, CallEvent, CallState } from './realTimeCallStateMachine';
import { enhancedBargeInDetectionService } from './enhancedBargeInDetectionService';

/**
 * Optimized real-time audio pipeline for low-latency AI voice agent workflow
 * Handles Twilio Media Streams, streaming STT/TTS, and coordinated state management
 */

export interface AudioPipelineConfig {
  // Audio processing
  sampleRate: number;           // Target sample rate (8000 for phone quality)
  channels: number;             // Number of audio channels (1 for mono)
  bitDepth: number;             // Bit depth (16 for phone quality)
  frameSize: number;            // Audio frame size in milliseconds
  bufferSize: number;           // Buffer size for processing
  
  // Latency optimization
  enableChunkedProcessing: boolean;  // Process audio in chunks
  maxProcessingLatency: number;      // Max allowed processing latency (ms)
  enableParallelProcessing: boolean; // Enable parallel STT/TTS processing
  
  // Provider settings
  primarySTTProvider: 'deepgram' | 'openai';
  primaryTTSProvider: 'elevenlabs' | 'deepgram';
  enableProviderFallback: boolean;
  fallbackTimeout: number;      // Timeout before falling back (ms)
  
  // Streaming settings
  enableStreamingSTT: boolean;
  enableStreamingTTS: boolean;
  streamingChunkSize: number;   // Size of streaming chunks (bytes)
  
  // Quality settings
  enableNoiseReduction: boolean;
  enableEchoCancellation: boolean;
  enableVAD: boolean;           // Voice Activity Detection
}

export interface AudioChunk {
  callId: string;
  timestamp: Date;
  data: Buffer;
  sequenceNumber: number;
  isComplete: boolean;
  metadata?: Record<string, any>;
}

export interface ProcessingResult {
  success: boolean;
  latency: number;
  provider: string;
  result: any;
  error?: string;
  fallbackUsed?: boolean;
}

export interface StreamingSession {
  callId: string;
  conversationId: string;
  streamSid?: string;
  
  // Audio state
  audioBuffer: Buffer[];
  sequenceNumber: number;
  lastAudioTime: Date;
  
  // Processing state
  isProcessingSTT: boolean;
  isProcessingTTS: boolean;
  pendingTTSCancel: boolean;
  
  // Performance metrics
  totalLatency: number[];
  sttLatency: number[];
  ttsLatency: number[];
  processingStartTime?: Date;
  
  // Provider state
  primaryProviderFailed: boolean;
  fallbackProviderActive: boolean;
  consecutiveFailures: number;
  
  // Configuration
  config: AudioPipelineConfig;
}

export class OptimizedRealTimeAudioPipeline extends EventEmitter {
  private sessions: Map<string, StreamingSession> = new Map();
  private processingQueue: Map<string, AudioChunk[]> = new Map();
  private activeStreams: Map<string, any> = new Map(); // WebSocket connections
  
  private readonly DEFAULT_CONFIG: AudioPipelineConfig = {
    sampleRate: 8000,            // 8kHz for phone quality
    channels: 1,                 // Mono
    bitDepth: 16,                // 16-bit
    frameSize: 20,               // 20ms frames
    bufferSize: 1600,            // 20ms at 8kHz, 16-bit = 320 bytes per frame, 5 frames = 1600
    enableChunkedProcessing: true,
    maxProcessingLatency: 500,   // 500ms max
    enableParallelProcessing: true,
    primarySTTProvider: 'deepgram',
    primaryTTSProvider: 'elevenlabs',
    enableProviderFallback: true,
    fallbackTimeout: 2000,      // 2 seconds
    enableStreamingSTT: true,
    enableStreamingTTS: true,
    streamingChunkSize: 4096,    // 4KB chunks
    enableNoiseReduction: false, // Disabled for latency
    enableEchoCancellation: false, // Disabled for latency
    enableVAD: true
  };

  constructor() {
    super();
    this.setupEventHandlers();
  }

  /**
   * Initialize audio pipeline for a call
   */
  public async initializeCall(
    callId: string,
    conversationId: string,
    config: Partial<AudioPipelineConfig> = {}
  ): Promise<StreamingSession> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    
    const session: StreamingSession = {
      callId,
      conversationId,
      audioBuffer: [],
      sequenceNumber: 0,
      lastAudioTime: new Date(),
      isProcessingSTT: false,
      isProcessingTTS: false,
      pendingTTSCancel: false,
      totalLatency: [],
      sttLatency: [],
      ttsLatency: [],
      primaryProviderFailed: false,
      fallbackProviderActive: false,
      consecutiveFailures: 0,
      config: finalConfig
    };

    this.sessions.set(callId, session);
    this.processingQueue.set(callId, []);

    // Initialize barge-in detection
    enhancedBargeInDetectionService.initializeCall(callId, {
      sampleRate: finalConfig.sampleRate,
      frameSize: Math.floor(finalConfig.sampleRate * finalConfig.frameSize / 1000),
      bargeInEnabled: true,
      sensitivity: 'medium'
    });

    logger.info(`Optimized audio pipeline initialized for call ${callId}`, {
      conversationId,
      config: finalConfig
    });

    this.emit('sessionInitialized', session);
    return session;
  }

  /**
   * Process incoming audio from Twilio Media Stream
   */
  public async processIncomingAudio(
    callId: string,
    audioPayload: string,
    timestamp: string,
    streamSid?: string
  ): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session) {
      logger.warn(`No session found for call ${callId}`);
      return;
    }

    // Update stream SID if provided
    if (streamSid && !session.streamSid) {
      session.streamSid = streamSid;
    }

    try {
      // Decode base64 audio payload
      const audioBuffer = Buffer.from(audioPayload, 'base64');
      session.lastAudioTime = new Date();
      session.sequenceNumber++;

      // Create audio chunk
      const chunk: AudioChunk = {
        callId,
        timestamp: new Date(parseInt(timestamp)),
        data: audioBuffer,
        sequenceNumber: session.sequenceNumber,
        isComplete: false
      };

      // Add to processing queue
      const queue = this.processingQueue.get(callId) || [];
      queue.push(chunk);
      this.processingQueue.set(callId, queue);

      // Process barge-in detection
      enhancedBargeInDetectionService.processAudioChunk(
        callId,
        audioBuffer,
        chunk.timestamp
      );

      // Process audio chunks if we have enough data
      if (this.shouldProcessChunks(session, queue)) {
        await this.processAudioChunks(callId);
      }

    } catch (error) {
      logger.error(`Error processing incoming audio for call ${callId}:`, error);
      this.handleProcessingError(callId, 'audio_processing', error);
    }
  }

  /**
   * Send audio to Twilio Media Stream
   */
  public async sendAudioToCall(
    callId: string,
    audioData: Buffer,
    metadata: Record<string, any> = {}
  ): Promise<boolean> {
    const session = this.sessions.get(callId);
    const stream = this.activeStreams.get(callId);
    
    if (!session || !stream) {
      logger.warn(`Cannot send audio: no session or stream for call ${callId}`);
      return false;
    }

    try {
      // Convert audio to phone-safe format (8kHz, 16-bit, mono)
      const processedAudio = await this.processAudioForTwilio(audioData, session.config);
      
      // Send to Twilio in required format
      const message = {
        event: 'media',
        streamSid: session.streamSid,
        media: {
          track: 'outbound',
          chunk: (++session.sequenceNumber).toString(),
          timestamp: Date.now().toString(),
          payload: processedAudio.toString('base64')
        }
      };

      if (stream.readyState === 1) { // WebSocket.OPEN
        stream.send(JSON.stringify(message));
        
        // Notify state machine that agent is speaking
        realTimeCallStateMachine.setAgentSpeaking(callId, true);
        enhancedBargeInDetectionService.setAgentSpeaking(callId, true);
        
        logger.debug(`Audio sent to call ${callId}`, {
          audioSize: processedAudio.length,
          metadata
        });
        
        return true;
      } else {
        logger.warn(`WebSocket not open for call ${callId}, state: ${stream.readyState}`);
        return false;
      }

    } catch (error) {
      logger.error(`Error sending audio to call ${callId}:`, error);
      return false;
    }
  }

  /**
   * Process audio chunks and perform STT
   */
  private async processAudioChunks(callId: string): Promise<void> {
    const session = this.sessions.get(callId);
    const queue = this.processingQueue.get(callId);
    
    if (!session || !queue || queue.length === 0) return;

    // Prevent concurrent processing
    if (session.isProcessingSTT) {
      logger.debug(`STT processing already in progress for call ${callId}`);
      return;
    }

    session.isProcessingSTT = true;
    session.processingStartTime = new Date();

    try {
      // Combine audio chunks
      const combinedAudio = Buffer.concat(queue.map(chunk => chunk.data));
      
      // Clear queue after combining
      this.processingQueue.set(callId, []);

      // Skip processing if audio is too short
      if (combinedAudio.length < 320) { // Less than 20ms at 8kHz
        session.isProcessingSTT = false;
        return;
      }

      logger.debug(`Processing ${combinedAudio.length} bytes of audio for call ${callId}`);

      // Perform STT with provider fallback
      const transcriptionResult = await this.performSTTWithFallback(
        callId,
        combinedAudio,
        session.config
      );

      if (transcriptionResult.success && transcriptionResult.result?.transcript) {
        const transcript = transcriptionResult.result.transcript.trim();
        
        if (transcript.length > 0) {
          logger.info(`STT result for call ${callId}: "${transcript}"`);
          
          // Record latency
          const latency = transcriptionResult.latency;
          session.sttLatency.push(latency);
          
          // Notify state machine
          realTimeCallStateMachine.handleEvent(callId, CallEvent.TRANSCRIPTION_RECEIVED, {
            transcript,
            confidence: transcriptionResult.result.confidence || 0,
            provider: transcriptionResult.provider,
            latency
          });

          // Process with conversation engine and generate response
          await this.processTranscriptionAndRespond(callId, transcript, latency);
        }
      } else if (!transcriptionResult.success) {
        logger.warn(`STT failed for call ${callId}:`, transcriptionResult.error);
        this.handleProcessingError(callId, 'stt', transcriptionResult.error);
      }

    } catch (error) {
      logger.error(`Error processing audio chunks for call ${callId}:`, error);
      this.handleProcessingError(callId, 'audio_chunks', error);
    } finally {
      session.isProcessingSTT = false;
    }
  }

  /**
   * Process transcription and generate AI response
   */
  private async processTranscriptionAndRespond(
    callId: string,
    transcript: string,
    sttLatency: number
  ): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session) return;

    try {
      // Notify state machine of processing start
      realTimeCallStateMachine.handleEvent(callId, CallEvent.SPEECH_DETECTED, {
        transcript,
        sttLatency
      });

      const processStart = new Date();

      // Get conversation engine and generate response
      const { conversationEngine } = await import('./index');
      const aiResponse = await conversationEngine.processUserInput(
        session.conversationId,
        transcript
      );

      const processingLatency = new Date().getTime() - processStart.getTime();

      if (aiResponse && aiResponse.text?.trim()) {
        logger.info(`AI response for call ${callId}: "${aiResponse.text.substring(0, 100)}..."`);

        // Notify state machine
        realTimeCallStateMachine.handleEvent(callId, CallEvent.AI_RESPONSE_GENERATED, {
          responseText: aiResponse.text,
          responseTime: processingLatency
        });

        // Generate and send TTS response
        await this.generateAndSendTTSResponse(callId, aiResponse.text, sttLatency + processingLatency);
      }

    } catch (error) {
      logger.error(`Error processing transcription for call ${callId}:`, error);
      this.handleProcessingError(callId, 'conversation', error);
    }
  }

  /**
   * Generate TTS response and send to call
   */
  private async generateAndSendTTSResponse(
    callId: string,
    responseText: string,
    previousLatency: number
  ): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session || session.pendingTTSCancel) return;

    session.isProcessingTTS = true;
    const ttsStart = new Date();

    try {
      // Perform TTS with provider fallback
      const ttsResult = await this.performTTSWithFallback(
        callId,
        responseText,
        session.config
      );

      if (session.pendingTTSCancel) {
        logger.info(`TTS cancelled for call ${callId} due to barge-in`);
        session.pendingTTSCancel = false;
        session.isProcessingTTS = false;
        return;
      }

      if (ttsResult.success && ttsResult.result?.audioContent) {
        const ttsLatency = ttsResult.latency;
        const totalLatency = previousLatency + ttsLatency;
        
        session.ttsLatency.push(ttsLatency);
        session.totalLatency.push(totalLatency);

        logger.info(`TTS generated for call ${callId}`, {
          provider: ttsResult.provider,
          ttsLatency,
          totalLatency,
          responseLength: responseText.length,
          audioSize: ttsResult.result.audioContent.length
        });

        // Send audio to call
        const audioSent = await this.sendAudioToCall(callId, ttsResult.result.audioContent, {
          responseText,
          totalLatency,
          provider: ttsResult.provider
        });

        if (audioSent) {
          // Schedule agent speaking end after estimated audio duration
          const audioDuration = this.estimateAudioDuration(
            ttsResult.result.audioContent,
            session.config
          );
          
          setTimeout(() => {
            realTimeCallStateMachine.setAgentSpeaking(callId, false);
            enhancedBargeInDetectionService.setAgentSpeaking(callId, false);
          }, audioDuration);
        }

      } else {
        logger.error(`TTS failed for call ${callId}:`, ttsResult.error);
        this.handleProcessingError(callId, 'tts', ttsResult.error);
      }

    } catch (error) {
      logger.error(`Error generating TTS for call ${callId}:`, error);
      this.handleProcessingError(callId, 'tts_generation', error);
    } finally {
      session.isProcessingTTS = false;
    }
  }

  /**
   * Perform STT with provider fallback
   */
  private async performSTTWithFallback(
    callId: string,
    audioData: Buffer,
    config: AudioPipelineConfig
  ): Promise<ProcessingResult> {
    const session = this.sessions.get(callId);
    if (!session) {
      return { success: false, latency: 0, provider: 'none', result: null, error: 'No session' };
    }

    const startTime = new Date();
    let provider = config.primarySTTProvider;
    let fallbackUsed = false;

    try {
      // Try primary provider first
      if (!session.primaryProviderFailed) {
        const result = await this.performSTT(audioData, provider);
        const latency = new Date().getTime() - startTime.getTime();
        
        if (result) {
          session.consecutiveFailures = 0;
          return { success: true, latency, provider, result };
        }
      }

      // Fallback to secondary provider if enabled
      if (config.enableProviderFallback) {
        provider = config.primarySTTProvider === 'deepgram' ? 'openai' : 'deepgram';
        fallbackUsed = true;
        
        logger.info(`Falling back to ${provider} STT for call ${callId}`);
        
        const result = await this.performSTT(audioData, provider);
        const latency = new Date().getTime() - startTime.getTime();
        
        if (result) {
          session.fallbackProviderActive = true;
          return { success: true, latency, provider, result, fallbackUsed };
        }
      }

      // Both providers failed
      session.consecutiveFailures++;
      if (session.consecutiveFailures >= 3) {
        session.primaryProviderFailed = true;
      }

      return {
        success: false,
        latency: new Date().getTime() - startTime.getTime(),
        provider,
        result: null,
        error: 'All STT providers failed'
      };

    } catch (error) {
      return {
        success: false,
        latency: new Date().getTime() - startTime.getTime(),
        provider,
        result: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Perform STT using specified provider
   */
  private async performSTT(audioData: Buffer, provider: string): Promise<any> {
    try {
      if (provider === 'deepgram') {
        const { conversationEngine } = await import('./index');
        const speechAnalysisService = conversationEngine.getSpeechAnalysisService();
        
        if (speechAnalysisService) {
          return await speechAnalysisService.transcribeAudio(audioData);
        }
      } else if (provider === 'openai') {
        // Implementation for OpenAI Whisper if needed
        // For now, fallback to Deepgram
        const { conversationEngine } = await import('./index');
        const speechAnalysisService = conversationEngine.getSpeechAnalysisService();
        
        if (speechAnalysisService) {
          return await speechAnalysisService.transcribeAudio(audioData);
        }
      }

      return null;
    } catch (error) {
      logger.error(`STT provider ${provider} failed:`, error);
      return null;
    }
  }

  /**
   * Perform TTS with provider fallback
   */
  private async performTTSWithFallback(
    callId: string,
    text: string,
    config: AudioPipelineConfig
  ): Promise<ProcessingResult> {
    const session = this.sessions.get(callId);
    if (!session) {
      return { success: false, latency: 0, provider: 'none', result: null, error: 'No session' };
    }

    const startTime = new Date();
    let provider = config.primaryTTSProvider;
    let fallbackUsed = false;

    try {
      // Get voice configuration
      const voiceConfig = await this.getVoiceConfiguration(callId);
      
      // Try primary provider first
      if (!session.primaryProviderFailed) {
        const result = await this.performTTS(text, provider, voiceConfig);
        const latency = new Date().getTime() - startTime.getTime();
        
        if (result) {
          session.consecutiveFailures = 0;
          return { success: true, latency, provider, result };
        }
      }

      // Fallback to secondary provider if enabled
      if (config.enableProviderFallback) {
        provider = config.primaryTTSProvider === 'elevenlabs' ? 'deepgram' : 'elevenlabs';
        fallbackUsed = true;
        
        logger.info(`Falling back to ${provider} TTS for call ${callId}`);
        
        const result = await this.performTTS(text, provider, voiceConfig);
        const latency = new Date().getTime() - startTime.getTime();
        
        if (result) {
          session.fallbackProviderActive = true;
          return { success: true, latency, provider, result, fallbackUsed };
        }
      }

      return {
        success: false,
        latency: new Date().getTime() - startTime.getTime(),
        provider,
        result: null,
        error: 'All TTS providers failed'
      };

    } catch (error) {
      return {
        success: false,
        latency: new Date().getTime() - startTime.getTime(),
        provider,
        result: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Perform TTS using specified provider
   */
  private async performTTS(text: string, provider: string, voiceConfig: any): Promise<any> {
    try {
      const Configuration = require('../models/Configuration').default;
      const config = await Configuration.findOne();
      
      if (!config) return null;

      if (provider === 'elevenlabs' && config.elevenLabsConfig?.isEnabled) {
        const voiceAI = getVoiceAIService();
        
        return await voiceAI.synthesizeAdaptiveVoice({
          text,
          personalityId: voiceConfig.voiceId,
          language: voiceConfig.language || 'en'
        });
        
      } else if (provider === 'deepgram' && config.ttsConfig?.deepgramTTS?.isEnabled) {
        const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
        
        return await synthesizeSpeechWithProvider(
          config,
          text,
          voiceConfig.voiceId,
          voiceConfig.language || 'en',
          { encoding: 'linear16', sampleRate: 8000 }
        );
      }

      return null;
    } catch (error) {
      logger.error(`TTS provider ${provider} failed:`, error);
      return null;
    }
  }

  /**
   * Get voice configuration for a call
   */
  private async getVoiceConfiguration(callId: string): Promise<any> {
    try {
      const Call = require('../models/Call').default;
      const Campaign = require('../models/Campaign').default;
      
      const call = await Call.findById(callId);
      const campaign = call ? await Campaign.findById(call.campaignId) : null;
      
      return {
        voiceId: call?.personalityId || 
                campaign?.voiceConfiguration?.voiceId || 
                'default',
        language: campaign?.primaryLanguage === 'hi' ? 'hi' : 'en'
      };
    } catch (error) {
      logger.error(`Error getting voice config for call ${callId}:`, error);
      return { voiceId: 'default', language: 'en' };
    }
  }

  /**
   * Check if we should process audio chunks
   */
  private shouldProcessChunks(session: StreamingSession, queue: AudioChunk[]): boolean {
    if (queue.length === 0) return false;
    
    // Process if we have enough data or if it's been too long
    const totalBytes = queue.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const oldestChunk = queue[0];
    const timeSinceOldest = new Date().getTime() - oldestChunk.timestamp.getTime();
    
    return totalBytes >= session.config.bufferSize || 
           timeSinceOldest > session.config.maxProcessingLatency;
  }

  /**
   * Process audio for Twilio (ensure correct format)
   */
  private async processAudioForTwilio(
    audioData: Buffer,
    config: AudioPipelineConfig
  ): Promise<Buffer> {
    // For now, assume audio is already in correct format
    // In production, you might need to resample/convert
    return audioData;
  }

  /**
   * Estimate audio duration in milliseconds
   */
  private estimateAudioDuration(audioData: Buffer, config: AudioPipelineConfig): number {
    // Calculate based on sample rate and bit depth
    const bytesPerSample = config.bitDepth / 8;
    const bytesPerSecond = config.sampleRate * bytesPerSample * config.channels;
    return Math.floor((audioData.length / bytesPerSecond) * 1000);
  }

  /**
   * Handle processing errors
   */
  private handleProcessingError(callId: string, errorType: string, error: any): void {
    logger.error(`Processing error for call ${callId} (${errorType}):`, error);
    
    realTimeCallStateMachine.handleEvent(callId, CallEvent.ERROR_OCCURRED, {
      errorType,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  /**
   * Cancel TTS for barge-in
   */
  public cancelTTS(callId: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      session.pendingTTSCancel = true;
      logger.info(`TTS cancellation requested for call ${callId}`);
    }
  }

  /**
   * Set WebSocket stream for a call
   */
  public setWebSocketStream(callId: string, stream: any): void {
    this.activeStreams.set(callId, stream);
    logger.debug(`WebSocket stream set for call ${callId}`);
  }

  /**
   * Clean up call resources
   */
  public cleanupCall(callId: string): void {
    this.sessions.delete(callId);
    this.processingQueue.delete(callId);
    this.activeStreams.delete(callId);
    
    enhancedBargeInDetectionService.cleanupCall(callId);
    
    logger.info(`Audio pipeline cleaned up for call ${callId}`);
  }

  /**
   * Get session metrics
   */
  public getSessionMetrics(callId: string): Record<string, any> | null {
    const session = this.sessions.get(callId);
    if (!session) return null;

    const avgSTTLatency = session.sttLatency.reduce((a, b) => a + b, 0) / 
      Math.max(session.sttLatency.length, 1);
    const avgTTSLatency = session.ttsLatency.reduce((a, b) => a + b, 0) / 
      Math.max(session.ttsLatency.length, 1);
    const avgTotalLatency = session.totalLatency.reduce((a, b) => a + b, 0) / 
      Math.max(session.totalLatency.length, 1);

    return {
      callId,
      conversationId: session.conversationId,
      isProcessingSTT: session.isProcessingSTT,
      isProcessingTTS: session.isProcessingTTS,
      averageSTTLatency: avgSTTLatency,
      averageTTSLatency: avgTTSLatency,
      averageTotalLatency: avgTotalLatency,
      totalProcessedChunks: session.sttLatency.length,
      consecutiveFailures: session.consecutiveFailures,
      fallbackProviderActive: session.fallbackProviderActive,
      config: session.config
    };
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    // Listen for barge-in events
    enhancedBargeInDetectionService.on('bargeInDetected', (event) => {
      this.cancelTTS(event.callId);
    });

    // Listen for state machine events
    realTimeCallStateMachine.on('cancelTTS', (data) => {
      this.cancelTTS(data.callId);
    });

    realTimeCallStateMachine.on('cleanupCall', (data) => {
      this.cleanupCall(data.callId);
    });
  }
}

// Export singleton instance
export const optimizedRealTimeAudioPipeline = new OptimizedRealTimeAudioPipeline();