/**
 * WebCallResponsePipeline
 * 
 * Optimized response generation pipeline for web call testing
 * This service handles the flow from transcription to LLM to speech synthesis
 * with optimizations to reduce latency.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';
import webCallMetricsService from './webCallMetricsService';
import { getLLMService } from '../services';
import { getTextToSpeechService } from './textToSpeechService';
import webCallCircuitBreaker, { ServiceType } from './webCallCircuitBreaker';
import WebCallTest from '../models/WebCallTest';
import { WebCallSession } from './webCallService';

/**
 * Pipeline stage
 */
export enum PipelineStage {
  TRANSCRIPTION = 'transcription',
  CONTEXT_BUILDING = 'contextBuilding',
  LLM_PROCESSING = 'llmProcessing',
  TEXT_TO_SPEECH = 'textToSpeech',
  ANALYSIS = 'analysis'
}

/**
 * Response pipeline options
 */
export interface ResponsePipelineOptions {
  // LLM options
  llmProvider?: string;
  llmModel?: string;
  temperature?: number;
  maxTokens?: number;
  
  // TTS options
  voiceId?: string;
  stability?: number;
  similarity?: number;
  speed?: number;
  modelId?: string;
  
  // Performance options
  useParallelProcessing?: boolean;
  useCaching?: boolean;
  cacheSize?: number;
  useStreaming?: boolean;
  
  // Analysis options
  performAnalysis?: boolean;
  analysisDepth?: 'basic' | 'detailed';
}

/**
 * Response pipeline result
 */
export interface ResponsePipelineResult {
  text: string;
  audio?: Buffer;
  processingTime: {
    total: number;
    llm: number;
    tts: number;
    context: number;
  };
  metadata?: any;
}

/**
 * WebCallResponsePipeline class
 */
export class WebCallResponsePipeline extends EventEmitter {
  private options: Required<ResponsePipelineOptions>;
  private responseCache: Map<string, { result: ResponsePipelineResult, timestamp: number }> = new Map();
  private sessionContexts: Map<string, any[]> = new Map();
  private metrics: Map<string, {
    totalProcessingTime: number;
    llmProcessingTime: number;
    ttsProcessingTime: number;
    contextBuildingTime: number;
    processedResponses: number;
    cacheHits: number;
    cacheMisses: number;
  }> = new Map();
  
  constructor(options: ResponsePipelineOptions = {}) {
    super();
    
    // Set default options
    this.options = {
      llmProvider: options.llmProvider || 'openai',
      llmModel: options.llmModel || 'gpt-4',
      temperature: options.temperature !== undefined ? options.temperature : 0.7,
      maxTokens: options.maxTokens || 300,
      voiceId: options.voiceId || 'default',
      stability: options.stability !== undefined ? options.stability : 0.5,
      similarity: options.similarity !== undefined ? options.similarity : 0.75,
      speed: options.speed !== undefined ? options.speed : 1.0,
      modelId: options.modelId || 'eleven_turbo_v2',
      useParallelProcessing: options.useParallelProcessing !== undefined ? options.useParallelProcessing : true,
      useCaching: options.useCaching !== undefined ? options.useCaching : true,
      cacheSize: options.cacheSize || 100,
      useStreaming: options.useStreaming !== undefined ? options.useStreaming : false,
      performAnalysis: options.performAnalysis !== undefined ? options.performAnalysis : true,
      analysisDepth: options.analysisDepth || 'basic'
    };
    
    // Start cache cleanup timer
    setInterval(() => {
      this.cleanupCache();
    }, 60 * 60 * 1000); // 1 hour
    
    logger.info('WebCallResponsePipeline initialized with options:', {
      llmProvider: this.options.llmProvider,
      llmModel: this.options.llmModel,
      useParallelProcessing: this.options.useParallelProcessing,
      useCaching: this.options.useCaching
    });
  }
  
  /**
   * Initialize a session for response processing
   * @param sessionId The session ID
   */
  public initializeSession(sessionId: string): void {
    // Initialize context
    this.sessionContexts.set(sessionId, []);
    
    // Initialize metrics
    this.metrics.set(sessionId, {
      totalProcessingTime: 0,
      llmProcessingTime: 0,
      ttsProcessingTime: 0,
      contextBuildingTime: 0,
      processedResponses: 0,
      cacheHits: 0,
      cacheMisses: 0
    });
    
    logger.info(`Response pipeline initialized for session ${sessionId}`);
  }
  
