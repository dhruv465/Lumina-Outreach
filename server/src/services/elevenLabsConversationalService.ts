/**
 * ElevenLabs Conversational AI Service
 * Handles interactive conversations with the ability to stop audio when user interrupts
 * and adapt voice tone according to conversation context.
 * Uses the official ElevenLabs Node.js SDK.
 * Enhanced with robust WebSocket connection management.
 */

import axios from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { VoicePersonality } from './voiceAIService';
// Import the official ElevenLabs SDK
import ElevenLabs from 'elevenlabs-node';
// Import enhanced WebSocket factory
import { createPlainWebSocket } from '../utils/enhancedWebSocketFactory';
import { CompatibleWebSocket } from '../utils/websocketCompatibility';

// Define Language type locally if not available from types
type Language = 'English' | 'Hindi' | 'Spanish' | 'French' | 'German';

// Types for the conversation service
export interface ConversationOptions {
  voiceId: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSSML?: boolean;
  modelId?: string;
}

export interface ConversationState {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  active: boolean;
  messages: ConversationMessage[];
  isGenerating: boolean;
}

export interface ConversationMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
  interrupted?: boolean;
}

export interface StreamOptions {
  latencyOptimization?: boolean;
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
  };
  model?: string;
}

// Events that can be emitted by the service
export enum ConversationEvent {
  MESSAGE_START = 'message-start',
  MESSAGE_STREAM = 'message-stream',
  MESSAGE_COMPLETE = 'message-complete',
  USER_INTERRUPT = 'user-interrupt',
  ERROR = 'error',
  CONNECTION_STATUS = 'connection-status'
}

/**
 * Handles conversational AI interactions with ElevenLabs API
 * Implements WebSocket streaming for real-time responses
 * Supports interruption and dynamic voice adaptation
 */
export class ElevenLabsConversationalService extends EventEmitter {
  private apiKey: string;
  private apiUrl: string = 'https://api.elevenlabs.io/v1';
  private wsUrl: string = 'wss://api.elevenlabs.io/v1/conversation';
  private conversations: Map<string, ConversationState> = new Map();
  private activeConnections: Map<string, CompatibleWebSocket> = new Map();
  private openAIApiKey: string;

  /**
   * Create a new ElevenLabs Conversational AI Service
   */
  constructor(apiKey: string, openAIApiKey: string = '') {
    super();
    this.apiKey = apiKey;
    this.openAIApiKey = openAIApiKey; // Make OpenAI API key optional
    logger.info('ElevenLabs Conversational AI Service initialized');
  }

  /**
   * Update API keys for the service
   * @param apiKey ElevenLabs API key
   * @param openAIApiKey OpenAI API key (optional)
   */
  public updateApiKeys(apiKey: string, openAIApiKey: string = ''): void {
    this.apiKey = apiKey;
    this.openAIApiKey = openAIApiKey;
    logger.info('ElevenLabs Conversational AI Service API keys updated');
  }

  /**
   * Create a new conversation
   * @returns Conversation ID
   */
  public createConversation(): string {
    const conversationId = uuidv4();
    
    this.conversations.set(conversationId, {
      id: conversationId,
      createdAt: new Date(),
      lastActivity: new Date(),
      active: true,
      messages: [],
      isGenerating: false
    });
    
    logger.info(`Created new conversation: ${conversationId}`);
    return conversationId;
  }

  /**
   * Add a message to the conversation
   * @param conversationId Conversation ID
   * @param role Role of the message sender
   * @param content Message content
   * @returns The message that was added
   */
  public addMessage(
    conversationId: string, 
    role: 'system' | 'user' | 'assistant', 
    content: string
  ): ConversationMessage | null {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      logger.error(`Conversation ${conversationId} not found`);
      return null;
    }

