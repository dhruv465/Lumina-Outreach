/**
 * AI Orchestration Service
 * 
 * This service coordinates and orchestrates all AI-related services in the application,
 * providing a unified interface for AI operations, fallback mechanisms, and monitoring.
 * 
 * Features:
 * - Centralized management of all AI providers and services
 * - Dynamic routing of AI requests based on context and requirements
 * - Fallback mechanisms for resilience
 * - Monitoring and observability for AI operations
 * - Performance optimization through caching and intelligent routing
 */

import { EventEmitter } from 'events';
import { logger, getErrorMessage } from '../index';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

// Import AI services
import { LLMService } from './llm/service';
import { LLMConfig, LLMProvider, LLMMessage, LLMResponse, LLMChatRequest } from './llm/types';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import { SpeechAnalysisService } from './speechAnalysisService';
import { SpeechAnalysisMock, AdvancedConversationEngineMock, ObjectDetectionServiceMock, ConversationQualityServiceMock } from './mockInterfaces';

// Performance and caching imports
import { createHash } from 'crypto';
import NodeCache from 'node-cache';

// Types for the orchestration service
export interface AIServiceOptions {
  cacheEnabled?: boolean;
  cacheTTL?: number; // seconds
  defaultTimeout?: number; // milliseconds
  retryAttempts?: number;
  recordUsage?: boolean;
  useStreamingByDefault?: boolean;
}

export interface AIRequest {
  id: string;
  type: 'llm' | 'voice' | 'speech' | 'conversation' | 'emotion' | 'objection';
  params: any;
  timestamp: Date;
  context?: any;
}

export interface AIResponse {
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
  metadata: {
    provider: string;
    model?: string;
    latency: number;
    cached?: boolean;
    cost?: number;
    tokens?: {
      prompt: number;
      completion: number;
      total: number;
    }
  }
}

export interface AIServiceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatency: number;
  cacheHitRate: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  }
  costEstimate: number;
  providerBreakdown: {
    [provider: string]: {
      requests: number;
      success: number;
      failure: number;
      avgLatency: number;
    }
  }
}

/**
 * AI Orchestration Service
 * 
 * Centralized management of all AI-related operations in the application
 */
export class AIOrchestrationService extends EventEmitter {
  private llmService: LLMService;
  private voiceService: EnhancedVoiceAIService;
  private speechService: SpeechAnalysisService;
  private conversationEngine: AdvancedConversationEngineMock;
  private objectDetectionService: ObjectDetectionServiceMock;
  private qualityService: ConversationQualityServiceMock;
  
  private cache: NodeCache;
  private metrics: {
    requestsTotal: number;
    requestsSuccess: number;
    requestsFailure: number;
    latencySum: number;
    cacheHits: number;
    cacheMisses: number;
    tokenUsage: {
      prompt: number;
      completion: number;
      total: number;
    };
    costSum: number;
    providerStats: Map<string, {
      requests: number;
      success: number;
      failure: number;
      latencySum: number;
    }>;
  };
  
  private options: AIServiceOptions;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  
  constructor(options: AIServiceOptions = {}) {
    super();
    
    // Set default options
    this.options = {
      cacheEnabled: true,
      cacheTTL: 60 * 60, // 1 hour
      defaultTimeout: 30000, // 30 seconds
      retryAttempts: 2,
      recordUsage: true,
      useStreamingByDefault: false,
      ...options
    };
    
    // Initialize cache
    this.cache = new NodeCache({
      stdTTL: this.options.cacheTTL,
      checkperiod: 120,
      useClones: false
    });
    
    // Initialize metrics
    this.resetMetrics();
    
    // Initialize services lazily to avoid circular dependencies
    this.initializeServices().catch(error => {
      logger.error(`Failed to initialize AI Orchestration Service: ${getErrorMessage(error)}`);
    });
  }
  
