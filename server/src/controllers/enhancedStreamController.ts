/**
 * Enhanced Stream Controller with Resilience Features
 * 
 * This enhanced version of the stream controller integrates comprehensive
 * error handling, fallback mechanisms, and connection monitoring for live calls.
 */

import { Request, Response } from 'express';
import * as WebSocket from 'ws';
import { logger } from '../index';
import Call from '../models/Call';
import Configuration from '../models/Configuration';
import { conversationEngine } from '../services/index';
import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import { getSDKService } from '../services/elevenlabsSDKService';
import { getCallResilienceService } from '../services/callResilienceService';
import { getFallbackTTSService } from '../services/fallbackTTSService';
import EnhancedWebSocketManager from '../utils/enhancedWebSocketManager';
import { TwilioWebSocketManager } from '../utils/TwilioWebSocketManager';
import { SessionConfig, globalSessionManager } from '../utils/SessionManager';
import { v4 as uuidv4 } from 'uuid';
import responseCache from '../utils/responseCache';

export interface StreamError {
  code: string;
  message: string;
  context: string;
  timestamp: Date;
  recoverable: boolean;
}

export interface StreamMetrics {
  messagesReceived: number;
  messagesSent: number;
  errorsEncountered: number;
  fallbacksUsed: number;
  averageLatency: number;
  connectionUptime: number;
}

/**
 * Enhanced WebSocket handler for Twilio Media Streams with resilience features
 */