  /**
   * Generate response for user input
   * @param sessionId The session ID
   * @param userInput User input text
   * @param systemPrompt System prompt
   * @param conversationHistory Conversation history
   * @param options Response pipeline options
   * @returns Response pipeline result
   */
  public async generateResponse(
    sessionId: string,
    userInput: string,
    systemPrompt: string,
    conversationHistory: { role: string, content: string }[] = [],
    options: Partial<ResponsePipelineOptions> = {}
  ): Promise<ResponsePipelineResult> {
    // Check if session exists
    if (!this.sessionContexts.has(sessionId)) {
      this.initializeSession(sessionId);
    }
    
    // Merge options
    const mergedOptions = { ...this.options, ...options };
    
    // Start processing timer
    const startTime = Date.now();
    let contextTime = 0;
    let llmTime = 0;
    let ttsTime = 0;
    
    try {
      // Check cache if enabled
      if (mergedOptions.useCaching) {
        const cacheKey = this.generateCacheKey(userInput, systemPrompt, conversationHistory);
        const cachedResult = this.responseCache.get(cacheKey);
        
        if (cachedResult) {
          // Update metrics
          const sessionMetrics = this.metrics.get(sessionId)!;
          sessionMetrics.cacheHits++;
          
          logger.info(`Cache hit for session ${sessionId}`);
          
          // Emit cache hit event
          this.emit('cacheHit', {
            sessionId,
            cacheKey,
            timestamp: Date.now()
          });
          
          return cachedResult.result;
        } else {
          // Update metrics
          const sessionMetrics = this.metrics.get(sessionId)!;
          sessionMetrics.cacheMisses++;
        }
      }
      
      // Build context
      const contextStartTime = Date.now();
      
      // Prepare conversation history
      let messages = [...conversationHistory];
      
      // Add system prompt if not already present
      if (!messages.some(msg => msg.role === 'system')) {
        messages.unshift({
          role: 'system',
          content: systemPrompt
        });
      }
      
      // Add user input if not already present
      if (!messages.some(msg => msg.role === 'user' && msg.content === userInput)) {
        messages.push({
          role: 'user',
          content: userInput
        });
      }
      
      contextTime = Date.now() - contextStartTime;
      
      // Record context building time
      webCallMetricsService.recordComponentLatency(sessionId, PipelineStage.CONTEXT_BUILDING as any, contextTime);
      
      // Generate LLM response
      const llmStartTime = Date.now();
      
      // Use circuit breaker to handle service failures
      const llmResponse = await webCallCircuitBreaker.executeWithBreaker(
        ServiceType.LLM,
        async () => {
          const llmService = getLLMService();
          
          return await llmService.chat({
            provider: mergedOptions.llmProvider as any,
            model: mergedOptions.llmModel,
            messages: messages as any,
            options: {
              temperature: mergedOptions.temperature,
              maxTokens: mergedOptions.maxTokens
            }
          });
        }
      );
      
      llmTime = Date.now() - llmStartTime;
      
      // Record LLM processing time
      webCallMetricsService.recordComponentLatency(sessionId, PipelineStage.LLM_PROCESSING, llmTime);
      
      // Get response text
      const responseText = llmResponse.content;
      
      // Generate speech if needed
      let audioBuffer: Buffer | undefined;
      
      if (mergedOptions.useParallelProcessing) {
        // Start TTS in parallel with LLM
        const ttsStartTime = Date.now();
        
        // Use circuit breaker to handle service failures
        audioBuffer = await webCallCircuitBreaker.executeWithBreaker(
          ServiceType.TEXT_TO_SPEECH,
          async () => {
            const ttsService = await getTextToSpeechService();
            
            return await ttsService.generateSpeech(responseText, {
              voiceId: mergedOptions.voiceId,
              stability: mergedOptions.stability,
              similarity: mergedOptions.similarity,
              speed: mergedOptions.speed,
              modelId: mergedOptions.modelId
            });
          }
        );
        
        ttsTime = Date.now() - ttsStartTime;
        
        // Record TTS processing time
        webCallMetricsService.recordComponentLatency(sessionId, PipelineStage.TEXT_TO_SPEECH, ttsTime);
      }
      
      // Calculate total processing time
      const totalTime = Date.now() - startTime;
      
      // Update metrics
      const sessionMetrics = this.metrics.get(sessionId)!;
      sessionMetrics.totalProcessingTime += totalTime;
      sessionMetrics.llmProcessingTime += llmTime;
      sessionMetrics.ttsProcessingTime += ttsTime;
      sessionMetrics.contextBuildingTime += contextTime;
      sessionMetrics.processedResponses++;
      
      // Create result
      const result: ResponsePipelineResult = {
        text: responseText,
        audio: audioBuffer,
        processingTime: {
          total: totalTime,
          llm: llmTime,
          tts: ttsTime,
          context: contextTime
        }
      };
      
      // Cache result if enabled
      if (mergedOptions.useCaching) {
        const cacheKey = this.generateCacheKey(userInput, systemPrompt, conversationHistory);
        this.responseCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
        
        // Limit cache size
        if (this.responseCache.size > mergedOptions.cacheSize) {
          // Remove oldest entry
          const oldestKey = [...this.responseCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
          this.responseCache.delete(oldestKey);
        }
      }
      
      // Emit completion event
      this.emit('responseGenerated', {
        sessionId,
        userInput,
        response: responseText,
        processingTime: result.processingTime,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      logger.error(`Error generating response for session ${sessionId}: ${error.message}`);
      
      // Emit error event
      this.emit('responseError', {
        sessionId,
        userInput,
        error,
        timestamp: Date.now()
      });
      
      throw error;
    }
  }
  
  /**
   * Generate cache key
   * @param userInput User input text
   * @param systemPrompt System prompt
   * @param conversationHistory Conversation history
   * @returns Cache key
   */
  private generateCacheKey(
    userInput: string,
    systemPrompt: string,
    conversationHistory: { role: string, content: string }[]
  ): string {
    // Create a simplified version of the conversation history
    const simplifiedHistory = conversationHistory.map(msg => `${msg.role}:${msg.content}`).join('|');
    
    // Create a hash of the inputs
    return `${systemPrompt.substring(0, 50)}|${simplifiedHistory.substring(0, 100)}|${userInput}`;
  }
  
  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [key, entry] of this.responseCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.responseCache.delete(key);
      }
    }
    
    logger.info(`Cache cleanup complete, ${this.responseCache.size} entries remaining`);
  }
  
