import { Request, Response } from 'express';
import WebSocket from 'ws';
import { logger } from '../index';
import Call from '../models/Call';
import Configuration from '../models/Configuration';
import { conversationEngine } from '../services/index';
import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import { v4 as uuidv4 } from 'uuid';

/**
 * WebSocket handler for voice streaming
 * This is the main handler for real-time voice communication during calls
 */
export const handleVoiceStream = async (ws: WebSocket, req: Request): Promise<void> => {
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
  
  try {
    logger.info(`Voice stream started for call ${callId}, conversation ${conversationId}`);
    
    // Get the call from database
    call = await Call.findById(callId);
    if (!call) {
      logger.error(`No call found with ID ${callId} for streaming`);
      ws.close(1008, 'Call not found');
      return;
    }
    
    // Get system configuration
    config = await Configuration.findOne();
    if (!config || !config.elevenLabsConfig.isEnabled) {
      logger.error('ElevenLabs not configured for streaming');
      ws.close(1008, 'Voice synthesis not configured');
      return;
    }
    
    // Initialize voice synthesis service
    const openAIProvider = config.llmConfig.providers.find(p => p.name === 'openai');
    if (!openAIProvider || !openAIProvider.isEnabled) {
      logger.error('OpenAI LLM not configured for streaming');
      ws.close(1008, 'LLM not configured');
      return;
    }
    
    // Get or create conversation session
    session = conversationEngine.getSession(conversationId);
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
    
    // Initialize ElevenLabs for voice synthesis
    voiceAI = new EnhancedVoiceAIService(
      config.elevenLabsConfig.apiKey
    );
    
    // Generate initial greeting if this is the first interaction
    if (session.conversationHistory.length === 0) {
      try {
        // Generate opening message
        const openingMessage = await conversationEngine.generateOpeningMessage(
          conversationId,
          "Customer", // Default name
          call.campaignId.toString()
        );
        
        // Ensure we're using a valid voice ID - prioritize call's personalityId (campaign voice)
        const voiceId = call.personalityId || 
                        session.currentPersonality.voiceId || 
                        config.elevenLabsConfig.availableVoices[0].voiceId;
        
        // Log which voice we're using
        logger.info(`Using voice ID ${voiceId} for call ${callId}`);
        
        // Synthesize speech using ElevenLabs with robust error handling
        try {
          const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
            text: openingMessage,
            personalityId: voiceId,
            language: session.language || 'English'
          });
          
          // Send synthesized audio through WebSocket
          if (speechResponse && speechResponse.audioContent) {
            logger.info(`Sending opening message audio to client for call ${callId}`);
            ws.send(speechResponse.audioContent);
          } else {
            throw new Error('No audio content returned from synthesizeAdaptiveVoice');
          }
        } catch (voiceError) {
          logger.error(`Error in adaptive voice synthesis for call ${callId}:`, voiceError);
          
          // Fallback to simpler method of speech synthesis
          try {
            logger.info(`Attempting fallback voice synthesis for call ${callId}`);
            const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;
            const fallbackResponse = await voiceAI.synthesizeSimpleSpeech(openingMessage, fallbackVoice);
            
            if (fallbackResponse) {
              logger.info(`Sending fallback speech for call ${callId}`);
              ws.send(fallbackResponse);
            } else {
              logger.error(`Fallback synthesis returned no audio for call ${callId}`);
              throw new Error('Fallback synthesis returned no audio');
            }
          } catch (fallbackError) {
            logger.error(`Fallback synthesis failed for call ${callId}:`, fallbackError);
            ws.close(1011, 'Voice synthesis failed');
            return;
          }
        }
      } catch (error) {
        logger.error(`Error generating opening message for call ${callId}:`, error);
        ws.close(1011, 'Failed to generate opening message');
        return;
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
              // Get dynamic transcription from configuration
              const config = await Configuration.findOne();
              
              // Try to transcribe using Deepgram
              if (config?.deepgramConfig?.isEnabled && speechAnalysisService) {
                logger.info(`Using Deepgram for speech recognition in call ${callId}`);
                transcribedText = await speechAnalysisService.transcribeAudio(completeAudio);
              } else {
                // Fallback to existing method
                logger.warn(`Deepgram not configured, using fallback for call ${callId}`);
                if (!config?.generalSettings?.defaultSystemPrompt) {
                  throw new Error('No speech recognition configuration available');
                }
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
                aiResponse = await conversationEngine.processUserInput(
                  conversationId, 
                  transcribedText
                );
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
              aiResponse = await conversationEngine.processUserInput(
                conversationId, 
                transcribedText
              );
            }
            
            // Use the same voice ID that worked for the opening message - prioritize call's personalityId (campaign voice)
            const voiceId = call.personalityId || 
                            session.currentPersonality.voiceId || 
                            config.elevenLabsConfig.availableVoices[0].voiceId;
            
            try {
              // Synthesize speech using ElevenLabs
              const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
                text: aiResponse.text,
                personalityId: voiceId,
                language: session.language || 'English'
              });
              
              // Send synthesized audio back through WebSocket
              if (speechResponse && speechResponse.audioContent) {
                ws.send(speechResponse.audioContent);
              } else {
                throw new Error('No audio content returned for response');
              }
            } catch (voiceError) {
              logger.error(`Error in response voice synthesis for call ${callId}:`, voiceError);
              
              // Fallback to simpler method
              try {
                const fallbackVoice = config.elevenLabsConfig.availableVoices[0].voiceId;
                const fallbackResponse = await voiceAI.synthesizeSimpleSpeech(aiResponse.text, fallbackVoice);
                
                if (fallbackResponse) {
                  ws.send(fallbackResponse);
                }
              } catch (fallbackError) {
                logger.error(`Fallback synthesis failed for response in call ${callId}:`, fallbackError);
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
        // Update call status if needed
        if (call && call.status === 'in-progress') {
          // Don't end the call just because the stream ended
          // The call may continue via other channels
        }
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
    logger.error(`Error in voice stream for call ${callId}:`, error);
    ws.close(1011, 'Internal server error');
  }
};

