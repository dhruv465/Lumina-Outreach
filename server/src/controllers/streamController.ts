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
  /**
   * Helper function to send audio data to Twilio in the required JSON format
   */
  // Store Twilio stream information
  let streamSid: string | null = null;
  let sequenceNumber = 0;
  let pendingOpeningMessage: { text: string; voiceId: string } | null = null;
  
  const sendAudioToTwilio = (audioData: Buffer) => {
    if (!streamSid) {
      logger.warn('Cannot send audio: streamSid not available yet');
      return;
    }
    
    const message = {
      event: 'media',
      streamSid: streamSid,
      media: {
        track: 'outbound',
        chunk: (++sequenceNumber).toString(),
        timestamp: Date.now().toString(),
        payload: audioData.toString('base64')
      }
    };
    
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      logger.error(`Failed to send audio to Twilio: ${error}`);
    }
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
    // Check if TTS is properly configured based on selected provider
    const selectedTTSProvider = config?.ttsConfig?.provider || 'elevenlabs';
    const isTTSConfigured = selectedTTSProvider === 'elevenlabs' 
      ? config?.elevenLabsConfig?.isEnabled && config?.elevenLabsConfig?.apiKey
      : config?.ttsConfig?.deepgramTTS?.isEnabled && config?.ttsConfig?.deepgramTTS?.apiKey;
    
    if (!config || !isTTSConfigured) {
      logger.warn(`TTS provider ${selectedTTSProvider} not configured for streaming, will attempt fallback`);
      // Don't terminate the call - we'll try fallbacks during actual synthesis
    } else {
      // Both ElevenLabs and Deepgram support streaming
      if (selectedTTSProvider !== 'elevenlabs' && selectedTTSProvider !== 'deepgram') {
        logger.warn(`Streaming not yet supported for TTS provider: ${selectedTTSProvider}, will use fallbacks`);
        // Don't terminate the call - we'll try fallbacks during actual synthesis
      }
    }

    logger.info(`Using ${selectedTTSProvider} for streaming TTS`, {
      provider: selectedTTSProvider
    });
    
    // Initialize voice synthesis service
    const openAIProvider = config?.llmConfig?.providers?.find(p => p.name === 'openai');
    if (!openAIProvider || !openAIProvider.isEnabled) {
      logger.warn('OpenAI LLM not configured for streaming, call may have limited functionality but will continue');
      // Don't terminate the call - the conversation engine may have other LLM providers or fallbacks
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
    
    // Initialize voice synthesis service only if using ElevenLabs
    if (selectedTTSProvider === 'elevenlabs') {
      voiceAI = new EnhancedVoiceAIService(
        config.elevenLabsConfig.apiKey
      );
    }
    
    // Generate initial greeting if this is the first interaction
    if (session.conversationHistory.length === 0) {
      const text = await conversationEngine.generateOpeningMessage(conversationId, 'Customer', call.campaignId.toString());
      
      // Select appropriate voice ID based on the selected TTS provider
      let voiceId;
      if (call.personalityId) {
        voiceId = call.personalityId;
      } else if (session.currentPersonality.voiceId) {
        voiceId = session.currentPersonality.voiceId;
      } else {
        // Use provider-appropriate default voice
        if (selectedTTSProvider === 'deepgram') {
          voiceId = config?.ttsConfig?.deepgramTTS?.defaultModel || 'aura-2-thalia-en';
        } else {
          voiceId = config?.elevenLabsConfig?.selectedVoiceId || 
                   config?.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 
                   'default-voice-id';
        }
      }
      
      pendingOpeningMessage = { text, voiceId };
    }
    
    // Set up accumulated buffer for incoming audio
    let audioBuffer: Buffer[] = [];
    
    // Handle incoming audio data
    ws.on('message', async (data: WebSocket.Data) => {
      try {
        // Check if it's a text message from Twilio (JSON)
        if (typeof data === 'string' || (data instanceof Buffer && data.length < 1000)) {
          const textData = typeof data === 'string' ? data : data.toString('utf8');
          
          try {
            const jsonMessage = JSON.parse(textData);
            
            if (jsonMessage.event === 'start') {
              streamSid = jsonMessage.start.streamSid;
              logger.info(`Media stream started, streamSid=${streamSid}`);
              if (pendingOpeningMessage) {
                const { text, voiceId } = pendingOpeningMessage;
                try {
                  let audioSent = false;
                  
                  if (selectedTTSProvider === 'elevenlabs') {
                    // Initialize voiceAI service if not already initialized
                    if (!voiceAI) {
                      voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
                    }
                    const audio = await voiceAI.synthesizeSimpleSpeech(text, voiceId);
                    if (audio) {
                      sendAudioToTwilio(audio);
                      audioSent = true;
                    } else {
                      logger.warn(`ElevenLabs TTS returned no audio content for opening message in call ${callId}`);
                    }
                  } else if (selectedTTSProvider === 'deepgram') {
                    // Use Deepgram TTS for opening message
                    const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
                    const speechResponse = await synthesizeSpeechWithProvider(
                      config,
                      text,
                      voiceId,
                      'en',
                      { encoding: 'linear16', sampleRate: 8000 }
                    );
                    if (speechResponse?.audioContent) {
                      sendAudioToTwilio(speechResponse.audioContent);
                      audioSent = true;
                    } else {
                      logger.warn(`Deepgram TTS failed for opening message, attempting fallback for call ${callId}`);
                    }
                  }
                  
                  // Only attempt ElevenLabs fallback if the selected provider actually failed AND ElevenLabs is available
                  if (!audioSent && selectedTTSProvider !== 'elevenlabs' && config?.elevenLabsConfig?.apiKey) {
                    logger.info(`Primary TTS provider ${selectedTTSProvider} failed, using ElevenLabs fallback for opening message in call ${callId}`);
                    try {
                      if (!voiceAI) {
                        voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
                      }
                      const fallbackVoice = config.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 'default-voice-id';
                      const fallbackAudio = await voiceAI.synthesizeSimpleSpeech(text, fallbackVoice);
                      if (fallbackAudio) {
                        sendAudioToTwilio(fallbackAudio);
                        audioSent = true;
                      }
                    } catch (fallbackError) {
                      logger.error(`ElevenLabs fallback also failed for opening message in call ${callId}:`, fallbackError);
                    }
                  }
                  
                  if (!audioSent) {
                    logger.warn(`All TTS providers failed for opening message in call ${callId}, continuing without audio`);
                  }
                } catch (e) { 
                  logger.error(`Error in opening message synthesis for call ${callId}:`, e);
                }
                pendingOpeningMessage = null;
              }
              return;
            }
          } catch (parseError) {
            // Not valid JSON, continue to process as binary
          }
        }
        
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
                const transcriptionResult = await speechAnalysisService.transcribeAudio(completeAudio);
                transcribedText = transcriptionResult.transcript || "";
                
                // Log the transcription details
                if (transcriptionResult.transcript) {
                  logger.info(`Transcription: "${transcriptionResult.transcript.substring(0, 100)}..." (confidence: ${transcriptionResult.confidence}, language: ${transcriptionResult.language})`);
                }
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
            
            // Use appropriate voice ID based on the selected TTS provider
            let voiceId;
            if (call.personalityId) {
              voiceId = call.personalityId;
            } else if (session.currentPersonality.voiceId) {
              voiceId = session.currentPersonality.voiceId;
            } else {
              // Use provider-appropriate default voice
              if (selectedTTSProvider === 'deepgram') {
                voiceId = config?.ttsConfig?.deepgramTTS?.defaultModel || 'aura-2-thalia-en';
              } else {
                voiceId = config?.elevenLabsConfig?.selectedVoiceId || 
                         config?.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 
                         'default-voice-id';
              }
            }
            
            try {
              let audioSent = false;
              
              if (selectedTTSProvider === 'elevenlabs') {
                // Initialize voiceAI service if not already initialized
                if (!voiceAI) {
                  voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
                }
                // Synthesize speech using ElevenLabs
                const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
                  text: aiResponse.text,
                  personalityId: voiceId,
                  language: session.language || 'English'
                });
                
                // Send synthesized audio back through WebSocket
                if (speechResponse && speechResponse.audioContent) {
                  sendAudioToTwilio(speechResponse.audioContent);
                  audioSent = true;
                } else {
                  logger.warn(`ElevenLabs TTS returned no audio content for call ${callId}`);
                }
              } else if (selectedTTSProvider === 'deepgram') {
                // Use Deepgram TTS for response
                const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
                const speechResponse = await synthesizeSpeechWithProvider(
                  config,
                  aiResponse.text,
                  voiceId,
                  session.language === 'Hindi' ? 'hi' : 'en',
                  { encoding: 'linear16', sampleRate: 8000 }
                );
                
                if (speechResponse?.audioContent) {
                  sendAudioToTwilio(speechResponse.audioContent);
                  audioSent = true;
                } else {
                  logger.warn(`Deepgram TTS failed for response, attempting fallback for call ${callId}`);
                }
              } else {
                logger.warn(`TTS provider ${selectedTTSProvider} not properly configured for call ${callId}`);
              }
              
              // Only attempt ElevenLabs fallback if the primary provider actually failed AND it's not ElevenLabs
              if (!audioSent && selectedTTSProvider !== 'elevenlabs' && config?.elevenLabsConfig?.apiKey) {
                logger.info(`Primary TTS provider ${selectedTTSProvider} failed, using ElevenLabs fallback for response in call ${callId}`);
                try {
                  if (!voiceAI) {
                    voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
                  }
                  const fallbackVoice = config.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 'default-voice-id';
                  const fallbackResponse = await voiceAI.synthesizeSimpleSpeech(aiResponse.text, fallbackVoice);
                  
                  if (fallbackResponse) {
                    sendAudioToTwilio(fallbackResponse);
                    audioSent = true;
                  }
                } catch (fallbackError) {
                  logger.error(`ElevenLabs fallback synthesis failed for response in call ${callId}:`, fallbackError);
                }
              }
              
              if (!audioSent) {
                logger.warn(`All TTS providers failed for response in call ${callId}, continuing without audio`);
              }
            } catch (voiceError) {
              logger.error(`Error in response voice synthesis for call ${callId}:`, voiceError);
              
              // Final fallback attempt with ElevenLabs if available and primary provider is not ElevenLabs
              if (selectedTTSProvider !== 'elevenlabs' && config?.elevenLabsConfig?.apiKey) {
                try {
                  logger.info(`Final ElevenLabs fallback attempt for call ${callId}`);
                  if (!voiceAI) {
                    voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
                  }
                  const fallbackVoice = config.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 'default-voice-id';
                  if (fallbackVoice) {
                    const fallbackResponse = await voiceAI.synthesizeSimpleSpeech(aiResponse.text, fallbackVoice);
                    
                    if (fallbackResponse) {
                      sendAudioToTwilio(fallbackResponse);
                    }
                  }
                } catch (finalFallbackError) {
                  logger.error(`Final fallback synthesis failed for response in call ${callId}:`, finalFallbackError);
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
  let selectedTTSProvider: string;
  
  try {
    logger.info(`Conversational AI stream started: ${conversationId}`);
    
    // Get system configuration
    config = await Configuration.findOne();
    selectedTTSProvider = config?.ttsConfig?.provider || 'elevenlabs';
    
    // Note: Conversational AI streaming is primarily an ElevenLabs feature
    if (!config || (selectedTTSProvider === 'elevenlabs' && !config.elevenLabsConfig.isEnabled)) {
      logger.warn('ElevenLabs not configured for conversational AI, will use basic streaming');
      // Don't terminate - we'll fallback to basic streaming instead of conversational AI
    }
    
    // Initialize voice synthesis service
    const openAIProvider = config?.llmConfig?.providers?.find(p => p.name === 'openai');
    if (!config?.elevenLabsConfig?.apiKey || !openAIProvider?.apiKey) {
      logger.warn('Missing API keys for conversational AI, will use basic functionality');
      // Don't terminate - we'll use basic streaming capabilities instead
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
            
            // Only use ElevenLabs conversational AI features when using ElevenLabs
            if (selectedTTSProvider === 'elevenlabs' && voiceAI) {
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
                    // Send audio chunk to client in Twilio format
                    const message = {
                      event: 'media',
                      media: {
                        payload: chunk.toString('base64')
                      }
                    };
                    ws.send(JSON.stringify(message));
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
                      type: 'utteranceCompleted',
                      scope: 'opening',
                      conversationId,
                      interrupted: response.interrupted || false,
                      metadata: response.metadata || {}
                    }));
                    
                    // After the opening message is complete, explicitly transition to listening state
                    // This ensures the agent continues the conversation
                    setTimeout(() => {
                      ws.send(JSON.stringify({
                        type: 'listening',
                        conversationId
                      }));
                      logger.info(`Transitioned to listening state after initial script for conversation ${conversationId}`);
                      isProcessing = false;
                    }, 500); // Small delay to ensure client has processed completion
                  }
                }
              ).catch((error) => {
                logger.error(`Error sending initial script: ${error.message}`);
                isProcessing = false;
              });
            } else {
              // For non-ElevenLabs providers, just send initial script as text
              logger.info(`Conversational AI streaming not available for ${selectedTTSProvider}, sending script as text`);
              isProcessing = false;
            }
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
        
        // Handle readyToListen message from client
        if (data.type === 'readyToListen') {
          logger.info(`Client ready to listen for conversation ${conversationId}`);
          ws.send(JSON.stringify({
            type: 'listening',
            conversationId
          }));
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
          
          // Only use ElevenLabs conversational AI features when using ElevenLabs
          if (selectedTTSProvider === 'elevenlabs' && voiceAI) {
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
                  // Send audio chunk to client in Twilio format
                  const message = {
                    event: 'media',
                    media: {
                      payload: chunk.toString('base64')
                    }
                  };
                  ws.send(JSON.stringify(message));
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
          } else {
            // For non-ElevenLabs providers, conversational AI streaming not supported
            logger.warn(`Conversational AI streaming not supported for ${selectedTTSProvider}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Conversational AI streaming not supported for this TTS provider'
            }));
            isProcessing = false;
          }
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