export const handleEnhancedVoiceStream = async (ws: WebSocket, req: Request): Promise<void> => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const callId = url.searchParams.get('callId');
  
  if (!callId) {
    logger.error('Missing callId parameter for voice stream');
    ws.close(1008, 'Missing callId parameter');
    return;
  }

  logger.info(`Enhanced voice stream starting for call ${callId}`);

  // Initialize resilience services
  const resilienceService = getCallResilienceService();
  const fallbackTTS = getFallbackTTSService();
  
  // Register call with resilience monitoring
  resilienceService.registerCall(callId);

  // Stream metrics
  const metrics: StreamMetrics = {
    messagesReceived: 0,
    messagesSent: 0,
    errorsEncountered: 0,
    fallbacksUsed: 0,
    averageLatency: 0,
    connectionUptime: 0
  };

  const startTime = Date.now();
  let conversationId: string | null = null;
  let streamSid: string | null = null;
  let audioBuffer: Buffer[] = [];
  let isCallActive = true;

  // Enhanced connection manager
  const connectionManager = new EnhancedWebSocketManager(
    callId,
    req.url || '',
    {
      maxReconnectAttempts: 3,
      reconnectDelay: 1000,
      heartbeatInterval: 5000,
      connectionTimeout: 30000,
      maxHeartbeatMisses: 3,
      pingInterval: 10000,
      pongTimeout: 3000
    }
  );

  // Connection manager event handlers
  connectionManager.on('connected', () => {
    logger.info(`Enhanced connection established for call ${callId}`);
  });

  connectionManager.on('disconnected', (code: number, reason: string) => {
    logger.warn(`Enhanced connection lost for call ${callId}: ${code} ${reason}`);
    handleConnectionLoss(code, reason);
  });

  connectionManager.on('error', (error: Error) => {
    handleStreamError('connection_error', error.message, 'websocket', true);
  });

  connectionManager.on('qualityChanged', (quality: string) => {
    logger.info(`Connection quality changed for call ${callId}: ${quality}`);
    
    if (quality === 'poor' || quality === 'failed') {
      activateFallbackMode('poor_connection');
    }
  });

  connectionManager.on('bufferOverflow', (size: number) => {
    logger.warn(`Buffer overflow detected for call ${callId}: ${size} bytes`);
    cleanupAudioBuffer();
  });

  try {
    // Load call data
    const call = await Call.findById(callId);
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }

    // Load configuration
    const config = await Configuration.findOne();
    if (!config) {
      throw new Error('Configuration not found');
    }

    // Initialize conversation
    const newConversationId = uuidv4();
    conversationId = newConversationId;
    
    const session = conversationEngine.createSession(
      newConversationId,
      callId,
      call.leadId.toString(),
      call.campaignId.toString()
    );

    if (!session) {
      throw new Error(`Failed to create conversation session for call ${callId}`);
    }

    // Initialize voice synthesis services
    let voiceAI: EnhancedVoiceAIService | null = null;
    let sdkService: any = null;

    const selectedTTSProvider = config.ttsConfig?.primaryProvider || 'elevenlabs';

    if (selectedTTSProvider === 'elevenlabs') {
      sdkService = getSDKService();
      if (!sdkService) {
        logger.warn(`ElevenLabs SDK not available for call ${callId}, activating fallback`);
        activateFallbackMode('tts_service_unavailable');
      }
    }

    // Generate and prepare opening message
    let pendingOpeningMessage: {
      message: string;
      voiceId: string;
      isFirstInteraction: boolean;
    } | null = null;

    if (session.conversationHistory.length === 0) {
      try {
        const openingMessagePromise = conversationEngine.generateOpeningMessage(
          conversationId,
          "Customer",
          call.campaignId.toString()
        );

        const voiceId = call.personalityId ||
          session.currentPersonality.voiceId ||
          config.elevenLabsConfig.availableVoices[0].voiceId;

        const openingMessage = await openingMessagePromise;

        pendingOpeningMessage = {
          message: openingMessage,
          voiceId: voiceId,
          isFirstInteraction: true
        };

        logger.info(`Opening message prepared for call ${callId}`);
      } catch (error) {
        handleStreamError('opening_message_generation', `Error generating opening message: ${error}`, 'conversation', true);
        
        // Use fallback greeting
        const fallbackGreeting = "Hello, how can I help you today?";
        const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;

        pendingOpeningMessage = {
          message: fallbackGreeting,
          voiceId: fallbackVoice,
          isFirstInteraction: true
        };
      }
    }

    // Twilio Manager for health reporting
    const twilioManager = TwilioWebSocketManager.getInstance();

    // WebSocket message handlers
    ws.on('message', async (data: WebSocket.Data) => {
      try {
        metrics.messagesReceived++;
        resilienceService.updateHeartbeat(callId);

        const message = JSON.parse(data.toString());

        if (message.event === 'start') {
          streamSid = message.start.streamSid;
          logger.info(`Stream started for call ${callId}, streamSid: ${streamSid}`);

          // Send opening message after streamSid is available
          if (pendingOpeningMessage && streamSid) {
            await sendOpeningMessage(pendingOpeningMessage, streamSid);
          }
        } else if (message.event === 'media') {
          await handleMediaMessage(message, streamSid);
        } else if (message.event === 'stop') {
          logger.info(`Stream stopped for call ${callId}`);
          isCallActive = false;
        }
      } catch (error) {
        handleStreamError('message_processing', `Error processing message: ${error}`, 'websocket', true);
      }
    });

    // WebSocket close handler
    ws.on('close', async (code: number, reason: string) => {
      handleConnectionLoss(code, reason);
    });

    // WebSocket error handler
    ws.on('error', (error: Error) => {
      handleStreamError('websocket_error', error.message, 'websocket', true);
    });

  } catch (error) {
    handleStreamError('initialization', `Stream initialization failed: ${error}`, 'setup', false);
    ws.close(1011, 'Internal server error');
  }

  /**
   * Handle media messages (audio data)
   */
  async function handleMediaMessage(message: any, currentStreamSid: string | null): Promise<void> {
    if (!currentStreamSid || !conversationId) {
      return;
    }

    try {
      const audioData = Buffer.from(message.media.payload, 'base64');
      audioBuffer.push(audioData);

      // Update buffer size in resilience service
      const totalBufferSize = audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      resilienceService.updateAudioBufferSize(callId, totalBufferSize);

      // Process accumulated audio when buffer reaches threshold
      const bufferThreshold = 8192; // 8KB threshold
      if (Buffer.concat(audioBuffer).length > bufferThreshold) {
        const completeAudio = Buffer.concat(audioBuffer);
        audioBuffer = []; // Clear buffer

        await processAudioWithFallback(completeAudio, currentStreamSid);
      }
    } catch (error) {
      handleStreamError('media_processing', `Error processing media: ${error}`, 'audio', true);
    }
  }

  /**
   * Process audio with fallback mechanisms
   */
  async function processAudioWithFallback(audioData: Buffer, currentStreamSid: string): Promise<void> {
    try {
      // Try to transcribe audio
      let transcribedText = '';

      const config = await Configuration.findOne();
      const speechAnalysisService = conversationEngine.getSpeechAnalysisService();

      if (config?.deepgramConfig?.isEnabled && speechAnalysisService) {
        try {
          const transcriptionResult = await speechAnalysisService.transcribeAudio(audioData);
          transcribedText = transcriptionResult.transcript || "";
          
          if (transcriptionResult.transcript) {
            logger.info(`Transcription for call ${callId}: "${transcriptionResult.transcript.substring(0, 100)}..."`);
          }
        } catch (transcriptionError) {
          handleStreamError('transcription', `Transcription failed: ${transcriptionError}`, 'stt', true);
          
          // Use fallback transcription method
          transcribedText = await getFallbackTranscription(audioData);
        }
      } else {
        transcribedText = await getFallbackTranscription(audioData);
      }

      if (!transcribedText.trim()) {
        return; // No speech detected
      }

      // Generate AI response with fallback
      const aiResponse = await generateAIResponseWithFallback(transcribedText, conversationId!);

      // Synthesize and send audio response
      await synthesizeAndSendResponse(aiResponse.text, currentStreamSid);

    } catch (error) {
      handleStreamError('audio_processing', `Audio processing failed: ${error}`, 'pipeline', true);
    }
  }

  /**
   * Get fallback transcription
   */
  async function getFallbackTranscription(audioData: Buffer): Promise<string> {
    // In a real implementation, this could:
    // 1. Use a local STT service
    // 2. Use a secondary cloud STT provider
    // 3. Return a default message indicating audio was received
    
    logger.warn(`Using fallback transcription for call ${callId}`);
    metrics.fallbacksUsed++;
    
    return "I heard something but couldn't transcribe it clearly. Could you please repeat?";
  }

  /**
   * Generate AI response with fallback
   */
  async function generateAIResponseWithFallback(userInput: string, sessionId: string): Promise<{ text: string }> {
    try {
      // Try primary LLM service
      const response = await conversationEngine.processConversationTurn(
        sessionId,
        userInput
      );
      
      return { text: response.response };
    } catch (error) {
      handleStreamError('llm_generation', `LLM response generation failed: ${error}`, 'llm', true);
      
      // Use fallback responses
      return generateFallbackResponse(userInput);
    }
  }

  /**
   * Generate fallback response
   */
  function generateFallbackResponse(userInput: string): { text: string } {
    const fallbackResponses = [
      "I apologize, but I'm experiencing some technical difficulties. Let me transfer you to a human agent.",
      "I'm sorry, I didn't catch that clearly. Could you please repeat your question?",
      "I'm having trouble processing your request right now. Would you like me to call you back in a few minutes?",
      "Due to technical issues, I'll need to escalate this to a human representative. Please hold on."
    ];
    
    // Simple keyword-based response selection
    const lowerInput = userInput.toLowerCase();
    
    if (lowerInput.includes('repeat') || lowerInput.includes('again')) {
      return { text: fallbackResponses[1] };
    } else if (lowerInput.includes('help') || lowerInput.includes('support')) {
      return { text: fallbackResponses[0] };
    } else if (lowerInput.includes('callback') || lowerInput.includes('call back')) {
      return { text: fallbackResponses[2] };
    } else {
      return { text: fallbackResponses[3] };
    }
  }

  /**
   * Synthesize and send audio response
   */
  async function synthesizeAndSendResponse(text: string, currentStreamSid: string): Promise<void> {
    try {
      // Try primary TTS service
      const config = await Configuration.findOne();
      const voiceId = call?.personalityId || config?.elevenLabsConfig?.availableVoices[0]?.voiceId;

      if (sdkService && voiceId) {
        try {
          const audioResponse = await sdkService.generateSpeech(text, voiceId, {
            optimizeLatency: true
          });

          if (audioResponse) {
            sendAudioToTwilio(audioResponse, currentStreamSid);
            return;
          }
        } catch (ttsError) {
          handleStreamError('tts_primary', `Primary TTS failed: ${ttsError}`, 'tts', true);
        }
      }

      // Use fallback TTS service
      const fallbackResponse = await fallbackTTS.synthesize({
        text,
        voiceId,
        language: 'en'
      }, callId);

      if (fallbackResponse.audioData) {
        sendAudioToTwilio(fallbackResponse.audioData, currentStreamSid);
        metrics.fallbacksUsed++;
      }

    } catch (error) {
      handleStreamError('tts_fallback', `All TTS methods failed: ${error}`, 'tts', false);
      
      // Send Twilio TTS as last resort
      sendTwilioTTSFallback(text, currentStreamSid);
    }
  }

  /**
   * Send opening message
   */
  async function sendOpeningMessage(openingData: any, currentStreamSid: string): Promise<void> {
    logger.info(`Sending opening message for call ${callId}: "${openingData.message}"`);
    await synthesizeAndSendResponse(openingData.message, currentStreamSid);
  }

  /**
   * Send audio to Twilio
   */
  function sendAudioToTwilio(audioData: Buffer, currentStreamSid: string): void {
    if (!currentStreamSid || !isCallActive) {
      return;
    }

    try {
      const mediaMessage = {
        event: 'media',
        streamSid: currentStreamSid,
        media: {
          payload: audioData.toString('base64')
        }
      };

      ws.send(JSON.stringify(mediaMessage));
      metrics.messagesSent++;
    } catch (error) {
      handleStreamError('audio_send', `Failed to send audio: ${error}`, 'twilio', true);
    }
  }

  /**
   * Send Twilio TTS as last resort
   */
  function sendTwilioTTSFallback(text: string, currentStreamSid: string): void {
    logger.warn(`Using Twilio TTS fallback for call ${callId}`);
    
    const ttsMessage = {
      event: 'media',
      streamSid: currentStreamSid,
      media: {
        track: 'outbound',
        chunk: '1',
        timestamp: Date.now().toString(),
        payload: text // Twilio will convert text to speech
      }
    };

    try {
      ws.send(JSON.stringify(ttsMessage));
      metrics.fallbacksUsed++;
    } catch (error) {
      logger.error(`Twilio TTS fallback failed for call ${callId}:`, error);
    }
  }

  /**
   * Handle stream errors
   */
  function handleStreamError(code: string, message: string, context: string, recoverable: boolean): void {
    const error: StreamError = {
      code,
      message,
      context,
      timestamp: new Date(),
      recoverable
    };

    logger.error(`Stream error for call ${callId}:`, error);
    
    metrics.errorsEncountered++;
    resilienceService.reportError(callId, new Error(message), context);

    if (!recoverable) {
      logger.error(`Non-recoverable error for call ${callId}, terminating stream`);
      ws.close(1011, 'Internal server error');
    }
  }

  /**
   * Handle connection loss
   */
  function handleConnectionLoss(code: number, reason: string): void {
    logger.warn(`Connection lost for call ${callId}: ${code} ${reason}`);
    
    // Update metrics
    metrics.connectionUptime = Date.now() - startTime;
    
    // Report to resilience service
    resilienceService.reportError(
      callId,
      new Error(`Connection lost: ${code} ${reason}`),
      'connection'
    );

    // Cleanup resources
    cleanupResources();
  }

  /**
   * Activate fallback mode
   */
  function activateFallbackMode(reason: string): void {
    logger.info(`Activating fallback mode for call ${callId}: ${reason}`);
    resilienceService.activateFallback(callId, reason);
  }

  /**
   * Cleanup audio buffer
   */
  function cleanupAudioBuffer(): void {
    const originalSize = audioBuffer.length;
    audioBuffer = audioBuffer.slice(-10); // Keep last 10 chunks
    
    logger.info(`Audio buffer cleaned for call ${callId}: ${originalSize} -> ${audioBuffer.length} chunks`);
  }

  /**
   * Cleanup resources
   */
  function cleanupResources(): void {
    // Clear audio buffer
    audioBuffer = [];
    
    // Unregister from resilience service
    resilienceService.unregisterCall(callId);
    
    // Update final metrics
    metrics.connectionUptime = Date.now() - startTime;
    
    logger.info(`Resources cleaned up for call ${callId}`, { metrics });
  }
};

// Initialize enhanced stream route
export const enhancedStreamRoute = (app: any): void => {
  app.ws('/voice/enhanced-stream', handleEnhancedVoiceStream);
  logger.info('Enhanced voice stream route registered');
};