  /**
   * Initialize all AI services
   */
  private async initializeServices(): Promise<void> {
    if (this.isInitialized || this.initializationPromise) {
      return this.initializationPromise;
    }
    
    this.initializationPromise = (async () => {
      try {
        logger.info('Initializing AI Orchestration Service...');
        
        // Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
          logger.warn('MongoDB not connected. AI Orchestration Service will initialize with default configuration.');
        }
        
        // Get configuration from database
        const Configuration = mongoose.models.Configuration || mongoose.model('Configuration');
        const config = await Configuration.findOne();
        
        if (!config) {
          logger.warn('No configuration found in database. Using default AI service configuration.');
        }
        
        // Initialize LLM service
        await this.initializeLLMService(config);
        
        // Initialize Voice service
        await this.initializeVoiceService(config);
        
        // Initialize Speech service
        await this.initializeSpeechService(config);
        
        // Initialize Conversation Engine
        await this.initializeConversationEngine();
        
        // Initialize other services
        this.objectDetectionService = {
          detectIntent: async (text: string) => {
            return {
              intent: 'unknown',
              confidence: 0.5
            };
          },
          detectObjection: async (text: string) => {
            return {
              isObjection: false,
              confidence: 0.5
            };
          }
        };
        
        this.qualityService = {
          scoreConversation: async (conversationId: string, callId: string) => {
            return {
              overallScore: 0.75,
              metrics: {
                clarity: 0.8,
                engagement: 0.7,
                empathy: 0.8,
                professionalism: 0.7
              },
              insights: ['Placeholder insight'],
              recommendations: ['Placeholder recommendation']
            };
          }
        };
        
        this.isInitialized = true;
        logger.info('AI Orchestration Service initialized successfully');
        
        // Emit initialization event
        this.emit('initialized');
      } catch (error) {
        logger.error(`Error initializing AI Orchestration Service: ${getErrorMessage(error)}`);
        this.isInitialized = false;
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();
    
    return this.initializationPromise;
  }
  
  /**
   * Initialize LLM service with configuration
   */
  private async initializeLLMService(config: any): Promise<void> {
    try {
      if (!config || !config.llmConfig) {
        // Create with empty configuration - will be updated later
        this.llmService = new LLMService({
          providers: [],
          defaultProvider: 'openai' as LLMProvider
        });
        return;
      }
      
      // Transform configuration for LLM service
      const llmConfig: LLMConfig = {
        providers: config.llmConfig.providers.map((p: any) => ({
          name: p.name.toLowerCase() as LLMProvider,
          apiKey: p.apiKey,
          isEnabled: p.isEnabled !== false,
          defaultModel: p.defaultModel || (p.availableModels && p.availableModels.length > 0 ? p.availableModels[0] : undefined),
          baseUrl: p.baseUrl
        })).filter((p: any) => p.isEnabled && p.apiKey),
        defaultProvider: (config.llmConfig.defaultProvider?.toLowerCase() || 'openai') as LLMProvider,
        defaultModel: config.llmConfig.defaultModel,
        timeoutMs: 30000,
        retryConfig: {
          maxRetries: this.options.retryAttempts || 2,
          initialDelayMs: 1000,
          maxDelayMs: 5000
        }
      };
      
      this.llmService = new LLMService(llmConfig);
      logger.info(`LLM Service initialized with ${llmConfig.providers.length} providers`);
    } catch (error) {
      logger.error(`Failed to initialize LLM Service: ${getErrorMessage(error)}`);
      // Create with empty configuration as fallback
      this.llmService = new LLMService({
        providers: [],
        defaultProvider: 'openai' as LLMProvider
      });
    }
  }
  
  /**
   * Initialize Voice service with configuration
   */
  private async initializeVoiceService(config: any): Promise<void> {
    try {
      let elevenLabsApiKey = '';
      
      if (config && config.elevenLabsConfig) {
        elevenLabsApiKey = config.elevenLabsConfig.apiKey || '';
      }
      
      this.voiceService = new EnhancedVoiceAIService(elevenLabsApiKey);
      logger.info('Voice AI Service initialized');
    } catch (error) {
      logger.error(`Failed to initialize Voice AI Service: ${getErrorMessage(error)}`);
      // Create with empty API key as fallback
      this.voiceService = new EnhancedVoiceAIService('');
    }
  }
  
  /**
   * Initialize Speech service with configuration
   */
  private async initializeSpeechService(config: any): Promise<void> {
    try {
      let openAIApiKey = '';
      let googleSpeechApiKey = '';
      let deepgramApiKey = '';
      
      if (config) {
        // Extract API keys from config
        if (config.llmConfig && config.llmConfig.providers) {
          const openAIProvider = config.llmConfig.providers.find((p: any) => p.name === 'openai');
          if (openAIProvider && openAIProvider.apiKey) {
            openAIApiKey = openAIProvider.apiKey;
          }
        }
        
        if (config.googleConfig) {
          googleSpeechApiKey = config.googleConfig.apiKey || '';
        }
        
        if (config.deepgramConfig) {
          deepgramApiKey = config.deepgramConfig.apiKey || '';
        }
      }
      
      this.speechService = new SpeechAnalysisService(openAIApiKey, googleSpeechApiKey, deepgramApiKey);
      logger.info('Speech Analysis Service initialized');
    } catch (error) {
      logger.error(`Failed to initialize Speech Analysis Service: ${getErrorMessage(error)}`);
      // Create with empty API keys as fallback
      this.speechService = new SpeechAnalysisService('', '', '');
    }
  }
  
  /**
   * Initialize Conversation Engine
   */
  private async initializeConversationEngine(): Promise<void> {
    try {
      if (!this.llmService || !this.voiceService) {
        throw new Error('LLM or Voice service not initialized');
      }
      
      this.conversationEngine = {
        processTurn: async (userInput: string, conversationContext: any) => {
          return {
            response: "This is a placeholder response from the Advanced Conversation Engine",
            emotion: "neutral"
          };
        },
        updateContext: (currentContext: any, newData: any) => {
          return {
            ...currentContext,
            ...newData,
            lastUpdated: new Date()
          };
        }
      };
      
      logger.info('Advanced Conversation Engine initialized');
    } catch (error) {
      logger.error(`Failed to initialize Advanced Conversation Engine: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Ensure the service is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    
    await this.initializeServices();
  }
  
  /**
   * Reset metrics
   */
  private resetMetrics(): void {
    this.metrics = {
      requestsTotal: 0,
      requestsSuccess: 0,
      requestsFailure: 0,
      latencySum: 0,
      cacheHits: 0,
      cacheMisses: 0,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0
      },
      costSum: 0,
      providerStats: new Map()
    };
  }
  
  /**
   * Update metrics with request result
   */
  private updateMetrics(
    provider: string,
    success: boolean,
    latency: number,
    tokenUsage?: { prompt: number, completion: number, total: number },
    cost?: number,
    cached: boolean = false
  ): void {
    if (!this.options.recordUsage) {
      return;
    }
    
    // Update overall metrics
    this.metrics.requestsTotal++;
    if (success) {
      this.metrics.requestsSuccess++;
    } else {
      this.metrics.requestsFailure++;
    }
    
    this.metrics.latencySum += latency;
    
    if (cached) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
    
    // Update token usage if available
    if (tokenUsage) {
      this.metrics.tokenUsage.prompt += tokenUsage.prompt || 0;
      this.metrics.tokenUsage.completion += tokenUsage.completion || 0;
      this.metrics.tokenUsage.total += tokenUsage.total || 0;
    }
    
    // Update cost if available
    if (cost) {
      this.metrics.costSum += cost;
    }
    
    // Update provider-specific metrics
    let providerStats = this.metrics.providerStats.get(provider);
    if (!providerStats) {
      providerStats = {
        requests: 0,
        success: 0,
        failure: 0,
        latencySum: 0
      };
      this.metrics.providerStats.set(provider, providerStats);
    }
    
    providerStats.requests++;
    if (success) {
      providerStats.success++;
    } else {
      providerStats.failure++;
    }
    providerStats.latencySum += latency;
  }
  
  /**
   * Generate a cache key for a request
   */
  private generateCacheKey(type: string, params: any): string {
    // Normalize parameters for consistent hashing
    const normalizedParams = { ...params };
    
    // Remove non-deterministic or changing fields
    delete normalizedParams.timestamp;
    delete normalizedParams.id;
    delete normalizedParams.context;
    
    // Hash the parameters
    return createHash('md5')
      .update(`${type}:${JSON.stringify(normalizedParams)}`)
      .digest('hex');
  }
  
  /**
   * Estimate cost of an LLM request
   */
  private estimateLLMCost(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    // Pricing per 1K tokens (USD)
    const pricing: Record<string, { input: number, output: number }> = {
      'openai:gpt-4': { input: 0.03, output: 0.06 },
      'openai:gpt-4-turbo': { input: 0.01, output: 0.03 },
      'openai:gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'anthropic:claude-3-opus': { input: 0.015, output: 0.075 },
      'anthropic:claude-3-sonnet': { input: 0.003, output: 0.015 },
      'anthropic:claude-3-haiku': { input: 0.00025, output: 0.00125 },
      'google:gemini-1.5-pro': { input: 0.0025, output: 0.0075 },
      'google:gemini-1.5-flash': { input: 0.0005, output: 0.0015 }
    };
    
    const key = `${provider}:${model}`;
    const pricingInfo = pricing[key] || { input: 0.001, output: 0.002 }; // Default fallback pricing
    
    return (
      (promptTokens / 1000) * pricingInfo.input +
      (completionTokens / 1000) * pricingInfo.output
    );
  }
  
  /**
   * Process an LLM chat request with caching, fallback, and metrics
   */
  public async processLLMRequest(
    params: Omit<LLMChatRequest, 'provider'> & { 
      provider?: LLMProvider,
      cacheKey?: string,
      bypassCache?: boolean,
      timeout?: number
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    const provider = params.provider || this.llmService.getDefaultProviderName();
    const cacheEnabled = this.options.cacheEnabled && !params.bypassCache;
    
    // Check cache if enabled
    if (cacheEnabled && params.cacheKey) {
      const cachedResult = this.cache.get<AIResponse>(params.cacheKey);
      if (cachedResult) {
        // Update metrics with cache hit
        this.updateMetrics(
          provider,
          true,
          0, // No latency for cache hits
          cachedResult.metadata.tokens,
          cachedResult.metadata.cost,
          true
        );
        
        // Return cached result with updated requestId
        return {
          ...cachedResult,
          requestId
        };
      }
    }
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`LLM request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute LLM request with timeout
      const llmPromise = this.llmService.chat({
        provider,
        model: params.model,
        messages: params.messages,
        options: params.options,
        responseFormat: params.responseFormat
      });
      
      // Wait for result or timeout
      const result = await Promise.race([llmPromise, timeoutPromise]) as LLMResponse;
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Calculate cost if usage is available
      let cost = 0;
      if (result.usage) {
        cost = this.estimateLLMCost(
          result.provider,
          result.model,
          result.usage.promptTokens,
          result.usage.completionTokens
        );
      }
      
      // Convert TokenUsage to our expected format
      const tokenUsage = result.usage ? {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.totalTokens
      } : undefined;
      
      // Create response object
      const response: AIResponse = {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: result.provider,
          model: result.model,
          latency,
          tokens: tokenUsage,
          cost
        }
      };
      
      // Update metrics
      this.updateMetrics(
        result.provider,
        true,
        latency,
        tokenUsage,
        cost
      );
      
      // Cache result if enabled
      if (cacheEnabled && params.cacheKey) {
        this.cache.set(params.cacheKey, response);
      }
      
      // Emit event for monitoring
      this.emit('llm:success', {
        requestId,
        provider: result.provider,
        model: result.model,
        latency,
        tokens: result.usage,
        cost
      });
      
      return response;
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`LLM request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics(provider, false, latency);
      
      // Emit event for monitoring
      this.emit('llm:error', {
        requestId,
        provider,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider,
          latency
        }
      };
    }
  }
  
  /**
   * Process a voice synthesis request
   */
  public async processVoiceRequest(
    params: {
      text: string;
      personalityId?: string;
      language?: 'English' | 'Hindi';
      timeout?: number;
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Voice synthesis request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute voice synthesis request with timeout
      const voicePromise = this.voiceService.synthesizeVoice({
        text: params.text,
        personalityId: params.personalityId,
        language: params.language
      });
      
      // Wait for result or timeout
      const result = await Promise.race([voicePromise, timeoutPromise]);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics('elevenlabs', true, latency);
      
      // Emit event for monitoring
      this.emit('voice:success', {
        requestId,
        provider: 'elevenlabs',
        textLength: params.text.length,
        latency
      });
      
      // Return response
      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: 'elevenlabs',
          latency
        }
      };
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Voice synthesis request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics('elevenlabs', false, latency);
      
      // Emit event for monitoring
      this.emit('voice:error', {
        requestId,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider: 'elevenlabs',
          latency
        }
      };
    }
  }
  
  /**
   * Process a speech analysis request
   */
  public async processSpeechAnalysisRequest(
    params: {
      audioBuffer: Buffer;
      fileType?: string;
      timeout?: number;
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout * 2; // Speech processing can take longer
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Speech analysis request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute speech analysis request with timeout
      const audioPath = `/tmp/speech-${Date.now()}.mp3`;
      require('fs').writeFileSync(audioPath, params.audioBuffer);
      
      const speechPromise = this.speechService.analyzeSpeech(
        audioPath,
        params.fileType || 'audio/mp3'
      );
      
      // Wait for result or timeout
      const result = await Promise.race([speechPromise, timeoutPromise]);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Determine which provider was used
      const provider = 'deepgram'; // Default provider
      
      // Update metrics
      this.updateMetrics(provider, true, latency);
      
      // Emit event for monitoring
      this.emit('speech:success', {
        requestId,
        provider,
        audioSize: params.audioBuffer.length,
        latency
      });
      
      // Return response
      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider,
          latency
        }
      };
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Speech analysis request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics('speech', false, latency);
      
      // Emit event for monitoring
      this.emit('speech:error', {
        requestId,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider: 'speech',
          latency
        }
      };
    }
  }
  
  /**
   * Process a conversation generation request
   */
  public async processConversationRequest(
    params: {
      userInput: string;
      conversationLog: any[];
      leadId: string;
      campaignId: string;
      callContext: {
        complianceComplete: boolean;
        disclosureComplete: boolean;
        currentPhase: string;
        language: string;
      };
      timeout?: number;
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Conversation request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute conversation request with timeout
      const conversationPromise = this.voiceService.generateResponse(params);
      
      // Wait for result or timeout
      const result = await Promise.race([conversationPromise, timeoutPromise]);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics('conversation', true, latency);
      
      // Emit event for monitoring
      this.emit('conversation:success', {
        requestId,
        latency,
        inputLength: params.userInput.length,
        outputLength: result.text.length
      });
      
      // Return response
      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: 'conversation',
          latency
        }
      };
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Conversation request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics('conversation', false, latency);
      
      // Emit event for monitoring
      this.emit('conversation:error', {
        requestId,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider: 'conversation',
          latency
        }
      };
    }
  }
  
  /**
   * Process an intent detection request
   */
  public async processIntentDetectionRequest(
    params: {
      text: string;
      timeout?: number;
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Intent detection request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute intent detection request with timeout
      const intentPromise = this.objectDetectionService.detectIntent(params.text);
      
      // Wait for result or timeout
      const result = await Promise.race([intentPromise, timeoutPromise]);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics('intent', true, latency);
      
      // Emit event for monitoring
      this.emit('intent:success', {
        requestId,
        latency,
        intent: result.intent,
        confidence: result.confidence
      });
      
      // Return response
      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: 'intent',
          latency
        }
      };
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Intent detection request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics('intent', false, latency);
      
      // Emit event for monitoring
      this.emit('intent:error', {
        requestId,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider: 'intent',
          latency
        }
      };
    }
  }
  
  /**
   * Process an objection detection request
   */
  public async processObjectionDetectionRequest(
    params: {
      text: string;
      timeout?: number;
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Objection detection request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute objection detection request with timeout
      const objectionPromise = this.objectDetectionService.detectObjection(params.text);
      
      // Wait for result or timeout
      const result = await Promise.race([objectionPromise, timeoutPromise]);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics('objection', true, latency);
      
      // Emit event for monitoring
      this.emit('objection:success', {
        requestId,
        latency,
        isObjection: result.isObjection,
        confidence: result.confidence
      });
      
      // Return response
      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: 'objection',
          latency
        }
      };
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Objection detection request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics('objection', false, latency);
      
      // Emit event for monitoring
      this.emit('objection:error', {
        requestId,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider: 'objection',
          latency
        }
      };
    }
  }
  
  /**
   * Process conversation quality scoring request
   */
  public async processQualityAnalysisRequest(
    params: {
      conversationId: string;
      callId: string;
      timeout?: number;
    }
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeout = params.timeout || this.options.defaultTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Quality analysis request timed out after ${timeout}ms`)), timeout);
      });
      
      // Execute quality analysis request with timeout
      const qualityPromise = this.qualityService.scoreConversation(
        params.conversationId,
        params.callId
      );
      
      // Wait for result or timeout
      const result = await Promise.race([qualityPromise, timeoutPromise]);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics('quality', true, latency);
      
      // Emit event for monitoring
      this.emit('quality:success', {
        requestId,
        latency,
        overallScore: result.overallScore
      });
      
      // Return response
      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: 'quality',
          latency
        }
      };
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Quality analysis request failed: ${getErrorMessage(error)}`);
      
      // Update metrics
      this.updateMetrics('quality', false, latency);
      
      // Emit event for monitoring
      this.emit('quality:error', {
        requestId,
        error: getErrorMessage(error),
        latency
      });
      
      // Return error response
      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: {
          provider: 'quality',
          latency
        }
      };
    }
  }
  
  /**
   * Run emotion detection on text
   */
  public async detectEmotion(text: string): Promise<AIResponse> {
    await this.ensureInitialized();
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    // Create a cache key for this request
    const cacheKey = this.generateCacheKey('emotion', { text });
    
    // Check cache if enabled
    if (this.options.cacheEnabled) {
      const cachedResult = this.cache.get<AIResponse>(cacheKey);
      if (cachedResult) {
        // Update metrics with cache hit
        this.updateMetrics(
          'emotion',
          true,
          0, // No latency for cache hits
          undefined,
          undefined,
          true
        );
        
        // Return cached result with updated requestId
        return {
          ...cachedResult,
          requestId
        };
      }
    }
    
    try {
      // Use LLM service for emotion detection
      const llmResponse = await this.llmService.chat({
        provider: this.llmService.getDefaultProviderName(),
        model: 'gpt-3.5-turbo', // Use a smaller model for efficiency
        messages: [
          {
            role: 'system',
            content: 'You are an expert emotion detection system. Analyze the text and identify the primary emotion expressed.'
          },
          {
            role: 'user',
            content: `Detect the primary emotion in the following text. Respond with JSON in the format: {"emotion": "emotion_name", "confidence": 0.0-1.0, "valence": -1.0-1.0, "arousal": 0.0-1.0}. Valid emotions are: positive, negative, neutral, confused, interested, frustrated, excited, anxious.\n\nText: "${text}"`
          }
        ],
        options: {
          temperature: 0.2,
          maxTokens: 150
        }
      });
      
      // Parse the JSON response
      const emotionData = JSON.parse(llmResponse.content);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      
      // Convert TokenUsage to our expected format
      const tokenUsage = llmResponse.usage ? {
        prompt: llmResponse.usage.promptTokens,
        completion: llmResponse.usage.completionTokens,
        total: llmResponse.usage.totalTokens
      } : undefined;
      
      // Create response object
      const response: AIResponse = {
        requestId,
        success: true,
        data: emotionData,
        metadata: {
          provider: llmResponse.provider,
          model: llmResponse.model,
          latency,
          tokens: tokenUsage
        }
      };
      
      // Update metrics
      this.updateMetrics(
        llmResponse.provider,
        true,
        latency,
        tokenUsage
      );
      
      // Cache the result
      if (this.options.cacheEnabled) {
        this.cache.set(cacheKey, response);
      }
      
      // Emit event for monitoring
      this.emit('emotion:success', {
        requestId,
        emotion: emotionData.emotion,
        confidence: emotionData.confidence,
        latency
      });
      
      return response;
    } catch (error) {
      // Calculate latency for failed request
      const latency = Date.now() - startTime;
      
      // Log error
      logger.error(`Emotion detection failed: ${getErrorMessage(error)}`);
      
      // Fallback to basic sentiment analysis
      const sentiment = this.basicSentimentAnalysis(text);
      
      // Create fallback response
      const fallbackResponse: AIResponse = {
        requestId,
        success: true, // We return success with fallback data
        data: {
          emotion: sentiment.sentiment,
          confidence: 0.6,
          valence: sentiment.valence,
          arousal: 0.5
        },
        metadata: {
          provider: 'fallback',
          latency
        }
      };
      
      // Update metrics
      this.updateMetrics('fallback', true, latency);
      
      // Emit event for monitoring
      this.emit('emotion:fallback', {
        requestId,
        emotion: sentiment.sentiment,
        latency
      });
      
      return fallbackResponse;
    }
  }
  
  /**
   * Basic sentiment analysis as fallback
   */
  private basicSentimentAnalysis(text: string): { sentiment: string, valence: number } {
    const positiveWords = ['great', 'good', 'excellent', 'amazing', 'awesome', 'happy', 'excited', 'interested', 'yes', 'like', 'love'];
    const negativeWords = ['bad', 'terrible', 'awful', 'sad', 'unhappy', 'angry', 'upset', 'frustrated', 'no', 'hate', 'dislike'];
    const confusedWords = ['confused', 'unsure', 'don\'t understand', 'what do you mean', 'unclear', 'question'];
    
    const lowercaseText = text.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;
    let confusedCount = 0;
    
    for (const word of positiveWords) {
      if (lowercaseText.includes(word)) positiveCount++;
    }
    
    for (const word of negativeWords) {
      if (lowercaseText.includes(word)) negativeCount++;
    }
    
    for (const word of confusedWords) {
      if (lowercaseText.includes(word)) confusedCount++;
    }
    
    if (confusedCount > positiveCount && confusedCount > negativeCount) {
      return { sentiment: 'confused', valence: 0 };
    } else if (positiveCount > negativeCount) {
      return { sentiment: 'positive', valence: 0.7 };
    } else if (negativeCount > positiveCount) {
      return { sentiment: 'negative', valence: -0.7 };
    } else {
      return { sentiment: 'neutral', valence: 0 };
    }
  }
  
  /**
   * Get the current metrics
   */
  public getMetrics(): AIServiceMetrics {
    const avgLatency = this.metrics.requestsTotal > 0
      ? this.metrics.latencySum / this.metrics.requestsTotal
      : 0;
    
    const cacheHitRate = (this.metrics.cacheHits + this.metrics.cacheMisses) > 0
      ? this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)
      : 0;
    
    // Convert provider stats map to object
    const providerBreakdown: Record<string, any> = {};
    for (const [provider, stats] of this.metrics.providerStats.entries()) {
      providerBreakdown[provider] = {
        requests: stats.requests,
        success: stats.success,
        failure: stats.failure,
        avgLatency: stats.requests > 0 ? stats.latencySum / stats.requests : 0
      };
    }
    
    return {
      totalRequests: this.metrics.requestsTotal,
      successfulRequests: this.metrics.requestsSuccess,
      failedRequests: this.metrics.requestsFailure,
      avgLatency,
      cacheHitRate,
      tokenUsage: this.metrics.tokenUsage,
      costEstimate: this.metrics.costSum,
      providerBreakdown
    };
  }
  
  /**
   * Clear the cache
   */
  public clearCache(): void {
    this.cache.flushAll();
    logger.info('AI Orchestration Service cache cleared');
  }
  
  /**
   * Update configuration from database
   */
  public async updateConfiguration(): Promise<void> {
    try {
      logger.info('Updating AI Orchestration Service configuration from database...');
      
      // Reset initialization state
      this.isInitialized = false;
      
      // Get configuration from database
      const Configuration = mongoose.models.Configuration || mongoose.model('Configuration');
      const config = await Configuration.findOne();
      
      if (!config) {
        logger.warn('No configuration found in database. Using default AI service configuration.');
        return;
      }
      
      // Re-initialize services with new configuration
      await this.initializeLLMService(config);
      await this.initializeVoiceService(config);
      await this.initializeSpeechService(config);
      await this.initializeConversationEngine();
      
      this.isInitialized = true;
      logger.info('AI Orchestration Service configuration updated successfully');
      
      // Emit update event
      this.emit('configuration:updated');
    } catch (error) {
      logger.error(`Error updating AI Orchestration Service configuration: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Get the LLM service
   */
  public getLLMService(): LLMService {
    return this.llmService;
  }
  
  /**
   * Get the Voice service
   */
  public getVoiceService(): EnhancedVoiceAIService {
    return this.voiceService;
  }
  
  /**
   * Get the Speech service
   */
  public getSpeechService(): SpeechAnalysisService {
    return this.speechService;
  }
  
  /**
   * Get the Conversation Engine
   */
  public getConversationEngine(): AdvancedConversationEngineMock {
    return this.conversationEngine;
  }
}

// Export a singleton instance
let _aiOrchestrationService: AIOrchestrationService | null = null;

export const getAIOrchestrationService = (): AIOrchestrationService => {
  if (!_aiOrchestrationService) {
    _aiOrchestrationService = new AIOrchestrationService();
  }
  return _aiOrchestrationService;
};
