/**
 * LLM Service - Main orchestration service
 * 
 * This service manages all LLM provider clients and provides a unified interface
 * for making LLM requests with fallback capabilities and circuit breaker protection.
 */
import {
  LLMConfig,
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMCompletionRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMMessage,
  LLMError,
  LLMErrorImpl,
  ModelInfo
} from './types';
import { ILLMProviderClient } from './base';
import { OpenAIClient } from './openai';
import { AnthropicClient } from './anthropic';
import { GoogleClient } from './google';
import { logger } from '../../index';
import { 
  RateLimitAwareCircuitBreaker, 
  createRateLimitAwareCircuitBreaker,
  RateLimitAwareOptions 
} from '../../utils/circuitBreaker';

export class LLMService {
  private providers: Map<LLMProvider, ILLMProviderClient> = new Map();
  private circuitBreakers: Map<LLMProvider, RateLimitAwareCircuitBreaker<any[], any>> = new Map();
  private config: LLMConfig;
  private failureTracker: Map<LLMProvider, { count: number; lastFailure: number }> = new Map();
  private readonly FALLBACK_COOLDOWN = 5 * 60 * 1000; // 5 minutes
  
  constructor(config: LLMConfig) {
    this.config = config;
    this.initializeProviders();
  }
  
  /**
   * Initialize provider clients based on configuration
   */
  private initializeProviders(): void {
    for (const providerConfig of this.config.providers) {
      if (!providerConfig.isEnabled || !providerConfig.apiKey) {
        continue;
      }
      
      try {
        const client = this.createProviderClient(providerConfig);
        if (client) {
          this.providers.set(providerConfig.name, client);
          
          // Create circuit breaker for this provider
          const circuitBreakerConfig: Partial<RateLimitAwareOptions> = {
            timeout: 60000, // 1 minute timeout
            errorThresholdPercentage: 70, // Higher threshold for LLM providers
            resetTimeout: 5 * 60 * 1000, // 5 minutes reset
            volumeThreshold: 5, // Need at least 5 requests
            maxRetries: 2, // Limited retries for 429s
            baseDelay: 2000, // 2 second base delay
            maxDelay: 60000, // 1 minute max delay
            jitter: true
          };
          
          const circuitBreaker = createRateLimitAwareCircuitBreaker(
            this.createProviderAction(client),
            circuitBreakerConfig,
            `LLM-${providerConfig.name}`
          );
          
          this.circuitBreakers.set(providerConfig.name, circuitBreaker);
          this.failureTracker.set(providerConfig.name, { count: 0, lastFailure: 0 });
          
          logger.info(`Initialized LLM provider with circuit breaker: ${providerConfig.name}`);
        }
      } catch (error) {
        logger.error(`Failed to initialize LLM provider ${providerConfig.name}:`, error);
      }
    }
  }

