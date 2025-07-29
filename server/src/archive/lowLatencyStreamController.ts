/**
 * Low-Latency Stream Controller
 * 
 * Optimized controller for human-like conversational AI interactions with:
 * 1. Parallel processing of AI responses and voice synthesis
 * 2. Real-time audio streaming with minimal latency
 * 3. Human-like audio cues and thinking sounds
 * 4. Response caching for common phrases
 */

import { Request, Response } from 'express';
import * as WebSocket from 'ws';
import { logger } from '../index';
import { safeSendWebSocketMessage, createTwilioMediaMessage, validateTwilioMediaMessage } from '../utils/websocketUtils';
import { createFrameHandler, WebSocketFrameHandler } from '../utils/websocketFraming';
import Call from '../models/Call';
import Configuration from '../models/Configuration';
import { conversationEngine } from '../services/index';
import { getSDKService } from '../services/elevenlabsSDKService';
import { 
  initializeParallelProcessingService, 
  getParallelProcessingService,
  ProcessingEvent
} from '../services/parallelProcessingService';
import { LLMService } from '../services/llm/service';
import responseCache from '../utils/responseCache';
import { v4 as uuidv4 } from 'uuid';

// Common phrases for pre-caching to eliminate first-response latency
const COMMON_PHRASES = {
  GREETINGS: [
    "Hello, how are you today?",
    "Hi there! How can I help you?",
    "Good morning! How may I assist you?",
    "Thanks for calling. How can I help you today?",
    "Welcome! What can I do for you?"
  ],
  ACKNOWLEDGMENTS: [
    "I understand.",
    "Got it.",
    "I see.",
    "Thanks for sharing that.",
    "I'm listening.",
    "Please go on.",
    "That makes sense."
  ],
  THINKING: [
    "Hmm, let me think about that.",
    "I'm considering your question.",
    "Let me process that for a moment.",
    "That's an interesting point."
  ]
};

/**
 * Initialize and pre-cache common responses for fast first interactions
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
    
    logger.info('Initializing response cache for common phrases with optimized latency settings');
    
    // Use the cache preloader utility from utils/cachePreloader
    const { preloadVoice } = require('../utils/cachePreloader');
    
    // Preload for the default voice
    await preloadVoice(defaultVoiceId);
    
    // Preload for any other active voices
    for (const voice of config.elevenLabsConfig.availableVoices) {
      if (voice.voiceId !== defaultVoiceId) {
        await preloadVoice(voice.voiceId);
      }
    }
    
    logger.info(`Response cache initialization complete. Cache size: ${responseCache.size()} items`);
  } catch (error) {
    logger.error(`Error initializing response cache: ${error.message}`);
  }
};

/**
 * Low-latency WebSocket handler for voice streaming
 * Uses parallel processing and human-like audio cues to reduce perceived latency
 */