  /**
   * Get metrics for a session
   * @param sessionId The session ID
   * @returns Session metrics
   */
  public getMetrics(sessionId: string): any {
    if (!this.metrics.has(sessionId)) {
      return null;
    }
    
    const metrics = this.metrics.get(sessionId)!;
    
    return {
      ...metrics,
      averageProcessingTime: metrics.processedResponses > 0 ? 
        metrics.totalProcessingTime / metrics.processedResponses : 0,
      averageLlmTime: metrics.processedResponses > 0 ?
        metrics.llmProcessingTime / metrics.processedResponses : 0,
      averageTtsTime: metrics.processedResponses > 0 ?
        metrics.ttsProcessingTime / metrics.processedResponses : 0,
      cacheHitRate: (metrics.cacheHits + metrics.cacheMisses) > 0 ?
        metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses) : 0
    };
  }
  
  /**
   * Analyze a completed session
   * @param session The web call session
   * @param systemPrompt The system prompt
   * @returns Analysis results
   */
  public async analyzeSession(
    session: WebCallSession,
    systemPrompt: string
  ): Promise<any> {
    if (!this.options.performAnalysis) {
      return null;
    }
    
    try {
      logger.info(`Analyzing session ${session.id}`);
      
      // Start analysis timer
      const startTime = Date.now();
      
      // Extract conversation
      const conversation = session.transcript.map(entry => ({
        role: entry.speaker === 'user' ? 'user' : 'assistant',
        content: entry.text
      }));
      
      // Add system prompt
      conversation.unshift({
        role: 'system',
        content: systemPrompt
      });
      
      // Add analysis prompt
      conversation.push({
        role: 'user',
        content: `Please analyze this conversation and provide insights on:
1. Response quality and relevance
2. Adherence to the system prompt instructions
3. Areas for improvement
4. Overall effectiveness
${this.options.analysisDepth === 'detailed' ? '5. Specific examples of good and bad responses\n6. Detailed recommendations for improving the system prompt' : ''}`
      });
      
      // Use LLM for analysis
      const llmService = getLLMService();
      
      const analysisResponse = await llmService.chat({
        provider: this.options.llmProvider as any,
        model: this.options.llmModel,
        messages: conversation as any,
        options: {
          temperature: 0.3, // Lower temperature for more consistent analysis
          maxTokens: 1000 // Allow longer response for analysis
        }
      });
      
      // Calculate analysis time
      const analysisTime = Date.now() - startTime;
      
      // Create analysis result
      const analysisResult = {
        sessionId: session.id,
        analysis: analysisResponse.content,
        analysisTime,
        timestamp: new Date()
      };
      
      // Emit analysis event
      this.emit('sessionAnalyzed', {
        sessionId: session.id,
        analysisResult,
        timestamp: Date.now()
      });
      
      logger.info(`Session analysis completed for ${session.id} in ${analysisTime}ms`);
      
      return analysisResult;
    } catch (error) {
      logger.error(`Error analyzing session ${session.id}: ${error.message}`);
      
      // Emit error event
      this.emit('analysisError', {
        sessionId: session.id,
        error,
        timestamp: Date.now()
      });
      
      return null;
    }
  }
  
  /**
   * Save analysis results to database
   * @param sessionId The session ID
   * @param testId The test ID
   * @returns True if successful, false otherwise
   */
  public async saveAnalysisToDatabase(
    sessionId: string,
    testId: string
  ): Promise<boolean> {
    try {
      // Find the test record
      const testRecord = await WebCallTest.findById(testId);
      
      if (!testRecord) {
        logger.warn(`Test record ${testId} not found for session ${sessionId}`);
        return false;
      }
      
      // Get metrics
      const metrics = this.getMetrics(sessionId);
      
      if (!metrics) {
        logger.warn(`Metrics not found for session ${sessionId}`);
        return false;
      }
      
      // Update test record with metrics
      await WebCallTest.findByIdAndUpdate(testId, {
        $set: {
          'metrics.llmLatency': metrics.averageLlmTime,
          'metrics.textToSpeechLatency': metrics.averageTtsTime,
          'analysis.processingMetrics': metrics,
          'analysis.timestamp': new Date()
        }
      });
      
      logger.info(`Analysis saved to database for session ${sessionId}, test ${testId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error saving analysis to database for session ${sessionId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Clean up resources for a session
   * @param sessionId The session ID
   */
  public cleanupSession(sessionId: string): void {
    // Clear context
    this.sessionContexts.delete(sessionId);
    
    logger.info(`Response pipeline cleaned up for session ${sessionId}`);
  }
  
  /**
   * Update processing options
   * @param options New options
   */
  public updateOptions(options: Partial<ResponsePipelineOptions>): void {
    // Update options
    Object.assign(this.options, options);
    
    logger.info('Response pipeline options updated:', options);
  }
  
  /**
   * Get pipeline health information
   * @returns Pipeline health information
   */
  public getPipelineHealth(): any {
    // Calculate overall metrics
    let totalProcessingTime = 0;
    let totalLlmTime = 0;
    let totalTtsTime = 0;
    let totalContextTime = 0;
    let totalResponses = 0;
    let totalCacheHits = 0;
    let totalCacheMisses = 0;
    
    // Aggregate metrics from all sessions
    for (const metrics of this.metrics.values()) {
      totalProcessingTime += metrics.totalProcessingTime;
      totalLlmTime += metrics.llmProcessingTime;
      totalTtsTime += metrics.ttsProcessingTime;
      totalContextTime += metrics.contextBuildingTime;
      totalResponses += metrics.processedResponses;
      totalCacheHits += metrics.cacheHits;
      totalCacheMisses += metrics.cacheMisses;
    }
    
    // Calculate averages
    const avgProcessingTime = totalResponses > 0 ? totalProcessingTime / totalResponses : 0;
    const avgLlmTime = totalResponses > 0 ? totalLlmTime / totalResponses : 0;
    const avgTtsTime = totalResponses > 0 ? totalTtsTime / totalResponses : 0;
    const avgContextTime = totalResponses > 0 ? totalContextTime / totalResponses : 0;
    const cacheHitRate = (totalCacheHits + totalCacheMisses) > 0 ? 
      totalCacheHits / (totalCacheHits + totalCacheMisses) : 0;
    
    return {
      status: 'healthy',
      activeSessions: this.metrics.size,
      cacheSize: this.responseCache.size,
      cacheHitRate,
      performance: {
        avgProcessingTime,
        avgLlmTime,
        avgTtsTime,
        avgContextTime
      },
      totals: {
        responses: totalResponses,
        cacheHits: totalCacheHits,
        cacheMisses: totalCacheMisses
      },
      options: {
        llmProvider: this.options.llmProvider,
        llmModel: this.options.llmModel,
        useParallelProcessing: this.options.useParallelProcessing,
        useCaching: this.options.useCaching
      }
    };
  }
}

// Create singleton instance
const webCallResponsePipeline = new WebCallResponsePipeline();

export default webCallResponsePipeline;