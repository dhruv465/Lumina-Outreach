/**
 * AI Orchestration Layer
 * 
 * This service provides a unified interface for managing and coordinating
 * multiple AI services, including LLM providers, voice synthesis, and
 * emotion detection.
 */

import { EventEmitter } from 'events';
import { LLMService } from './llm/service';
import { 
  LLMConfig, 
  LLMProvider, 
  LLMChatRequest, 
  LLMCompletionRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo
} from './llm/types';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import { RAGService } from './rag/ragService';
import logger, { getErrorMessage } from '../utils/logger';
import mongoose from 'mongoose';
import Configuration from '../models/Configuration';
import Campaign from '../models/Campaign';

// Event types
export enum OrchestrationEvent {
  LLM_REQUEST = 'llm-request',
  LLM_RESPONSE = 'llm-response',
  LLM_ERROR = 'llm-error',
  VOICE_REQUEST = 'voice-request',
  VOICE_RESPONSE = 'voice-response',
  VOICE_ERROR = 'voice-error',
  EMOTION_DETECTED = 'emotion-detected',
  RAG_RETRIEVAL = 'rag-retrieval',
  SERVICE_STATUS_CHANGE = 'service-status-change'
}

// Emotion detection types
export interface EmotionDetectionResult {
  emotion: string;
  confidence: number;
  secondaryEmotion?: string;
  secondaryConfidence?: number;
  valence: number; // -1 to 1, negative to positive
  arousal: number; // 0 to 1, calm to excited
  timestamp: number;
}

// Voice synthesis types
export interface VoiceSynthesisRequest {
  text: string;
  voiceId: string;
  language?: string;
  emotionHint?: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface VoiceSynthesisResponse {
  audioContent: Buffer;
  metadata: {
    duration: number;
    format: string;
    emotions?: EmotionDetectionResult[];
  };
  audioUrl?: string;
}

// RAG types
export interface RAGRequest {
  query: string;
  contextId?: string;
  filters?: Record<string, any>;
  maxResults?: number;
}

export interface RAGResult {
  documents: Array<{
    content: string;
    metadata: Record<string, any>;
    score: number;
  }>;
  contextId: string;
}

// Service status
export interface ServiceStatus {
  isAvailable: boolean;
  lastChecked: Date;
  errorMessage?: string;
  metrics?: {
    latency: number;
    successRate: number;
    usagePercentage: number;
  };
}

/**
 * Main Orchestration Service
 */
export class AIOrchestrationService extends EventEmitter {
  private llmService: LLMService | null = null;
  private voiceService: EnhancedVoiceAIService | null = null;
  private ragService: RAGService | null = null;
  
  // Service status tracking
  private serviceStatus: Map<string, ServiceStatus> = new Map();
  
  // Cache for frequently used data
  private cache: Map<string, { data: any, timestamp: number, ttl: number }> = new Map();
  
  /**
   * Create a new AI Orchestration Service
   */
  constructor() {
    super();
    
    // Initialize status for services
    this.serviceStatus.set('llm', { 
      isAvailable: false, 
      lastChecked: new Date(),
      metrics: { latency: 0, successRate: 0, usagePercentage: 0 } 
    });
    
    this.serviceStatus.set('voice', { 
      isAvailable: false, 
      lastChecked: new Date(),
      metrics: { latency: 0, successRate: 0, usagePercentage: 0 } 
    });
    
    this.serviceStatus.set('rag', { 
      isAvailable: false, 
      lastChecked: new Date(),
      metrics: { latency: 0, successRate: 0, usagePercentage: 0 } 
    });
    
    // Set up periodic health checks
    this.setupPeriodicHealthChecks();
  }
  
