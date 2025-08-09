import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import ElevenLabs from 'elevenlabs-node';
import WebSocket from 'ws';
import * as latencyConfig from '../config/latencyOptimization';
import responseCache from '../utils/responseCache';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// Types
type Language = 'English' | 'Hindi';

// Rate limiting configuration
interface RateLimitState {
  requestCount: number;
  windowStart: number;
  backoffUntil: number;
  consecutiveErrors: number;
}

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
  latencyOptimization?: boolean | number;
  optimizationProfile?: 'ultraLow' | 'low' | 'balanced' | 'highQuality';
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
  };
  model?: string;
  outputFormat?: string;
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
 * Handles conversational AI interactions with ElevenLabs API using the official SDK
 * Implements WebSocket streaming for real-time responses
 * Supports interruption and dynamic voice adaptation
 */
export class ElevenLabsSDKService extends EventEmitter {
  private apiKey: string;
  private wsUrl: string = 'wss://api.elevenlabs.io/v1/streaming/';
  private conversations: Map<string, ConversationState> = new Map();
  private activeConnections: Map<string, WebSocket> = new Map();
  private elevenlabs: ElevenLabs;
  private responseCache: any; // For caching common responses

  // Rate limiting state
  private rateLimitState: RateLimitState = {
    requestCount: 0,
    windowStart: Date.now(),
    backoffUntil: 0,
    consecutiveErrors: 0
  };

  // Rate limiting configuration
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute window
  private readonly MAX_REQUESTS_PER_WINDOW = 10; // More conservative limit to avoid 429 errors
  private readonly BASE_BACKOFF_MS = 2000; // Start with 2 seconds
  private readonly MAX_BACKOFF_MS = 60000; // Max 60 seconds
  private readonly MAX_CONSECUTIVE_ERRORS = 3;