export const handleLowLatencyVoiceStream = async (ws: WebSocket, req: Request): Promise<void> => {
  // Store connection timing for diagnostics
  const connectionStartTime = Date.now();
  
  // Store Twilio stream information
  let streamSid: string | null = null;
  let sequenceNumber = 0;
  let audioBuffer: Buffer[] = []; // Declare audioBuffer at function scope
  let pingInterval: NodeJS.Timeout | null = null; // For connection keep-alive
  
  // Frame handler will be initialized after we have the WebSocket
  let frameHandler: WebSocketFrameHandler | null = null;
  
  /**
   * Helper function to send audio data to Twilio in the required JSON format
   */
  const sendAudioToTwilio = (audioData: Buffer) => {
    if (!streamSid) {
      logger.warn('Cannot send audio: streamSid not available yet');
      return false;
    }
    
    const message = createTwilioMediaMessage(streamSid, audioData, ++sequenceNumber);
    
    // Validate message format before sending
    const validation = validateTwilioMediaMessage(message);
    if (!validation.valid) {
      logger.error(`Invalid Twilio media message: ${validation.error}`, { message });
      return false;
    }
    
    // Use frame handler for robust sending if available, otherwise fallback
    let success = false;
    if (frameHandler) {
      success = frameHandler.sendMessage(message);
    } else {
      success = safeSendWebSocketMessage(ws, message, `call-${callId}-chunk-${sequenceNumber}`);
    }
    
    if (success) {
      logger.debug(`Sent audio chunk ${sequenceNumber} to Twilio (${audioData.length} bytes)`);
    }
    
    return success;
  };

  // Add proper WebSocket ready state check and error handling
  if (ws.readyState !== WebSocket.OPEN) {
    logger.warn(`WebSocket connection not in OPEN state during initialization. State: ${ws.readyState}`);
    // For Twilio connections, the WebSocket should already be open when this handler is called
    // If it's not open, something went wrong
    logger.error('WebSocket connection is not ready for Twilio Media Stream');
    return;
  }

  // DO NOT send any initial messages - wait for Twilio to initiate the connection
  // Twilio Media Streams expect a specific protocol flow

  // Extract query parameters - handle multiple formats
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Try to get parameters from query string
  let callId = url.searchParams.get('callId');
  let conversationId = url.searchParams.get('conversationId');
  
  // If not found, try to get from URL path parameters
  if (!callId || !conversationId) {
    // Parse the path to extract parameters
    const pathMatch = req.url.match(/\/voice\/low-latency\/([\w-]+)\/([\w-]+)/);
    if (pathMatch && pathMatch.length >= 3) {
      if (!callId) callId = pathMatch[1];
      if (!conversationId) conversationId = pathMatch[2];
      logger.info(`Extracted parameters from URL path: callId=${callId}, conversationId=${conversationId}`);
    }
    
    // Also try to get from Express request params (should be populated by route with :callId and :conversationId)
    if ((!callId || !conversationId) && req.params) {
      if (!callId && req.params.callId) {
        callId = req.params.callId;
        logger.info(`Found callId in Express params: ${callId}`);
      }
      if (!conversationId && req.params.conversationId) {
        conversationId = req.params.conversationId;
        logger.info(`Found conversationId in Express params: ${conversationId}`);
      }
    }
  }
  
  // If not found, try to get from the Twilio WebSocket parameters
  if (!callId || !conversationId) {
    try {
      // Check for parameters in request object
      if ((req as any).twilio?.parameters) {
        // Look for both regular and custom parameter names
        const parameters = (req as any).twilio.parameters;
        
        // Try standard parameters
        if (!callId && parameters.callId) {
          callId = parameters.callId;
        }
        if (!conversationId && parameters.conversationId) {
          conversationId = parameters.conversationId;
        }
        
        // Try custom parameters (added as fallback)
        if (!callId && parameters.customCallId) {
          callId = parameters.customCallId;
        }
        if (!conversationId && parameters.customConversationId) {
          conversationId = parameters.customConversationId;
        }
      }
      
      // Also check if Twilio added them as properties directly on the req object
      if (!callId && (req as any).callId) {
        callId = (req as any).callId;
      }
      if (!conversationId && (req as any).conversationId) {
        conversationId = (req as any).conversationId;
      }
    } catch (error) {
      logger.warn('Error extracting Twilio parameters:', error);
    }
  }
  
  // Enhanced logging for debugging
  logger.info(`WebSocket connection attempt for low-latency stream`, {
    url: req.url,
    fullUrl: url.toString(),
    searchParams: Array.from(url.searchParams.entries()),
    callId,
    conversationId,
    headers: {
      host: req.headers.host,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']
    },
    hasParams: !!(callId && conversationId),
    pathParameters: req.params,
    extractionMethod: callId ? (url.searchParams.has('callId') ? 'query' : 
                              (req.params && req.params.callId ? 'express-params' : 
                              (req.url.includes(`/voice/low-latency/${callId}`) ? 'url-path' : 'twilio-params'))) : 'none'
  });
  
  if (!callId || !conversationId) {
    logger.error('Missing callId or conversationId in voice stream', {
      url: req.url,
      callId,
      conversationId,
      searchParams: Array.from(url.searchParams.entries())
    });
    
    // Close connection immediately with appropriate code for missing parameters
    // Don't send any custom messages as they're not part of Twilio Media Stream protocol
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1002, 'Missing required parameters');
    }
    return;
  }
  
  // Log successful parameter extraction
  logger.info(`WebSocket connection established successfully for Twilio Media Stream`, {
    callId,
    conversationId,
    readyState: ws.readyState,
    userAgent: req.headers['user-agent'],
    url: req.url
  });
  
  let call;
  let session;
  let config;
  let sdkService;
  let processingService;
  
  try {
    logger.info(`Low-latency voice stream started for call ${callId}, conversation ${conversationId}`, {
      callId,
      conversationId,
      userAgent: req.headers['user-agent'],
      url: req.url
    });
    
    // Setup WebSocket ping to keep connection alive (use native WebSocket ping, not JSON)
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Use native WebSocket ping instead of custom JSON message
          ws.ping();
        } catch (pingError) {
          logger.warn(`Failed to send native ping for call ${callId}:`, pingError);
        }
      }
    }, 30000); // Send ping every 30 seconds
    
    // Load all required resources in parallel for faster initialization
    const [callResult, configResult] = await Promise.all([
      Call.findById(callId),
      Configuration.findOne(),
    ]);
    
    call = callResult;
    config = configResult;
    
    if (!call) {
      logger.error(`No call found with ID ${callId} for streaming`);
      ws.close(1008, 'Call not found');
      return;
    }
    
    // Initialize the conversation session - use persistent conversation ID
    session = conversationEngine.getSession(conversationId);
    if (!session) {
      // Create a session with the exact conversationId passed from the client
      // This ensures voice settings and conversation context are maintained
      logger.info(`Creating new conversation session with persistent ID: ${conversationId}`);
      
      // Create the session directly with the provided conversationId instead of generating a new one
      const sessionCreated = await conversationEngine.createSessionWithId(
        conversationId,
        call.leadId.toString(), 
        call.campaignId.toString(),
        call.personalityId // Use the campaign voice ID stored in the call object
      );
      
      if (sessionCreated) {
        session = conversationEngine.getSession(conversationId);
        logger.info(`Successfully created persistent conversation session: ${conversationId}`);
      } else {
        logger.error(`Failed to create conversation session with ID: ${conversationId}`);
        ws.close(1008, 'Failed to create persistent conversation');
        return;
      }
    } else {
      logger.info(`Using existing conversation session: ${conversationId}`);
    }
    
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
    
    // Both ElevenLabs and Deepgram support streaming
    if (selectedTTSProvider !== 'elevenlabs' && selectedTTSProvider !== 'deepgram') {
      logger.error(`Streaming not yet supported for TTS provider: ${selectedTTSProvider}`);
      ws.close(1008, 'Streaming not supported for selected TTS provider');
      return;
    }

    logger.info(`Using ${selectedTTSProvider} for streaming TTS`, {
      provider: selectedTTSProvider
    });
    
    if (!session) {
      logger.error(`Failed to create or retrieve session for conversation ${conversationId}`);
      ws.close(1008, 'Session initialization failed');
      return;
    }
    
    // Get ElevenLabs SDK service (singleton)
    sdkService = getSDKService();
    if (!sdkService) {
      // Initialize the SDK service if not already
      const defaultProviderName = config.llmConfig.defaultProvider;
      const defaultProvider = config.llmConfig.providers.find(p => p.name === defaultProviderName);
      
      // Check if we have a configured LLM provider
      if (!defaultProvider || !defaultProvider.isEnabled) {
        logger.error(`Default LLM provider '${defaultProviderName}' not configured or not enabled for streaming`);
        
        // Try to find any enabled provider as a fallback
        const fallbackProvider = config.llmConfig.providers.find(p => p.isEnabled && p.apiKey);
        
        if (!fallbackProvider) {
          logger.error('No LLM provider configured for streaming', { callId, conversationId });
          
          // Close connection immediately without sending custom messages
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'LLM not configured');
          }
          return;
        }
        
        logger.info(`Using fallback LLM provider '${fallbackProvider.name}' for streaming`);
        
        // Initialize the SDK service with the fallback provider
        sdkService = require('../services/elevenlabsSDKService').initializeSDKService(
          config.elevenLabsConfig.apiKey,
          fallbackProvider.apiKey
        );
      } else {
        // Initialize the SDK service with the default provider
        logger.info(`Initializing SDK service with default provider '${defaultProvider.name}'`);
        
        sdkService = require('../services/elevenlabsSDKService').initializeSDKService(
          config.elevenLabsConfig.apiKey,
          defaultProvider.apiKey
        );
      }
      
      if (!sdkService) {
        logger.error('Failed to initialize ElevenLabs SDK service');
        ws.close(1008, 'Voice synthesis failed to initialize');
        return;
      }
    }      // Get or initialize parallel processing service
      processingService = getParallelProcessingService();
      if (!processingService) {
        // Create LLM service for parallel processing
        const llmConfig = {
          providers: config.llmConfig.providers,
          defaultProvider: config.llmConfig.defaultProvider
        };
        
        const llmService = new LLMService(llmConfig);
        
        // Store the LLM service in the config for shared access
        if (!config.llmConfig.llmService) {
          config.llmConfig.llmService = llmService;
        }
        
        // Initialize the parallel processing service
        processingService = initializeParallelProcessingService(sdkService, llmService);
    }
    
    // Set up event handlers for processing service
    processingService.on(ProcessingEvent.PROCESSING_START, (data) => {
      logger.debug(`Processing started for conversation ${conversationId}`);
    });
    
    processingService.on(ProcessingEvent.ERROR, (data) => {
      logger.error(`Processing error for conversation ${conversationId}: ${data.error}`);
    });
    
    // Check if we should generate opening message
    // The opening message is already sent by the voice webhook in the TwiML response
    // This WebSocket stream is for real-time conversation after the initial greeting
    // So we should NOT generate another opening message here
    const shouldGenerateOpening = false; // Always skip opening message in WebSocket stream
    
    if (shouldGenerateOpening) {
      try {
        // This code block should not execute in normal flow
        // since the voice webhook already handles the opening message
        
        // Generate opening message in parallel with voice synthesis setup
        const openingMessagePromise = conversationEngine.generateOpeningMessage(
          conversationId,
          "Customer", // Default name
          call.campaignId.toString()
        );
        
        // IMPORTANT: Skip opening message generation since it's now handled in TwiML
        // This prevents duplicate greetings and connection issues
        logger.info(`🎯 Skipping opening message generation for call ${callId} - already handled in TwiML`);
        
        // Get voice ID for voice synthesis - prioritize call's personalityId (campaign voice), then session personality
        const voiceId = call.personalityId || 
                        session.currentPersonality.voiceId || 
                        config.elevenLabsConfig.availableVoices[0].voiceId;
        
        // Log detailed voice debug information
        logger.info(`🎯 Voice Debug - Call personalityId (campaign voice): ${call.personalityId}`);
        logger.info(`🎯 Voice Debug - Session personality voiceId: ${session.currentPersonality.voiceId}`);
        logger.info(`🎯 Voice Debug - Config fallback voiceId: ${config.elevenLabsConfig.availableVoices[0].voiceId}`);
        logger.info(`🎯 Voice Debug - Final selected voiceId: ${voiceId}`);
        logger.info(`Using voice ID ${voiceId} for call ${callId}`);
        
        // No need to generate opening message - it's already played via TwiML
        // This WebSocket connection is now ready for the conversation flow
        } catch (error) {
        logger.error(`Error generating opening message for call ${callId}:`, error);
        
        // Fallback to simple greeting from cache
        try {
          // Use first common greeting phrase as fallback
          const fallbackGreeting = COMMON_PHRASES.GREETINGS[0];
          const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;
          
          // Try cache first
          const cacheKey = `${fallbackVoice}_${fallbackGreeting}`;
          if (responseCache.has(cacheKey)) {
            if (ws.readyState === WebSocket.OPEN) {
              sendAudioToTwilio(responseCache.get(cacheKey));
            }
          } else {
            // Generate simple greeting with optimized latency
            const buffer = await sdkService.generateOptimizedSpeech(
              fallbackGreeting,
              fallbackVoice,
              { 
                optimizationProfile: 'ultraLow',
                cacheAsPriority: true  // Cache this for future use
              }
            );
            
            if (ws.readyState === WebSocket.OPEN) {
              sendAudioToTwilio(buffer);
            }
          }
        } catch (fallbackError) {
          logger.error(`Fallback greeting failed for call ${callId}:`, fallbackError);
          ws.close(1011, 'Voice synthesis failed');
          return;
        }
      }
    }
    
    // Set up accumulated buffer for incoming audio
    let audioBuffer: Buffer[] = [];
    
    // Handle incoming audio data
    ws.on('message', async (data: WebSocket.Data) => {
      try {
        // Check WebSocket state before processing
        if (ws.readyState !== WebSocket.OPEN) {
          logger.warn(`WebSocket not open, skipping message processing for call ${callId}`);
          return;
        }

        // Parse Twilio Media Stream JSON message
        let audioData: Buffer | null = null;
        
        try {
          // Convert data to string and parse JSON
          const messageStr = data.toString();
          
          // Validate that we have a non-empty string
          if (!messageStr || messageStr.trim() === '') {
            logger.warn(`Received empty message for call ${callId}`);
            return;
          }
          
          const message = JSON.parse(messageStr);
          
          // Validate basic message structure
          if (!message || typeof message !== 'object') {
            logger.error(`Invalid message format for call ${callId}: not an object`);
            return;
          }
          
          // Handle Twilio stream start message - capture streamSid
          if (message.event === 'start') {
            streamSid = message.streamSid;
            logger.info(`Twilio stream started for call ${callId}, streamSid: ${streamSid}`, {
              streamSid,
              customParameters: message.start?.customParameters,
              mediaFormat: message.start?.mediaFormat
            });
            
            // Do NOT send any acknowledgment back to Twilio
            // Twilio Media Streams expect us to simply start processing
            // The next step is to wait for media messages or send our own media
            return;
          } else if (message.event === 'media' && message.media && message.media.payload) {
            // Only process media if we have streamSid
            if (!streamSid) {
              logger.warn(`Received media before start message for call ${callId}`);
              return;
            }
            
            // Decode base64 audio payload from Twilio
            audioData = Buffer.from(message.media.payload, 'base64');
            logger.debug(`Received Twilio media message with ${audioData.length} bytes for call ${callId}`);
          } else if (message.event === 'stop') {
            logger.info(`Twilio stream stopped for call ${callId}:`, message);
            streamSid = null; // Reset streamSid
            return;
          } else if (message.type === 'readyToListen') {
            // Handle readyToListen message from client
            logger.info(`Client ready to listen for call ${callId}`);
            // Don't send response messages to Twilio Media Streams
            // This type of message should not occur in Twilio streams
            return;
          } else {
            logger.debug(`Ignoring Twilio message type ${message.event || message.type} for call ${callId}`);
            return;
          }
        } catch (parseError) {
          logger.error(`Failed to parse Twilio message for call ${callId}:`, parseError);
          return;
        }

        // Process audio data if we have it
        if (audioData && audioData.length > 0) {
          // Accumulate audio data
          audioBuffer.push(audioData);
          
          // Accumulate larger audio chunks for better Deepgram transcription
          // Use larger buffer size for more reliable transcription (at least 1 second of audio)
          const bufferThreshold = 8000; // 1 second at 8kHz sample rate
          if (Buffer.concat(audioBuffer).length > bufferThreshold) {
            const completeAudio = Buffer.concat(audioBuffer);
            audioBuffer = []; // Reset buffer
            
            // Process the audio with speech recognition using Deepgram if available
            let transcribedText;
            let shouldProcessInput = true;
            
            // Get the speech analysis service from the conversation engine
            const speechAnalysisService = conversationEngine.getSpeechAnalysisService();
            
            try {
              // Try to transcribe using Deepgram
              if (config.deepgramConfig?.isEnabled && speechAnalysisService) {
                logger.info(`Using Deepgram for speech recognition in call ${callId}`);
                const transcriptionResult = await speechAnalysisService.transcribeAudio(completeAudio);
                transcribedText = transcriptionResult.transcript || "";
                
                // Use voice activity detection to determine if user is speaking
                const hasVoiceActivity = transcriptionResult.hasVoiceActivity;
                
                // Log the transcription details with voice activity information
                logger.info(`Deepgram transcription completed: "${transcribedText}" (Voice activity: ${hasVoiceActivity ? 'YES' : 'NO'})`);
                
                // Update user speaking state based on transcription
                // Only consider it real speech if we have actual transcribed content
                // Voice activity detection is supplementary - we trust Deepgram's transcription more
                if (transcribedText.trim()) {
                  // If we have actual speech content AND voice activity, confirm user is speaking
                  if (!session.userSpeaking) {
                    logger.info(`Speech detected for call ${callId}, entering listening mode`);
                    session.userSpeaking = true;
                    session.emptyTranscriptionCount = 0;
                    
                    // Don't send status messages to Twilio Media Streams
                    // These are internal state changes only
                  }
                } else {
                  // If we have empty transcriptions or no voice activity, user might have stopped speaking
                  if (session.emptyTranscriptionCount === undefined) {
                    session.emptyTranscriptionCount = 1;
                  } else {
                    session.emptyTranscriptionCount++;
                  }
                  
                  // After 3 empty transcriptions, consider user stopped speaking
                  if (session.emptyTranscriptionCount > 3 && session.userSpeaking) {
                    logger.info(`No speech detected for call ${callId}, exiting listening mode`);
                    session.userSpeaking = false;
                    session.emptyTranscriptionCount = 0;
                    
                    // Don't send status messages to Twilio Media Streams
                    // These are internal state changes only
                  }
                  
                  logger.debug(`Empty transcription detected for call ${callId}, skipping AI processing (count: ${session.emptyTranscriptionCount}, voice activity: ${hasVoiceActivity})`);
                  shouldProcessInput = false;
                }
                
                // Update session in memory (session is already updated by reference)
              } else {
                // Fallback to existing method
                logger.warn(`Deepgram not configured, using fallback for call ${callId}`);
                transcribedText = "I'm listening..."; // Default message when we receive audio but can't transcribe
              }
            } catch (transcriptionError) {
              logger.error(`Error in speech transcription for call ${callId}: ${transcriptionError.message}`);
              // Fallback to default message
              transcribedText = "Sorry, I couldn't hear you clearly.";
            }
            
            // Process the user input with parallel processing for minimal latency
            const voiceId = call.personalityId || 
                            session.currentPersonality.voiceId || 
                            config.elevenLabsConfig.availableVoices[0].voiceId;
            
            // Define callback to send audio chunks
            const streamCallback = (chunk: Buffer) => {
              try {
                if (ws.readyState === WebSocket.OPEN) {
                  sendAudioToTwilio(chunk);
                } else {
                  logger.warn(`Cannot send audio chunk, WebSocket not open for call ${callId}`);
                }
              } catch (sendError) {
                logger.error(`Error sending audio chunk for call ${callId}:`, sendError);
              }
            };
            
            // Only process non-empty transcriptions
            if (shouldProcessInput && transcribedText.trim()) {
              // Log that we're processing user speech
              logger.info(`Processing user speech for call ${callId}: "${transcribedText}"`);
              
              // Process user input with optimized parallel processing
              await processingService.processInputParallel(
                conversationId,
                transcribedText,
                voiceId,
                session.conversationHistory,
                {
                  streamCallback,
                  leadId: call.leadId.toString(),
                  campaignId: call.campaignId.toString(),
                  language: session.language || 'English',
                  useThinkingSounds: true,
                  streamPartialResponses: true,
                  optimizationProfile: 'balanced'  // Use balanced profile for normal conversation
                }
              );
              
              // Reset empty transcription count after successful processing
              session.emptyTranscriptionCount = 0;
              // Session is already updated by reference
            } else if (session.userSpeaking) {
              // If we're in listening mode but got an empty transcription, log it
              logger.info(`Agent is in listening mode for call ${callId}, waiting for clear speech (empty count: ${session.emptyTranscriptionCount || 0})`);
            } else {
              logger.debug(`Skipping AI processing for empty or filtered transcription in call ${callId} - shouldProcess: ${shouldProcessInput}, text: "${transcribedText}", userSpeaking: ${session.userSpeaking}`);
            }
          }
        } else {
          logger.debug(`No audio data to process for call ${callId}`);
        }
      } catch (parseError) {
        logger.error(`Failed to parse Twilio message for call ${callId}:`, parseError);
        return;
      }
    });
  
  // Handle WebSocket closure
  ws.on('close', async (code: number, reason: string) => {
    const reasonString = reason ? reason.toString() : 'No reason provided';
    logger.info(`WebSocket connection closed`, {
      callId,
      conversationId,
      code,
      reason: reasonString,
      connectionDuration: Date.now() - connectionStartTime
    });
    
    try {
      // Clean up resources as needed
      // Clear audio buffer without redeclaring it
      audioBuffer = [];
      
      // Clear ping interval
      if (pingInterval) {
        clearInterval(pingInterval);
      }
      
      // Log specific closure reasons for debugging
      if (code === 1006) {
        logger.warn(`Abnormal WebSocket closure detected for call ${callId}. This usually indicates:`, {
          possibleCauses: [
            'Network connectivity issues',
            'Server error during message processing', 
            'Invalid message format sent to Twilio',
            'Connection timeout'
          ],
          streamSid,
          lastActivity: Date.now()
        });
      } else if (code === 1011) {
        logger.warn(`WebSocket closed due to server error for call ${callId}: ${reasonString}`);
      } else if (code === 1000) {
        logger.info(`Normal WebSocket closure for call ${callId}`);
      } else if (code === 1002) {
        logger.error(`WebSocket closed due to protocol error for call ${callId}: ${reasonString}`);
      }
      
      // If the call is still in progress, we should mark this as an unexpected disconnection
      if (call && call.status === 'in-progress') {
        logger.warn(`WebSocket closed while call ${callId} was still in progress - this may cause call to hang up`, {
          callStatus: call.status,
          closeCode: code,
          streamSid
        });
      }
    } catch (error) {
      logger.error(`Error handling stream close for call ${callId}:`, error);
    }
  });
  
  // Handle errors with better diagnostics
  ws.on('error', (error: Error) => {
    logger.error(`WebSocket error for call ${callId}:`, {
      error: error.message,
      code: (error as any).code,
      stack: error.stack,
      streamSid,
      callId,
      conversationId
    });
    
    // For connection errors that might be recoverable, don't immediately close
    // Let Twilio retry the connection if needed
    const errorCode = (error as any).code;
    if (errorCode === 'ECONNRESET' || errorCode === 'EPIPE') {
      logger.warn(`Network error detected for call ${callId}, connection may be unstable`);
    }
  });  } catch (outerError) {
    logger.error(`Error in low-latency voice stream for call ${callId || 'unknown'}:`, outerError);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal server error');
    }
  }
};

