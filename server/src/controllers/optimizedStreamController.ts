import { Request, Response } from 'express';
import WebSocket from 'ws';
import { logger } from '../index';
import Call from '../models/Call';
import Configuration from '../models/Configuration';
import { conversationEngine } from '../services/index';
import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import { getSDKService } from '../services/elevenlabsSDKService';
import { handleVoiceStream } from './streamController';
import responseCache from '../utils/responseCache';
import { v4 as uuidv4 } from 'uuid';

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

  // Extract query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const callId = url.searchParams.get('callId');
  const conversationId = url.searchParams.get('conversationId');
  
  if (!callId || !conversationId) {
    logger.error('Missing callId or conversationId in voice stream');
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
    
    if (!config || !config.elevenLabsConfig.isEnabled) {
      logger.error('ElevenLabs not configured for streaming');
      ws.close(1008, 'Voice synthesis not configured');
      return;
    }
    
    // Get ElevenLabs SDK service (singleton)
    sdkService = getSDKService();
    if (!sdkService) {
      // Initialize the SDK service if not already
      const openAIProvider = config.llmConfig.providers.find(p => p.name === 'openai');
      if (!openAIProvider || !openAIProvider.isEnabled) {
        logger.error('OpenAI LLM not configured for streaming');
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
    
    // Initialize Enhanced Voice AI service as well (for compatibility)
    voiceAI = new EnhancedVoiceAIService(
      config.elevenLabsConfig.apiKey
    );
    
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
    
    // Generate initial greeting if this is the first interaction
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
        
        // First try to get from cache (for common greetings)
        const cacheKey = `${voiceId}_${openingMessage}`;
        if (responseCache.has(cacheKey)) {
          logger.info(`Using cached greeting for call ${callId}`);
          const cachedAudio = responseCache.get(cacheKey);
          sendAudioToTwilio(cachedAudio);
        } else {
          // Use streaming synthesis for optimal latency
          logger.info(`Streaming opening message audio for call ${callId}`);
          
          // Define callback to send chunks as they arrive
          const onAudioChunk = (chunk: Buffer) => {
            sendAudioToTwilio(chunk);
          };
          
          // Stream the audio response
          await sdkService.streamSpeechGeneration(
            openingMessage,
            voiceId,
            onAudioChunk,
            { optimizeLatency: true },
            conversationId  // Pass the persistent conversation ID
          );
        }
      } catch (error) {
        logger.error(`Error generating opening message for call ${callId}:`, error);
        
        // Fallback to simple greeting from cache
        try {
          const fallbackGreeting = "";
          const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;
          
          // Try cache first
          const cacheKey = `${fallbackVoice}_${fallbackGreeting}`;
          if (responseCache.has(cacheKey)) {
            sendAudioToTwilio(responseCache.get(cacheKey));
          } else {
            // Generate simple speech
            const fallbackResponse = await voiceAI.synthesizeSimpleSpeech(fallbackGreeting, fallbackVoice);
            if (fallbackResponse) {
              sendAudioToTwilio(fallbackResponse);
            } else {
              throw new Error('Fallback speech generation failed');
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
        // Process as binary data
        if (data instanceof Buffer) {
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
                transcribedText = await speechAnalysisService.transcribeAudio(completeAudio);
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
    logger.error(`Error in optimized voice stream for call ${callId}:`, error);
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

// Export enhanced controller functions
export default {
  handleOptimizedVoiceStream,
  handleVoiceStream, // Keep original for backward compatibility
  initialize
};