  /**
   * Initialize all services from configuration
   */
  async initialize(): Promise<void> {
    try {
      // Load configuration from database
      const config = await Configuration.findOne();
      
      if (!config) {
        throw new Error('System configuration not found');
      }
      
      // Initialize LLM service
      if (config.llmConfig) {
        this.initializeLLMService(config.llmConfig);
      }
      
      // Initialize Voice service
      if (config.elevenLabsConfig && config.elevenLabsConfig.apiKey) {
        this.initializeVoiceService(config.elevenLabsConfig.apiKey);
      }
      
      // Initialize RAG service
      if (config.ragConfig) {
        this.initializeRAGService(config.ragConfig);
      }
      
      logger.info('AI Orchestration Layer initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize AI Orchestration Layer: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Initialize the LLM service
   */
  private initializeLLMService(config: any): void {
    try {
      // Convert database config to LLMConfig format
      const llmConfig: LLMConfig = {
        providers: config.providers.map((p: any) => ({
          name: p.name as LLMProvider,
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
          defaultModel: p.defaultModel,
          isEnabled: p.isEnabled,
          organization: p.organization
        })),
        defaultProvider: config.defaultProvider as LLMProvider,
        fallbackProviders: config.fallbackProviders as LLMProvider[],
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs
      };
      
      this.llmService = new LLMService(llmConfig);
      
      // Update service status
      this.serviceStatus.set('llm', { 
        isAvailable: true, 
        lastChecked: new Date(),
        metrics: { latency: 0, successRate: 100, usagePercentage: 0 } 
      });
      
      this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
        service: 'llm',
        status: 'available'
      });
      
      logger.info('LLM Service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize LLM Service: ${getErrorMessage(error)}`);
      
      this.serviceStatus.set('llm', { 
        isAvailable: false, 
        lastChecked: new Date(),
        errorMessage: getErrorMessage(error)
      });
      
      this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
        service: 'llm',
        status: 'unavailable',
        error: getErrorMessage(error)
      });
    }
  }
  
  /**
   * Initialize the Voice service
   */
  private initializeVoiceService(apiKey: string): void {
    try {
      this.voiceService = new EnhancedVoiceAIService(apiKey);
      
      // Update service status
      this.serviceStatus.set('voice', { 
        isAvailable: true, 
        lastChecked: new Date(),
        metrics: { latency: 0, successRate: 100, usagePercentage: 0 } 
      });
      
      this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
        service: 'voice',
        status: 'available'
      });
      