  /**
   * Create a provider action function for circuit breaker
   */
  private createProviderAction(client: ILLMProviderClient) {
    return async (action: string, ...args: any[]): Promise<any> => {
      switch (action) {
        case 'completion':
          return await client.completion(args[0]);
        case 'chat':
          return await client.chat(args[0]);
        case 'streamChat':
          return await client.streamChat(args[0], args[1]);
        case 'realtimeChat':
          if ('realtimeChat' in client) {
            return await client.realtimeChat!(args[0], args[1]);
          } else {
            // Fall back to regular streaming if realtime not supported
            return await client.streamChat(args[0], args[1]);
          }
        case 'testConnection':
          return await client.testConnection();
        case 'getAvailableModels':
          return await client.getAvailableModels();
        case 'listModels':
          return await client.listModels();
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    };
  }
  
  /**
   * Create a provider client based on provider type
   */
  private createProviderClient(config: LLMProviderConfig): ILLMProviderClient | null {
    const { name, apiKey, baseUrl, defaultModel, organization } = config;
    
    switch (name) {
      case 'openai':
        return new OpenAIClient(apiKey, { baseUrl, defaultModel, organization });
        
      case 'anthropic':
        return new AnthropicClient(apiKey, { baseUrl, defaultModel });
        
      case 'google':
      case 'gemini':
        return new GoogleClient(apiKey, { defaultModel });
        
      default:
        logger.warn(`Unsupported LLM provider: ${name}`);
        return null;
    }
  }
  
  /**
   * Get the default provider client
   */
  getDefaultProvider(): ILLMProviderClient {
    const defaultProviderName = this.config.defaultProvider || 
      (this.providers.size > 0 ? this.providers.keys().next().value : null);
    
    if (!defaultProviderName) {
      throw new Error('No LLM providers configured');
    }
    
    const provider = this.providers.get(defaultProviderName);
    if (!provider) {
      throw new Error(`Default provider ${defaultProviderName} not found or not initialized`);
    }
    
    return provider;
  }

  /**
   * Get the name of the default provider.
   */
  getDefaultProviderName(): LLMProvider {
    if (!this.config.defaultProvider) {
      throw new Error('Default LLM provider not configured');
    }
    return this.config.defaultProvider;
  }
  
  /**
   * Get a specific provider client by name
   */
  getProvider(name: LLMProvider): ILLMProviderClient {
    // Map 'gemini' to 'google' for provider lookup
    const providerName = name === 'gemini' ? 'google' : name;
    
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${name} not found or not initialized`);
    }
    
    return provider;
  }
  
  /**
   * List all available providers
   */
  listProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }
  
  /**
   * Check if a provider should be used for fallback
   */
  private shouldUseProviderForFallback(providerName: LLMProvider): boolean {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    const failureInfo = this.failureTracker.get(providerName);
    
    // Don't use if circuit breaker is open
    if (circuitBreaker && circuitBreaker.isOpen()) {
      logger.debug(`Skipping provider ${providerName}: circuit breaker is open`);
      return false;
    }
    
    // Don't use if too many recent failures
    if (failureInfo && failureInfo.count >= 3 && 
        (Date.now() - failureInfo.lastFailure) < this.FALLBACK_COOLDOWN) {
      logger.debug(`Skipping provider ${providerName}: too many recent failures`);
      return false;
    }
    
    return true;
  }

  /**
   * Record a failure for fallback tracking
   */
  private recordFailure(providerName: LLMProvider, error: any): void {
    const failureInfo = this.failureTracker.get(providerName);
    if (failureInfo) {
      failureInfo.count++;
      failureInfo.lastFailure = Date.now();
      
      // Reset count after successful recovery period
      if (failureInfo.count > 5) {
        failureInfo.count = 5; // Cap at 5
      }
    }
    
    logger.warn(`Recorded failure for provider ${providerName}:`, {
      error: error.message,
      status: error.response?.status,
      count: failureInfo?.count
    });
  }

  /**
   * Record a success for fallback tracking
   */
  private recordSuccess(providerName: LLMProvider): void {
    const failureInfo = this.failureTracker.get(providerName);
    if (failureInfo) {
      failureInfo.count = Math.max(0, failureInfo.count - 1);
    }
  }

  /**
   * Get all available models from all providers
   */
  async getAllAvailableModels(): Promise<{ [provider: string]: ModelInfo[] }> {
    const allModels: { [provider: string]: ModelInfo[] } = {};
    
    for (const [providerName, provider] of this.providers) {
      try {
        const models = await provider.getAvailableModels();
        allModels[providerName] = models;
      } catch (error) {
        logger.error(`Failed to get models from provider ${providerName}:`, error);
        allModels[providerName] = [];
      }
    }
    
    return allModels;
  }

  /**
   * Get available models from a specific provider
   */
  async getProviderModels(name: LLMProvider): Promise<ModelInfo[]> {
    try {
      const provider = this.getProvider(name);
      return await provider.getAvailableModels();
    } catch (error) {
      logger.error(`Failed to get models from provider ${name}:`, error);
      return [];
    }
  }
  
  /**
   * Generate a completion with fallback capabilities
   */
  async completion(request: LLMCompletionRequest): Promise<LLMResponse> {
    const providerName = request.provider;
    const fallbackProviders = this.config.fallbackProviders || [];
    
    // Try the requested provider first
    try {
      const provider = this.getProvider(providerName);
      return await provider.completion({
        model: request.model,
        prompt: request.prompt,
        options: request.options,
        responseFormat: request.responseFormat
      });
    } catch (error) {
      logger.warn(`Provider ${providerName} failed, trying fallbacks:`, error);
      
      // If the error is not retryable or there are no fallbacks, rethrow
      if (!(error as LLMError).retryable || fallbackProviders.length === 0) {
        throw error;
      }
      
      // Try fallback providers in order
      for (const fallbackName of fallbackProviders) {
        try {
          const fallbackProvider = this.getProvider(fallbackName);
          logger.info(`Trying fallback provider: ${fallbackName}`);
          
          return await fallbackProvider.completion({
            model: request.model,
            prompt: request.prompt,
            options: request.options,
            responseFormat: request.responseFormat
          });
        } catch (fallbackError) {
          logger.warn(`Fallback provider ${fallbackName} failed:`, fallbackError);
          // Continue to the next fallback
        }
      }
      
      // If all fallbacks failed, throw the original error
      throw error;
    }
  }
  
  /**
   * Generate a chat completion with fallback capabilities
   */
  async chat(request: LLMChatRequest): Promise<LLMResponse> {
    const providerName = request.provider;
    const fallbackProviders = this.config.fallbackProviders || [];
    
    // Try the requested provider first
    try {
      const provider = this.getProvider(providerName);
      return await provider.chat({
        model: request.model,
        messages: request.messages,
        options: request.options,
        responseFormat: request.responseFormat
      });
    } catch (error) {
      logger.warn(`Provider ${providerName} failed, trying fallbacks:`, error);
      
      // If the error is not retryable or there are no fallbacks, rethrow
      if (!(error as LLMError).retryable || fallbackProviders.length === 0) {
        throw error;
      }
      
      // Try fallback providers in order
      for (const fallbackName of fallbackProviders) {
        try {
          const fallbackProvider = this.getProvider(fallbackName);
          logger.info(`Trying fallback provider: ${fallbackName}`);
          
          return await fallbackProvider.chat({
            model: request.model,
            messages: request.messages,
            options: request.options,
            responseFormat: request.responseFormat
          });
        } catch (fallbackError) {
          logger.warn(`Fallback provider ${fallbackName} failed:`, fallbackError);
          // Continue to the next fallback
        }
      }
      
      // If all fallbacks failed, throw the original error
      throw error;
    }
  }
  
  /**
   * Stream a chat completion with fallback capabilities
   */
  async streamChat(
    request: LLMChatRequest,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<void> {
    const providerName = request.provider;
    const fallbackProviders = this.config.fallbackProviders || [];
    
    // Try the requested provider first
    try {
      const provider = this.getProvider(providerName);
      await provider.streamChat({
        model: request.model,
        messages: request.messages,
        options: request.options,
        responseFormat: request.responseFormat
      }, onChunk);
      return;
    } catch (error) {
      logger.warn(`Provider ${providerName} failed for streaming, trying fallbacks:`, error);
      
      // If the error is not retryable or there are no fallbacks, rethrow
      if (!(error as LLMError).retryable || fallbackProviders.length === 0) {
        throw error;
      }
      
      // Try fallback providers in order
      for (const fallbackName of fallbackProviders) {
        try {
          const fallbackProvider = this.getProvider(fallbackName);
          logger.info(`Trying fallback provider for streaming: ${fallbackName}`);
          
          await fallbackProvider.streamChat({
            model: request.model,
            messages: request.messages,
            options: request.options,
            responseFormat: request.responseFormat
          }, onChunk);
          return;
        } catch (fallbackError) {
          logger.warn(`Fallback provider ${fallbackName} failed for streaming:`, fallbackError);
          // Continue to the next fallback
        }
      }
      
      // If all fallbacks failed, throw the original error
      throw error;
    }
  }
  
  /**
   * Stream chat completion with ultra-low latency using the Realtime API
   * Falls back to standard streaming if realtime is not available
   */
  async realtimeChat(request: LLMChatRequest, onChunk: (chunk: LLMStreamChunk) => void): Promise<void> {
    const providerName = request.provider;
    
    try {
      const provider = this.getProvider(providerName);
      
      if (!provider || typeof provider.realtimeChat !== 'function') {
        logger.info(`Realtime API not available for provider ${providerName}, falling back to standard streaming`);
        return this.streamChat(request, onChunk);
      }
      
      logger.info(`Using realtime chat with provider: ${providerName}, model: ${request.model}`);
      
      try {
        await provider.realtimeChat!({
          model: request.model,
          messages: request.messages,
          options: request.options,
          responseFormat: request.responseFormat
        }, onChunk);
        return;
      } catch (realtimeError) {
        logger.warn(`Realtime API failed, falling back to standard streaming: ${realtimeError}`);
        return this.streamChat(request, onChunk);
      }
    } catch (error) {
      logger.error(`Failed to get provider for realtime chat: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the service configuration
   */
  getConfig(): LLMConfig {
    return this.config;
  }
  
  /**
   * Update the service configuration
   */
  updateConfig(newConfig: LLMConfig): void {
    this.config = newConfig;
    
    // Clear existing providers
    this.providers.clear();
    
    // Reinitialize with new config
    this.initializeProviders();
  }
  
  /**
   * Generate embeddings for text
   */
  async generateEmbedding(request: {
    provider?: LLMProvider;
    model?: string;
    input: string;
  }): Promise<{ embedding: number[] }> {
    const provider = request.provider || 'openai';
    const model = request.model || 'text-embedding-3-small';
    
    try {
      const providerClient = this.getProvider(provider);
      const circuitBreaker = this.circuitBreakers.get(provider);
      
      if (!circuitBreaker) {
        throw new LLMErrorImpl(
          `Circuit breaker not found for provider: ${provider}`,
          'CIRCUIT_BREAKER_ERROR',
          500,
          provider
        );
      }
      
      const result = await circuitBreaker.execute(async () => {
        // For now, use the OpenAI client directly
        if (provider === 'openai') {
          const openaiClient = providerClient as OpenAIClient;
          return await openaiClient.generateEmbedding({ model, input: request.input });
        } else {
          throw new LLMErrorImpl(
            `Embedding not supported for provider: ${provider}`,
            'UNSUPPORTED_OPERATION',
            400,
            provider
          );
        }
      });
      
      return result;
    } catch (error) {
      if (error instanceof LLMErrorImpl) {
        throw error;
      }
      
      throw new LLMErrorImpl(
        `Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
        'EMBEDDING_ERROR',
        500,
        request.provider || 'openai'
      );
    }
  }
  
  /**
   * Get available models for a provider
   */
  async getModels(providerName: LLMProvider): Promise<string[]> {
    try {
      const provider = this.getProvider(providerName);
      return await provider.listModels();
    } catch (error) {
      logger.error(`Failed to get models for provider ${providerName}:`, error);
      return [];
    }
  }
}
