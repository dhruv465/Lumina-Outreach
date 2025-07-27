/**
 * Retrieval-Augmented Generation (RAG) Service
 * 
 * This service enhances LLM capabilities by retrieving relevant information
 * from external sources (databases, knowledge bases, etc.) and augmenting
 * the prompt with this information.
 */

import { EventEmitter } from 'events';
import { logger, getErrorMessage } from '../index';
import { LLMService } from './llm/service';
import { LLMProvider, LLMChatRequest } from './llm/types';
import mongoose from 'mongoose';
import { createHash } from 'crypto';
import NodeCache from 'node-cache';

// Types for the RAG service
export interface RAGSourceConfig {
  id: string;
  name: string;
  type: 'database' | 'vectorstore' | 'api' | 'filestore';
  connectionInfo: any;
  isEnabled: boolean;
  priority: number; // 1-100, lower means higher priority
  maxResultsPerQuery: number;
}

export interface RAGQueryOptions {
  sources?: string[]; // Source IDs to use for this query
  maxResults?: number;
  minRelevanceScore?: number; // 0-1, higher means more relevant
  includeMetadata?: boolean;
  timeout?: number; // milliseconds
  cacheKey?: string;
  bypassCache?: boolean;
}

export interface RAGResult {
  query: string;
  results: Array<{
    content: string;
    metadata: {
      source: string;
      sourceId: string;
      relevanceScore: number;
      timestamp: Date;
      [key: string]: any;
    };
  }>;
  augmentedPrompt?: string;
}

/**
 * Retrieval-Augmented Generation Service
 * 
 * Enhances LLM responses with relevant information from configured sources
 */
export class RAGService extends EventEmitter {
  private llmService: LLMService;
  private sources: Map<string, RAGSourceConfig> = new Map();
  private cache: NodeCache;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  
  constructor(llmService: LLMService) {
    super();
    this.llmService = llmService;
    
    // Initialize cache
    this.cache = new NodeCache({
      stdTTL: 60 * 60, // 1 hour
      checkperiod: 120,
      useClones: false
    });
    
    // Initialize sources lazily to avoid circular dependencies
    this.initializeSources().catch(error => {
      logger.error(`Failed to initialize RAG Service: ${getErrorMessage(error)}`);
    });
  }
  