/**
 * WebSocket handler for ElevenLabs Conversational AI
 * Provides real-time streaming with interruption support
 */
export const handleConversationalAIStream = async (ws: WebSocket, req: Request): Promise<void> => {
  // Extract query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const conversationId = url.searchParams.get('conversationId') || uuidv4();
  const voiceId = url.searchParams.get('voiceId');
  
  if (!voiceId) {
    logger.error('Missing voiceId in conversational AI stream');
    ws.close(1008, 'Missing required parameters');
    return;
  }
  
  let voiceAI: EnhancedVoiceAIService | null = null;
  let config;
  let isProcessing = false;
  
  try {
    logger.info(`Conversational AI stream started: ${conversationId}`);
    
    // Get system configuration
    config = await Configuration.findOne();
    if (!config || !config.elevenLabsConfig.isEnabled) {
      logger.error('ElevenLabs not configured for conversational AI');
      ws.close(1008, 'Voice synthesis not configured');
      return;
    }
    
    // Initialize voice synthesis service
    const openAIProvider = config.llmConfig.providers.find(p => p.name === 'openai');
    if (!config.elevenLabsConfig.apiKey || !openAIProvider?.apiKey) {
      logger.error('Missing API keys for conversational AI');
      ws.close(1008, 'Service not configured properly');
      return;
    }
    
    // Create voice AI service instance
    voiceAI = new EnhancedVoiceAIService(
      config.elevenLabsConfig.apiKey
    );
    
    // Initialize conversational settings from configuration
    const conversationalSettings = config.voiceAIConfig?.conversationalAI || {
      enabled: true,
      useSDK: true,
      interruptible: true,
      adaptiveTone: true,
      naturalConversationPacing: true
    };
    
    // Send ready message
    ws.send(JSON.stringify({
      type: 'ready',
      conversationId,
      settings: conversationalSettings
    }));
    
    // Check if this is a new connection - if so, send the initial script message
    // first before waiting for user input
    try {
      // Get campaign ID from request parameters if available
      const campaignId = url.searchParams.get('campaignId');
      
      if (campaignId) {
        // Get campaign to retrieve initial script/prompt
        const Campaign = require('../models/Campaign').default;
        const campaign = await Campaign.findById(campaignId);
        
        if (campaign && campaign.script?.versions?.length > 0) {
          // Get the active script version or use the first one
          const activeScript = campaign.script.versions.find(v => v.isActive) || campaign.script.versions[0];
          
          if (activeScript?.content) {
            logger.info(`Sending initial script for conversation ${conversationId}`);
            
            // Generate initial message from script
            const initialMessage = activeScript.content.trim();
            
            // Send script as a message type first
            ws.send(JSON.stringify({
              type: 'initialScript',
              text: initialMessage,
              conversationId
            }));
            
            // Start processing flag to prevent other processing while synthesizing
            isProcessing = true;
            
            // Collect audio chunks
            const audioChunks: Buffer[] = [];
            
            // Start conversation with streaming
            await voiceAI.createRealisticConversation(
              initialMessage,
              voiceId,
              {
                conversationId,
                language: campaign.primaryLanguage || 'English',
                interruptible: conversationalSettings.interruptible,
                contextAwareness: true,
                modelId: conversationalSettings.defaultModelId || 'eleven_multilingual_v2',
                onAudioChunk: (chunk: Buffer) => {
                  // Send audio chunk to client
                  ws.send(chunk);
                  audioChunks.push(chunk);
                },
                onInterruption: () => {
                  ws.send(JSON.stringify({
                    type: 'interrupted',
                    conversationId
                  }));
                },
                onCompletion: (response) => {
                  ws.send(JSON.stringify({
                    type: 'completed',
                    conversationId,
                    interrupted: response.interrupted || false,
                    metadata: response.metadata || {}
                  }));
                  isProcessing = false;
                }
              }
            ).catch((error) => {
              logger.error(`Error sending initial script: ${error.message}`);
              isProcessing = false;
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error sending initial script: ${error.message}`);
      isProcessing = false;
    }
    
    // Handle messages from client
    ws.on('message', async (message: WebSocket.Data) => {
      try {
        // Skip if already processing a message
        if (isProcessing) {
          logger.info(`Skipping message, already processing: ${conversationId}`);
          return;
        }
        
        isProcessing = true;
        const data = JSON.parse(message.toString());
        
        // Handle interruption request
        if (data.type === 'interrupt') {
          if (voiceAI) {
            // Use the underlying service to interrupt the stream
            let interrupted = false;
            try {
              // Try to interrupt using the conversational service
              if (voiceAI['conversationalService']) {
                interrupted = voiceAI['conversationalService'].interruptStream(conversationId);
              } else if (voiceAI['sdkService']) {
                interrupted = voiceAI['sdkService'].interruptStream(conversationId);
              }
            } catch (error) {
              logger.warn(`Failed to interrupt conversation ${conversationId}:`, error);
            }
            
            ws.send(JSON.stringify({
              type: 'interrupted',
              success: interrupted,
              conversationId
            }));
          }
          isProcessing = false;
          return;
        }
        
        // Handle text input
        if (data.type === 'text') {
          const text = data.text;
          if (!text) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'No text provided'
            }));
            isProcessing = false;
            return;
          }
          
          // Detect language
          const language = data.language || 'English';
          
          // Start streaming response
          ws.send(JSON.stringify({
            type: 'processing',
            conversationId
          }));
          
          // Collect audio chunks
          const audioChunks: Buffer[] = [];
          
          // Start conversation with streaming
          voiceAI.createRealisticConversation(
            text,
            voiceId,
            {
              conversationId,
              language: language,
              interruptible: conversationalSettings.interruptible,
              contextAwareness: true,
              modelId: conversationalSettings.defaultModelId || 'eleven_multilingual_v2',
              onAudioChunk: (chunk: Buffer) => {
                // Send audio chunk to client
                ws.send(chunk);
                audioChunks.push(chunk);
              },
              onInterruption: () => {
                ws.send(JSON.stringify({
                  type: 'interrupted',
                  conversationId
                }));
              },
              onCompletion: (response) => {
                ws.send(JSON.stringify({
                  type: 'completed',
                  conversationId,
                  interrupted: response.interrupted || false,
                  metadata: response.metadata || {}
                }));
                isProcessing = false;
              }
            }
          ).catch((error) => {
            logger.error(`Error in conversational AI: ${error.message}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message
            }));
            isProcessing = false;
          });
        }
      } catch (error: any) {
        logger.error(`Error processing message: ${error.message}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message'
        }));
        isProcessing = false;
      }
    });
    
    // Handle connection close
    ws.on('close', () => {
      logger.info(`Conversational AI stream closed: ${conversationId}`);
      // Clean up resources if needed
      if (voiceAI) {
        try {
          // Try to interrupt using the underlying service
          if (voiceAI['conversationalService']) {
            voiceAI['conversationalService'].closeConversation(conversationId);
          } else if (voiceAI['sdkService']) {
            voiceAI['sdkService'].closeConversation(conversationId);
          }
        } catch (error) {
          logger.warn(`Failed to close conversation ${conversationId}:`, error);
        }
      }
    });
    
  } catch (error: any) {
    logger.error(`Conversational AI stream error: ${error.message}`);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Internal server error'
    }));
    ws.close(1011, 'Internal server error');
  }
};