    const message: ConversationMessage = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date()
    };

    conversation.messages.push(message);
    conversation.lastActivity = new Date();
    
    logger.info(`Added ${role} message to conversation ${conversationId}`);
    return message;
  }

  /**
   * Generate speech from text using ElevenLabs API
   * @param text Text to synthesize
   * @param voiceId Voice ID to use
   * @param options Options for speech synthesis
   * @returns Audio buffer
   */
  public async generateSpeech(
    text: string,
    voiceId: string,
    options?: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      modelId?: string;
    }
  ): Promise<Buffer> {
    try {
      // Validate inputs
      if (!text || text.trim() === '') {
        throw new Error('Empty text provided for speech generation');
      }

      if (!voiceId || voiceId.trim() === '') {
        throw new Error('Invalid voice ID provided');
      }

      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('ElevenLabs API key is not configured');
      }

      // Log request details for debugging (without the API key)
      logger.info(`Generating speech for voice ${voiceId}, text length: ${text.length} chars`);

      const voiceSettings = {
        stability: options?.stability || 0.75,
        similarity_boost: options?.similarityBoost || 0.75,
        style: options?.style || 0.0,
        use_speaker_boost: true
      };

      const modelId = options?.modelId || 'eleven_multilingual_v2';

      // Make the request with detailed error handling
      try {
        const response = await axios.post(
          `${this.apiUrl}/text-to-speech/${voiceId}`,
          {
            text,
            model_id: modelId,
            voice_settings: voiceSettings
          },
          {
            headers: {
              'Accept': 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': this.apiKey
            },
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout
          }
        );

        // Check if we got a successful response
        if (response.status === 200 && response.data) {
          logger.info(`Speech generated successfully for voice ${voiceId}, size: ${response.data.byteLength} bytes`);
          return Buffer.from(response.data);
        } else {
          throw new Error(`Unexpected response: ${response.status}`);
        }
      } catch (axiosError: any) {
        // Handle Axios specific errors
        if (axiosError.response) {
          // The request was made and the server responded with a status code
          // outside the 2xx range
          let errorData = axiosError.response.data;
          
          // Try to parse the error data if it's in arraybuffer format
          if (errorData instanceof ArrayBuffer || Buffer.isBuffer(errorData)) {
            try {
              const dataString = Buffer.from(errorData).toString('utf8');
              errorData = JSON.parse(dataString);
              logger.error(`ElevenLabs API error response: ${JSON.stringify(errorData)}`);
            } catch (e) {
              logger.error(`Could not parse error response: ${e.message}`);
            }
          }
          
          throw new Error(`ElevenLabs API responded with ${axiosError.response.status}: ${JSON.stringify(errorData)}`);
        } else if (axiosError.request) {
          // The request was made but no response was received
          throw new Error(`No response received from ElevenLabs API: ${axiosError.message}`);
        } else {
          // Something happened in setting up the request that triggered an Error
          throw new Error(`Request setup error: ${axiosError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error generating speech: ${getErrorMessage(error)}`);
      throw new Error(`Speech generation failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Stream speech with the ability to interrupt
   * @param conversationId Conversation ID
   * @param text Text to synthesize
   * @param voiceId Voice ID to use
   * @param onAudioChunk Callback for audio chunks
   * @param options Stream options
   */
  public async streamSpeech(
    conversationId: string,
    text: string,
    voiceId: string,
    onAudioChunk: (chunk: Buffer) => void,
    options?: StreamOptions
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Create enhanced WebSocket connection
    try {
      logger.info(`Creating enhanced WebSocket connection for ElevenLabs conversation ${conversationId}`);
      
      const ws = await createPlainWebSocket(this.wsUrl, {
        callId: `elevenlabs-${conversationId}`,
        connectionId: conversationId,
        serviceName: 'elevenlabs-conversational',
        // ElevenLabs specific optimizations
        heartbeatInterval: 30000, // 30 seconds for TTS services
        connectionTimeout: 15000,
        maxReconnectAttempts: 3, // Fewer retries for TTS to fail fast
        reconnectDelay: 2000 // Slightly longer delay for TTS services
      });

      let interrupted = false;

      // Store connection for potential interruption
      this.activeConnections.set(conversationId, ws);

      // Handle WebSocket connection
      ws.on('open', () => {
        logger.info(`Enhanced WebSocket connection opened for ElevenLabs conversation ${conversationId}`);
      
      // Send initialization message
      ws.send(JSON.stringify({
        text,
        voice_id: voiceId,
        xi_api_key: this.apiKey,
        model_id: options?.model || 'eleven_multilingual_v2',
        voice_settings: {
          stability: options?.voiceSettings?.stability || 0.75,
          similarity_boost: options?.voiceSettings?.similarityBoost || 0.75,
          style: options?.voiceSettings?.style || 0.0,
          use_speaker_boost: options?.voiceSettings?.speakerBoost || true
        },
        optimize_streaming_latency: options?.latencyOptimization || 0
      }));

      // Emit connection status
      this.emit(ConversationEvent.CONNECTION_STATUS, { 
        conversationId, 
        status: 'connected' 
      });
    });

    // Handle incoming audio data
    ws.on('message', (data) => {
      if (Buffer.isBuffer(data)) {
        onAudioChunk(data);
        this.emit(ConversationEvent.MESSAGE_STREAM, { 
          conversationId, 
          chunk: data 
        });
      } else {
        try {
          const jsonData = JSON.parse(data.toString());
          
          if (jsonData.type === 'message') {
            logger.info(`Message from ElevenLabs: ${jsonData.message}`);
          } else if (jsonData.type === 'audio_started') {
            this.emit(ConversationEvent.MESSAGE_START, { 
              conversationId 
            });
          } else if (jsonData.type === 'audio_completed') {
            this.emit(ConversationEvent.MESSAGE_COMPLETE, { 
              conversationId,
              interrupted: false
            });
          }
        } catch (e) {
          logger.warn(`Non-JSON message received: ${data}`);
        }
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error for conversation ${conversationId}: ${getErrorMessage(error)}`);
      this.emit(ConversationEvent.ERROR, { 
        conversationId, 
        error: getErrorMessage(error) 
      });
    });

    // Handle WebSocket closure
    ws.on('close', (code, reason) => {
      logger.info(`WebSocket closed for conversation ${conversationId}: ${code} ${reason}`);
      this.activeConnections.delete(conversationId);
      
      // Emit completion event if not already emitted due to interruption
      if (interrupted) {
        this.emit(ConversationEvent.MESSAGE_COMPLETE, { 
          conversationId,
          interrupted: true
        });
      }
    });

    return new Promise(async (resolve, reject) => {
      // Handle WebSocket events to resolve/reject the promise
      ws.on('close', () => resolve());
      ws.on('error', (error) => reject(error));
    });

    } catch (error) {
      logger.error(`Failed to create enhanced WebSocket connection for ElevenLabs conversation ${conversationId}`, {
        error: getErrorMessage(error),
        conversationId,
        wsUrl: this.wsUrl
      });
      
      this.emit(ConversationEvent.ERROR, { 
        conversationId, 
        error: `Failed to establish connection: ${getErrorMessage(error)}` 
      });
      
      throw error;
    }
  }

  /**
   * Interrupt the currently streaming message
   * @param conversationId Conversation ID
   * @returns True if successfully interrupted
   */
  public interruptStream(conversationId: string): boolean {
    const ws = this.activeConnections.get(conversationId);
    if (!ws) {
      logger.warn(`No active connection found for conversation ${conversationId}`);
      return false;
    }

    try {
      // Send interruption signal
      ws.send(JSON.stringify({ interrupt: true }));
      
      // Mark the conversation as interrupted
      const conversation = this.conversations.get(conversationId);
      if (conversation && conversation.messages.length > 0) {
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage.role === 'assistant') {
          lastMessage.interrupted = true;
        }
      }

      // Emit interruption event
      this.emit(ConversationEvent.USER_INTERRUPT, { conversationId });
      logger.info(`Interrupted stream for conversation ${conversationId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error interrupting stream for conversation ${conversationId}: ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Close the conversation
   * @param conversationId Conversation ID
   */
  public closeConversation(conversationId: string): void {
    // Interrupt any active stream
    this.interruptStream(conversationId);
    
    // Update conversation state
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.active = false;
      logger.info(`Closed conversation ${conversationId}`);
    } else {
      logger.warn(`Attempted to close non-existent conversation ${conversationId}`);
    }
  }

  /**
   * Synthesize adaptive voice with personality adaptation
   * @param params Parameters for adaptive voice synthesis
   * @returns Audio content and metadata
   */
  public async synthesizeAdaptiveVoice(params: {
    text: string;
    personalityId: string;
    language?: string;
  }): Promise<any> {
    try {
      const { text, personalityId, language = 'en' } = params;
      
      // Use standard voice settings
      const standardSettings = {
        stability: 0.8,
        similarityBoost: 0.75,
        style: 0.3,
        speakerBoost: true
      };

      // Choose appropriate model based on language and flash model availability
      let modelId;
      
      // Check if we should use Flash v2.5 model
      let useFlashModel = true; // Default to using Flash v2.5
      
      try {
        const Configuration = require('../models/Configuration').default;
        const config = await Configuration.findOne();
        if (config && typeof config.elevenLabsConfig.useFlashModel !== 'undefined') {
          useFlashModel = config.elevenLabsConfig.useFlashModel;
        }
      } catch (error) {
        logger.warn(`Could not get Flash model setting from configuration, using default: ${useFlashModel}`);
      }
      
      if (useFlashModel) {
        modelId = 'eleven_turbo_v2'; // Flash v2.5 model for ultra-low latency (~75ms)
      } else if (language === 'hi') {
        modelId = 'eleven_multilingual_v2'; // Use multilingual model for Hindi
      } else {
        modelId = 'eleven_monolingual_v1'; // Use monolingual for English if not using Flash
      }

      // Generate the speech
      const audioBuffer = await this.generateSpeech(
        text,
        personalityId,
        {
          stability: standardSettings.stability,
          similarityBoost: standardSettings.similarityBoost,
          style: standardSettings.style,
          modelId
        }
      );

      // Return audio content and metadata
      return {
        audioContent: audioBuffer,
        metadata: {
          voiceId: personalityId,
          language,
          duration: Math.ceil(text.length / 15), // Rough estimate
          adapted: false
        },
        adaptations: null
      };
    } catch (error) {
      logger.error(`Error synthesizing adaptive voice: ${getErrorMessage(error)}`);
      throw new Error(`Voice synthesis failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Begin an interactive conversation with streaming response
   * @param conversationId Conversation ID
   * @param text User input text
   * @param voiceId Voice ID to use
   * @param options Stream options
   * @param onAudioChunk Callback for audio chunks
   */
  public async startInteractiveConversation(
    conversationId: string,
    text: string,
    voiceId: string,
    options?: StreamOptions,
    onAudioChunk?: (chunk: Buffer) => void
  ): Promise<void> {
    try {
      // Create conversation if it doesn't exist
      if (!this.conversations.has(conversationId)) {
        this.createConversation();
      }

      const conversation = this.conversations.get(conversationId)!;
      
      // Add user message
      this.addMessage(conversationId, 'user', text);
      
      // Mark conversation as generating
      conversation.isGenerating = true;

      // Start streaming and return the promise
      return this.streamSpeech(
        conversationId,
        text,
        voiceId,
        onAudioChunk || (() => {}),
        options
      ).finally(() => {
        conversation.isGenerating = false;
      });
    } catch (error) {
      logger.error(`Error starting interactive conversation: ${getErrorMessage(error)}`);
      throw new Error(`Failed to start conversation: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get the current state of a conversation
   * @param conversationId Conversation ID
   * @returns Conversation state or null if not found
   */
  public getConversationState(conversationId: string): ConversationState | null {
    return this.conversations.get(conversationId) || null;
  }

  /**
   * Get all active conversations
   * @returns Array of active conversation states
   */
  public getActiveConversations(): ConversationState[] {
    return Array.from(this.conversations.values())
      .filter(conv => conv.active);
  }
}

// Singleton instance
let conversationalService: ElevenLabsConversationalService | null = null;

/**
 * Initialize the ElevenLabs Conversational AI Service
 * @param apiKey ElevenLabs API key
 * @param openAIApiKey OpenAI API key for conversation enhancement
 * @returns Service instance
 */
export function initializeConversationalService(
  apiKey: string,
  openAIApiKey: string
): ElevenLabsConversationalService {
  if (!conversationalService) {
    conversationalService = new ElevenLabsConversationalService(apiKey, openAIApiKey);
  } else {
    // Update API keys if service already exists
    conversationalService.updateApiKeys(apiKey, openAIApiKey);
  }
  return conversationalService;
}

/**
 * Get the ElevenLabs Conversational AI Service instance
 * @returns Service instance or null if not initialized
 */
export function getConversationalService(): ElevenLabsConversationalService | null {
  return conversationalService;
}

// Export default interface for singleton pattern
export default {
  initialize: initializeConversationalService,
  getService: getConversationalService
};
