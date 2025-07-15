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
import WebSocket from 'ws';
import { logger } from '../index';
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
  /**
   * Helper function to send audio data to Twilio in the required JSON format
   */
  const sendAudioToTwilio = (audioData: Buffer) => {
    const message = {
      event: 'media',
      media: {
        payload: audioData.toString('base64')
      }
    };
    ws.send(JSON.stringify(message));
  };

  // Add proper WebSocket ready state check and error handling
  if (ws.readyState !== WebSocket.OPEN) {
    logger.warn('WebSocket connection not in OPEN state during initialization');
    return;
  }

  // Send immediate acknowledgment to complete handshake
  try {
    ws.send(JSON.stringify({ 
      event: 'connected', 
      message: 'WebSocket connection established',
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    logger.error('Failed to send initial WebSocket message:', error);
    return;
  }

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
    
    // Instead of immediately closing, send an error message
    try {
      ws.send(JSON.stringify({
        event: 'error',
        message: 'Missing required parameters: callId and conversationId are required for voice streaming',
        errorCode: 'MISSING_PARAMS',
        timestamp: new Date().toISOString()
      }));
      
      // Don't close immediately - delay to allow error message to be sent
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1008, 'Missing required parameters');
        }
      }, 500);
      
    } catch (error) {
      logger.error('Failed to send error message over WebSocket:', error);
      ws.close(1008, 'Missing required parameters');
    }
    
    return;
  }
  
  let call;
  let session;
  let config;
  let sdkService;
  let processingService;
  
  try {
    logger.info(`Low-latency voice stream started for call ${callId}, conversation ${conversationId}`);
    
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
    
    if (!config || !config.elevenLabsConfig.isEnabled) {
      logger.error('ElevenLabs not configured for streaming');
      ws.close(1008, 'Voice synthesis not configured');
      return;
    }
    
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
          ws.send(JSON.stringify({
            event: 'error',
            message: 'No LLM provider configured for streaming',
            errorCode: 'LLM_NOT_CONFIGURED',
            timestamp: new Date().toISOString()
          }));
          
          setTimeout(() => {
            ws.close(1008, 'LLM not configured');
          }, 500);
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
        
        // Wait for opening message
        const openingMessage = await openingMessagePromise;
        
        // Validate opening message
        if (!openingMessage || typeof openingMessage !== 'string' || openingMessage.trim() === '') {
          logger.error(`Invalid opening message for call ${callId}: ${JSON.stringify(openingMessage)}`);
          throw new Error('Opening message is invalid or empty');
        }
        
        logger.info(`📝 Opening message for call ${callId}: "${openingMessage}"`);
        
        // Define callback to send audio chunks
        const streamCallback = (chunk: Buffer) => {
          sendAudioToTwilio(chunk);
        };
        
        // Process the opening message - use direct speech synthesis instead of AI processing
        // since the opening message is already generated
        await sdkService.streamOptimizedSpeech(
          openingMessage,
          voiceId,
          streamCallback,
          { 
            optimizationProfile: 'low', // Use low latency profile for greetings
            cacheResult: openingMessage.length < 100, // Cache shorter greetings
            conversationId: conversationId
          }
        );
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
          const message = JSON.parse(messageStr);
          
          // Handle media messages with audio payload
          if (message.event === 'media' && message.media && message.media.payload) {
            // Decode base64 audio payload from Twilio
            audioData = Buffer.from(message.media.payload, 'base64');
            logger.debug(`Received Twilio media message with ${audioData.length} bytes for call ${callId}`);
          } else if (message.event === 'start') {
            logger.info(`Twilio stream started for call ${callId}:`, message);
            return;
          } else if (message.event === 'stop') {
            logger.info(`Twilio stream stopped for call ${callId}:`, message);
            return;
          } else if (message.type === 'readyToListen') {
            // Handle readyToListen message from client
            logger.info(`Client ready to listen for call ${callId}`);
            ws.send(JSON.stringify({
              type: 'listening',
              conversationId
            }));
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
          }
        } else {
          logger.debug(`No audio data to process for call ${callId}`);
        }
      } catch (error) {
        logger.error(`Error processing voice stream data for call ${callId}:`, error);
      }
    });
    
    // Handle WebSocket closure
    ws.on('close', async (code: number, reason: string) => {
      logger.info(`Voice stream closed for call ${callId}: ${code} ${reason}`);
      
      try {
        // Clean up resources as needed
        audioBuffer = []; // Clear buffer
      } catch (error) {
        logger.error(`Error handling stream close for call ${callId}:`, error);
      }
    });
    
    // Handle errors
    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for call ${callId}:`, error);
      ws.close(1011, 'Internal server error');
    });
    
  } catch (error) {
    logger.error(`Error in low-latency voice stream for call ${callId}:`, error);
    ws.close(1011, 'Internal server error');
  }
};

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