  /**
   * Create a new ElevenLabs SDK Service
   */
  constructor(apiKey: string) {
    super();

    console.log('ElevenLabsSDKService constructor called with:', {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0
    });

    if (!apiKey || apiKey.trim() === '') {
      throw new Error('ElevenLabs API key is required for SDK initialization');
    }

    this.apiKey = apiKey;

    try {
      // Initialize the ElevenLabs SDK
      this.elevenlabs = new ElevenLabs({
        apiKey: this.apiKey
      });

      // Initialize response cache
      try {
        this.responseCache = require('../utils/responseCache').default;
        logger.debug('Response cache initialized for ElevenLabsSDKService');
      } catch (cacheError) {
        logger.warn(`Failed to initialize response cache: ${getErrorMessage(cacheError)}`);
        this.responseCache = null;
      }

      console.log('ElevenLabs SDK Service initialized successfully with API key', {
        keyLength: this.apiKey.length,
        keyPrefix: this.apiKey.substring(0, 3) + '...'
      });

      logger.info('ElevenLabs SDK Service initialized with API key', {
        keyLength: this.apiKey.length,
        keyPrefix: this.apiKey.substring(0, 3) + '...'
      });
    } catch (error) {
      console.error(`Failed to initialize ElevenLabs SDK: ${getErrorMessage(error)}`);
      logger.error(`Failed to initialize ElevenLabs SDK: ${getErrorMessage(error)}`);
      throw new Error(`ElevenLabs SDK initialization failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Update API keys for the service
   * @param apiKey ElevenLabs API key
   */
  public updateApiKeys(apiKey: string): void {
    this.apiKey = apiKey;

    // Re-initialize the SDK with the new API key
    this.elevenlabs = new ElevenLabs({
      apiKey: this.apiKey
    });

    logger.info('ElevenLabs SDK Service API keys updated');
  }

  /**
   * Check if we're within rate limits and handle backoff
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();

    // Check if we're still in backoff period
    if (now < this.rateLimitState.backoffUntil) {
      const waitTime = this.rateLimitState.backoffUntil - now;
      logger.warn(`Rate limit backoff active, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return;
    }

    // Reset window if it has expired
    if (now - this.rateLimitState.windowStart > this.RATE_LIMIT_WINDOW) {
      this.rateLimitState.requestCount = 0;
      this.rateLimitState.windowStart = now;
    }

    // Check if we're at the rate limit
    if (this.rateLimitState.requestCount >= this.MAX_REQUESTS_PER_WINDOW) {
      const waitTime = this.RATE_LIMIT_WINDOW - (now - this.rateLimitState.windowStart);
      logger.warn(`Rate limit reached, waiting ${waitTime}ms for window reset`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimitState.requestCount = 0;
      this.rateLimitState.windowStart = Date.now();
    }

    this.rateLimitState.requestCount++;
  }

  /**
   * Handle rate limit error with exponential backoff
   */
  private handleRateLimitError(): void {
    this.rateLimitState.consecutiveErrors++;

    const backoffTime = Math.min(
      this.BASE_BACKOFF_MS * Math.pow(2, this.rateLimitState.consecutiveErrors - 1),
      this.MAX_BACKOFF_MS
    );

    this.rateLimitState.backoffUntil = Date.now() + backoffTime;

    logger.warn(`Rate limit hit, backing off for ${backoffTime}ms (consecutive errors: ${this.rateLimitState.consecutiveErrors})`);
  }

  /**
   * Reset rate limit error state on successful request
   */
  private resetRateLimitErrors(): void {
    if (this.rateLimitState.consecutiveErrors > 0) {
      logger.info(`Rate limit errors reset after successful request`);
      this.rateLimitState.consecutiveErrors = 0;
    }
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
   * Generate speech from text using ElevenLabs SDK
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
      optimizeLatency?: boolean;
    }
  ): Promise<Buffer> {
    try {
      // Check rate limits before making request
      await this.checkRateLimit();

      // Validate input parameters
      if (!text || typeof text !== 'string' || text.trim() === '') {
        throw new Error(`Invalid text parameter: ${typeof text} - "${text}"`);
      }

      if (!voiceId || typeof voiceId !== 'string' || voiceId.trim() === '') {
        throw new Error(`Invalid voiceId parameter: ${typeof voiceId} - "${voiceId}"`);
      }

      logger.debug(`Generating speech for text: "${text.substring(0, 50)}..." with voice: ${voiceId}`);

      // Check cache first for common phrases (greetings, acknowledgments, etc.)
      const cacheKey = `${voiceId}_${text}`;
      if (this.responseCache && this.responseCache.has(cacheKey)) {
        logger.info(`Cache hit for text: "${text.substring(0, 20)}..."`);
        return this.responseCache.get(cacheKey);
      }

      const voiceSettings = {
        stability: options?.stability || 0.5, // Lower stability for faster generation
        similarity_boost: options?.similarityBoost || 0.75,
        style: options?.style || 0.0,
        use_speaker_boost: true
      };

      // Get model selection from configuration if available
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

      // Use optimized model for latency-sensitive responses
      let modelId;
      if (useFlashModel) {
        modelId = 'eleven_turbo_v2'; // Flash v2.5 model for ultra-low latency (~75ms)
      } else if (options?.optimizeLatency) {
        modelId = 'eleven_monolingual_v1'; // Older faster model
      } else {
        modelId = options?.modelId || 'eleven_multilingual_v2'; // Default to multilingual
      }

      // Use lower quality for faster responses
      const outputFormat = options?.optimizeLatency
        ? 'mp3_44100_64' // Lower bitrate for faster generation
        : 'mp3_44100_128';

      logger.debug(`Making ElevenLabs API call with params:`, {
        voiceId: voiceId,
        textLength: text.length,
        modelId: modelId,
        outputFormat: outputFormat,
        stability: voiceSettings.stability,
        apiKeyPrefix: this.apiKey.substring(0, 10) + '...'
      });

      // Validate voice ID exists before making the API call
      try {
        // Normalize voices response to an array
        const voicesResponse = await this.getVoices();
        let voicesList: any[] = [];
        if (Array.isArray(voicesResponse)) {
          voicesList = voicesResponse;
        } else if (voicesResponse && Array.isArray((voicesResponse as any).voices)) {
          voicesList = (voicesResponse as any).voices;
        }
        const voiceExists = voicesList.some(v => v.voice_id === voiceId);
        if (!voiceExists) {
          logger.warn(`Voice ID ${voiceId} not found in available voices. Available voices: ${voicesList.map(v => v.voice_id).slice(0, 5).join(', ')}...`);
        }
      } catch (voiceError) {
        logger.warn(`Could not validate voice ID (continuing anyway): ${getErrorMessage(voiceError)}`);
      }

      // Use the SDK to generate speech with proper error handling
      let audioResponse;
      const tempFileName = `temp_${Date.now()}.mp3`;

      try {
        audioResponse = await this.elevenlabs.textToSpeech({
          voiceId: voiceId,
          textInput: text,
          fileName: tempFileName, // Required parameter for elevenlabs-node
          modelId: modelId,
          stability: voiceSettings.stability,
          similarityBoost: voiceSettings.similarity_boost,
          style: voiceSettings.style
        });
      } catch (apiError: any) {
        // Clean up temp file if it was created during the error
        try {
          const fs = require('fs');
          if (fs.existsSync(tempFileName)) {
            fs.unlinkSync(tempFileName);
            logger.debug(`Cleaned up temp file after API error: ${tempFileName}`);
          }
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup temp file after API error: ${tempFileName}`, cleanupError);
        }

        // Handle specific API errors
        if (apiError.response?.status === 401) {
          logger.error(`API Key validation details:`, {
            apiKeyLength: this.apiKey?.length,
            apiKeyPrefix: this.apiKey?.substring(0, 10),
            voiceId: voiceId,
            modelId: modelId
          });
          throw new Error(`ElevenLabs API authentication failed. Please check your API key. Status: ${apiError.response.status}`);
        } else if (apiError.response?.status === 422) {
          throw new Error(`ElevenLabs API validation error: ${apiError.response?.data?.detail || 'Invalid request parameters'}`);
        } else if (apiError.response?.status === 429) {
          // Handle rate limiting
          this.handleRateLimitError();
          throw new Error(`ElevenLabs API rate limit exceeded. Please try again later.`);
        } else if (apiError.code === 'ERR_BAD_REQUEST' && apiError.response?.status) {
          throw new Error(`ElevenLabs API error (${apiError.response.status}): ${apiError.response.statusText || 'Unknown error'}`);
        } else {
          throw new Error(`ElevenLabs API call failed: ${getErrorMessage(apiError)}`);
        }
      }

      logger.debug(`ElevenLabs API response type: ${typeof audioResponse}, isBuffer: ${Buffer.isBuffer(audioResponse)}, isNull: ${audioResponse === null}`);

      // Handle different response types from elevenlabs-node
      let buffer: Buffer;

      if (!audioResponse) {
        throw new Error('ElevenLabs API returned empty response');
      }

      // Check if the response is an error object
      if (typeof audioResponse === 'object' && audioResponse.constructor !== Buffer) {
        const errorObj = audioResponse as any;
        if (errorObj.error || errorObj.status === 401) {
          throw new Error(`ElevenLabs API error: ${errorObj.error || 'Authentication failed (401)'}`);
        }
      }

      // Handle different response formats
      if (Buffer.isBuffer(audioResponse)) {
        buffer = audioResponse;
      } else if (typeof audioResponse === 'string') {
        // If it's a file path, read the file
        const fs = require('fs');
        try {
          buffer = fs.readFileSync(audioResponse);
          // Clean up temporary file
          fs.unlinkSync(audioResponse);
        } catch (fsError) {
          throw new Error(`Failed to read audio file: ${getErrorMessage(fsError)}`);
        }
      } else if (typeof audioResponse === 'object' && audioResponse !== null) {
        // Handle object response with fileName (newer elevenlabs-node behavior)
        const responseObj = audioResponse as any;
        if (responseObj.fileName && responseObj.status === 'ok') {
          const fs = require('fs');
          let tempFilePath: string | null = null;

          try {
            tempFilePath = responseObj.fileName;
            buffer = fs.readFileSync(tempFilePath);
            logger.debug(`Successfully read audio from file: ${tempFilePath}`);
          } catch (fsError) {
            throw new Error(`Failed to read audio file ${tempFilePath}: ${getErrorMessage(fsError)}`);
          } finally {
            // Ensure temp file is always cleaned up
            if (tempFilePath && fs.existsSync(tempFilePath)) {
              try {
                fs.unlinkSync(tempFilePath);
                logger.debug(`Cleaned up temp file: ${tempFilePath}`);
              } catch (cleanupError) {
                logger.warn(`Failed to cleanup temp file: ${tempFilePath}`, cleanupError);
              }
            }
          }
        } else {
          // Handle error object
          throw new Error(`ElevenLabs API error: ${responseObj.error || responseObj.message || 'Unknown error'}`);
        }
      } else if (audioResponse instanceof ArrayBuffer) {
        buffer = Buffer.from(audioResponse);
      } else if (Array.isArray(audioResponse)) {
        buffer = Buffer.from(audioResponse);
      } else {
        logger.error('Unexpected audioResponse type:', {
          type: typeof audioResponse,
          isArray: Array.isArray(audioResponse),
          isNull: audioResponse === null,
          isUndefined: audioResponse === undefined,
          constructor: audioResponse?.constructor?.name,
          value: audioResponse
        });
        throw new Error(`ElevenLabs API returned unexpected response type: ${typeof audioResponse}`);
      }

      // Cache the result for common phrases (less than 100 chars)
      if (this.responseCache && text.length < 100) {
        this.responseCache.set(cacheKey, buffer);
        logger.debug(`Cached response for: "${text.substring(0, 20)}..."`);
      }

      // Reset rate limit errors on successful request
      this.resetRateLimitErrors();

      return buffer;
    } catch (error) {
      // Handle rate limiting errors specifically
      if (error.response?.status === 429 || getErrorMessage(error).includes('429') || getErrorMessage(error).includes('Too Many Requests')) {
        this.handleRateLimitError();
        logger.error(`Rate limit error in generateSpeech: ${getErrorMessage(error)}`);
        throw new Error(`Rate limit exceeded. Please try again in a few moments.`);
      }

      logger.error(`Error generating speech: ${getErrorMessage(error)}`);
      throw new Error(`Speech generation failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Stream speech generation with optimized settings
   * @param text Text to synthesize
   * @param voiceId Voice ID to use
   * @param onAudioChunk Callback for audio chunks
   * @param options Options for speech synthesis
   * @param persistentConversationId Optional persistent conversation ID to maintain voice settings
   */
  public async streamSpeechGeneration(
    text: string,
    voiceId: string,
    onAudioChunk: (chunk: Buffer) => void,
    options?: {
      optimizeLatency?: boolean;
      stability?: number;
      similarityBoost?: number;
      style?: number;
    },
    persistentConversationId?: string
  ): Promise<void> {
    try {
      // Check cache first for common phrases
      const cacheKey = `${voiceId}_${text}`;
      if (this.responseCache && this.responseCache.has(cacheKey)) {
        logger.debug(`Using cached audio for text: "${text.substring(0, 20)}..."`);
        onAudioChunk(this.responseCache.get(cacheKey));
        return;
      }

      // Use optimized settings for latency by default
      const streamOptions = {
        latencyOptimization: options?.optimizeLatency !== false, // Convert to boolean
        voiceSettings: {
          stability: options?.stability || 0.5, // Lower stability for faster generation
          similarityBoost: options?.similarityBoost || 0.75,
          style: options?.style || 0.0,
          speakerBoost: true
        }
      };

      // Determine conversation ID: use persistent one if provided, otherwise reuse last active or create new
      let conversationId: string;
      if (persistentConversationId) {
        conversationId = persistentConversationId;
        // Ensure the conversation exists in our tracking
        if (!this.conversations.has(conversationId)) {
          this.conversations.set(conversationId, {
            id: conversationId,
            createdAt: new Date(),
            lastActivity: new Date(),
            active: true,
            messages: [],
            isGenerating: false
          });
        }
      } else {
        // Fallback to existing logic
        const existingIds = Array.from(this.conversations.keys());
        if (existingIds.length > 0) {
          conversationId = existingIds[existingIds.length - 1];
        } else {
          conversationId = this.createConversation();
        }
      }

      // Use the streamSpeech method to stream the speech
      await this.streamSpeech(
        conversationId,
        text,
        voiceId,
        onAudioChunk,
        streamOptions
      );

      // Cache the response if it's short (less than 100 chars)
      if (this.responseCache && text.length < 100) {
        try {
          // Generate the complete audio in the background for caching
          this.generateSpeech(text, voiceId, { optimizeLatency: true })
            .then(buffer => {
              if (this.responseCache) {
                this.responseCache.set(cacheKey, buffer);
                logger.debug(`Cached response for future use: "${text.substring(0, 20)}..."`);
              }
            })
            .catch(err => {
              logger.debug(`Failed to cache response: ${getErrorMessage(err)}`);
            });
        } catch (cacheError) {
          // Ignore cache errors - caching is optional
          logger.debug(`Error in background caching: ${getErrorMessage(cacheError)}`);
        }
      }
    } catch (error) {
      logger.error(`Error streaming speech generation: ${getErrorMessage(error)}`);
      throw new Error(`Failed to stream speech: ${getErrorMessage(error)}`);
    }
  }

  // streamOptimizedSpeech implementation moved to line ~1373

  // generateOptimizedSpeech implementation moved to line ~1311

  /**
   * Stream speech using text-to-speech API instead of conversational WebSocket
   * This ensures we maintain control over voice IDs and conversation persistence
   */
  public async streamSpeech(
    conversationId: string,
    text: string,
    voiceId: string,
    onAudioChunk: (chunk: Buffer) => void,
    options?: StreamOptions
  ): Promise<void> {
    // Validate all parameters before proceeding
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error(`Invalid conversationId parameter: ${conversationId}`);
    }
    if (!text || typeof text !== 'string') {
      throw new Error(`Invalid text parameter: ${text}`);
    }
    if (!voiceId || typeof voiceId !== 'string') {
      throw new Error(`Invalid voiceId parameter: ${voiceId}`);
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    try {
      // Check rate limits before making request
      await this.checkRateLimit();

      // Use the standard text-to-speech API instead of WebSocket to maintain voice consistency
      logger.info(`Using text-to-speech API for conversation ${conversationId} with voice ${voiceId}`);

      // Use a more reliable file path with absolute path
      const uploadsDir = path.join(__dirname, '../../uploads');

      // Ensure uploads directory exists
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Use absolute path for the file
      const fileName = path.join(uploadsDir, `speech-${Date.now()}.mp3`);

      const ttsParams = {
        voiceId: String(voiceId), // Ensure it's a string
        textInput: String(text), // Use textInput instead of text for elevenlabs-node
        fileName: fileName, // Add required fileName parameter with absolute path
        modelId: options?.model || 'eleven_multilingual_v2', // Use modelId instead of model
        stability: options?.voiceSettings?.stability ?? 0.75,
        similarityBoost: options?.voiceSettings?.similarityBoost ?? 0.75,
        style: options?.voiceSettings?.style ?? 0.0
      };

      logger.debug(`TTS parameters:`, {
        voiceId: ttsParams.voiceId,
        textLength: ttsParams.textInput.length,
        modelId: ttsParams.modelId,
        fileName: ttsParams.fileName
      });

      const audioResponse = await this.elevenlabs.textToSpeech(ttsParams);

      // Handle the response properly - the elevenlabs-node SDK returns different types
      let audioBuffer: Buffer;

      // Add detailed logging to understand the response format
      logger.debug(`Audio response type: ${typeof audioResponse}`, {
        isBuffer: Buffer.isBuffer(audioResponse),
        isIterable: audioResponse && typeof audioResponse[Symbol.iterator] === 'function',
        hasData: audioResponse && audioResponse.data !== undefined,
        constructor: audioResponse?.constructor?.name,
        keys: audioResponse && typeof audioResponse === 'object' ? Object.keys(audioResponse) : []
      });

      try {
        if (Buffer.isBuffer(audioResponse)) {
          // If it's already a buffer, use it directly
          audioBuffer = audioResponse;
          logger.debug('Using direct buffer response');
        } else if (audioResponse && audioResponse.data && Buffer.isBuffer(audioResponse.data)) {
          // If the response has a data property that is a buffer
          audioBuffer = audioResponse.data;
          logger.debug('Using buffer from response.data');
        } else if (audioResponse && typeof audioResponse[Symbol.iterator] === 'function') {
          // If it's an iterator/stream, collect all chunks
          logger.debug('Processing iterable response');
          const chunks: Buffer[] = [];
          for (const chunk of audioResponse) {
            if (chunk) {
              const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              chunks.push(bufferChunk);
            }
          }
          audioBuffer = Buffer.concat(chunks);
          logger.debug(`Concatenated ${chunks.length} chunks into ${audioBuffer.length} bytes`);
        } else if (audioResponse && audioResponse.buffer) {
          // If the response has a buffer property
          audioBuffer = Buffer.isBuffer(audioResponse.buffer) ? audioResponse.buffer : Buffer.from(audioResponse.buffer);
          logger.debug('Using buffer from response.buffer');
        } else if (audioResponse && audioResponse.status === 'ok' && audioResponse.fileName) {
          // Handle the elevenlabs-node SDK response format that returns file info
          try {
            // Check if the fileName is an absolute path
            const audioFilePath = path.isAbsolute(audioResponse.fileName)
              ? audioResponse.fileName
              : path.resolve(audioResponse.fileName);

            logger.debug(`Checking for audio file at: ${audioFilePath}`);

            if (fs.existsSync(audioFilePath)) {
              audioBuffer = fs.readFileSync(audioFilePath);
              logger.debug(`Read audio from file: ${audioFilePath} (${audioBuffer.length} bytes)`);

              // Clean up the file after reading
              try {
                fs.unlinkSync(audioFilePath);
                logger.debug(`Cleaned up temp file: ${audioFilePath}`);
              } catch (unlinkError) {
                logger.warn(`Failed to clean up temp file ${audioFilePath}: ${unlinkError}`);
              }
            } else {
              // Try to find the file in the uploads directory
              const uploadsDir = path.join(__dirname, '../../uploads');
              const alternativePath = path.join(uploadsDir, path.basename(audioResponse.fileName));

              logger.debug(`File not found at ${audioFilePath}, trying alternative path: ${alternativePath}`);

              if (fs.existsSync(alternativePath)) {
                audioBuffer = fs.readFileSync(alternativePath);
                logger.debug(`Read audio from alternative path: ${alternativePath} (${audioBuffer.length} bytes)`);

                // Clean up the file after reading
                try {
                  fs.unlinkSync(alternativePath);
                  logger.debug(`Cleaned up temp file: ${alternativePath}`);
                } catch (unlinkError) {
                  logger.warn(`Failed to clean up temp file ${alternativePath}: ${unlinkError}`);
                }
              } else {
                throw new Error(`Audio file not found at either ${audioFilePath} or ${alternativePath}`);
              }
            }
          } catch (fileError) {
            logger.error(`Error reading audio file ${audioResponse.fileName}: ${fileError}`);

            // Try to generate a fallback response directly
            const fallbackText = "I'm sorry, there was an issue processing the audio. Could you please repeat that?";

            // Use direct API call as fallback
            const fallbackResponse = await axios.post(
              `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
              {
                text: fallbackText,
                voice_settings: {
                  stability: 0.8,
                  similarity_boost: 0.8,
                  style: 0.0,
                  use_speaker_boost: true
                },
                model_id: "eleven_turbo_v2"
              },
              {
                headers: {
                  'Accept': 'audio/mpeg',
                  'xi-api-key': this.apiKey,
                  'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
              }
            );

            audioBuffer = Buffer.from(fallbackResponse.data);
            logger.info(`Generated fallback response after file read error: ${audioBuffer.length} bytes`);
          }
        } else if (audioResponse && typeof audioResponse === 'string') {
          // If it's a base64 string or similar
          audioBuffer = Buffer.from(audioResponse, 'base64');
          logger.debug('Converting string response to buffer');
        } else {
          // Last resort - try to inspect the response and convert it
          logger.error('Unknown audio response format:', {
            type: typeof audioResponse,
            constructor: audioResponse?.constructor?.name,
            keys: audioResponse && typeof audioResponse === 'object' ? Object.keys(audioResponse) : [],
            value: typeof audioResponse === 'object' ? JSON.stringify(audioResponse, null, 2).substring(0, 500) : audioResponse
          });

          // Generate a fallback response
          const fallbackText = "I'm sorry, there was an issue processing the audio. Could you please repeat that?";

          // Use direct API call as fallback
          const fallbackResponse = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
              text: fallbackText,
              voice_settings: {
                stability: 0.8,
                similarity_boost: 0.8,
                style: 0.0,
                use_speaker_boost: true
              },
              model_id: "eleven_turbo_v2"
            },
            {
              headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': this.apiKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer'
            }
          );

          audioBuffer = Buffer.from(fallbackResponse.data);
          logger.info(`Generated fallback response for unknown format: ${audioBuffer.length} bytes`);
        }
      } catch (processingError) {
        logger.error(`Error processing audio response: ${getErrorMessage(processingError)}`);
        throw new Error(`Failed to process audio response: ${getErrorMessage(processingError)}`);
      }

      // Clean up the original file if it exists
      try {
        if (typeof fileName === 'string' && fs.existsSync(fileName)) {
          fs.unlinkSync(fileName);
          logger.debug(`Cleaned up original temp file: ${fileName}`);
        }
      } catch (cleanupError) {
        logger.warn(`Failed to clean up original temp file ${fileName}: ${cleanupError}`);
      }

      // Send the complete audio buffer
      onAudioChunk(audioBuffer);

      // Reset rate limit errors on successful request
      this.resetRateLimitErrors();

      // Add message to conversation history
      this.addMessage(conversationId, 'assistant', text);

      logger.info(`Successfully generated speech for conversation ${conversationId}`);
    } catch (error) {
      // Handle rate limiting errors specifically
      if (error.response?.status === 429 || getErrorMessage(error).includes('429') || getErrorMessage(error).includes('Too Many Requests')) {
        this.handleRateLimitError();
        logger.error(`Rate limit error in streamSpeech for conversation ${conversationId}: ${getErrorMessage(error)}`);
        throw new Error(`Rate limit exceeded. Please try again in a few moments.`);
      }

      logger.error(`Error in streamSpeech for conversation ${conversationId}: ${getErrorMessage(error)}`);
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
   * Synthesize adaptive voice with personality adaptation using ElevenLabs SDK
   * @param params Parameters for adaptive voice synthesis
   * @returns Audio content and metadata
   */
  public async synthesizeAdaptiveVoice(params: {
    text: string;
    personalityId: string;
    language?: string;
    campaignVoiceSettings?: {
      speed?: number;
      pitch?: number;
      stability?: number;
      clarity?: number;
    };
  }): Promise<any> {
    try {
      const { text, personalityId, language = 'en', campaignVoiceSettings } = params;

      // Validate inputs
      if (!text || text.trim() === '') {
        throw new Error('Text for synthesis cannot be empty');
      }

      if (!personalityId || personalityId.trim() === '') {
        throw new Error('Voice ID (personalityId) cannot be empty');
      }

      // Log synthesis attempt
      logger.info(`Attempting to synthesize voice with ElevenLabs SDK: ${text.substring(0, 30)}...`, {
        voiceId: personalityId,
        language,
        textLength: text.length
      });

      // Use standard voice settings, override with campaign settings if provided
      const voiceSettings = {
        stability: campaignVoiceSettings?.stability ?? 0.8,
        similarity_boost: campaignVoiceSettings?.clarity ?? 0.75,
        style: campaignVoiceSettings?.speed ? Math.min(1.0, (campaignVoiceSettings.speed - 0.5) * 0.6 + 0.3) : 0.3,
        use_speaker_boost: true
      };

      if (campaignVoiceSettings) {
        logger.info(`Applied campaign voice settings to SDK synthesis:`, campaignVoiceSettings);
      }

      // Choose appropriate model based on language
      const modelId = language === 'hi' ? 'eleven_multilingual_v2' : 'eleven_monolingual_v1';

      // Generate the speech using the SDK with timeout handling
      const synthesisPromise = this.elevenlabs.textToSpeech({
        voiceId: personalityId,
        textInput: text,
        fileName: `synthesis_${Date.now()}.mp3`, // Required parameter for elevenlabs-node
        modelId: modelId,
        stability: voiceSettings.stability,
        similarityBoost: voiceSettings.similarity_boost,
        style: voiceSettings.style
      });

      // Add a timeout to prevent hanging on API issues
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Voice synthesis timed out after 15 seconds')), 15000);
      });

      // Race the promises
      const audioResponse = await Promise.race([synthesisPromise, timeoutPromise]);

      // Handle different response types from elevenlabs-node
      let audioBuffer: Buffer;

      if (!audioResponse) {
        throw new Error('ElevenLabs API returned empty response');
      }

      // Handle different response formats
      if (Buffer.isBuffer(audioResponse)) {
        audioBuffer = audioResponse;
      } else if (typeof audioResponse === 'string') {
        // If it's a file path, read the file
        const fs = require('fs');
        try {
          audioBuffer = fs.readFileSync(audioResponse);
          // Clean up temporary file
          fs.unlinkSync(audioResponse);
        } catch (fsError) {
          throw new Error(`Failed to read audio file: ${getErrorMessage(fsError)}`);
        }
      } else if (audioResponse instanceof ArrayBuffer) {
        audioBuffer = Buffer.from(audioResponse);
      } else if (Array.isArray(audioResponse)) {
        audioBuffer = Buffer.from(audioResponse);
      } else {
        logger.error('Unexpected audioResponse type in synthesizeAdaptiveVoice:', typeof audioResponse, audioResponse);
        throw new Error(`ElevenLabs API returned unexpected response type: ${typeof audioResponse}`);
      }

      // Log successful synthesis
      logger.info(`Successfully synthesized voice with ElevenLabs SDK for ${text.length} characters`);

      // Return audio content and metadata
      return {
        audioContent: audioBuffer,
        metadata: {
          voiceId: personalityId,
          language,
          duration: Math.ceil(text.length / 15), // Rough estimate
          synthesisService: 'elevenlabs-sdk',
          size: audioBuffer.length // Include size for TwiML decisions
        }
      };
    } catch (error) {
      logger.error(`Error synthesizing adaptive voice: ${getErrorMessage(error)}`, {
        error: error instanceof Error ? error.stack : 'Unknown error',
        params: {
          textLength: params.text?.length || 0,
          voiceId: params.personalityId,
          language: params.language
        }
      });

      // Check if this is the "unusual activity" error from ElevenLabs
      // This can be in the error message, or in the error.response.data.detail.status field
      const errorMsg = error.message || '';
      const responseData = error.response?.data || {};
      const detailStatus = responseData.detail?.status || '';

      const isUnusualActivity =
        errorMsg.includes('detected_unusual_activity') ||
        errorMsg.includes('unusual activity') ||
        detailStatus === 'detected_unusual_activity';

      if (isUnusualActivity) {
        logger.error('ElevenLabs API unusual activity detected. This is likely due to quota or free tier limitations.', {
          errorMessage: errorMsg,
          statusCode: error.response?.status,
          detailStatus: detailStatus
        });

        // Try to update configuration status in database
        try {
          const Configuration = require('../models/Configuration').default;
          await Configuration.findOneAndUpdate(
            {},
            {
              'elevenLabsConfig.status': 'failed',
              'elevenLabsConfig.lastVerified': new Date(),
              'elevenLabsConfig.lastError': 'Unusual activity detected. Free tier usage disabled.',
              'elevenLabsConfig.unusualActivityDetected': true,
              'elevenLabsConfig.quotaInfo': {
                tier: 'free',
                status: 'restricted'
              }
            }
          );

          // Import the verification utility
          const { verifyAndUpdateElevenLabsApiStatus } = require('../utils/elevenLabsVerification');

          // Trigger a verification to update quota info
          await verifyAndUpdateElevenLabsApiStatus(this.apiKey).catch(e => {
            logger.error(`Failed to verify ElevenLabs API after unusual activity: ${getErrorMessage(e)}`);
          });

          logger.info('Updated configuration with ElevenLabs unusual activity status');
        } catch (dbError) {
          logger.error(`Failed to update ElevenLabs status in database: ${getErrorMessage(dbError)}`);
        }

        throw new Error('ElevenLabs API reported unusual activity detected. Please check your account status and limits or upgrade to a paid plan.');
      }

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
        // Use the provided conversationId instead of creating a new random one
        this.conversations.set(conversationId, {
          id: conversationId,
          createdAt: new Date(),
          lastActivity: new Date(),
          active: true,
          messages: [],
          isGenerating: false
        });
        logger.info(`Created conversation with provided ID: ${conversationId}`);
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
        onAudioChunk || (() => { }),
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
   * Get available voices using the SDK
   * @returns List of available voices
   */
  public async getVoices(): Promise<any> {
    try {
      const voices = await this.elevenlabs.getVoices();
      return voices;
    } catch (error) {
      logger.error(`Error getting voices: ${getErrorMessage(error)}`);
      throw new Error(`Failed to get voices: ${getErrorMessage(error)}`);
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

  /**
   * Generate speech with optimized latency settings based on profile
   * @param text Text to synthesize
   * @param voiceId Voice ID to use
   * @param options Options for speech synthesis with optimization profile
   */
  public async generateOptimizedSpeech(
    text: string,
    voiceId: string,
    options?: {
      optimizationProfile?: 'ultraLow' | 'low' | 'balanced' | 'highQuality';
      customSettings?: {
        stability?: number;
        similarityBoost?: number;
        style?: number;
      };
      cacheAsPriority?: boolean;
    }
  ): Promise<Buffer> {
    try {
      // Check cache first for common phrases
      const cacheKey = `${voiceId}_${text}`;
      if (this.responseCache && this.responseCache.has(cacheKey)) {
        logger.debug(`Cache hit for optimized speech: "${text.substring(0, 20)}..."`);
        return this.responseCache.get(cacheKey);
      }

      // Default to balanced profile if none specified
      const profile = options?.optimizationProfile || 'balanced';
      const { voiceSettings } = require('../config/latencyOptimization');
      const profileSettings = voiceSettings[profile];

      // Combine profile settings with any custom overrides
      const speechSettings = {
        stability: options?.customSettings?.stability || profileSettings.stability,
        similarityBoost: options?.customSettings?.similarityBoost || profileSettings.similarityBoost,
        style: options?.customSettings?.style || profileSettings.style,
        modelId: profileSettings.model,
        optimizeLatency: profile === 'ultraLow' || profile === 'low'
      };

      // Generate speech with selected profile
      const buffer = await this.generateSpeech(text, voiceId, speechSettings);

      // Cache the result and mark as priority if requested
      if (this.responseCache) {
        this.responseCache.set(cacheKey, buffer);

        if (options?.cacheAsPriority) {
          this.responseCache.addPriorityItem(cacheKey);
          logger.debug(`Cached as priority item: "${text.substring(0, 20)}..."`);
        }
      }

      return buffer;
    } catch (error) {
      logger.error(`Error generating optimized speech: ${getErrorMessage(error)}`);
      throw new Error(`Optimized speech generation failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Stream speech with optimized settings based on profile
   * @param text Text to synthesize
   * @param voiceId Voice ID to use
   * @param onAudioChunk Callback for audio chunks
   * @param options Options for speech synthesis with optimization profile
   */
  public async streamOptimizedSpeech(
    textOrConversationId: string,
    voiceId: string,
    onAudioChunk: (chunk: Buffer) => void,
    options?: {
      optimizationProfile?: 'ultraLow' | 'low' | 'balanced' | 'highQuality';
      cacheResult?: boolean;
      conversationId?: string;
      modelId?: string;
      interrupted?: boolean;
      text?: string;
    }
  ): Promise<void> {
    try {
      // Determine if this is the conversation overload or the text overload
      const isConversationOverload = this.conversations.has(textOrConversationId) && !options?.text;

      // Set variables based on which overload is being used
      let conversationId = isConversationOverload ? textOrConversationId : options?.conversationId;
      const text = isConversationOverload ? (options?.text || '') : textOrConversationId;

      // Validate text parameter
      if (!text || typeof text !== 'string') {
        logger.error(`Invalid text parameter in streamOptimizedSpeech: ${JSON.stringify({ text, textOrConversationId, options })}`);
        throw new Error('Text parameter is required and must be a string');
      }

      if (isConversationOverload && !options?.text) {
        // This is a problem - we don't have text for the conversation overload
        throw new Error('Text parameter is required when using conversation overload');
      }

      // If no conversationId is provided, reuse the last active one or create a new one
      if (!conversationId) {
        const existingIds = Array.from(this.conversations.keys());
        if (existingIds.length > 0) {
          conversationId = existingIds[existingIds.length - 1] as string;
          logger.debug(`Using last active conversation ID: ${conversationId}`);
        } else {
          // Create a deterministic conversation ID instead of random
          conversationId = `persistent-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          this.conversations.set(conversationId, {
            id: conversationId,
            createdAt: new Date(),
            lastActivity: new Date(),
            active: true,
            messages: [],
            isGenerating: false
          });
          logger.debug(`Created new persistent conversation ID: ${conversationId}`);
        }
      }

      // Check cache first
      const cacheKey = `${voiceId}_${text}`;
      if (this.responseCache && this.responseCache.has(cacheKey)) {
        onAudioChunk(this.responseCache.get(cacheKey));
        return;
      }

      // Default to balanced profile if none specified
      const profile = options?.optimizationProfile || 'balanced';
      // Import directly to avoid issues with voiceSettings
      const { voiceSettings } = require('../config/latencyOptimization');
      const profileSettings = voiceSettings[profile];

      // Set latency optimization level based on profile
      let latencyOptimization: boolean | number = false;
      if (profile === 'ultraLow') {
        latencyOptimization = 4; // Maximum optimization
      } else if (profile === 'low') {
        latencyOptimization = 3; // High optimization
      } else if (profile === 'balanced') {
        latencyOptimization = 2; // Moderate optimization
      } else {
        latencyOptimization = 0; // No optimization for high quality
      }

      // Collect all chunks to store in cache if needed
      const chunks: Buffer[] = [];

      // Create a proxy callback that captures audio chunks for caching
      const onAudioChunkProxy = (chunk: Buffer) => {
        // Ensure chunk is a proper Buffer
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        // Collect for caching
        chunks.push(bufferChunk);
        // Forward to caller
        onAudioChunk(bufferChunk);
      };

      // Use appropriate method based on whether we have a valid conversationId
      if (conversationId && this.conversations.has(conversationId)) {
        // Use the persistent conversation for consistent voice settings
        await this.streamSpeech(
          conversationId,
          text,
          voiceId,
          onAudioChunkProxy,
          {
            latencyOptimization,
            voiceSettings: {
              stability: profileSettings.stability,
              similarityBoost: profileSettings.similarityBoost,
              style: profileSettings.style,
              speakerBoost: profileSettings.speakerBoost
            },
            model: profileSettings.model || options?.modelId,
            outputFormat: profileSettings.outputFormat
          }
        );
      } else if (conversationId) {
        // We have a conversation ID but it's not in our map - create it
        this.conversations.set(conversationId, {
          id: conversationId,
          createdAt: new Date(),
          lastActivity: new Date(),
          active: true,
          messages: [],
          isGenerating: false
        });

        // Now use it for streaming
        await this.streamSpeech(
          conversationId,
          text,
          voiceId,
          onAudioChunkProxy,
          {
            latencyOptimization,
            voiceSettings: {
              stability: profileSettings.stability,
              similarityBoost: profileSettings.similarityBoost,
              style: profileSettings.style,
              speakerBoost: profileSettings.speakerBoost
            },
            model: profileSettings.model || options?.modelId,
            outputFormat: profileSettings.outputFormat
          }
        );
      } else {
        // Fallback to streaming with stable conversation via streamSpeechGeneration
        await this.streamSpeechGeneration(
          text,
          voiceId,
          onAudioChunkProxy,
          {
            optimizeLatency: latencyOptimization !== 0,
            stability: profileSettings.stability,
            similarityBoost: profileSettings.similarityBoost,
            style: profileSettings.style
          },
          conversationId  // Pass the persistent conversation ID
        );
      }

      // Cache the complete audio if it's short or caching was explicitly requested
      if ((options?.cacheResult || text.length < 100) && chunks.length > 0 && this.responseCache) {
        // Ensure all chunks are proper Buffers before concatenating
        const validChunks = chunks.filter(chunk => Buffer.isBuffer(chunk) && chunk.length > 0);
        if (validChunks.length > 0) {
          const completeAudio = Buffer.concat(validChunks);
          this.responseCache.set(cacheKey, completeAudio);
          logger.debug(`Cached streamed audio for: "${text.substring(0, 20)}..."`);
        } else {
          logger.warn(`No valid buffer chunks to cache for: "${text.substring(0, 20)}..."`);
        }
      }
    } catch (error) {
      logger.error(`Error streaming optimized speech: ${getErrorMessage(error)}`);
      throw new Error(`Optimized speech streaming failed: ${getErrorMessage(error)}`);
    }
  }
}

// Singleton instance
let sdkService: ElevenLabsSDKService | null = null;

/**
 * Initialize the ElevenLabs SDK Service
 * @param apiKey ElevenLabs API key
 * @param openAIApiKey OpenAI API key for conversation enhancement
 * @returns Service instance
 */
export function initializeSDKService(
  apiKey: string
): ElevenLabsSDKService | null {
  try {
    console.log('initializeSDKService called with:', {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
    });

    if (!apiKey || apiKey.trim() === '') {
      console.error('Cannot initialize SDK Service: ElevenLabs API key is missing or empty');
      logger.error('Cannot initialize SDK Service: ElevenLabs API key is missing or empty');
      return null;
    }

    if (!sdkService) {
      console.log('Creating new ElevenLabsSDKService instance...');
      sdkService = new ElevenLabsSDKService(apiKey);
      console.log('ElevenLabs SDK Service initialized successfully with new instance');
      logger.info('ElevenLabs SDK Service initialized successfully with new instance');
    } else {
      // Update API keys if service already exists
      console.log('Updating existing ElevenLabsSDKService with new API keys...');
      sdkService.updateApiKeys(apiKey);
      console.log('ElevenLabs SDK Service updated with new API keys');
      logger.info('ElevenLabs SDK Service updated with new API keys');
    }

    // Do a quick validation of the API key by attempting to get voices
    // This is wrapped in a Promise.race to timeout if it takes too long
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('API validation timed out')), 5000);
    });

    // Attempt to validate the API in the background without blocking
    Promise.race([
      (async () => {
        try {
          console.log('Starting background API key validation...');
          await sdkService.getVoices();
          console.log('ElevenLabs API key validated successfully');
          logger.info('ElevenLabs API key validated successfully');
        } catch (error) {
          console.error(`ElevenLabs API key validation failed: ${getErrorMessage(error)}`);
          logger.error(`ElevenLabs API key validation failed: ${getErrorMessage(error)}`);
          // Don't set to null here, as it might just be a temporary network issue
        }
      })(),
      timeoutPromise
    ]).catch(error => {
      console.warn(`API validation check: ${getErrorMessage(error)}`);
      logger.warn(`API validation check: ${getErrorMessage(error)}`);
    });

    return sdkService;
  } catch (error) {
    console.error(`Failed to initialize ElevenLabs SDK Service: ${getErrorMessage(error)}`);
    logger.error(`Failed to initialize ElevenLabs SDK Service: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Get the ElevenLabs SDK Service instance
 * @returns Service instance or null if not initialized
 */
export function getSDKService(): ElevenLabsSDKService | null {
  return sdkService;
}

// Export default interface for singleton pattern
export default {
  initialize: initializeSDKService,
  getService: getSDKService
};
