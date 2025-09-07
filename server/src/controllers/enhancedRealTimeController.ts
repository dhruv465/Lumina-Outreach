import { Request, Response } from 'express';
import WebSocket from 'ws';
import { logger } from '../index';
import { realTimeCallStateMachine, CallEvent, CallState } from '../services/realTimeCallStateMachine';
import { optimizedRealTimeAudioPipeline } from '../services/optimizedRealTimeAudioPipeline';
import { enhancedBargeInDetectionService } from '../services/enhancedBargeInDetectionService';
import Call from '../models/Call';
import Campaign from '../models/Campaign';
import Configuration from '../models/Configuration';
import { conversationEngine } from '../services/index';

/**
 * Enhanced controller for real-time, interruption-friendly AI voice agent calls
 * Integrates Twilio Media Streams with streaming STT/TTS and barge-in handling
 */

interface TwilioMediaMessage {
  event: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

/**
 * Enhanced WebSocket handler for real-time media streaming
 */
export const handleRealTimeMediaStream = async (ws: WebSocket, req: Request): Promise<void> => {
  let callId: string | null = null;
  let conversationId: string | null = null;
  let streamSid: string | null = null;
  let sequenceNumber = 0;

  try {
    // Extract parameters from URL
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    callId = url.searchParams.get('callId') || url.pathname.split('/').find(p => p.length === 24);
    conversationId = url.searchParams.get('conversationId') || url.searchParams.get('sessionId');

    if (!callId) {
      logger.error('Missing callId in real-time media stream request');
      ws.close(1008, 'Missing callId parameter');
      return;
    }

    logger.info(`Real-time media stream initiated for call ${callId}`, {
      conversationId,
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin
    });

    // Get call and campaign information
    const call = await Call.findById(callId);
    if (!call) {
      logger.error(`Call not found: ${callId}`);
      ws.close(1008, 'Call not found');
      return;
    }

    const campaign = await Campaign.findById(call.campaignId);
    if (!campaign) {
      logger.error(`Campaign not found for call: ${callId}`);
      ws.close(1008, 'Campaign not found');
      return;
    }

    // Get or create conversation ID
    if (!conversationId) {
      conversationId = await conversationEngine.startConversation(
        callId,
        call.leadId.toString(),
        call.campaignId.toString(),
        call.personalityId
      );
    }

    logger.info(`Using conversation ID ${conversationId} for call ${callId}`);

    // Get configuration to determine TTS provider
    const config = await Configuration.findOne();
    
    // Check if ASR is properly configured (required for bidirectional functionality)
    const isASRConfigured = !!(
      config?.deepgramConfig?.apiKey
    );
    
    if (!isASRConfigured) {
      logger.error('Speech recognition not configured for streaming session', {
        callId,
        conversationId
      });
      ws.close(1008, 'Speech recognition not configured');
      return;
    }
    
    const configuredTTSProvider = config?.ttsConfig?.provider || 'elevenlabs';
    
    // Ensure the TTS provider is compatible with optimized audio pipeline
    const selectedTTSProvider: 'elevenlabs' | 'deepgram' = 
      (configuredTTSProvider === 'elevenlabs' || configuredTTSProvider === 'deepgram') 
        ? configuredTTSProvider 
        : 'elevenlabs';
    
    if (configuredTTSProvider !== selectedTTSProvider) {
      logger.warn(`TTS provider ${configuredTTSProvider} not supported by optimized audio pipeline, falling back to ${selectedTTSProvider} for call ${callId}`);
    } else {
      logger.info(`Using TTS provider: ${selectedTTSProvider} for call ${callId}`);
    }

    // Initialize real-time call state machine
    const session = realTimeCallStateMachine.createSession(
      callId,
      conversationId,
      call.leadId.toString(),
      call.campaignId.toString(),
      {
        silenceTimeout: 4000,      // 4 seconds
        responseTimeout: 8000,     // 8 seconds
        bargeInThreshold: 0.25,    // Lower threshold for better detection
        canBeInterrupted: true
      }
    );

    // Initialize optimized audio pipeline with configuration-based TTS provider
    const audioSession = await optimizedRealTimeAudioPipeline.initializeCall(
      callId,
      conversationId,
      {
        primarySTTProvider: 'deepgram',
        primaryTTSProvider: selectedTTSProvider,
        enableProviderFallback: true,
        enableStreamingSTT: true,
        enableStreamingTTS: true,
        maxProcessingLatency: 300,  // 300ms for ultra-low latency
        enableParallelProcessing: true
      }
    );

    // Set WebSocket stream for audio pipeline
    optimizedRealTimeAudioPipeline.setWebSocketStream(callId, ws);

    // Transition to connecting state
    realTimeCallStateMachine.transitionToState(
      callId,
      CallState.CONNECTING,
      CallEvent.CALL_CONNECTED
    );

    // Set up message handlers
    ws.on('message', async (data: WebSocket.Data) => {
      logger.debug(`Received raw WebSocket data for call ${callId}: ${data.toString().substring(0, 200)}`); // Log first 200 chars
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());
        
        switch (message.event) {
          case 'connected':
            logger.info(`Twilio Media Stream connected for call ${callId}`, {
              streamSid: message.streamSid
            });
            break;

          case 'start':
            streamSid = message.start?.streamSid || null;
            logger.info(`Media stream started for call ${callId}`, {
              streamSid,
              accountSid: message.start?.accountSid,
              tracks: message.start?.tracks
            });

            // Transition to greeting state and start conversation
            realTimeCallStateMachine.transitionToState(
              callId,
              CallState.GREETING,
              CallEvent.MEDIA_STREAM_STARTED,
              { streamSid }
            );

            // Send initial greeting
            await sendInitialGreeting(callId, conversationId, campaign, ws, streamSid);
            break;

          case 'media':
            if (message.media?.payload) {
              // Process incoming audio through optimized pipeline
              await optimizedRealTimeAudioPipeline.processIncomingAudio(
                callId,
                message.media.payload,
                message.media.timestamp,
                streamSid || undefined
              );
            }
            break;

          case 'stop':
            logger.info(`Media stream stopped for call ${callId}`, {
              accountSid: message.stop?.accountSid
            });
            
            realTimeCallStateMachine.handleEvent(callId, CallEvent.CALL_ENDED);
            break;

          default:
            logger.debug(`Unknown Twilio event for call ${callId}:`, message.event);
        }

      } catch (error) {
        logger.error(`Error processing message for call ${callId}:`, error);
      }
    });