  /**
   * Initialize sources from configuration
   */
  private async initializeSources(): Promise<void> {
    if (this.isInitialized || this.initializationPromise) {
      return this.initializationPromise;
    }
    
    this.initializationPromise = (async () => {
      try {
        logger.info('Initializing RAG Service...');
        
        // Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
          logger.warn('MongoDB not connected. RAG Service will initialize with default configuration.');
        }
        
        // Get configuration from database
        const Configuration = mongoose.models.Configuration || mongoose.model('Configuration');
        const config = await Configuration.findOne();
        
        if (!config || !config.ragConfig || !config.ragConfig.sources || config.ragConfig.sources.length === 0) {
          logger.info('No RAG configuration or sources found in database. RAG service will operate with minimal functionality.');
          this.setupDefaultSources();
        } else {
          // Initialize sources from configuration
          for (const sourceConfig of config.ragConfig.sources) {
            if (sourceConfig.isEnabled) {
              this.sources.set(sourceConfig.id, {
                id: sourceConfig.id,
                name: sourceConfig.name,
                type: sourceConfig.type,
                connectionInfo: sourceConfig.connectionInfo,
                isEnabled: true,
                priority: sourceConfig.priority || 50,
                maxResultsPerQuery: sourceConfig.maxResultsPerQuery || 5
              });
            }
          }
          
          logger.info(`RAG Service initialized with ${this.sources.size} sources`);
        }
        
        this.isInitialized = true;
        this.emit('initialized');
      } catch (error) {
        logger.error(`Error initializing RAG Service: ${getErrorMessage(error)}`);
        this.isInitialized = false;
        
        // Setup default sources as fallback
        this.setupDefaultSources();
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();
    
    return this.initializationPromise;
  }
  
  /**
   * Setup default sources
   */
  private setupDefaultSources(): void {
    // Only add MongoDB as default source if it's connected
    if (mongoose.connection.readyState === 1) {
      this.sources.set('mongodb', {
        id: 'mongodb',
        name: 'MongoDB',
        type: 'database',
        connectionInfo: {
          // Connection will be extracted from mongoose
        },
        isEnabled: true,
        priority: 10,
        maxResultsPerQuery: 5
      });
      
      logger.info('RAG Service initialized with MongoDB as default source');
    } else {
      logger.info('RAG Service initialized with no sources (MongoDB not connected)');
    }
  }
  
  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    
    await this.initializeSources();
  }
  
  /**
   * Generate a cache key for a query
   */
  private generateCacheKey(query: string, options?: RAGQueryOptions): string {
    const normalizedOptions = {
      sources: options?.sources?.sort() || [],
      maxResults: options?.maxResults || 10,
      minRelevanceScore: options?.minRelevanceScore || 0.7
    };
    
    return createHash('md5')
      .update(`${query}:${JSON.stringify(normalizedOptions)}`)
      .digest('hex');
  }
  
  /**
   * Check if RAG service has any available sources
   */
  public async hasAvailableSources(): Promise<boolean> {
    await this.ensureInitialized();
    return this.sources.size > 0;
  }

  /**
   * Query sources for relevant information
   */
  public async query(
    query: string,
    options: RAGQueryOptions = {}
  ): Promise<RAGResult> {
    await this.ensureInitialized();
    
    const startTime = Date.now();
    const cacheKey = options.cacheKey || this.generateCacheKey(query, options);
    const cacheEnabled = !options.bypassCache;
    
    // Check cache if enabled
    if (cacheEnabled) {
      const cachedResult = this.cache.get<RAGResult>(cacheKey);
      if (cachedResult) {
        logger.debug(`RAG cache hit for query: ${query}`);
        return cachedResult;
      }
    }
    
    try {
      logger.debug(`RAG query: ${query}`);
      
      // Filter sources based on options
      const sourcesToQuery = [...this.sources.values()]
        .filter(source => source.isEnabled)
        .filter(source => !options.sources || options.sources.includes(source.id))
        .sort((a, b) => a.priority - b.priority);
      
      if (sourcesToQuery.length === 0) {
        logger.debug('No enabled sources available for RAG query, returning empty result');
        return {
          query,
          results: [],
          augmentedPrompt: query
        };
      }
      
      // Execute queries in parallel with timeout
      const timeout = options.timeout || 5000;
      const queryPromises = sourcesToQuery.map(source => {
        return Promise.race([
          this.querySource(source, query, options),
          new Promise<any[]>((_, reject) => {
            setTimeout(() => reject(new Error(`Query to source ${source.id} timed out after ${timeout}ms`)), timeout);
          })
        ]);
      });
      
      // Aggregate results
      const allResults = await Promise.allSettled(queryPromises);
      
      // Process results
      const successfulResults = allResults
        .filter((result): result is PromiseFulfilledResult<any[]> => result.status === 'fulfilled')
        .flatMap(result => result.value)
        .filter(result => result.metadata.relevanceScore >= (options.minRelevanceScore || 0.7))
        .sort((a, b) => b.metadata.relevanceScore - a.metadata.relevanceScore)
        .slice(0, options.maxResults || 10);
      
      // Create augmented prompt
      const augmentedPrompt = this.createAugmentedPrompt(query, successfulResults);
      
      // Create result object
      const result: RAGResult = {
        query,
        results: successfulResults,
        augmentedPrompt
      };
      
      // Cache result if enabled
      if (cacheEnabled) {
        this.cache.set(cacheKey, result);
      }
      
      // Log metrics
      const latency = Date.now() - startTime;
      logger.debug(`RAG query completed in ${latency}ms with ${successfulResults.length} results`);
      
      // Emit event for monitoring
      this.emit('query:success', {
        query,
        sourcesQueried: sourcesToQuery.length,
        resultsCount: successfulResults.length,
        latency
      });
      
      return result;
    } catch (error) {
      // Log error
      logger.error(`RAG query failed: ${getErrorMessage(error)}`);
      
      // Emit event for monitoring
      this.emit('query:error', {
        query,
        error: getErrorMessage(error),
        latency: Date.now() - startTime
      });
      
      // Return empty result
      return {
        query,
        results: [],
        augmentedPrompt: query
      };
    }
  }
  
  /**
   * Query a specific source
   */
  private async querySource(
    source: RAGSourceConfig,
    query: string,
    options: RAGQueryOptions
  ): Promise<any[]> {
    try {
      logger.debug(`Querying source ${source.id} for: ${query}`);
      
      switch (source.type) {
        case 'database':
          return await this.queryDatabase(source, query, options);
        case 'vectorstore':
          return await this.queryVectorStore(source, query, options);
        case 'api':
          return await this.queryExternalAPI(source, query, options);
        case 'filestore':
          return await this.queryFileStore(source, query, options);
        default:
          throw new Error(`Unsupported source type: ${source.type}`);
      }
    } catch (error) {
      logger.error(`Error querying source ${source.id}: ${getErrorMessage(error)}`);
      return [];
    }
  }
  
  /**
   * Query a database source
   */
  private async queryDatabase(
    source: RAGSourceConfig,
    query: string,
    options: RAGQueryOptions
  ): Promise<any[]> {
    // This is a placeholder implementation
    // In a real implementation, this would query MongoDB or other databases
    
    // For MongoDB source, use text search
    if (source.id === 'mongodb') {
      try {
        // Extract models to search
        const modelsToSearch = [
          'Call',
          'Campaign',
          'Lead',
          'Script',
          'Conversation'
        ];
        
        const results: any[] = [];
        
        // Query each model
        for (const modelName of modelsToSearch) {
          if (!mongoose.models[modelName]) continue;
          
          const Model = mongoose.models[modelName];
          
          try {
            // Perform text search if the model has a text index
            const searchResults = await Model.find(
              { $text: { $search: query } },
              { score: { $meta: 'textScore' } }
            )
              .sort({ score: { $meta: 'textScore' } })
              .limit(source.maxResultsPerQuery)
              .lean()
              .exec();
            
            // Transform results
            for (const result of searchResults) {
              results.push({
                content: JSON.stringify(this.sanitizeDocument(result)),
                metadata: {
                  source: 'mongodb',
                  sourceId: source.id,
                  model: modelName,
                  id: result._id.toString(),
                  relevanceScore: result.score || 0.7,
                  timestamp: result.updatedAt || result.createdAt || new Date()
                }
              });
            }
          } catch (modelError) {
            // If text search fails (e.g., no text index), try a simple regex search as fallback
            logger.debug(`Text search failed for model ${modelName}, trying fallback search: ${getErrorMessage(modelError)}`);
            
            try {
              // Simple fallback search on common text fields
              const fallbackQuery = {
                $or: [
                  { name: { $regex: query, $options: 'i' } },
                  { title: { $regex: query, $options: 'i' } },
                  { description: { $regex: query, $options: 'i' } },
                  { content: { $regex: query, $options: 'i' } },
                  { message: { $regex: query, $options: 'i' } }
                ]
              };
              
              const fallbackResults = await Model.find(fallbackQuery)
                .limit(source.maxResultsPerQuery)
                .lean()
                .exec();
              
              // Transform fallback results
              for (const result of fallbackResults) {
                results.push({
                  content: JSON.stringify(this.sanitizeDocument(result)),
                  metadata: {
                    source: 'mongodb',
                    sourceId: source.id,
                    model: modelName,
                    id: result._id.toString(),
                    relevanceScore: 0.5, // Lower relevance for fallback search
                    timestamp: result.updatedAt || result.createdAt || new Date()
                  }
                });
              }
            } catch (fallbackError) {
              logger.debug(`Fallback search also failed for model ${modelName}: ${getErrorMessage(fallbackError)}`);
              // Continue to next model
            }
          }
        }
        
        return results;
      } catch (error) {
        logger.debug(`MongoDB query error (this is normal if no knowledge base exists): ${getErrorMessage(error)}`);
        return [];
      }
    }
    
    return [];
  }
  
  /**
   * Sanitize a document by removing sensitive fields
   */
  private sanitizeDocument(doc: any): any {
    if (!doc) return doc;
    
    const sanitized = { ...doc };
    
    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'apiKey',
      'secret',
      'token',
      '__v',
      '_id' // Replace with string ID
    ];
    
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        if (field === '_id') {
          sanitized.id = sanitized._id.toString();
        }
        delete sanitized[field];
      }
    }
    
    // Process nested objects and arrays
    for (const [key, value] of Object.entries(sanitized)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item => 
            typeof item === 'object' ? this.sanitizeDocument(item) : item
          );
        } else {
          sanitized[key] = this.sanitizeDocument(value);
        }
      }
    }
    
    return sanitized;
  }
  
  /**
   * Query a vector store source
   */
  private async queryVectorStore(
    source: RAGSourceConfig,
    query: string,
    options: RAGQueryOptions
  ): Promise<any[]> {
    // This is a placeholder implementation
    // In a real implementation, this would query a vector store
    
    // For now, return empty results
    return [];
  }
  
  /**
   * Query an external API source
   */
  private async queryExternalAPI(
    source: RAGSourceConfig,
    query: string,
    options: RAGQueryOptions
  ): Promise<any[]> {
    // This is a placeholder implementation
    // In a real implementation, this would query an external API
    
    // For now, return empty results
    return [];
  }
  
  /**
   * Query a file store source
   */
  private async queryFileStore(
    source: RAGSourceConfig,
    query: string,
    options: RAGQueryOptions
  ): Promise<any[]> {
    // This is a placeholder implementation
    // In a real implementation, this would query a file store
    
    // For now, return empty results
    return [];
  }
  
  /**
   * Create an augmented prompt from the query and results
   */
  private createAugmentedPrompt(
    query: string,
    results: any[]
  ): string {
    if (results.length === 0) {
      return query;
    }
    
    // Construct prompt with context
    let contextString = '';
    
    for (const result of results) {
      contextString += `--- Source: ${result.metadata.source} (${result.metadata.model || 'unknown'}) ---\n`;
      contextString += result.content;
      contextString += '\n\n';
    }
    
    // Construct final prompt
    const augmentedPrompt = `
I want you to answer the following query based on the provided context information. If the context doesn't contain relevant information, respond based on your general knowledge.

CONTEXT:
${contextString}

QUERY:
${query}

ANSWER:
`;
    
    return augmentedPrompt;
  }
  
  /**
   * Generate a response using RAG and LLM
   */
  public async generateResponse(
    query: string,
    options: RAGQueryOptions & {
      provider?: LLMProvider;
      model?: string;
      temperature?: number;
      systemPrompt?: string;
    } = {}
  ): Promise<{
    query: string;
    response: string;
    augmentedPrompt?: string;
    sources: Array<{
      source: string;
      relevanceScore: number;
    }>;
  }> {
    try {
      // Retrieve relevant information
      const ragResult = await this.query(query, options);
      
      // If no results, use LLM directly
      if (ragResult.results.length === 0) {
        const llmResponse = await this.llmService.chat({
          provider: options.provider,
          model: options.model,
          messages: [
            {
              role: 'system',
              content: options.systemPrompt || 'You are a helpful assistant.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          options: {
            temperature: options.temperature || 0.7
          }
        });
        
        return {
          query,
          response: llmResponse.content,
          sources: []
        };
      }
      
      // Use augmented prompt for LLM
      const llmResponse = await this.llmService.chat({
        provider: options.provider,
        model: options.model,
        messages: [
          {
            role: 'system',
            content: options.systemPrompt || 'You are a helpful assistant. Use the provided context to answer the question accurately.'
          },
          {
            role: 'user',
            content: ragResult.augmentedPrompt || query
          }
        ],
        options: {
          temperature: options.temperature || 0.5 // Lower temperature for factual responses
        }
      });
      
      // Extract sources for citation
      const sources = ragResult.results.map(result => ({
        source: `${result.metadata.source}${result.metadata.model ? ` (${result.metadata.model})` : ''}`,
        relevanceScore: result.metadata.relevanceScore
      }));
      
      return {
        query,
        response: llmResponse.content,
        augmentedPrompt: ragResult.augmentedPrompt,
        sources
      };
    } catch (error) {
      logger.error(`RAG response generation failed: ${getErrorMessage(error)}`);
      
      // Fallback to direct LLM query
      try {
        const llmResponse = await this.llmService.chat({
          provider: options.provider,
          model: options.model,
          messages: [
            {
              role: 'system',
              content: options.systemPrompt || 'You are a helpful assistant.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          options: {
            temperature: options.temperature || 0.7
          }
        });
        
        return {
          query,
          response: llmResponse.content,
          sources: []
        };
      } catch (fallbackError) {
        logger.error(`Fallback LLM query failed: ${getErrorMessage(fallbackError)}`);
        return {
          query,
          response: "I'm sorry, I couldn't process your request at this time. Please try again later.",
          sources: []
        };
      }
    }
  }
  
  /**
   * Clear the cache
   */
  public clearCache(): void {
    this.cache.flushAll();
    logger.info('RAG Service cache cleared');
  }
  
  /**
   * Update configuration from database
   */
  public async updateConfiguration(): Promise<void> {
    try {
      logger.info('Updating RAG Service configuration from database...');
      
      // Reset initialization state
      this.isInitialized = false;
      this.sources.clear();
      
      // Re-initialize sources
      await this.initializeSources();
      
      logger.info('RAG Service configuration updated successfully');
      
      // Emit update event
      this.emit('configuration:updated');
    } catch (error) {
      logger.error(`Error updating RAG Service configuration: ${getErrorMessage(error)}`);
      throw error;
    }
  }
}

// Export a singleton instance
let _ragService: RAGService | null = null;

export const getRAGService = (llmService: LLMService): RAGService => {
  if (!_ragService) {
    _ragService = new RAGService(llmService);
  }
  return _ragService;
};
