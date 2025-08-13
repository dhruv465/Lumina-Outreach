/**
 * Advanced AI Orchestration Layer
 * 
 * This service provides a unified interface for managing multiple AI services,
 * implementing intelligent routing, fallback mechanisms, and performance optimization.
 */

import { EventEmitter } from 'events';
import { LLMService, LLMConfig, LLMProvider, LLMMessage, ModelInfo } from '../llm';
import { ElevenLabsSDKService, ConversationEvent } from '../elevenlabsSDKService';
import logger from '../../utils/logger';
import { getErrorMessage } from '../../utils/logger';
import mongoose from 'mongoose';
import { RateLimitAwareCircuitBreaker, createRateLimitAwareCircuitBreaker } from '../../utils/circuitBreaker';

// Orchestration events
export enum OrchestrationEvent {
  SERVICE_STATUS_CHANGE = 'service-status-change',
  PERFORMANCE_METRICS = 'performance-metrics',
  ERROR = 'error',
  FALLBACK_ACTIVATED = 'fallback-activated',
  REQUEST_COMPLETE = 'request-complete'
}

// Service types supported by the orchestration layer
export enum ServiceType {
  LLM = 'llm',
  VOICE = 'voice',
  SPEECH_RECOGNITION = 'speech-recognition',
  EMOTION_DETECTION = 'emotion-detection',
  MULTIMODAL = 'multimodal'
}

// Status of a service
export enum ServiceStatus {
  AVAILABLE = 'available',
  DEGRADED = 'degraded',
  UNAVAILABLE = 'unavailable',
  RATE_LIMITED = 'rate-limited',
  CIRCUIT_OPEN = 'circuit-open'
}

// Performance metrics for a service
export interface ServiceMetrics {
  latency: number;
  successRate: number;
  throughput: number;
  lastUpdated: Date;
}

// Configuration for service routing
export interface RoutingRule {
  serviceType: ServiceType;
  preferredProvider: string;
  fallbackProviders: string[];
  routingStrategy: 'performance' | 'cost' | 'quality' | 'latency';
  contextThreshold?: number; // Context length threshold for routing
  customRules?: any; // Custom routing rules
}

/**
 * The AI Orchestration Layer manages multiple AI services and provides
 * intelligent routing, fallback mechanisms, and performance optimization.
 */
export class AIOrchestrationLayer extends EventEmitter {
  private llmService: LLMService | null = null;
  private voiceService: ElevenLabsSDKService | null = null;
  private serviceStatus: Map<ServiceType, ServiceStatus> = new Map();
  private serviceMetrics: Map<ServiceType, ServiceMetrics> = new Map();
  private routingRules: Map<ServiceType, RoutingRule> = new Map();
  private circuitBreakers: Map<string, RateLimitAwareCircuitBreaker<any[], any>> = new Map();
  
  // Initialize with default settings
  constructor() {
    super();
    
    // Set default service status
    Object.values(ServiceType).forEach(type => {
      this.serviceStatus.set(type as ServiceType, ServiceStatus.UNAVAILABLE);
    });
    
    logger.info('AI Orchestration Layer initialized');
  }
  