      logger.info('Voice Service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize Voice Service: ${getErrorMessage(error)}`);
      
      this.serviceStatus.set('voice', { 
        isAvailable: false, 
        lastChecked: new Date(),
        errorMessage: getErrorMessage(error)
      });
      
      this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
        service: 'voice',
        status: 'unavailable',
        error: getErrorMessage(error)
      });
    }
  }
  
  /**
   * Initialize the RAG service
   */
  private initializeRAGService(config: any): void {
    try {
      this.ragService = new RAGService(config);
      
      // Update service status
      this.serviceStatus.set('rag', { 
        isAvailable: true, 
        lastChecked: new Date(),
        metrics: { latency: 0, successRate: 100, usagePercentage: 0 } 
      });
      
      this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
        service: 'rag',
        status: 'available'
      });
      
      logger.info('RAG Service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize RAG Service: ${getErrorMessage(error)}`);
      
      this.serviceStatus.set('rag', { 
        isAvailable: false, 
        lastChecked: new Date(),
        errorMessage: getErrorMessage(error)
      });
      
      this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
        service: 'rag',
        status: 'unavailable',
        error: getErrorMessage(error)
      });
    }
  }
  
  /**
   * Set up periodic health checks for all services
   */
  private setupPeriodicHealthChecks(): void {
    // Check every 5 minutes
    setInterval(async () => {
      await this.performHealthChecks();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Perform health checks on all services
   */
  async performHealthChecks(): Promise<void> {
    // Check LLM service
    if (this.llmService) {
      try {
        // Test connection with default provider
        const providers = this.llmService.listProviders();
        let llmAvailable = false;
        
        // Try each provider until one works
        for (const provider of providers) {
          try {
            const client = this.llmService.getProvider(provider);
            const result = await client.testConnection();
            
            if (result) {
              llmAvailable = true;
              break;
            }
          } catch (error) {
            logger.warn(`Provider ${provider} health check failed: ${getErrorMessage(error)}`);
          }
        }
        
        this.serviceStatus.set('llm', { 
          isAvailable: llmAvailable, 
          lastChecked: new Date(),
          metrics: { 
            latency: 0, 
            successRate: llmAvailable ? 100 : 0, 
            usagePercentage: 0 
          } 
        });
        
        this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
          service: 'llm',
          status: llmAvailable ? 'available' : 'unavailable'
        });
      } catch (error) {
        logger.error(`LLM Service health check failed: ${getErrorMessage(error)}`);
        
        this.serviceStatus.set('llm', { 
          isAvailable: false, 
          lastChecked: new Date(),
          errorMessage: getErrorMessage(error)
        });
        
        this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
          service: 'llm',
          status: 'unavailable',
          error: getErrorMessage(error)
        });
      }
    }
    
    // Check Voice service
    if (this.voiceService) {
      try {
        const healthResult = await this.voiceService.healthCheck();
        
        this.serviceStatus.set('voice', { 
          isAvailable: healthResult, 
          lastChecked: new Date(),
          metrics: { 
            latency: 0, 
            successRate: healthResult ? 100 : 0, 
            usagePercentage: 0 
          } 
        });
        
        this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
          service: 'voice',
          status: healthResult ? 'available' : 'unavailable'
        });
      } catch (error) {
        logger.error(`Voice Service health check failed: ${getErrorMessage(error)}`);
        
        this.serviceStatus.set('voice', { 
          isAvailable: false, 
          lastChecked: new Date(),
          errorMessage: getErrorMessage(error)
        });
        
        this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
          service: 'voice',
          status: 'unavailable',
          error: getErrorMessage(error)
        });
      }
    }
    
    // Check RAG service
    if (this.ragService) {
      try {
        const healthResult = await this.ragService.healthCheck();
        
        this.serviceStatus.set('rag', { 
          isAvailable: healthResult, 
          lastChecked: new Date(),
          metrics: { 
            latency: 0, 
            successRate: healthResult ? 100 : 0, 
            usagePercentage: 0 
          } 
        });
        
        this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
          service: 'rag',
          status: healthResult ? 'available' : 'unavailable'
        });
      } catch (error) {
        logger.error(`RAG Service health check failed: ${getErrorMessage(error)}`);
        
        this.serviceStatus.set('rag', { 
          isAvailable: false, 
          lastChecked: new Date(),
          errorMessage: getErrorMessage(error)
        });
        
        this.emit(OrchestrationEvent.SERVICE_STATUS_CHANGE, {
          service: 'rag',
          status: 'unavailable',
          error: getErrorMessage(error)
        });
      }
    }
  }
  
  /**
   * Get the current status of all services
   */
  getServiceStatus(): Record<string, ServiceStatus> {
    const status: Record<string, ServiceStatus> = {};
    
    for (const [service, serviceStatus] of this.serviceStatus.entries()) {
      status[service] = serviceStatus;
    }
    
    return status;
  }
  
  /**
   * Send a chat request to the LLM service with context enhancement
   */
  async chat(request: LLMChatRequest, contextParams?: {
    campaignId?: string;
    leadId?: string;
    enhanceWithRAG?: boolean;
    ragQuery?: string;
  }): Promise<LLMResponse> {
    // Ensure LLM service is available
    if (!this.llmService) {
      throw new Error('LLM Service not initialized');
    }
    
    // Track metrics
    const startTime = Date.now();
    this.emit(OrchestrationEvent.LLM_REQUEST, {
      provider: request.provider,
      model: request.model,
      messageCount: request.messages.length
    });
    
    try {
      // Enhance with RAG if requested and available
      if (contextParams?.enhanceWithRAG && this.ragService && contextParams.ragQuery) {
        try {
          const ragResults = await this.ragService.query({
            query: contextParams.ragQuery,
            filters: {
              campaignId: contextParams.campaignId,
              leadId: contextParams.leadId
            }
          });
          
          // Add RAG results to system prompt
          if (ragResults.documents.length > 0) {
            // Find system message
            const systemMessageIndex = request.messages.findIndex(m => m.role === 'system');
            
            if (systemMessageIndex >= 0) {
              // Enhance existing system message
              const enhancedSystemContent = `${request.messages[systemMessageIndex].content}\n\nAdditional context:\n${ragResults.documents.map(d => d.content).join('\n\n')}`;
              
              request.messages[systemMessageIndex].content = enhancedSystemContent;
            } else {
              // Create new system message with context
              const contextMessage = {
                role: 'system' as const,
                content: `Context information:\n${ragResults.documents.map(d => d.content).join('\n\n')}`
              };
              
              // Insert at beginning
              request.messages.unshift(contextMessage);
            }
            
            this.emit(OrchestrationEvent.RAG_RETRIEVAL, {
              query: contextParams.ragQuery,
              documentCount: ragResults.documents.length,
              contextId: ragResults.contextId
            });
          }
        } catch (error) {
          logger.warn(`RAG enhancement failed, continuing without RAG: ${getErrorMessage(error)}`);
        }
      }
      
      // Campaign-specific model override
      let campaignSpecificModel = '';
      if (contextParams?.campaignId) {
        try {
          const campaign = await Campaign.findById(contextParams.campaignId);
          if (campaign?.llmConfiguration?.model) {
            campaignSpecificModel = campaign.llmConfiguration.model;
            logger.info(`Using campaign-specific LLM model: ${campaignSpecificModel}`);
          }
        } catch (error) {
          logger.warn(`Failed to get campaign LLM model: ${getErrorMessage(error)}`);
        }
      }
      
      // Apply campaign-specific model if available
      if (campaignSpecificModel) {
        request.model = campaignSpecificModel;
      }
      
      // Forward to LLM service
      const response = await this.llmService.chat(request);
      
      // Track metrics
      const latency = Date.now() - startTime;
      this.emit(OrchestrationEvent.LLM_RESPONSE, {
        provider: request.provider,
        model: request.model,
        latency,
        usage: response.usage
      });
      
      // Update service metrics
      const llmStatus = this.serviceStatus.get('llm');
      if (llmStatus) {
        llmStatus.metrics = {
          ...llmStatus.metrics,
          latency
        };
      }
      
      return response;
    } catch (error) {
      // Track error
      this.emit(OrchestrationEvent.LLM_ERROR, {
        provider: request.provider,
        model: request.model,
        error: getErrorMessage(error)
      });
      
      // Update service metrics
      const llmStatus = this.serviceStatus.get('llm');
      if (llmStatus && llmStatus.metrics) {
        llmStatus.metrics.successRate = Math.max(0, (llmStatus.metrics.successRate || 100) - 10);
      }
      
      throw error;
    }
  }
  
  /**
   * Stream a chat completion with context enhancement
   */
  async streamChat(
    request: LLMChatRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
    contextParams?: {
      campaignId?: string;
      leadId?: string;
      enhanceWithRAG?: boolean;
      ragQuery?: string;
    }
  ): Promise<void> {
    // Ensure LLM service is available
    if (!this.llmService) {
      throw new Error('LLM Service not initialized');
    }
    
    // Track metrics
    const startTime = Date.now();
    this.emit(OrchestrationEvent.LLM_REQUEST, {
      provider: request.provider,
      model: request.model,
      messageCount: request.messages.length,
      streaming: true
    });
    
    try {
      // Enhance with RAG if requested and available
      if (contextParams?.enhanceWithRAG && this.ragService && contextParams.ragQuery) {
        try {
          const ragResults = await this.ragService.query({
            query: contextParams.ragQuery,
            filters: {
              campaignId: contextParams.campaignId,
              leadId: contextParams.leadId
            }
          });
          
          // Add RAG results to system prompt
          if (ragResults.documents.length > 0) {
            // Find system message
            const systemMessageIndex = request.messages.findIndex(m => m.role === 'system');
            
            if (systemMessageIndex >= 0) {
              // Enhance existing system message
              const enhancedSystemContent = `${request.messages[systemMessageIndex].content}\n\nAdditional context:\n${ragResults.documents.map(d => d.content).join('\n\n')}`;
              
              request.messages[systemMessageIndex].content = enhancedSystemContent;
            } else {
              // Create new system message with context
              const contextMessage = {
                role: 'system' as const,
                content: `Context information:\n${ragResults.documents.map(d => d.content).join('\n\n')}`
              };
              
              // Insert at beginning
              request.messages.unshift(contextMessage);
            }
            
            this.emit(OrchestrationEvent.RAG_RETRIEVAL, {
              query: contextParams.ragQuery,
              documentCount: ragResults.documents.length,
              contextId: ragResults.contextId
            });
          }
        } catch (error) {
          logger.warn(`RAG enhancement failed, continuing without RAG: ${getErrorMessage(error)}`);
        }
      }
      
      // Campaign-specific model override
      let campaignSpecificModel = '';
      if (contextParams?.campaignId) {
        try {
          const campaign = await Campaign.findById(contextParams.campaignId);
          if (campaign?.llmConfiguration?.model) {
            campaignSpecificModel = campaign.llmConfiguration.model;
            logger.info(`Using campaign-specific LLM model: ${campaignSpecificModel}`);
          }
        } catch (error) {
          logger.warn(`Failed to get campaign LLM model: ${getErrorMessage(error)}`);
        }
      }
      
      // Apply campaign-specific model if available
      if (campaignSpecificModel) {
        request.model = campaignSpecificModel;
      }
      
      // Create enhanced chunk handler to track metrics
      let totalTokens = 0;
      const enhancedChunkHandler = (chunk: LLMStreamChunk) => {
        // Count approximate tokens (very rough estimation)
        totalTokens += chunk.content.length / 4;
        
        // Forward to original handler
        onChunk(chunk);
        
        // If this is the final chunk, emit metrics
        if (chunk.isDone) {
          const latency = Date.now() - startTime;
          this.emit(OrchestrationEvent.LLM_RESPONSE, {
            provider: request.provider,
            model: request.model,
            latency,
            streaming: true,
            estimatedTokens: totalTokens
          });
          
          // Update service metrics
          const llmStatus = this.serviceStatus.get('llm');
          if (llmStatus) {
            llmStatus.metrics = {
              ...llmStatus.metrics,
              latency
            };
          }
        }
      };
      
      // Forward to LLM service
      await this.llmService.streamChat(request, enhancedChunkHandler);
    } catch (error) {
      // Track error
      this.emit(OrchestrationEvent.LLM_ERROR, {
        provider: request.provider,
        model: request.model,
        error: getErrorMessage(error),
        streaming: true
      });
      
      // Update service metrics
      const llmStatus = this.serviceStatus.get('llm');
      if (llmStatus && llmStatus.metrics) {
        llmStatus.metrics.successRate = Math.max(0, (llmStatus.metrics.successRate || 100) - 10);
      }
      
      throw error;
    }
  }
  
  /**
   * Synthesize voice with emotion detection
   */
  async synthesizeVoice(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResponse> {
    // Ensure Voice service is available
    if (!this.voiceService) {
      throw new Error('Voice Service not initialized');
    }
    
    // Track metrics
    const startTime = Date.now();
    this.emit(OrchestrationEvent.VOICE_REQUEST, {
      voiceId: request.voiceId,
      textLength: request.text.length,
      language: request.language
    });
    
    try {
      // Forward to Voice service with appropriate personality
      const result = await this.voiceService.synthesizeAdaptiveVoice({
        text: request.text,
        personalityId: request.voiceId,
        language: request.language || 'en'
      });
      
      // Perform emotion detection on the generated audio
      const emotions = await this.detectEmotions(request.text);
      
      if (emotions) {
        this.emit(OrchestrationEvent.EMOTION_DETECTED, emotions);
      }
      
      // Track metrics
      const latency = Date.now() - startTime;
      this.emit(OrchestrationEvent.VOICE_RESPONSE, {
        voiceId: request.voiceId,
        latency,
        audioSize: result.audioContent.length
      });
      
      // Update service metrics
      const voiceStatus = this.serviceStatus.get('voice');
      if (voiceStatus) {
        voiceStatus.metrics = {
          ...voiceStatus.metrics,
          latency
        };
      }
      
      // Return the result with emotion data
      return {
        audioContent: result.audioContent,
        metadata: {
          duration: result.metadata.duration,
          format: 'mp3',
          emotions: emotions ? [emotions] : undefined
        },
        audioUrl: result.audioUrl
      };
    } catch (error) {
      // Track error
      this.emit(OrchestrationEvent.VOICE_ERROR, {
        voiceId: request.voiceId,
        error: getErrorMessage(error)
      });
      
      // Update service metrics
      const voiceStatus = this.serviceStatus.get('voice');
      if (voiceStatus && voiceStatus.metrics) {
        voiceStatus.metrics.successRate = Math.max(0, (voiceStatus.metrics.successRate || 100) - 10);
      }
      
      throw error;
    }
  }
  
  /**
   * Perform emotion detection on text
   */
  private async detectEmotions(text: string): Promise<EmotionDetectionResult | null> {
    // If LLM service is not available, skip emotion detection
    if (!this.llmService) {
      return null;
    }
    
    try {
      // Use OpenAI for emotion detection
      const providers = this.llmService.listProviders();
      if (!providers.includes('openai')) {
        return null;
      }
      
      // Simple emotion detection prompt
      const response = await this.llmService.chat({
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Analyze the following text and detect the primary emotion expressed. 
            Return a JSON object with:
            - emotion (string): The primary emotion (anger, fear, joy, sadness, surprise, disgust, neutral)
            - confidence (number): Confidence score from 0 to 1
            - secondaryEmotion (string, optional): Secondary emotion if present
            - secondaryConfidence (number, optional): Confidence score for secondary emotion
            - valence (number): Emotional valence from -1 (negative) to 1 (positive)
            - arousal (number): Emotional arousal from 0 (calm) to 1 (excited)`
          },
          {
            role: 'user',
            content: text
          }
        ],
        options: {
          temperature: 0.2,
          maxTokens: 150
        },
        responseFormat: {
          type: 'json'
        }
      });
      
      // Parse the JSON response
      try {
        const emotionData = JSON.parse(response.content);
        
        // Validate emotion data
        if (typeof emotionData.emotion === 'string' && 
            typeof emotionData.confidence === 'number' &&
            typeof emotionData.valence === 'number' &&
            typeof emotionData.arousal === 'number') {
          
          return {
            ...emotionData,
            timestamp: Date.now()
          };
        }
      } catch (parseError) {
        logger.warn(`Failed to parse emotion detection response: ${getErrorMessage(parseError)}`);
      }
    } catch (error) {
      logger.warn(`Emotion detection failed: ${getErrorMessage(error)}`);
    }
    
    return null;
  }
  
  /**
   * Perform RAG query to retrieve relevant context
   */
  async retrieveContext(request: RAGRequest): Promise<RAGResult> {
    // Ensure RAG service is available
    if (!this.ragService) {
      throw new Error('RAG Service not initialized');
    }
    
    try {
      const result = await this.ragService.query(request);
      
      this.emit(OrchestrationEvent.RAG_RETRIEVAL, {
        query: request.query,
        documentCount: result.documents.length,
        contextId: result.contextId
      });
      
      return result;
    } catch (error) {
      logger.error(`RAG query failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Update service configuration
   */
  async updateConfiguration(config: {
    llmConfig?: LLMConfig;
    elevenLabsApiKey?: string;
    ragConfig?: any;
  }): Promise<void> {
    try {
      // Update LLM service if config provided
      if (config.llmConfig) {
        if (this.llmService) {
          this.llmService.updateConfig(config.llmConfig);
        } else {
          this.initializeLLMService(config.llmConfig);
        }
        
        // Update configuration in database
        await Configuration.findOneAndUpdate(
          {}, 
          { llmConfig: config.llmConfig },
          { upsert: true }
        );
      }
      
      // Update Voice service if API key provided
      if (config.elevenLabsApiKey) {
        if (this.voiceService) {
          // Re-initialize with new API key
          this.initializeVoiceService(config.elevenLabsApiKey);
        } else {
          this.initializeVoiceService(config.elevenLabsApiKey);
        }
        
        // Update configuration in database
        await Configuration.findOneAndUpdate(
          {}, 
          { 'elevenLabsConfig.apiKey': config.elevenLabsApiKey },
          { upsert: true }
        );
      }
      
      // Update RAG service if config provided
      if (config.ragConfig) {
        if (this.ragService) {
          await this.ragService.updateConfiguration(config.ragConfig);
        } else {
          this.initializeRAGService(config.ragConfig);
        }
        
        // Update configuration in database
        await Configuration.findOneAndUpdate(
          {}, 
          { ragConfig: config.ragConfig },
          { upsert: true }
        );
      }
      
      // Perform health checks
      await this.performHealthChecks();
      
      logger.info('AI Orchestration Layer configuration updated successfully');
    } catch (error) {
      logger.error(`Failed to update AI Orchestration Layer configuration: ${getErrorMessage(error)}`);
      throw error;
    }
  }
}

// Create a singleton instance
let orchestrationService: AIOrchestrationService | null = null;

/**
 * Get the orchestration service instance
 */
export function getOrchestrationService(): AIOrchestrationService {
  if (!orchestrationService) {
    orchestrationService = new AIOrchestrationService();
  }
  
  return orchestrationService;
}

/**
 * Initialize the orchestration service
 */
export async function initializeOrchestrationService(): Promise<AIOrchestrationService> {
  if (!orchestrationService) {
    orchestrationService = new AIOrchestrationService();
    await orchestrationService.initialize();
  }
  
  return orchestrationService;
}
