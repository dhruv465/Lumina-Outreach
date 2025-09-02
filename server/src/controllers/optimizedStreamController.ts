import { Request, Response } from 'express';
import * as WebSocket from 'ws';
import { logger } from '../index';
import Call from '../models/Call';
import Configuration from '../models/Configuration';
import { conversationEngine } from '../services/index';
import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import { getSDKService } from '../services/elevenlabsSDKService';
import { handleVoiceStream } from './streamController';
import responseCache from '../utils/responseCache';
import { TwilioWebSocketManager } from '../utils/TwilioWebSocketManager';
import { SessionConfig, globalSessionManager } from '../utils/SessionManager';
import { getCallResilienceService } from '../services/callResilienceService';
import { getCallMonitoringService } from '../services/callMonitoringService';
import { getFallbackTTSService } from '../services/fallbackTTSService';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
// Common greeting phrases for pre-caching
const COMMON_GREETINGS = [
  "Hello, how are you today?",
  "Hi there! How can I help you?",
  "Good morning! How may I assist you?",
  "Thanks for calling. How can I help you today?",
  "Welcome! What can I do for you?"
];

// Common acknowledgment phrases for pre-caching
const COMMON_ACKNOWLEDGMENTS = [
  "I understand.",
  "Got it.",
  "I see.",
  "Thanks for sharing that.",
  "I'm listening.",
  "Please go on.",
  "That makes sense."
];

/**
 * Estimate text-to-speech duration in milliseconds
 */
function estimateTextDuration(text: string): number {
  // Rough estimation: average speaking rate is about 150-180 words per minute
  const wordsPerMinute = 160;
  const words = text.split(/\s+/).length;
  const durationMinutes = words / wordsPerMinute;
  const durationMs = durationMinutes * 60 * 1000;
  
  // Add buffer time for audio processing and network latency
  return Math.max(durationMs + 2000, 3000); // Minimum 3 seconds
}

/**
 * Initialize and pre-cache common responses
 * This function pre-generates audio for common phrases to eliminate first-response latency
 */
export const initializeResponseCache = async (): Promise<void> => {
  try {
    // Get configuration
    const config = await Configuration.findOne();
    if (!config || !config.elevenLabsConfig.isEnabled) {
      logger.warn('ElevenLabs not configured, skipping response cache initialization');
      return;
    }

    // Get default voice ID
    const defaultVoiceId = config.elevenLabsConfig.availableVoices[0]?.voiceId;
    if (!defaultVoiceId) {
      logger.warn('No default voice available for pre-caching');
      return;
    }

    // Get ElevenLabs SDK service
    const sdkService = getSDKService();
    if (!sdkService) {
      logger.warn('ElevenLabs SDK service not initialized, skipping pre-caching');
      return;
    }

    logger.info('Initializing response cache for common phrases');

    // Pre-cache greetings
    const greetingPromises = COMMON_GREETINGS.map(async (greeting) => {
      try {
        const buffer = await sdkService.generateSpeech(greeting, defaultVoiceId, {
          optimizeLatency: true // Use optimized settings for faster generation
        });

        const cacheKey = `${defaultVoiceId}_${greeting}`;
        responseCache.set(cacheKey, buffer);
        logger.debug(`Pre-cached greeting: "${greeting}"`);
      } catch (error) {
        logger.error(`Failed to pre-cache greeting: ${greeting}`, error);
      }
    });

    // Pre-cache acknowledgments
    const ackPromises = COMMON_ACKNOWLEDGMENTS.map(async (ack) => {
      try {
        const buffer = await sdkService.generateSpeech(ack, defaultVoiceId, {
          optimizeLatency: true // Use optimized settings for faster generation
        });

        const cacheKey = `${defaultVoiceId}_${ack}`;
        responseCache.set(cacheKey, buffer);
        logger.debug(`Pre-cached acknowledgment: "${ack}"`);
      } catch (error) {
        logger.error(`Failed to pre-cache acknowledgment: ${ack}`, error);
      }
    });

    // Wait for all pre-caching to complete
    await Promise.all([...greetingPromises, ...ackPromises]);

    logger.info(`Response cache initialized with ${responseCache.size()} common phrases`);
  } catch (error) {
    logger.error('Failed to initialize response cache', error);
  }
};

/**
 * Optimized WebSocket handler for voice streaming
 * Uses parallel processing and streaming to reduce latency
 */