  /**
   * Initialize the orchestration layer with configuration from the database
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing AI Orchestration Layer...');
      
      // Get configuration from database
      const Configuration = mongoose.model('Configuration');
      const config = await Configuration.findOne();
      
      if (!config) {
        logger.warn('No configuration found in database for AI Orchestration Layer');
        return;
      }
      
      // Initialize LLM Service
      await this.initializeLLMService(config);
      
      // Initialize Voice Service
      await this.initializeVoiceService(config);
      
      // Set up routing rules
      this.setupRoutingRules(config);
      
      // Set up circuit breakers
      this.setupCircuitBreakers();
      
      logger.info('AI Orchestration Layer initialization complete');
    } catch (error) {
      logger.error(`Error initializing AI Orchestration Layer: ${getErrorMessage(error)}`);
      throw new Error(`Failed to initialize AI Orchestration Layer: ${getErrorMessage(error)}`);
    }
  }
  
  /**
   * Initialize LLM Service with configuration from database
   */
  private async initializeLLMService(config: any): Promise<void> {
    try {
      // Extract LLM configuration from database
      const dbLlmConfig = config.llmConfig;
      
      if (!dbLlmConfig || !dbLlmConfig.providers || dbLlmConfig.providers.length === 0) {
        logger.warn('No LLM configuration found in database');
        this.serviceStatus.set(ServiceType.LLM, ServiceStatus.UNAVAILABLE);
        return;
      }
      
      // Transform database configuration to LLM service configuration
      const llmServiceConfig: LLMConfig = {
        providers: dbLlmConfig.providers
          .filter((p: any) => p.apiKey && p.isEnabled !== false)
          .map((p: any) => ({
            name: p.name.toLowerCase() as LLMProvider,
            apiKey: p.apiKey,
            isEnabled: true,
            defaultModel: p.availableModels && p.availableModels.length > 0 
              ? p.availableModels[0] 
              : undefined,
            models: p.availableModels || []
          })),
        defaultProvider: (dbLlmConfig.defaultProvider?.toLowerCase() || 'openai') as LLMProvider,
        defaultModel: dbLlmConfig.defaultModel || 'gpt-4o',
        timeoutMs: 30000,
        retryConfig: {
          maxRetries: 2,
          initialDelayMs: 1000,
          maxDelayMs: 5000
        },
        // Add fallback providers configuration
        fallbackProviders: ['anthropic', 'google'] // Will be used if primary provider fails
      };
      
      if (llmServiceConfig.providers.length === 0) {
        logger.warn('No enabled LLM providers found in configuration');
        this.serviceStatus.set(ServiceType.LLM, ServiceStatus.UNAVAILABLE);
        return;
      }
      
      // Create LLM service
      this.llmService = new LLMService(llmServiceConfig);
      
      // Set service status to available
      this.serviceStatus.set(ServiceType.LLM, ServiceStatus.AVAILABLE);
      
      // Initialize metrics
      this.serviceMetrics.set(ServiceType.LLM, {
        latency: 0,
        successRate: 1.0,
        throughput: 0,
        lastUpdated: new Date()
      });
      
      logger.info(`LLM Service initialized with ${llmServiceConfig.providers.length} providers`);
    } catch (error) {
      logger.error(`Failed to initialize LLM Service: ${getErrorMessage(error)}`);
      this.serviceStatus.set(ServiceType.LLM, ServiceStatus.UNAVAILABLE);
    }
  }
  