    // Set up WebSocket event handlers
    ws.on('close', (code: number, reason: string) => {
      logger.info(`WebSocket closed for call ${callId}`, {
        code,
        reason: reason.toString(),
        conversationId,
        streamSid
      });

      // End session and cleanup
      if (callId) {
        realTimeCallStateMachine.endSession(callId, 'websocket_closed');
        optimizedRealTimeAudioPipeline.cleanupCall(callId);
        enhancedBargeInDetectionService.cleanupCall(callId);
      }
    });

    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for call ${callId}:`, {
        error: error.message,
        stack: error.stack,
        conversationId,
        streamSid
      });

      if (callId) {
        realTimeCallStateMachine.handleEvent(callId, CallEvent.ERROR_OCCURRED, {
          error: error.message,
          source: 'websocket'
        });
      }
    });

    // Set up ping/pong for connection health
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 15000);

    ws.on('pong', () => {
      logger.debug(`Pong received for call ${callId}`);
    });

    // Clean up ping interval on close
    ws.on('close', () => {
      clearInterval(pingInterval);
    });

    logger.info(`Real-time media stream handler setup complete for call ${callId}`);

  } catch (error) {
    logger.error('Error setting up real-time media stream:', error);
    
    if (callId) {
      realTimeCallStateMachine.handleEvent(callId, CallEvent.ERROR_OCCURRED, {
        error: error instanceof Error ? error.message : String(error),
        source: 'setup'
      });
    }
    
    ws.close(1011, 'Internal server error');
  }
};

/**
 * Send initial greeting to start the conversation
 */
async function sendInitialGreeting(
  callId: string,
  conversationId: string,
  campaign: any,
  ws: WebSocket,
  streamSid: string | null
): Promise<void> {
  try {
    logger.info(`Sending initial greeting for call ${callId}`);

    // Get greeting text from campaign
    const greetingText = campaign.openingMessage?.trim() || 
                        campaign.initialPrompt?.trim() || 
                        "Hello! How can I help you today?";

    // Transition to speaking state
    realTimeCallStateMachine.transitionToState(
      callId,
      CallState.SPEAKING,
      CallEvent.TTS_STARTED,
      { greetingText }
    );

    // Generate and send greeting audio using optimized pipeline
    const audioGenerated = await generateAndSendGreeting(callId, greetingText);

    if (audioGenerated) {
      logger.info(`Initial greeting sent successfully for call ${callId}`);
      
      // Estimate greeting duration and schedule transition to listening
      const estimatedDuration = estimateTextDuration(greetingText);
      
      setTimeout(() => {
        realTimeCallStateMachine.transitionToState(
          callId,
          CallState.LISTENING,
          CallEvent.TTS_COMPLETED
        );
      }, estimatedDuration);
      
    } else {
      logger.error(`Failed to generate greeting audio for call ${callId}`);
      
      // Fallback to TTS via Twilio
      sendTwilioTTSFallback(ws, greetingText, streamSid);
      
      setTimeout(() => {
        realTimeCallStateMachine.transitionToState(
          callId,
          CallState.LISTENING,
          CallEvent.TTS_COMPLETED
        );
      }, estimateTextDuration(greetingText));
    }

  } catch (error) {
    logger.error(`Error sending initial greeting for call ${callId}:`, error);
    
    // Fallback to TTS
    const fallbackText = "Hello! I'm here to help you.";
    sendTwilioTTSFallback(ws, fallbackText, streamSid);
    
    setTimeout(() => {
      realTimeCallStateMachine.transitionToState(
        callId,
        CallState.LISTENING,
        CallEvent.TTS_COMPLETED
      );
    }, 3000);
  }
}

/**
 * Generate and send greeting using the optimized audio pipeline
 */
async function generateAndSendGreeting(callId: string, greetingText: string): Promise<boolean> {
  try {
    // Get configuration and voice settings
    const call = await Call.findById(callId);
    const campaign = await Campaign.findById(call?.campaignId);
    const config = await Configuration.findOne();

    if (!config || !call || !campaign) {
      logger.error(`Missing configuration for greeting generation: call ${callId}`);
      return false;
    }

    // Determine voice ID and provider
    const voiceId = call.personalityId || 
                   campaign.voiceConfiguration?.voiceId || 
                   'default';
    
    const language = campaign.primaryLanguage === 'hi' ? 'hi' : 'en';
    
    // Try ElevenLabs first
    if (config.elevenLabsConfig?.isEnabled && config.elevenLabsConfig?.apiKey) {
      try {
        const { EnhancedVoiceAIService } = await import('../services/enhancedVoiceAIService');
        const voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
        
        const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
          text: greetingText,
          personalityId: voiceId,
          language
        });

        if (speechResponse?.audioContent) {
          const success = await optimizedRealTimeAudioPipeline.sendAudioToCall(
            callId,
            speechResponse.audioContent,
            { greetingText, provider: 'elevenlabs' }
          );
          
          if (success) {
            logger.info(`ElevenLabs greeting sent for call ${callId}`);
            return true;
          }
        }
      } catch (elevenLabsError) {
        logger.warn(`ElevenLabs greeting failed for call ${callId}:`, elevenLabsError);
      }
    }

    // Try Deepgram TTS as fallback
    if (config.ttsConfig?.deepgramTTS?.isEnabled) {
      try {
        const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
        
        const speechResponse = await synthesizeSpeechWithProvider(
          config,
          greetingText,
          voiceId,
          language,
          { encoding: 'linear16', sampleRate: 8000 }
        );

        if (speechResponse?.audioContent) {
          const success = await optimizedRealTimeAudioPipeline.sendAudioToCall(
            callId,
            speechResponse.audioContent,
            { greetingText, provider: 'deepgram' }
          );
          
          if (success) {
            logger.info(`Deepgram greeting sent for call ${callId}`);
            return true;
          }
        }
      } catch (deepgramError) {
        logger.warn(`Deepgram greeting failed for call ${callId}:`, deepgramError);
      }
    }

    return false;

  } catch (error) {
    logger.error(`Error generating greeting for call ${callId}:`, error);
    return false;
  }
}

/**
 * Send TTS fallback using Twilio's built-in TTS
 */
function sendTwilioTTSFallback(
  ws: WebSocket,
  text: string,
  streamSid: string | null
): void {
  try {
    if (ws.readyState !== WebSocket.OPEN || !streamSid) {
      logger.warn('Cannot send Twilio TTS fallback: WebSocket not open or no streamSid');
      return;
    }

    // Use Twilio's TTS by sending a special message
    // Note: This is a simplified approach - in practice, you'd need to integrate with Twilio's TTS API
    const message = {
      event: 'tts_fallback',
      streamSid,
      text,
      voice: 'alice',
      language: 'en-US'
    };

    ws.send(JSON.stringify(message));
    logger.info('Twilio TTS fallback sent');

  } catch (error) {
    logger.error('Error sending Twilio TTS fallback:', error);
  }
}

/**
 * Estimate text-to-speech duration in milliseconds
 */
function estimateTextDuration(text: string): number {
  // Rough estimation: average speaking rate is about 150-180 words per minute
  const wordsPerMinute = 160;
  const words = text.split(/\s+/).length;
  const durationMinutes = words / wordsPerMinute;
  const durationMs = durationMinutes * 60 * 1000;
  
  // Add buffer time
  return Math.max(durationMs + 1000, 2000); // Minimum 2 seconds
}

/**
 * Health check endpoint for real-time services
 */
export const getHealthStatus = async (req: Request, res: Response): Promise<Response> => {
  try {
    const config = await Configuration.findOne();
    
    const health = {
      timestamp: new Date().toISOString(),
      services: {
        stateMachine: {
          status: 'healthy',
          activeSessions: realTimeCallStateMachine.getActiveSessions().length
        },
        audioPipeline: {
          status: 'healthy',
          activeStreams: 0 // Would need to implement this in the audio pipeline
        },
        bargeInDetection: {
          status: 'healthy',
          activeCalls: enhancedBargeInDetectionService.getActiveCalls().length
        },
        sttProviders: {
          deepgram: config?.deepgramConfig?.isEnabled || false,
          openai: config?.llmConfig?.providers?.find(p => p.name === 'openai')?.isEnabled || false
        },
        ttsProviders: {
          elevenlabs: config?.elevenLabsConfig?.isEnabled || false,
          deepgram: config?.ttsConfig?.deepgramTTS?.isEnabled || false
        }
      },
      performance: {
        averageLatency: 'N/A', // Would calculate from active sessions
        totalCalls: realTimeCallStateMachine.getActiveSessions().length
      }
    };

    return res.status(200).json(health);

  } catch (error) {
    logger.error('Error getting health status:', error);
    
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get metrics for a specific call
 */
export const getCallMetrics = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { callId } = req.params;
    
    if (!callId) {
      return res.status(400).json({ error: 'Call ID is required' });
    }

    const stateMachineMetrics = realTimeCallStateMachine.getSessionMetrics(callId);
    const audioPipelineMetrics = optimizedRealTimeAudioPipeline.getSessionMetrics(callId);
    const bargeInMetrics = enhancedBargeInDetectionService.getCallMetrics(callId);
    const stateHistory = realTimeCallStateMachine.getStateHistory(callId);

    if (!stateMachineMetrics) {
      return res.status(404).json({ error: 'Call session not found' });
    }

    const metrics = {
      callId,
      stateMachine: stateMachineMetrics,
      audioPipeline: audioPipelineMetrics,
      bargeInDetection: bargeInMetrics,
      stateHistory,
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(metrics);

  } catch (error) {
    logger.error('Error getting call metrics:', error);
    
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Manually trigger a state transition (for testing/debugging)
 */
export const triggerStateTransition = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { callId } = req.params;
    const { state, event, metadata = {} } = req.body;

    if (!callId || !state || !event) {
      return res.status(400).json({ 
        error: 'Call ID, state, and event are required' 
      });
    }

    const success = realTimeCallStateMachine.transitionToState(
      callId,
      state as CallState,
      event as CallEvent,
      metadata
    );

    if (success) {
      return res.status(200).json({
        success: true,
        callId,
        newState: state,
        event,
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid state transition'
      });
    }

  } catch (error) {
    logger.error('Error triggering state transition:', error);
    
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
};