export const handleOptimizedVoiceStream = async (ws: WebSocket, req: Request): Promise<void> => {
  // Log the connection attempt with detailed information
  logger.info(`WebSocket connection attempt received`, {
    url: req.url,
    headers: {
      host: req.headers.host,
      origin: req.headers.origin,
      upgrade: req.headers.upgrade,
      connection: req.headers.connection,
      protocol: req.headers['sec-websocket-protocol']
    },
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Validate this is a proper WebSocket connection
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
    logger.error('Invalid connection attempt: not a WebSocket upgrade request');
    ws.close(1003, 'Not a WebSocket connection');
    return;
  }

  // Configure WebSocket for Twilio compatibility
  ws.setMaxListeners(20); // Prevent memory leaks with many listeners

  // Store Twilio stream information
  let streamSid: string | null = null;
  let twilioManager: TwilioWebSocketManager;

  // Extract query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Try to get callId and conversationId from different sources
  // 1. Check URL parameters (from route path)
  let callId = req.params?.callId;
  let conversationId = req.params?.conversationId;

  // 2. If not found in params, check query parameters
  if (!callId || !conversationId) {
    callId = url.searchParams.get('callId');
    conversationId = url.searchParams.get('conversationId');
  }

  // 3. Try to extract from URL path as a last resort
  if (!callId || !conversationId) {
    const pathParts = url.pathname.split('/');
    if (pathParts.length >= 4) {
      // Format: /voice/optimized-stream/[callId]/[conversationId]
      const potentialCallId = pathParts[3];
      const potentialConvId = pathParts[4];

      if (potentialCallId) {
        callId = potentialCallId;
      }

      if (potentialConvId) {
        conversationId = potentialConvId;
      }
    }
  }

  logger.info(`WebSocket connection parameters: callId=${callId}, conversationId=${conversationId}, URL=${req.url}`);

  if (!callId || !conversationId) {
    logger.error('Missing callId or conversationId in voice stream', {
      url: req.url,
      params: req.params,
      query: url.searchParams.toString(),
      headers: req.headers
    });
    ws.close(1008, 'Missing required parameters');
    return;
  }

  let call;
  let session;
  let voiceAI;
  let config;
  let sdkService;

  try {
    logger.info(`Optimized voice stream started for call ${callId}, conversation ${conversationId}`);
    logger.debug(`WebSocket connection details: URL=${req.url}, Headers=${JSON.stringify(req.headers)}`);

    // Create session configuration
    const sessionConfig: SessionConfig = {
      sessionId: `session-${callId}-${conversationId}-${Date.now()}`,
      callId,
      conversationId,
      userId: undefined, // Could be extracted from request if available
      campaignId: undefined, // Could be extracted from request if available
      sessionType: 'voice_call',
      priority: 'high',
      maxDuration: 1800000, // 30 minutes max
      idleTimeout: 300000,  // 5 minutes idle timeout
      healthCheckInterval: 10000 // 10 seconds health check for faster issue detection
    };

    // Create session with integrated WebSocket management
    const sessionInstance = globalSessionManager.createSession(ws, sessionConfig);
    twilioManager = sessionInstance.getTwilioManager();

    // Initialize resilience services
    const resilienceService = getCallResilienceService();
    const monitoringService = getCallMonitoringService();
    const fallbackTTS = getFallbackTTSService();
    
    // Register call for resilience monitoring
    resilienceService.registerCall(callId);
    monitoringService.registerCall(callId);
    
    logger.info(`Resilience services initialized for call ${callId}`);

    /**
     * Enhanced function to send audio data to Twilio with proper chunking and validation
     */
    const sendAudioToTwilio = (audioData: Buffer) => {
      if (!streamSid) {
        logger.warn('Cannot send audio: streamSid not available yet', {
          callId,
          conversationId
        });
        return false;
      }

      // Register audio processing as intensive operation if large
      let operationId: string | undefined;
      if (audioData.length > 32 * 1024) { // Large audio chunks (> 32KB)
        operationId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        twilioManager.registerIntensiveOperation({
          id: operationId,
          type: 'audio_processing',
          priority: 'high',
          estimatedDuration: Math.min(audioData.length / 1000, 5000), // Estimate based on size
          startTime: new Date(),
          pauseHeartbeat: false // Don't pause for audio, just track
        });
      }

      // Use the enhanced Twilio manager to send audio with proper chunking
      const success = twilioManager.sendAudioToTwilio(audioData, streamSid);

      if (success) {
        // Record successful operation for health assessment
        twilioManager.recordSuccess();
      } else {
        logger.error('Failed to send audio to Twilio via enhanced manager', {
          callId,
          conversationId,
          streamSid,
          audioSize: audioData.length,
          connectionHealth: twilioManager.getConnectionHealth(),
          reconnectionDecision: twilioManager.getReconnectionDecision()
        });
      }

      // Complete intensive operation if registered
      if (operationId) {
        twilioManager.completeIntensiveOperation(operationId);
      }

      return success;
    };

    // Initialize the enhanced WebSocket manager without sending any messages to Twilio
    // Do NOT send "connected" events to Twilio as this violates the protocol
    try {
      logger.info(`Enhanced Twilio WebSocket manager initialized for call ${callId}`);
    } catch (initError) {
      logger.error(`Failed to initialize WebSocket manager for call ${callId}:`, initError);
    }

    // Set up session event handlers with resilience service integration
    sessionInstance.on('sessionIdle', (data) => {
      logger.warn(`Session idle timeout for call ${callId}`, {
        sessionId: data.sessionId,
        callId,
        conversationId
      });
      
      // Report to monitoring service
      monitoringService.reportIssue(callId, {
        type: 'warning',
        category: 'connection',
        message: 'Session idle timeout detected',
        impact: 'medium',
        suggestion: 'Check if user is still active or consider ending call'
      });
    });

    sessionInstance.on('healthDegraded', (data) => {
      logger.warn(`Session health degraded for call ${callId}`, {
        sessionId: data.sessionId,
        callId,
        conversationId
      });
      
      // Report to resilience and monitoring services
      resilienceService.reportError(callId, new Error('Session health degraded'), 'connection');
      monitoringService.reportIssue(callId, {
        type: 'warning',
        category: 'connection',
        message: 'Session health degraded',
        impact: 'medium',
        suggestion: 'Monitor connection quality and consider reconnection'
      });
    });

    sessionInstance.on('healthRecovered', (data) => {
      logger.info(`Session health recovered for call ${callId}`, {
        sessionId: data.sessionId,
        callId,
        conversationId
      });
      
      // Update monitoring service - health recovered
      monitoringService.updateCallMetrics(callId, {
        connectionStability: 1.0
      });
    });

    sessionInstance.on('criticalHealth', (data) => {
      logger.error(`Critical session health detected for call ${callId}`, {
        sessionId: data.sessionId,
        callId,
        conversationId,
        healthReport: data.healthReport
      });
      
      // Report critical issue
      resilienceService.reportError(callId, new Error('Critical session health'), 'connection');
      monitoringService.reportIssue(callId, {
        type: 'error',
        category: 'connection',
        message: 'Critical session health detected',
        impact: 'critical',
        suggestion: 'Immediate reconnection or call termination required'
      });
    });

    // Start the session
    sessionInstance.start();

    // Set up session-aware health monitoring
    const healthMonitoringInterval = setInterval(() => {
      const sessionMetrics = sessionInstance.getMetrics();
      const sessionHealthReport = sessionInstance.getHealthReport();
      const healthScore = twilioManager.getHealthScore();
      const reconnectionDecision = twilioManager.getReconnectionDecision();
      const realTimeReport = twilioManager.getRealTimeHealthReport();
      const heartbeatMetrics = twilioManager.getHeartbeatMetrics();
      const heartbeatHealth = twilioManager.getHeartbeatHealth();
      const adaptiveMetrics = twilioManager.getAdaptiveHeartbeatMetrics();
      const adaptiveRecommendations = twilioManager.getAdaptiveHeartbeatRecommendations();

      // Log comprehensive session and connection health status
      logger.debug(`Session-aware connection health for call ${callId}:`, {
        // Session information
        sessionId: sessionConfig.sessionId,
        callId,
        conversationId,
        sessionDuration: sessionMetrics.duration,
        sessionActive: sessionMetrics.isActive,
        sessionHealthy: sessionMetrics.isHealthy,
        sessionOverallHealth: sessionHealthReport.overallHealth,
        messageCount: sessionMetrics.messageCount,
        errorCount: sessionMetrics.errorCount,
        reconnectionCount: sessionMetrics.reconnectionCount,
        // Connection health assessment
        healthScore: healthScore.overall,
        quality: healthScore.quality,
        latency: healthScore.latency,
        // Reconnection decision
        shouldReconnect: reconnectionDecision.shouldReconnect,
        reconnectionReason: reconnectionDecision.reason,
        urgency: reconnectionDecision.urgency,
        // Connection status
        connectionReady: twilioManager.getStats().isReady,
        circuitState: realTimeReport.circuitBreakerHealth.metrics.state,
        // Basic heartbeat metrics
        heartbeatAlive: heartbeatMetrics.isAlive,
        heartbeatLatency: heartbeatMetrics.averageLatency,
        heartbeatInterval: heartbeatMetrics.currentInterval,
        missedHeartbeats: heartbeatMetrics.missedHeartbeats,
        heartbeatQuality: heartbeatHealth.quality,
        totalPings: heartbeatMetrics.totalPings,
        totalPongs: heartbeatMetrics.totalPongs,
        // Adaptive heartbeat metrics
        networkCondition: adaptiveMetrics.currentCondition.type,
        recommendedInterval: adaptiveMetrics.recommendedInterval,
        performanceScore: adaptiveMetrics.performanceScore,
        pausedOperations: adaptiveMetrics.pausedOperations,
        adaptationHistory: adaptiveMetrics.adaptationHistory.length
      });

      // Log warning if session or connection health is degrading
      if (healthScore.overall < 50 || !heartbeatMetrics.isAlive ||
        adaptiveMetrics.currentCondition.type === 'poor' ||
        sessionHealthReport.overallHealth === 'poor' || sessionHealthReport.overallHealth === 'critical') {
        logger.warn(`Poor session/connection health detected for call ${callId}`, {
          sessionId: sessionConfig.sessionId,
          callId,
          sessionHealth: sessionHealthReport.overallHealth,
          sessionIssues: sessionHealthReport.issues,
          connectionHealthScore: healthScore,
          reconnectionDecision,
          recommendations: [
            ...realTimeReport.recommendations,
            ...adaptiveRecommendations,
            ...sessionHealthReport.recommendations
          ],
          degradationEvents: realTimeReport.degradationEvents.slice(-3), // Last 3 events
          heartbeatHealth,
          heartbeatIssues: heartbeatHealth.issues,
          networkCondition: adaptiveMetrics.currentCondition,
          sessionMetrics: {
            duration: sessionMetrics.duration,
            messageCount: sessionMetrics.messageCount,
            errorCount: sessionMetrics.errorCount,
            reconnectionCount: sessionMetrics.reconnectionCount
          }
        });
      }

      // Log critical health issues
      if (reconnectionDecision.shouldReconnect && reconnectionDecision.urgency === 'immediate' ||
        sessionHealthReport.overallHealth === 'critical') {
        logger.error(`Critical session/connection health for call ${callId} - immediate action needed`, {
          sessionId: sessionConfig.sessionId,
          callId,
          sessionHealth: sessionHealthReport.overallHealth,
          sessionAlerts: sessionHealthReport.alerts,
          reason: reconnectionDecision.reason,
          urgency: reconnectionDecision.urgency,
          fallbackRecommended: reconnectionDecision.fallbackRecommended,
          circuitState: realTimeReport.circuitBreakerHealth.metrics.state,
          heartbeatDead: !heartbeatMetrics.isAlive,
          missedHeartbeats: heartbeatMetrics.missedHeartbeats,
          sessionDuration: sessionMetrics.duration,
          sessionErrors: sessionMetrics.errorCount
        });
      }
    }, 10000); // Check every 10 seconds for faster issue detection

    // Get the call from database - in parallel with other initialization
    const callPromise = Call.findById(callId);

    // Get system configuration - in parallel
    const configPromise = Configuration.findOne();

    // Get conversation session - in parallel
    session = conversationEngine.getSession(conversationId);

    // Wait for configuration and call data
    [call, config] = await Promise.all([callPromise, configPromise]);

    if (!call) {
      logger.error(`No call found with ID ${callId} for streaming`);
      ws.close(1008, 'Call not found');
      return;
    }

    // Check if TTS is properly configured based on selected provider
    const selectedTTSProvider = config?.ttsConfig?.provider || 'elevenlabs';
    const isTTSConfigured = selectedTTSProvider === 'elevenlabs' 
      ? config?.elevenLabsConfig?.isEnabled 
      : config?.ttsConfig?.deepgramTTS?.isEnabled || false;
    
    if (!config || !isTTSConfigured) {
      logger.error(`TTS provider ${selectedTTSProvider} not configured for streaming`);
      ws.close(1008, 'Voice synthesis not configured');
      return;
    }
    
    // Check if ASR is properly configured (required for bidirectional functionality)
    const isASRConfigured = !!(
      config?.asrConfig?.apiKey || 
      config?.deepgramConfig?.apiKey
    );
    
    if (!isASRConfigured) {
      logger.error('ASR (speech-to-text) not configured for streaming session', {
        callId,
        conversationId
      });
      ws.close(1008, 'ASR not configured: Deepgram API key missing');
      return;
    }
    
    // Both ElevenLabs and Deepgram support streaming
    if (selectedTTSProvider !== 'elevenlabs' && selectedTTSProvider !== 'deepgram') {
      logger.error(`Streaming not yet supported for TTS provider: ${selectedTTSProvider}`);
      ws.close(1008, 'Streaming not supported for selected TTS provider');
      return;
    }

    logger.info(`Using ${selectedTTSProvider} for streaming TTS`, {
      callId,
      conversationId,
      provider: selectedTTSProvider
    });

    // Initialize TTS service based on selected provider
    if (selectedTTSProvider === 'elevenlabs') {
      // Get ElevenLabs SDK service (singleton)
      sdkService = getSDKService();
      if (!sdkService) {
        // Initialize the SDK service if not already
        const openAIProvider = config.llmConfig.providers.find(p => p.name === 'openai');
        if (!openAIProvider || !openAIProvider.isEnabled) {
          logger.error('OpenAI LLM not configured for ElevenLabs streaming');
          ws.close(1008, 'LLM not configured');
          return;
        }

        // Initialize the SDK service
        sdkService = require('../services/elevenlabsSDKService').initializeSDKService(
          config.elevenLabsConfig.apiKey,
          openAIProvider.apiKey
        );

        if (!sdkService) {
          logger.error('Failed to initialize ElevenLabs SDK service');
          ws.close(1008, 'Voice synthesis failed to initialize');
          return;
        }
      }
    } else if (selectedTTSProvider === 'deepgram') {
      // Initialize Deepgram streaming TTS service
      const deepgramApiKey = config.ttsConfig?.deepgramTTS?.apiKey;
      if (!deepgramApiKey) {
        logger.error('Deepgram TTS API key not configured for streaming');
        ws.close(1008, 'Deepgram TTS not configured');
        return;
      }

      logger.info('Deepgram streaming TTS will be initialized per connection', {
        hasApiKey: !!deepgramApiKey
      });
    }

    // Initialize Enhanced Voice AI service for ElevenLabs (for compatibility)
    if (selectedTTSProvider === 'elevenlabs') {
      voiceAI = new EnhancedVoiceAIService(
        config.elevenLabsConfig.apiKey
      );
    }

    // Create conversation session if it doesn't exist
    if (!session) {
      // If no session exists, create one
      const newConversationId = await conversationEngine.startConversation(
        callId,
        call.leadId.toString(),
        call.campaignId.toString()
      );
      session = conversationEngine.getSession(newConversationId);

      if (!session) {
        logger.error(`Failed to create conversation session for call ${callId}`);
        ws.close(1008, 'Failed to create conversation');
        return;
      }
    }

    // Store opening message data for later use (after streamSid is received)
    let pendingOpeningMessage: {
      message: string;
      voiceId: string;
      isFirstInteraction: boolean;
    } | null = null;

    // Prepare initial greeting if this is the first interaction
    if (session.conversationHistory.length === 0) {
      try {
        // Generate opening message - run in parallel with voice synthesis setup
        const openingMessagePromise = conversationEngine.generateOpeningMessage(
          conversationId,
          "Customer", // Default name
          call.campaignId.toString()
        );

        // Resolve voice ID while message is being generated - prioritize call's personalityId (campaign voice)
        const voiceId = call.personalityId ||
          session.currentPersonality.voiceId ||
          config.elevenLabsConfig.availableVoices[0].voiceId;

        // Log which voice we're using
        logger.info(`Using voice ID ${voiceId} for call ${callId}`);

        // Wait for opening message
        const openingMessage = await openingMessagePromise;

        // Store the opening message to be sent after streamSid is received
        pendingOpeningMessage = {
          message: openingMessage,
          voiceId: voiceId,
          isFirstInteraction: true
        };

        logger.info(`Opening message prepared for call ${callId}, waiting for streamSid`);
      } catch (error) {
        logger.error(`Error generating opening message for call ${callId}:`, error);

        // Prepare fallback greeting
        const fallbackGreeting = "Hello, how can I help you today?";
        const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;

        pendingOpeningMessage = {
          message: fallbackGreeting,
          voiceId: fallbackVoice,
          isFirstInteraction: true
        };
      }
    }

    /**
     * Function to send the opening message once streamSid is available
     */
    const sendPendingOpeningMessage = async () => {
      if (!pendingOpeningMessage || !streamSid) return;
      const { message, voiceId } = pendingOpeningMessage;
      try {
        const cacheKey = `${voiceId}_${message}`;
        const audio = responseCache.get(cacheKey) || await sdkService.generateSpeech(message, voiceId, { optimizeLatency: true });
        if (!responseCache.has(cacheKey)) responseCache.set(cacheKey, audio);
        sendAudioToTwilio(audio);
        
        // After the opening message is sent, explicitly transition to listening state
        // This ensures the agent continues the conversation and is ready for user input
        // Calculate proper delay based on message length to ensure audio completes
        const estimatedDuration = estimateTextDuration(message);
        logger.info(`Opening message sent for call ${callId}, estimated duration: ${estimatedDuration}ms, transitioning to listening state after completion`);
        
        setTimeout(() => {
          // Simply transition to listening state internally - no need to notify Twilio
          // Twilio doesn't expect or need "listening" event messages from us
          logger.info(`Transitioned to listening state after opening message for call ${callId}, conversation ${conversationId}`);
        }, estimatedDuration);
        
      } catch (e) { 
        logger.error(`Error sending opening message for call ${callId}:`, e); 
      } finally { 
        pendingOpeningMessage = null; 
      }
    };

    // Set up accumulated buffer for incoming audio
    let audioBuffer: Buffer[] = [];

    // Handle incoming WebSocket messages
    ws.on('message', async (data: WebSocket.Data) => {
      try {
        // Reset the missed pings counter whenever we receive any message
        (ws as any).isAlive = true;

        // Check if it's a text message from Twilio (JSON)
        if (typeof data === 'string' || (data instanceof Buffer && data.length < 1000)) {
          // Convert to string if it's a Buffer
          const textData = typeof data === 'string' ? data : data.toString('utf8');

          try {
            // Try to parse as JSON
            const jsonMessage = JSON.parse(textData);
            logger.debug(`Received JSON message from Twilio: ${JSON.stringify(jsonMessage)}`);

            // Handle Twilio Media Stream protocol messages
            if (jsonMessage.event === 'start') {
              // This is the initial message from Twilio with the streamSid
              streamSid = jsonMessage.start.streamSid;
              logger.info(`Media stream started for call ${callId}, conv ${conversationId}, streamSid: ${streamSid}`);
              await sendPendingOpeningMessage();

              // Do NOT send acknowledgment back to Twilio for 'start' event
              // The 'connected' event is something Twilio sends TO us, not something we send back
              // Sending this back causes protocol violations (Twilio error 31924)
              // Simply receiving and processing the start message is sufficient acknowledgment

              return; // Don't process as audio data
            }

            // Handle stop event
            if (jsonMessage.event === 'stop') {
              logger.info(`Media stream stopped: ${jsonMessage.stop?.streamSid}`);
              // Properly clean up resources
              clearInterval((ws as any).pingInterval);
              ws.close(1000, 'Stop event received from Twilio');
              return;
            }

            // Handle media event from Twilio (incoming audio)
            if (jsonMessage.event === 'media' && jsonMessage.media?.payload) {
              // Extract the media payload
              const payload = jsonMessage.media.payload;
              try {
                // Convert base64 to buffer
                const mediaBuffer = Buffer.from(payload, 'base64');
                // Add to audio buffer for processing
                audioBuffer.push(mediaBuffer);
              } catch (mediaError) {
                logger.error(`Error processing media payload: ${mediaError}`);
              }
              return;
            }

            // Handle mark events from Twilio
            if (jsonMessage.event === 'mark') {
              logger.debug(`Received mark event from Twilio: ${jsonMessage.mark?.name || 'unnamed'}`);
              return;
            }
          } catch (parseError) {
            // Not valid JSON, might be binary data
            logger.debug(`Received non-JSON message: ${textData.substring(0, 100)}...`);
          }
        }

        // Process as binary data if it's a large buffer
        if (data instanceof Buffer && data.length >= 1000) {
          // Accumulate audio data
          audioBuffer.push(data);

          // If we have enough data, process it
          if (Buffer.concat(audioBuffer).length > 4096) {
            const completeAudio = Buffer.concat(audioBuffer);
            audioBuffer = []; // Reset buffer

            // Process the audio with speech recognition using Deepgram if available
            let transcribedText;

            // Get the speech analysis service from the conversation engine
            const speechAnalysisService = conversationEngine.getSpeechAnalysisService();

            try {
              // Try to transcribe using Deepgram
              if (config.deepgramConfig?.isEnabled && speechAnalysisService) {
                logger.info(`Using Deepgram for speech recognition in call ${callId}`);
                const transcriptionResult = await speechAnalysisService.transcribeAudio(completeAudio);
                transcribedText = transcriptionResult.transcript || "";

                // Log the transcription details
                if (transcriptionResult.transcript) {
                  logger.info(`Transcription: "${transcriptionResult.transcript.substring(0, 100)}..." (confidence: ${transcriptionResult.confidence}, language: ${transcriptionResult.language})`);
                }
              } else {
                // Fallback to existing method
                logger.warn(`Deepgram not configured, using fallback for call ${callId}`);
                transcribedText = data?.toString() || (() => {
                  throw new Error('Speech recognition not properly configured - no audio data received');
                })();
              }
            } catch (transcriptionError) {
              logger.error(`Error in speech transcription for call ${callId}: ${transcriptionError.message}`);
              // Fallback to existing method
              transcribedText = data?.toString() || "Sorry, I couldn't hear you clearly.";
            }

            // Add user input to conversation
            const userMessage = {
              id: uuidv4(),
              timestamp: new Date(),
              speaker: 'customer',
              content: transcribedText
            };

            // Send immediate acknowledgment if needed (reduces perceived latency)
            // Only do this for longer user inputs that might need processing time
            if (transcribedText.length > 50) {
              try {
                const ack = "I'm thinking about that...";
                const voiceId = call.personalityId ||
                  session.currentPersonality.voiceId ||
                  config.elevenLabsConfig.availableVoices[0].voiceId;

                // Check cache for acknowledgment
                const cacheKey = `${voiceId}_${ack}`;
                if (responseCache.has(cacheKey)) {
                  sendAudioToTwilio(responseCache.get(cacheKey));
                } else {
                  // Generate and cache acknowledgment in the background
                  sdkService.generateSpeech(ack, voiceId, { optimizeLatency: true })
                    .then(buffer => {
                      responseCache.set(cacheKey, buffer);
                    })
                    .catch(err => {
                      logger.debug(`Failed to cache acknowledgment: ${err.message}`);
                    });
                }
              } catch (ackError) {
                logger.debug(`Failed to send acknowledgment: ${ackError.message}`);
                // Continue processing - acknowledgment is optional
              }
            }

            // Generate AI response - this starts the processing
            const aiResponsePromise = conversationEngine.processUserInput(
              conversationId,
              transcribedText
            );

            // Get voice ID for voice synthesis - prioritize call's personalityId (campaign voice)
            const voiceId = call.personalityId ||
              session.currentPersonality.voiceId ||
              config.elevenLabsConfig.availableVoices[0].voiceId;

            // Get the LLM provider configuration
            const openAIProvider = config.llmConfig.providers.find(p => p.name === 'openai');

            // Generate AI response - use Realtime API if available and enabled
            let aiResponse;
            if (openAIProvider?.useRealtimeAPI) {
              logger.info(`Using OpenAI Realtime API for call ${callId}`);
              // Use the LLM service from the global instance
              const llmService = global.llmService;
              if (!llmService) {
                logger.warn('LLM service not found in global instance, falling back to conversation engine');
                aiResponse = await aiResponsePromise;
              } else {
                // Use direct LLM service for realtime processing
                const messages = session.conversationHistory.map(turn => ({
                  role: turn.speaker === 'agent' ? 'assistant' : 'user',
                  content: turn.content
                }));

                // Add current message
                messages.push({
                  role: 'user',
                  content: transcribedText
                });

                // We'll collect the response here
                let responseText = '';

                // Use the realtime chat method for ultra-low latency
                await llmService.realtimeChat({
                  provider: 'openai',
                  model: openAIProvider.defaultModel,
                  messages: messages,
                  options: {
                    temperature: 0.7,
                    maxTokens: 150
                  }
                }, (chunk) => {
                  responseText += chunk.content;
                });

                aiResponse = { text: responseText };
              }
            } else {
              // Use standard conversation engine
              aiResponse = await aiResponsePromise;
            }

            // Stream the audio response for lowest latency
            try {
              logger.info(`Streaming response audio for call ${callId}`);

              // Define callback to send chunks as they arrive
              const onAudioChunk = (chunk: Buffer) => {
                sendAudioToTwilio(chunk);
              };

              // Stream the audio response
              await sdkService.streamSpeechGeneration(
                aiResponse.text,
                voiceId,
                onAudioChunk,
                { optimizeLatency: true },
                conversationId  // Pass the persistent conversation ID
              );
            } catch (streamError) {
              logger.error(`Error streaming response for call ${callId}:`, streamError);

              // Fallback to non-streaming method
              try {
                const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
                  text: aiResponse.text,
                  personalityId: voiceId,
                  language: session.language || 'English'
                });

                if (speechResponse && speechResponse.audioContent) {
                  sendAudioToTwilio(speechResponse.audioContent);
                } else {
                  throw new Error('No audio content returned for response');
                }
              } catch (voiceError) {
                logger.error(`Fallback synthesis failed for call ${callId}:`, voiceError);

                // Last resort fallback
                try {
                  const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;
                  const fallbackResponse = await voiceAI.synthesizeSimpleSpeech(aiResponse.text, fallbackVoice);

                  if (fallbackResponse) {
                    sendAudioToTwilio(fallbackResponse);
                  } else {
                    throw new Error('All synthesis methods failed');
                  }
                } catch (finalError) {
                  logger.error(`All synthesis methods failed for call ${callId}:`, finalError);
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error(`Error processing voice stream data for call ${callId}:`, error);
        
        // Report error to resilience services
        resilienceService.reportError(callId, error as Error, 'voice_processing');
        monitoringService.reportIssue(callId, {
          type: 'error',
          category: 'audio',
          message: `Voice stream processing error: ${error}`,
          impact: 'high',
          suggestion: 'Check audio processing pipeline and network connection'
        });
        
        // Update error metrics
        monitoringService.updateCallMetrics(callId, {
          errorRate: monitoringService.getCallHealth(callId)?.metrics.errorRate || 0 + 0.1
        });
      }
    });

    // Handle WebSocket closure
    ws.on('close', async (code: number, reason: string) => {
      // Get final health report before cleanup
      const healthReport = twilioManager.getHealthReport();
      const healthMetrics = twilioManager.getHealthMetrics();

      logger.info(`Voice stream closed for call ${callId}: code=${code} reason="${reason || 'No reason provided'}"`, {
        callId,
        conversationId,
        streamSid,
        code,
        reason,
        connectionHealth: twilioManager.getConnectionHealth(),
        healthScore: healthReport.healthScore,
        totalErrors: healthMetrics.issues.length
      });

      try {
        // Clean up resources as needed
        audioBuffer = []; // Clear buffer

        // Clear ping interval if it exists
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
          logger.debug(`Cleared ping interval for call ${callId}`);
        }

        // Clear health monitoring interval
        if (healthMonitoringInterval) {
          clearInterval(healthMonitoringInterval);
          logger.debug(`Cleared health monitoring interval for call ${callId}`);
        }

        // End session and cleanup resources
        const finalSessionMetrics = sessionInstance.getMetrics();
        const finalHealthReport = sessionInstance.getHealthReport();

        logger.info(`Session ending for call ${callId}`, {
          sessionId: sessionConfig.sessionId,
          callId,
          conversationId,
          sessionDuration: finalSessionMetrics.duration,
          messageCount: finalSessionMetrics.messageCount,
          errorCount: finalSessionMetrics.errorCount,
          reconnectionCount: finalSessionMetrics.reconnectionCount,
          finalHealth: finalHealthReport.overallHealth,
          closeCode: code,
          closeReason: reason
        });

        sessionInstance.end(`WebSocket closed: ${code} - ${reason || 'No reason provided'}`);

        // Clean up resilience services
        resilienceService.unregisterCall(callId);
        monitoringService.unregisterCall(callId);
        
        logger.debug(`Cleaned up session and WebSocket manager for call ${callId}`);

        // Log additional information about the disconnection
        // This helps diagnose Twilio error 31924
        if (code === 1006) {
          logger.warn(`Abnormal WebSocket closure (code 1006) for call ${callId} - possible Twilio Media Stream protocol error`, {
            callId,
            conversationId,
            streamSid,
            twilioErrorPossible: 'Error 31924 may occur after this abnormal closure'
          });
        }

        // If this is an intentional closure from our side (1000), no action needed
        // For other closure codes, we might want to record them for debugging
        if (code !== 1000) {
          // Log unexpected closures to help with debugging
          logger.warn(`Unexpected WebSocket closure code ${code} for call ${callId}`, {
            callId,
            conversationId,
            streamSid,
            closeCode: code,
            closeReason: reason || 'No reason provided'
          });
        }
      } catch (error) {
        logger.error(`Error handling stream close for call ${callId}:`, error);
      }
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for call ${callId}:`, {
        error: error.message,
        stack: error.stack,
        callId,
        conversationId,
        streamSid
      });

      // Check if this is a Twilio protocol error that might benefit from reconnection
      const errorMessage = error.message.toLowerCase();
      const isTwilioProtocolError = errorMessage.includes('protocol') ||
        errorMessage.includes('malformed') ||
        errorMessage.includes('fragmented') ||
        errorMessage.includes('31924');

      if (isTwilioProtocolError && twilioManager) {
        // Get reconnection decision for protocol errors
        const reconnectionDecision = twilioManager.getEnhancedReconnectionDecision(
          `Twilio protocol error: ${error.message}`
        );

        logger.info('Twilio protocol error detected, evaluating reconnection', {
          callId,
          conversationId,
          error: error.message,
          reconnectionDecision
        });

        if (reconnectionDecision.shouldReconnect && reconnectionDecision.urgency === 'immediate') {
          // Attempt immediate reconnection for critical protocol errors
          logger.warn('Attempting immediate reconnection for Twilio protocol error', {
            callId,
            conversationId,
            error: error.message,
            estimatedDelay: reconnectionDecision.estimatedDelay
          });

          // Don't close the connection immediately - let reconnection service handle it
          return;
        }
      }

      try {
        // Send a closing message to Twilio if possible
        if (streamSid && ws.readyState === WebSocket.OPEN) {
          try {
            const errorMessage = {
              event: 'error',
              streamSid: streamSid,
              error: {
                message: 'Internal server error',
                code: 'SERVER_ERROR'
              }
            };
            twilioManager.sendTwilioMessage(errorMessage);
            logger.debug(`Sent error message to Twilio for call ${callId}`);
          } catch (sendError) {
            logger.error(`Failed to send error message to Twilio: ${sendError.message}`);
          }
        }

        // Close the connection with an appropriate code
        ws.close(1011, 'Internal server error: ' + error.message.substring(0, 100));
      } catch (closeError) {
        logger.error(`Error closing WebSocket after error: ${closeError.message}`);

        // Force terminate if normal close fails
        try {
          ws.terminate();
        } catch (terminateError) {
          logger.error(`Failed to terminate WebSocket: ${terminateError.message}`);
        }
      }
    });

    // Handle pong messages from client
    ws.on('pong', () => {
      logger.debug(`Received pong from client for call ${callId}`);
      (ws as any).isAlive = true;
    });

    // Mark the connection as alive initially
    (ws as any).isAlive = true;

    // Set up ping/pong to keep connection alive for Twilio
    const pingInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(pingInterval);
        logger.debug(`Cleared ping interval due to closed connection for call ${callId}`);
        return;
      }

      // Check if we received a pong since the last ping
      if ((ws as any).isAlive === false) {
        logger.warn(`No pong received for call ${callId}, attempting reconnection`);

        // Attempt to send a message to see if connection is actually dead
        try {
          // Send a mark message as a last attempt to verify connection
          if (streamSid) {
            const reconnectMessage = {
              event: 'mark',
              streamSid: streamSid,
              mark: {
                name: 'reconnection-attempt'
              }
            };
            twilioManager.sendTwilioMessage(reconnectMessage);
            logger.info(`Sent reconnection attempt message for call ${callId}`);

            // Give one more chance
            (ws as any).isAlive = true;
          } else {
            // If we don't have a streamSid, we can't send a proper message
            // and the connection is likely dead
            logger.error(`No streamSid available for reconnection attempt, terminating connection`);
            clearInterval(pingInterval);
            ws.terminate();
          }
        } catch (reconnectError) {
          logger.error(`Error during reconnection attempt: ${reconnectError}`);
          clearInterval(pingInterval);
          try {
            ws.terminate();
          } catch (terminateError) {
            logger.error(`Error terminating connection: ${terminateError}`);
          }
        }
        return;
      }

      // Mark as not alive, will be set to true when pong is received
      // or when any message is received
      (ws as any).isAlive = false;

      // Send ping
      try {
        ws.ping(Buffer.from(JSON.stringify({ timestamp: Date.now() })));
        logger.debug(`Ping sent to keep WebSocket connection alive for call ${callId}`);
      } catch (pingError) {
        logger.error(`Error sending ping: ${pingError}`);

        // If ping fails, try to send a JSON message instead (Twilio sometimes prefers this)
        try {
          if (streamSid) {
            const pingMessage = {
              event: 'ping',
              streamSid: streamSid,
              timestamp: Date.now()
            };
            twilioManager.sendTwilioMessage(pingMessage);
            logger.debug(`Sent ping as JSON message for call ${callId}`);
          }
        } catch (jsonPingError) {
          logger.error(`Error sending JSON ping: ${jsonPingError}`);
        }
      }
    }, 30000); // Ping every 30 seconds (aligned with Twilio best practices)

    // Store the interval for cleanup
    (ws as any).pingInterval = pingInterval;

  } catch (error) {
    logger.error(`Error in optimized voice stream for call ${callId}:`, error);
    
    // Report to resilience services if they were initialized
    if (callId) {
      try {
        const resilienceService = getCallResilienceService();
        const monitoringService = getCallMonitoringService();
        
        resilienceService.reportError(callId, error as Error, 'stream_initialization');
        monitoringService.reportIssue(callId, {
          type: 'error',
          category: 'connection',
          message: `Stream initialization failed: ${error}`,
          impact: 'critical',
          suggestion: 'Check service configuration and network connectivity'
        });
        
        // Clean up services
        resilienceService.unregisterCall(callId);
        monitoringService.unregisterCall(callId);
      } catch (serviceError) {
        logger.error(`Error reporting to resilience services: ${serviceError}`);
      }
    }
    
    ws.close(1011, 'Internal server error');
  }
};

/**
 * Initialize the module
 * Pre-caches responses and sets up any needed resources
 */
export const initialize = async (): Promise<void> => {
  try {
    await initializeResponseCache();
    logger.info('Streaming controller initialized with response caching');
  } catch (error) {
    logger.error('Failed to initialize streaming controller', error);
  }
};

/**
 * HTTP route handler for optimized stream endpoint
 * Provides information about the WebSocket endpoint
 */
export const optimizedStreamRoute = (req: Request, res: Response): void => {
  const { callId, conversationId } = req.params;

  res.json({
    message: 'Optimized Voice Stream Endpoint',
    callId,
    conversationId,
    websocketUrl: `${req.protocol === 'https' ? 'wss' : 'ws'}://${req.get('host')}/voice/optimized-stream/${callId}/${conversationId}`,
    status: 'ready'
  });
};

// Export enhanced controller functions
export default {
  handleOptimizedVoiceStream,
  handleVoiceStream, // Keep original for backward compatibility
  initialize,
  optimizedStreamRoute
};