/**
 * Trigger cache preloading on demand - can be called via API endpoint
 */

/**
 * Trigger cache preloading on demand - can be called via API endpoint
 */
export const triggerCachePreload = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get configuration
    const config = await Configuration.findOne();
    if (!config || !config.elevenLabsConfig.isEnabled) {
      logger.warn('ElevenLabs not configured, skipping cache preload');
      res.status(400).json({ success: false, message: 'ElevenLabs not configured' });
      return;
    }
    
    // Use the cache preloader utility
    const { preloadVoice, preloadAllVoices } = require('../utils/cachePreloader');
    
    // Start preloading in the background
    preloadAllVoices().then(result => {
      logger.info(`Cache preloading completed: ${result.voiceCount} voices, ${result.phrasesLoaded} phrases`);
    }).catch(error => {
      logger.error(`Cache preloading failed: ${error.message}`);
    });
    
    // Return success immediately since preloading runs in background
    res.status(200).json({ 
      success: true, 
      message: 'Cache preloading started in background',
      voiceCount: config.elevenLabsConfig.availableVoices.length
    });
  } catch (error) {
    logger.error(`Error triggering cache preload: ${error.message}`);
    res.status(500).json({ success: false, message: `Error: ${error.message}` });
  }
};

/**
 * Initialize the module
 * Pre-caches responses and sets up any needed resources
 */
export const initialize = async (): Promise<void> => {
  try {
    await initializeResponseCache();
    logger.info('Low-latency streaming controller initialized with response caching');
  } catch (error) {
    logger.error('Failed to initialize low-latency streaming controller', error);
  }
};

// Export controller functions
export default {
  handleLowLatencyVoiceStream,
  initialize
};