  /**
   * Initialize Voice Service with configuration from database
   */
  private async initializeVoiceService(config: any): Promise<void> {
    try {
      // Extract Voice configuration from database
      const voiceConfig = config.elevenLabsConfig;
      
      if (!voiceConfig || !voiceConfig.apiKey) {
        logger.warn('No Voice API configuration found in database');
        this.serviceStatus.set(ServiceType.VOICE, ServiceStatus.UNAVAILABLE);
        return;
      }
      
      // Create Voice service
      this.voiceService = new ElevenLabsSDKService(voiceConfig.apiKey);
      
      // Set service status to available
      this.serviceStatus.set(ServiceType.VOICE, ServiceStatus.AVAILABLE);
      
      // Initialize metrics
      this.serviceMetrics.set(ServiceType.VOICE, {
        latency: 0,
        successRate: 1.0,
        throughput: 0,
        lastUpdated: new Date()
      });
      
      logger.info('Voice Service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize Voice Service: ${getErrorMessage(error)}`);
      this.serviceStatus.set(ServiceType.VOICE, ServiceStatus.UNAVAILABLE);
    }
  }
  
  /**
   * Set up routing rules based on configuration
   */
  private setupRoutingRules(config: any): void {
    // Set up LLM routing rules
    const llmRule: RoutingRule = {
      serviceType: ServiceType.LLM,
      preferredProvider: config.llmConfig?.defaultProvider || 'openai',
      fallbackProviders: ['anthropic', 'google'],
      routingStrategy: 'performance',
      contextThreshold: 8000, // Switch to different provider for contexts > 8000 tokens
      customRules: {
        useOpenAIForCode: true,
        useAnthropicForLongContext: true,
        useGoogleForMultilingual: true
      }
    };
    
    this.routingRules.set(ServiceType.LLM, llmRule);
    
    // Set up Voice routing rules
    const voiceRule: RoutingRule = {
      serviceType: ServiceType.VOICE,
      preferredProvider: 'elevenlabs',
      fallbackProviders: ['openai'],
      routingStrategy: 'latency',
      customRules: {
        useFlashForShortMessages: true,
        useMultilingualForNonEnglish: true
      }
    };
    
    this.routingRules.set(ServiceType.VOICE, voiceRule);
    
    logger.info('Routing rules configured successfully');
  }
  
  /**
   * Set up circuit breakers for services
   */
  private setupCircuitBreakers(): void {
    // LLM circuit breaker
    const llmCircuitBreaker = createRateLimitAwareCircuitBreaker(
      async (action: string, ...args: any[]) => {
        if (!this.llmService) {
          throw new Error('LLM Service not initialized');
        }
        
        switch (action) {
          case 'chat':
            return await this.llmService.chat(args[0]);
          case 'streamChat':
            return await this.llmService.streamChat(args[0], args[1]);
          case 'getModels':
            return await this.llmService.getProviderModels(args[0]);
          default:
            throw new Error(`Unknown LLM action: ${action}`);
        }
      },
      {
        timeout: 30000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000,
        volumeThreshold: 3,
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 5000,
        jitter: true
      },
      'orchestration-llm'
    );
    
    this.circuitBreakers.set('llm', llmCircuitBreaker);
    
    // Voice circuit breaker
    const voiceCircuitBreaker = createRateLimitAwareCircuitBreaker(
      async (action: string, ...args: any[]) => {
        if (!this.voiceService) {
          throw new Error('Voice Service not initialized');
        }
        
        switch (action) {
          case 'synthesizeAdaptiveVoice':
            return await this.voiceService.synthesizeAdaptiveVoice(args[0]);
          case 'streamSpeech':
            return await this.voiceService.streamSpeech(args[0], args[1], args[2], args[3], args[4]);
          case 'getVoices':
            return await this.voiceService.getVoices();
          default:
            throw new Error(`Unknown Voice action: ${action}`);
        }
      },
      {
        timeout: 15000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000,
        volumeThreshold: 3,
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 5000,
        jitter: true
      },
      'orchestration-voice'
    );
    
    this.circuitBreakers.set('voice', voiceCircuitBreaker);
    
    logger.info('Circuit breakers configured successfully');
  }
  
  /**
   * Get the current status of a service
   */
  public getServiceStatus(serviceType: ServiceType): ServiceStatus {
    return this.serviceStatus.get(serviceType) || ServiceStatus.UNAVAILABLE;
  }
  
  /**
   * Get the current metrics for a service
   */
  public getServiceMetrics(serviceType: ServiceType): ServiceMetrics | null {
    return this.serviceMetrics.get(serviceType) || null;
  }
  
  /**
   * Get the routing rule for a service
   */
  public getRoutingRule(serviceType: ServiceType): RoutingRule | null {
    return this.routingRules.get(serviceType) || null;
  }
  
  /**
   * Select the optimal LLM provider based on the request context and routing rules
   */
  public selectOptimalLLMProvider(messages: LLMMessage[]): LLMProvider {
    if (!this.llmService) {
      throw new Error('LLM Service not initialized');
    }
    
    const rule = this.routingRules.get(ServiceType.LLM);
    if (!rule) {
      // Default to the service's default provider
      return this.llmService.getDefaultProviderName();
    }
    
    // Get available providers
    const availableProviders = this.llmService.listProviders();
    if (availableProviders.length === 0) {
      throw new Error('No available LLM providers');
    }
    
    // Estimate context length
    const contextLength = this.estimateContextLength(messages);
    
    // Apply custom routing rules
    if (rule.customRules?.useAnthropicForLongContext && 
        contextLength > (rule.contextThreshold || 8000) && 
        availableProviders.includes('anthropic')) {
      return 'anthropic';
    }
    
    // Check if this is a code-heavy request
    if (rule.customRules?.useOpenAIForCode && 
        this.isCodeRelatedRequest(messages) && 
        availableProviders.includes('openai')) {
      return 'openai';
    }
    
    // Check if this is a multilingual request
    if (rule.customRules?.useGoogleForMultilingual && 
        this.isMultilingualRequest(messages) && 
        availableProviders.includes('google')) {
      return 'google';
    }
    
    // Default to preferred provider if available
    if (availableProviders.includes(rule.preferredProvider as LLMProvider)) {
      return rule.preferredProvider as LLMProvider;
    }
    
    // Fall back to first available provider
    return availableProviders[0];
  }
  
  /**
   * Estimate the context length of a set of messages
   */
  private estimateContextLength(messages: LLMMessage[]): number {
    // Simple estimation: 4 characters per token
    let totalChars = 0;
    for (const message of messages) {
      totalChars += message.content.length;
    }
    return Math.ceil(totalChars / 4);
  }
  
  /**
   * Check if a request is code-related
   */
  private isCodeRelatedRequest(messages: LLMMessage[]): boolean {
    const codePatterns = [
      /```/g,
      /function/g,
      /class/g,
      /const /g,
      /let /g,
      /var /g,
      /def /g,
      /import /g,
      /export /g,
      /return /g
    ];
    
    // Check the last user message for code patterns
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find(m => m.role === 'user');
    
    if (lastUserMessage) {
      return codePatterns.some(pattern => pattern.test(lastUserMessage.content));
    }
    
    return false;
  }
  
  /**
   * Check if a request is multilingual
   */
  private isMultilingualRequest(messages: LLMMessage[]): boolean {
    // Check for non-Latin characters
    const nonLatinPattern = /[^\x00-\x7F]/g;
    
    // Check the last user message for non-Latin characters
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find(m => m.role === 'user');
    
    if (lastUserMessage) {
      return nonLatinPattern.test(lastUserMessage.content);
    }
    
    return false;
  }
  
  /**
   * Generate a chat completion with fallback and circuit breaker protection
   */
  public async generateChatCompletion(
    messages: LLMMessage[],
    options?: {
      provider?: LLMProvider;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<any> {
    if (!this.llmService) {
      throw new Error('LLM Service not initialized');
    }
    
    // Select optimal provider if not specified
    const provider = options?.provider || this.selectOptimalLLMProvider(messages);
    
    // Start performance timing
    const startTime = Date.now();
    
    try {
      // Use circuit breaker to make the request
      const circuitBreaker = this.circuitBreakers.get('llm');
      if (!circuitBreaker) {
        throw new Error('LLM circuit breaker not initialized');
      }
      
      const response = await circuitBreaker.execute({
        provider,
        model: options?.model || this.llmService.getConfig().defaultModel,
        messages,
        options: {
          temperature: options?.temperature,
          maxTokens: options?.maxTokens
        }
      });
      
      // Update metrics
      this.updateServiceMetrics(ServiceType.LLM, {
        latency: Date.now() - startTime,
        success: true
      });
      
      // Emit completion event
      this.emit(OrchestrationEvent.REQUEST_COMPLETE, {
        serviceType: ServiceType.LLM,
        provider,
        latency: Date.now() - startTime,
        success: true
      });
      
      return response;
    } catch (error) {
      // Update metrics
      this.updateServiceMetrics(ServiceType.LLM, {
        latency: Date.now() - startTime,
        success: false
      });
      
      // Emit error event
      this.emit(OrchestrationEvent.ERROR, {
        serviceType: ServiceType.LLM,
        provider,
        error: getErrorMessage(error)
      });
      
      // Check if we should try a fallback
      const rule = this.routingRules.get(ServiceType.LLM);
      if (rule && rule.fallbackProviders.length > 0) {
        // Try fallback providers
        for (const fallbackProvider of rule.fallbackProviders) {
          if (fallbackProvider !== provider) {
            try {
              // Emit fallback event
              this.emit(OrchestrationEvent.FALLBACK_ACTIVATED, {
                serviceType: ServiceType.LLM,
                primaryProvider: provider,
                fallbackProvider
              });
              
              // Use circuit breaker to make the fallback request
              const circuitBreaker = this.circuitBreakers.get('llm');
              if (!circuitBreaker) {
                throw new Error('LLM circuit breaker not initialized');
              }
              
              const response = await circuitBreaker.execute({
                provider: fallbackProvider as LLMProvider,
                model: options?.model || this.llmService.getConfig().defaultModel,
                messages,
                options: {
                  temperature: options?.temperature,
                  maxTokens: options?.maxTokens
                }
              });
              
              // Update metrics for successful fallback
              this.updateServiceMetrics(ServiceType.LLM, {
                latency: Date.now() - startTime,
                success: true,
                fallback: true
              });
              
              return response;
            } catch (fallbackError) {
              // Continue to next fallback provider
              logger.error(`Fallback provider ${fallbackProvider} failed: ${getErrorMessage(fallbackError)}`);
            }
          }
        }
      }
      
      // All fallbacks failed, rethrow the original error
      throw error;
    }
  }
  
  /**
   * Stream a chat completion with fallback and circuit breaker protection
   */
  public async streamChatCompletion(
    messages: LLMMessage[],
    onChunk: (chunk: any) => void,
    options?: {
      provider?: LLMProvider;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<void> {
    if (!this.llmService) {
      throw new Error('LLM Service not initialized');
    }
    
    // Select optimal provider if not specified
    const provider = options?.provider || this.selectOptimalLLMProvider(messages);
    
    // Start performance timing
    const startTime = Date.now();
    
    try {
      // Use circuit breaker to make the request
      const circuitBreaker = this.circuitBreakers.get('llm');
      if (!circuitBreaker) {
        throw new Error('LLM circuit breaker not initialized');
      }
      
      await circuitBreaker.execute(
        'streamChat',
        {
          provider,
          model: options?.model || this.llmService.getConfig().defaultModel,
          messages,
          options: {
            temperature: options?.temperature,
            maxTokens: options?.maxTokens
          }
        },
        onChunk
      );
      
      // Update metrics
      this.updateServiceMetrics(ServiceType.LLM, {
        latency: Date.now() - startTime,
        success: true
      });
      
      // Emit completion event
      this.emit(OrchestrationEvent.REQUEST_COMPLETE, {
        serviceType: ServiceType.LLM,
        provider,
        latency: Date.now() - startTime,
        success: true
      });
    } catch (error) {
      // Update metrics
      this.updateServiceMetrics(ServiceType.LLM, {
        latency: Date.now() - startTime,
        success: false
      });
      
      // Emit error event
      this.emit(OrchestrationEvent.ERROR, {
        serviceType: ServiceType.LLM,
        provider,
        error: getErrorMessage(error)
      });
      
      // Check if we should try a fallback
      const rule = this.routingRules.get(ServiceType.LLM);
      if (rule && rule.fallbackProviders.length > 0) {
        // Try fallback providers
        for (const fallbackProvider of rule.fallbackProviders) {
          if (fallbackProvider !== provider) {
            try {
              // Emit fallback event
              this.emit(OrchestrationEvent.FALLBACK_ACTIVATED, {
                serviceType: ServiceType.LLM,
                primaryProvider: provider,
                fallbackProvider
              });
              
              // Use circuit breaker to make the fallback request
              const circuitBreaker = this.circuitBreakers.get('llm');
              if (!circuitBreaker) {
                throw new Error('LLM circuit breaker not initialized');
              }
              
              await circuitBreaker.execute(
                'streamChat',
                {
                  provider: fallbackProvider as LLMProvider,
                  model: options?.model || this.llmService.getConfig().defaultModel,
                  messages,
                  options: {
                    temperature: options?.temperature,
                    maxTokens: options?.maxTokens
                  }
                },
                onChunk
              );
              
              // Update metrics for successful fallback
              this.updateServiceMetrics(ServiceType.LLM, {
                latency: Date.now() - startTime,
                success: true,
                fallback: true
              });
              
              return;
            } catch (fallbackError) {
              // Continue to next fallback provider
              logger.error(`Fallback provider ${fallbackProvider} failed: ${getErrorMessage(fallbackError)}`);
            }
          }
        }
      }
      
      // All fallbacks failed, rethrow the original error
      throw error;
    }
  }
  
  /**
   * Synthesize voice with emotion adaptation
   */
  public async synthesizeVoice(
    text: string,
    options?: {
      voiceId?: string;
      language?: string;
      emotion?: string;
      speed?: number;
    }
  ): Promise<any> {
    if (!this.voiceService) {
      throw new Error('Voice Service not initialized');
    }
    
    // Start performance timing
    const startTime = Date.now();
    
    try {
      // Use circuit breaker to make the request
      const circuitBreaker = this.circuitBreakers.get('voice');
      if (!circuitBreaker) {
        throw new Error('Voice circuit breaker not initialized');
      }
      
      const response = await circuitBreaker.execute(
        'synthesizeAdaptiveVoice',
        {
          text,
          personalityId: options?.voiceId || 'default',
          language: options?.language || 'en'
        }
      );
      
      // Update metrics
      this.updateServiceMetrics(ServiceType.VOICE, {
        latency: Date.now() - startTime,
        success: true
      });
      
      // Emit completion event
      this.emit(OrchestrationEvent.REQUEST_COMPLETE, {
        serviceType: ServiceType.VOICE,
        provider: 'elevenlabs',
        latency: Date.now() - startTime,
        success: true
      });
      
      return response;
    } catch (error) {
      // Update metrics
      this.updateServiceMetrics(ServiceType.VOICE, {
        latency: Date.now() - startTime,
        success: false
      });
      
      // Emit error event
      this.emit(OrchestrationEvent.ERROR, {
        serviceType: ServiceType.VOICE,
        provider: 'elevenlabs',
        error: getErrorMessage(error)
      });
      
      // No fallback implemented yet for voice
      throw error;
    }
  }
  
  /**
   * Generate embeddings for text using available embedding providers
   */
  public async generateEmbedding(options: {
    provider?: 'openai' | 'google';
    model?: string;
    input: string;
  }): Promise<{ embedding: number[] }> {
    if (!this.llmService) {
      throw new Error('LLM Service not initialized');
    }
    
    const startTime = Date.now();
    const provider = options.provider || 'openai';
    const model = options.model || 'text-embedding-3-small';
    
    try {
      // Use circuit breaker to make the request
      const circuitBreaker = this.circuitBreakers.get('llm');
      if (!circuitBreaker) {
        throw new Error('LLM circuit breaker not initialized');
      }
      
      // Generate embedding using the LLM service
      const result = await circuitBreaker.execute(
        'generateEmbedding',
        {
          provider,
          model,
          input: options.input
        }
      );
      
      // Update metrics
      this.updateServiceMetrics(ServiceType.LLM, {
        latency: Date.now() - startTime,
        success: true
      });
      
      this.emit(OrchestrationEvent.REQUEST_COMPLETE, {
        serviceType: ServiceType.LLM,
        provider,
        action: 'generateEmbedding',
        latency: Date.now() - startTime,
        success: true
      });
      
      return result;
    } catch (error) {
      // Update metrics
      this.updateServiceMetrics(ServiceType.LLM, {
        latency: Date.now() - startTime,
        success: false
      });
      
      this.emit(OrchestrationEvent.ERROR, {
        serviceType: ServiceType.LLM,
        provider,
        action: 'generateEmbedding',
        error: getErrorMessage(error)
      });
      
      // For now, just rethrow the error
      // TODO: Implement fallback to other embedding providers
      throw error;
    }
  }
  
  /**
   * Update service metrics
   */
  private updateServiceMetrics(
    serviceType: ServiceType,
    update: {
      latency: number;
      success: boolean;
      fallback?: boolean;
    }
  ): void {
    const currentMetrics = this.serviceMetrics.get(serviceType);
    if (!currentMetrics) {
      return;
    }
    
    // Update metrics with exponential moving average
    const alpha = 0.3; // Weight for new data
    currentMetrics.latency = (1 - alpha) * currentMetrics.latency + alpha * update.latency;
    
    // Update success rate
    const successValue = update.success ? 1.0 : 0.0;
    currentMetrics.successRate = (1 - alpha) * currentMetrics.successRate + alpha * successValue;
    
    // Increment throughput (requests per minute)
    currentMetrics.throughput += 1;
    
    // Reset throughput every minute
    const now = new Date();
    if (now.getTime() - currentMetrics.lastUpdated.getTime() > 60000) {
      currentMetrics.throughput = 1;
      currentMetrics.lastUpdated = now;
    }
    
    // Update service status based on metrics
    if (currentMetrics.successRate < 0.5) {
      this.serviceStatus.set(serviceType, ServiceStatus.DEGRADED);
    } else {
      this.serviceStatus.set(serviceType, ServiceStatus.AVAILABLE);
    }
    
    // Emit metrics event
    this.emit(OrchestrationEvent.PERFORMANCE_METRICS, {
      serviceType,
      metrics: { ...currentMetrics }
    });
  }
}

// Singleton instance
let orchestrationLayer: AIOrchestrationLayer | null = null;

/**
 * Initialize the AI Orchestration Layer
 */
export async function initializeAIOrchestration(): Promise<AIOrchestrationLayer> {
  if (!orchestrationLayer) {
    orchestrationLayer = new AIOrchestrationLayer();
    await orchestrationLayer.initialize();
  }
  
  return orchestrationLayer;
}

/**
 * Get the AI Orchestration Layer instance
 */
export function getAIOrchestration(): AIOrchestrationLayer | null {
  return orchestrationLayer;
}

export default AIOrchestrationLayer;
