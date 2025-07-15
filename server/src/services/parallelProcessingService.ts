/**
 * Parallel Processing Service
 * 
 * This service optimizes conversation flow by:
 * 1. Implementing parallel processing of AI response generation and voice synthesis
 * 2. Using streaming responses to reduce perceived latency
 * 3. Implementing caching for common responses
 * 4. Adding human-like audio cues during processing
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger, getErrorMessage } from '../index';
import { ConversationTurn } from './conversationEngineService';
import { ElevenLabsSDKService } from './elevenlabsSDKService';
import { LLMService } from './llm/service';
import { LLMMessage, MessageRole } from './llm/types';
import responseCache from '../utils/responseCache';
import { voiceSettings, parallelProcessingSettings } from '../config/latencyOptimization';

// Audio cue types for more human-like interactions
export enum AudioCueType {
  THINKING = 'thinking',
  ACKNOWLEDGMENT = 'acknowledgment',
  TRANSITION = 'transition'
}

// Events that can be emitted during processing
export enum ProcessingEvent {
  PROCESSING_START = 'processing-start',
  THINKING_CUE = 'thinking-cue',
  PARTIAL_RESPONSE = 'partial-response',
  RESPONSE_CHUNK = 'response-chunk',
  PROCESSING_COMPLETE = 'processing-complete',
  ERROR = 'error'
}

// Interface for thinking sound cues
interface ThinkingCue {
  id: string;
  audioBuffer: Buffer;
  duration: number; // in milliseconds
  type: 'hmm' | 'uh' | 'let-me-think' | 'well';
}

export class ParallelProcessingService extends EventEmitter {
  private sdkService: ElevenLabsSDKService;
  private llmService: LLMService;
  private thinkingSounds: Map<string, ThinkingCue[]> = new Map(); // Mapped by voice ID
  private activeProcessingIds: Set<string> = new Set();
  private partialResponseTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(sdkService: ElevenLabsSDKService, llmService: LLMService) {
    super();
    this.sdkService = sdkService;
    this.llmService = llmService;
    
    // Initialize thinking sounds for different voices
    this.initializeThinkingSounds().catch(error => {
      logger.error(`Failed to initialize thinking sounds: ${getErrorMessage(error)}`);
    });
  }
  
  /**
   * Initialize thinking sounds for each voice
   * These are short audio cues that make the AI seem more human-like
   */
  private async initializeThinkingSounds(): Promise<void> {
    try {
      // Get available voices from the SDK service
      const voicesResponse = await this.sdkService.getVoices();
      // Normalize response to an array, handling nested structures
      const voices: any[] = Array.isArray(voicesResponse)
        ? voicesResponse
        : (Array.isArray(voicesResponse.voices)
            ? voicesResponse.voices
            : (Array.isArray(voicesResponse.data?.voices)
                ? voicesResponse.data.voices
                : []));
      
      // Generate thinking sounds for each voice
      for (const voice of voices) {
        const voiceId = voice.voice_id;
        const thinkingPhrases = [
          { text: 'Hmm...', type: 'hmm' as const, duration: 800 },
          { text: 'Uh...', type: 'uh' as const, duration: 500 },
          { text: 'Let me think about that.', type: 'let-me-think' as const, duration: 1500 },
          { text: 'Well...', type: 'well' as const, duration: 600 }
        ];
        
        const cues: ThinkingCue[] = [];
        
        // Generate audio for each thinking phrase with delay to avoid rate limits
        for (const phrase of thinkingPhrases) {
          try {
            // Add delay between requests to avoid rate limiting
            if (thinkingPhrases.indexOf(phrase) > 0) {
              await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
            }
            
            const audioBuffer = await this.sdkService.generateSpeech(
              phrase.text,
              voiceId,
              { 
                optimizeLatency: true,
                stability: 0.3, // Lower stability for more natural-sounding thinking
                style: 0.3 // Add some style variation
              }
            );
            
            cues.push({
              id: uuidv4(),
              audioBuffer,
              duration: phrase.duration,
              type: phrase.type
            });
            
            logger.debug(`Generated thinking sound "${phrase.text}" for voice ${voiceId}`);
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            if (errorMessage.includes('Rate limit') || errorMessage.includes('429')) {
              logger.warn(`Rate limit hit while generating thinking sound "${phrase.text}" for voice ${voiceId}, skipping remaining phrases for this voice`);
              break; // Skip remaining phrases for this voice to avoid more rate limit errors
            } else {
              logger.warn(`Failed to generate thinking sound "${phrase.text}" for voice ${voiceId}: ${errorMessage}`);
            }
          }
        }
        
        // Store cues for this voice
        if (cues.length > 0) {
          this.thinkingSounds.set(voiceId, cues);
        }
      }
      
      logger.info(`Initialized thinking sounds for ${this.thinkingSounds.size} voices`);
    } catch (error) {
      logger.error(`Error initializing thinking sounds: ${getErrorMessage(error)}`);
    }
  }
  
  /**
   * Process user input in parallel with optimized streaming
   * This is the main optimization method that:
   * 1. Starts generating an acknowledgment immediately
   * 2. Processes the AI response in parallel
   * 3. Streams the response as soon as parts become available
   * 4. Adds natural thinking sounds while processing
   */
  public async processInputParallel(
    conversationId: string,
    userInput: string,
    voiceId: string,
    conversationHistory: ConversationTurn[],
    options: {
      streamCallback: (chunk: Buffer) => void;
      leadId?: string;
      campaignId?: string;
      language?: string;
      useThinkingSounds?: boolean;
      streamPartialResponses?: boolean;
      optimizationProfile?: 'ultraLow' | 'low' | 'balanced' | 'highQuality';
    }
  ): Promise<{ text: string; processingTime: number }> {
    const processingId = uuidv4();
    const startTime = Date.now();
    
    this.activeProcessingIds.add(processingId);
    
    try {
      // Emit processing start event
      this.emit(ProcessingEvent.PROCESSING_START, { 
        conversationId, 
        processingId 
      });
      
      // First, check if this is a common phrase we already have cached
      const cacheKey = `${voiceId}_${userInput.toLowerCase()}`;
      if (responseCache.has(cacheKey)) {
        logger.info(`Using cached response for input: "${userInput.substring(0, 20)}..."`);
        const audioBuffer = responseCache.get(cacheKey);
        
        // Send the cached audio
        options.streamCallback(audioBuffer);
        
        // Complete the processing
        this.activeProcessingIds.delete(processingId);
        
        // Emit processing complete event
        this.emit(ProcessingEvent.PROCESSING_COMPLETE, {
          conversationId,
          processingId,
          responseText: userInput,
          processingTime: Date.now() - startTime
        });
        
        // Return immediately
        return { 
          text: userInput, 
          processingTime: Date.now() - startTime 
        };
      }
      
      // For longer inputs, send an acknowledgment to reduce perceived latency
      // Use ultra-low latency profile for acknowledgments
      if (userInput.length > 30 && options.useThinkingSounds !== false) {
        await this.sendAcknowledgment(voiceId, options.streamCallback, parallelProcessingSettings.acknowledgmentDelay);
      }
      
      // Start AI processing to generate the response
      const llmPromise = this.generateAIResponse(conversationId, userInput, conversationHistory, {
        leadId: options.leadId,
        campaignId: options.campaignId,
        language: options.language
      });
      
      // If enabled, play thinking sounds while waiting for AI response
      if (options.useThinkingSounds !== false) {
        this.scheduleThinkingSound(
          voiceId, 
          processingId, 
          options.streamCallback,
          parallelProcessingSettings.thinkingDelay
        );
      }
      
      // If streaming partial responses is enabled, set up timer for partial responses
      if (options.streamPartialResponses !== false || parallelProcessingSettings.streamPartialResponses) {
        this.setupPartialResponseGeneration(
          processingId,
          voiceId,
          options.streamCallback
        );
      }
      
      // Wait for AI response
      const aiResponse = await llmPromise;
      
      // Validate AI response
      if (!aiResponse || !aiResponse.text || typeof aiResponse.text !== 'string') {
        logger.error(`Invalid AI response in parallel processing: ${JSON.stringify(aiResponse)}`);
        this.emit(ProcessingEvent.ERROR, { 
          conversationId, 
          processingId, 
          error: 'AI response is invalid or missing text' 
        });
        this.activeProcessingIds.delete(processingId);
        return;
      }
      
      // Clear any scheduled thinking sounds or partial response timers
      this.clearActiveTimers(processingId);
      
      // Stream the final response with optimized settings based on requested profile
      const onAudioChunk = (chunk: Buffer) => {
        options.streamCallback(chunk);
        this.emit(ProcessingEvent.RESPONSE_CHUNK, { 
          conversationId, 
          processingId, 
          chunk 
        });
      };
      
      // Use the appropriate optimization profile based on response length and importance
      const profile = options.optimizationProfile || 
                     (aiResponse.text.length > 100 ? 'balanced' : 'low');
      
      // Generate speech for the AI response with streaming
      await this.sdkService.streamOptimizedSpeech(
        aiResponse.text,
        voiceId,
        onAudioChunk,
        { 
          optimizationProfile: profile,
          cacheResult: aiResponse.text.length < 100, // Only cache shorter responses
          conversationId: conversationId // Pass conversationId to streamOptimizedSpeech
        }
      );
      
      // Complete processing
      this.activeProcessingIds.delete(processingId);
      const processingTime = Date.now() - startTime;
      
      this.emit(ProcessingEvent.PROCESSING_COMPLETE, { 
        conversationId, 
        processingId, 
        processingTime,
        text: aiResponse.text
      });
      
      return { 
        text: aiResponse.text, 
        processingTime 
      };
    } catch (error) {
      this.activeProcessingIds.delete(processingId);
      this.clearActiveTimers(processingId);
      
      this.emit(ProcessingEvent.ERROR, { 
        conversationId, 
        processingId, 
        error: getErrorMessage(error) 
      });
      
      logger.error(`Error in parallel processing for conversation ${conversationId}: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Sends an immediate acknowledgment to reduce perceived latency
   */
  private async sendAcknowledgment(
    voiceId: string, 
    streamCallback: (chunk: Buffer) => void,
    delayMs: number = 800
  ): Promise<void> {
    // Delay acknowledgment by configured time 
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    const acknowledgments = [
      "I understand.",
      "Got it.",
      "I see.",
      "Okay."
    ];
    
    const ack = acknowledgments[Math.floor(Math.random() * acknowledgments.length)];
    const cacheKey = `${voiceId}_${ack}`;
    
    try {
      if (responseCache.has(cacheKey)) {
        // Use cached acknowledgment
        streamCallback(responseCache.get(cacheKey));
      } else {
        // Generate new acknowledgment with ultra-low latency settings
        await this.sdkService.streamOptimizedSpeech(
          ack, 
          voiceId, 
          streamCallback,
          { 
            optimizationProfile: 'ultraLow',
            cacheResult: true
          }
        );
        
        // Also cache it for future use
        this.sdkService.generateOptimizedSpeech(ack, voiceId, {
          optimizationProfile: 'ultraLow',
          cacheAsPriority: true
        }).catch(err => logger.debug(`Failed to cache acknowledgment: ${err.message}`));
      }
    } catch (error) {
      logger.warn(`Failed to send acknowledgment: ${getErrorMessage(error)}`);
    }
  }
  
  /**
   * Generate AI response using the LLM service
   */
  private async generateAIResponse(
    conversationId: string,
    userInput: string,
    conversationHistory: ConversationTurn[],
    context: {
      leadId?: string;
      campaignId?: string;
      language?: string;
    }
  ): Promise<{ text: string; intent?: string }> {
    try {
      // Convert conversation history to LLM messages
      const messages: LLMMessage[] = conversationHistory.map(turn => ({
        role: (turn.speaker === 'agent' ? 'assistant' : 'user') as MessageRole,
        content: turn.content
      }));
      
      // Add the current user input
      messages.push({
        role: 'user' as MessageRole,
        content: userInput
      });
      
      // Generate response from LLM
      // Store context info as a system message instead of using the unsupported context parameter
      const contextMessage: LLMMessage = {
        role: 'system' as MessageRole,
        content: `Conversation ID: ${conversationId}
${context.leadId ? `Lead ID: ${context.leadId}` : ''}
${context.campaignId ? `Campaign ID: ${context.campaignId}` : ''}
Language: ${context.language || 'English'}`
      };
      
      // Add context as a system message at the beginning
      const messagesWithContext = [contextMessage, ...messages];
      
      // Check if OpenAI Realtime API is enabled and use it for ultra-low latency
      const openAIProvider = global.llmService?.getConfig()?.providers.find(p => p.name === 'openai');
      let response;
      
      if (openAIProvider?.useRealtimeAPI) {
        // Get the default LLM provider and model from config
        const config = await require('../models/Configuration').default.findOne();
        const realtimeProvider = config?.llmConfig?.providers?.find(p => p.useRealtimeAPI && p.isEnabled);
        const providerName = realtimeProvider?.name || config?.llmConfig?.defaultProvider || 'google';
        const modelName = realtimeProvider?.defaultModel || config?.llmConfig?.defaultModel || 'gemini-1.5-flash';
        
        logger.info(`Using ${providerName} Realtime API for conversation ${conversationId} with model ${modelName}`);
        
        // We'll collect the response here
        let responseText = '';
        
        // Use the realtime chat method
        await this.llmService.realtimeChat({
          provider: providerName,
          model: modelName,
          messages: messagesWithContext,
          options: {
            temperature: config?.llmConfig?.temperature || 0.7,
            maxTokens: config?.llmConfig?.maxTokens || 150
          }
        }, (chunk) => {
          responseText += chunk.content;
        });
        
        response = { content: responseText };
      } else {
        // Get the default LLM provider from config
        const config = await require('../models/Configuration').default.findOne();
        const defaultProvider = config?.llmConfig?.defaultProvider || 'google';
        const defaultModel = config?.llmConfig?.defaultModel || 'gemini-1.5-flash';
        
        logger.info(`Using configured LLM provider: ${defaultProvider} with model: ${defaultModel}`);
        
        try {
          // Use standard API with the configured provider
          response = await this.llmService.chat({
            provider: defaultProvider,
            model: defaultModel,
            messages: messagesWithContext,
            options: {
              temperature: config?.llmConfig?.temperature || 0.7,
              maxTokens: config?.llmConfig?.maxTokens || 150
            }
          });
        } catch (error) {
          // If the configured provider fails, try to fall back to any available provider
          logger.warn(`Provider ${defaultProvider} failed, trying fallbacks: ${getErrorMessage(error)}`);
          
          // Get all available providers
          const providers = config?.llmConfig?.providers || [];
          const enabledProviders = providers.filter(p => p.isEnabled && p.apiKey);
          
          if (enabledProviders.length > 0 && enabledProviders[0].name !== defaultProvider) {
            // Try the first available provider that's not the one that just failed
            const fallbackProvider = enabledProviders[0].name;
            const fallbackModel = enabledProviders[0].defaultModel || 'gemini-1.5-flash';
            
            logger.info(`Falling back to provider: ${fallbackProvider} with model: ${fallbackModel}`);
            
            response = await this.llmService.chat({
              provider: fallbackProvider,
              model: fallbackModel,
              messages: messagesWithContext,
              options: {
                temperature: config?.llmConfig?.temperature || 0.7,
                maxTokens: config?.llmConfig?.maxTokens || 150
              }
            });
          } else {
            // If there are no other providers, rethrow the error
            throw error;
          }
        }
      }
      
      return {
        text: response.content,
        intent: 'continue'
      };
    } catch (error) {
      logger.error(`Error generating AI response: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Schedule a thinking sound to be played while waiting for AI response
   */
  private scheduleThinkingSound(
    voiceId: string,
    processingId: string,
    streamCallback: (chunk: Buffer) => void,
    delay: number = 1500,
    maxThinkingSounds: number = 2
  ): void {
    const thinkingCues = this.thinkingSounds.get(voiceId);
    if (!thinkingCues || thinkingCues.length === 0) {
      logger.debug(`No thinking sounds available for voice ${voiceId}`);
      return;
    }
    
    let thinkingSoundCount = 0;
    
    // Use configured values from settings
    const thinkingDelay = delay;
    const thinkingSoundInterval = parallelProcessingSettings.thinkingSoundInterval;
    const maxSounds = maxThinkingSounds || parallelProcessingSettings.maxThinkingSounds;
    
    // Function to play a random thinking sound
    const playThinkingSound = () => {
      // Stop if processing is no longer active
      if (!this.activeProcessingIds.has(processingId)) {
        return;
      }
      
      // Stop after playing max number of thinking sounds
      if (thinkingSoundCount >= maxSounds) {
        return;
      }
      
      // Select a random thinking sound
      const randomIndex = Math.floor(Math.random() * thinkingCues.length);
      const cue = thinkingCues[randomIndex];
      
      // Emit thinking cue event
      this.emit(ProcessingEvent.THINKING_CUE, { 
        processingId, 
        cueType: cue.type 
      });
      
      // Stream the thinking sound
      streamCallback(cue.audioBuffer);
      thinkingSoundCount++;
      
      // Schedule next thinking sound
      setTimeout(playThinkingSound, thinkingSoundInterval);
    };
    
    // Schedule the first thinking sound
    setTimeout(playThinkingSound, thinkingDelay);
  }
  
  /**
   * Set up a timer to generate partial responses while waiting for full AI response
   */
  private setupPartialResponseGeneration(
    processingId: string,
    voiceId: string,
    streamCallback: (chunk: Buffer) => void,
    initialDelay: number = 3000
  ): void {
    // Only if streaming partial responses is enabled
    if (!parallelProcessingSettings.streamPartialResponses) {
      return;
    }
    
    const partialResponses = [
      "I'm considering your question.",
      "That's a good point. Let me think about that.",
      "Let me process that information.",
      "I'm working on a response for you."
    ];
    
    // Create a timer to generate a partial response if AI takes too long
    const timer = setTimeout(async () => {
      // Check if processing is still active
      if (!this.activeProcessingIds.has(processingId)) {
        return;
      }
      
      try {
        // Select a random partial response
        const randomIndex = Math.floor(Math.random() * partialResponses.length);
        const partialResponse = partialResponses[randomIndex];
        
        // Emit partial response event
        this.emit(ProcessingEvent.PARTIAL_RESPONSE, { 
          processingId, 
          text: partialResponse 
        });
        
        // Check cache first
        const cacheKey = `${voiceId}_${partialResponse}`;
        if (responseCache.has(cacheKey)) {
          streamCallback(responseCache.get(cacheKey));
        } else {
          // Generate speech for the partial response
          await this.sdkService.streamOptimizedSpeech(
            partialResponse,
            voiceId,
            streamCallback,
            { optimizationProfile: 'low' }
          );
          
          // Cache for future use
          this.sdkService.generateOptimizedSpeech(partialResponse, voiceId, {
            optimizationProfile: 'low',
            cacheAsPriority: true
          }).catch(err => logger.debug(`Failed to cache partial response: ${err.message}`));
        }
      } catch (error) {
        logger.warn(`Failed to generate partial response: ${getErrorMessage(error)}`);
      }
    }, initialDelay);
    
    // Store the timer so it can be cleared when no longer needed
    this.partialResponseTimers.set(processingId, timer);
  }
  
  /**
   * Clear all active timers for a processing session
   */
  private clearActiveTimers(processingId: string): void {
    // Clear thinking sounds timer
    const thinkingTimer = this.partialResponseTimers.get(`${processingId}_thinking`);
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      this.partialResponseTimers.delete(`${processingId}_thinking`);
    }
    
    // Clear partial response timer
    const partialTimer = this.partialResponseTimers.get(`${processingId}_partial`);
    if (partialTimer) {
      clearTimeout(partialTimer);
      this.partialResponseTimers.delete(`${processingId}_partial`);
    }
  }
  
  /**
   * Stream speech generation with optimized settings
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
      conversationId?: string; // Add conversationId to options
    }
  ): Promise<void> {
    try {
      // Check cache first
      const cacheKey = `${voiceId}_${text}`;
      if (responseCache.has(cacheKey)) {
        onAudioChunk(responseCache.get(cacheKey));
        return;
      }
      
      // Use optimized settings for latency by default
      const streamOptions = {
        latencyOptimization: options?.optimizeLatency !== false,
        voiceSettings: {
          stability: options?.stability || 0.5,
          similarityBoost: options?.similarityBoost || 0.75,
          style: options?.style || 0.0,
          speakerBoost: true
        }
      };
      
      // Use the SDK service to stream the speech
      await this.sdkService.streamSpeech(
        options?.conversationId || uuidv4(), // Use provided conversationId or create a new one
        text,
        voiceId,
        onAudioChunk,
        streamOptions
      );
      
      // Cache the response if it's short
      if (text.length < 100) {
        this.sdkService.generateSpeech(text, voiceId, { optimizeLatency: true })
          .then(buffer => {
            responseCache.set(cacheKey, buffer);
            logger.debug(`Cached response: "${text.substring(0, 20)}..."`);
          })
          .catch(err => {
            logger.debug(`Failed to cache response: ${err.message}`);
          });
      }
    } catch (error) {
      logger.error(`Error streaming speech generation: ${getErrorMessage(error)}`);
      throw error;
    }
  }
}

// Singleton instance
let parallelProcessingService: ParallelProcessingService | null = null;

/**
 * Initialize the parallel processing service
 */
export const initializeParallelProcessingService = (
  sdkService: ElevenLabsSDKService,
  llmService: LLMService
): ParallelProcessingService => {
  if (!parallelProcessingService) {
    parallelProcessingService = new ParallelProcessingService(sdkService, llmService);
    logger.info('Parallel Processing Service initialized');
  }
  return parallelProcessingService;
};

/**
 * Get the parallel processing service instance
 */
export const getParallelProcessingService = (): ParallelProcessingService | null => {
  return parallelProcessingService;
};

export default {
  initializeParallelProcessingService,
  getParallelProcessingService
};
