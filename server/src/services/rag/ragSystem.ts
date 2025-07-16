/**
 * Advanced RAG (Retrieval-Augmented Generation) System
 * 
 * This service provides advanced context retrieval and embedding capabilities
 * for enhancing LLM responses with relevant information from various data sources.
 */

import { EventEmitter } from 'events';
import { LLMMessage, LLMProvider } from '../llm';
import logger from '../../utils/logger';
import { getErrorMessage } from '../../utils/logger';
import mongoose from 'mongoose';
import { getAIOrchestration } from '../aiOrchestration/orchestrationLayer';
import { createRateLimitAwareCircuitBreaker } from '../../utils/circuitBreaker';

// RAG Retrieval events
export enum RAGEvent {
  RETRIEVAL_START = 'retrieval-start',
  RETRIEVAL_COMPLETE = 'retrieval-complete',
  CONTEXT_GENERATION = 'context-generation',
  ERROR = 'error'
}

// Retrieval strategies
export enum RetrievalStrategy {
  SEMANTIC_SEARCH = 'semantic-search',
  HYBRID_SEARCH = 'hybrid-search',
  METADATA_FILTER = 'metadata-filter',
  HIERARCHICAL = 'hierarchical',
  KNOWLEDGE_GRAPH = 'knowledge-graph'
}

// Document types that can be retrieved
export enum DocumentType {
  PRODUCT = 'product',
  FAQ = 'faq',
  POLICY = 'policy',
  CUSTOMER = 'customer',
  CONVERSATION = 'conversation',
  KNOWLEDGE_BASE = 'knowledge-base',
  USER_DEFINED = 'user-defined'
}

// Result from RAG retrieval
export interface RetrievalResult {
  documents: RetrievedDocument[];
  strategy: RetrievalStrategy;
  query: string;
  timestamp: Date;
  latency: number;
  metadata?: Record<string, any>;
}

// Document retrieved from a data source
export interface RetrievedDocument {
  id: string;
  content: string;
  type: DocumentType;
  source: string;
  metadata: Record<string, any>;
  relevanceScore: number;
  embedding?: number[];
  chunks?: {
    content: string;
    relevanceScore: number;
  }[];
}

// RAG generation result
export interface RAGGenerationResult {
  augmentedPrompt: LLMMessage[];
  retrievalResults: RetrievalResult;
  selectedDocuments: RetrievedDocument[];
  strategy: string;
}

// Advanced reranking model options
export interface RerankingOptions {
  model: string;
  enabled: boolean;
  topK: number;
  threshold: number;
  useRecency: boolean;
  usePreviousInteractions: boolean;
}

// Configuration for RAG system
export interface RAGConfig {
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  similarityMetric: 'cosine' | 'euclidean' | 'dot';
  chunking: {
    enabled: boolean;
    chunkSize: number;
    chunkOverlap: number;
    strategy: 'fixed' | 'semantic' | 'recursive';
  };
  retrieval: {
    topK: number;
    minRelevanceScore: number;
    strategy: RetrievalStrategy;
    hybridSearch: {
      keywordWeight: number;
      semanticWeight: number;
    };
  };
  reranking: RerankingOptions;
  promptTemplate: string;
  maxContextLength: number;
  cacheTTL: number;
}

/**
 * The RAG System provides advanced context retrieval and embedding capabilities
 * for enhancing LLM responses with relevant information.
 */
export class RAGSystem extends EventEmitter {
  private config: RAGConfig;
  private embeddingCircuitBreaker: any;
  private cache: Map<string, { result: RetrievalResult; timestamp: number }> = new Map();
  
  constructor(config?: Partial<RAGConfig>) {
    super();
    
    // Default configuration
    this.config = {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
      similarityMetric: 'cosine',
      chunking: {
        enabled: true,
        chunkSize: 512,
        chunkOverlap: 50,
        strategy: 'semantic'
      },
      retrieval: {
        topK: 5,
        minRelevanceScore: 0.7,
        strategy: RetrievalStrategy.HYBRID_SEARCH,
        hybridSearch: {
          keywordWeight: 0.3,
          semanticWeight: 0.7
        }
      },
      reranking: {
        model: 'default',
        enabled: true,
        topK: 10,
        threshold: 0.7,
        useRecency: true,
        usePreviousInteractions: true
      },
      promptTemplate: `Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.

Context:
{{context}}

Question: {{question}}

Answer:`,
      maxContextLength: 4000,
      cacheTTL: 300 // 5 minutes
    };
    
    // Override defaults with provided config
    if (config) {
      this.config = {
        ...this.config,
        ...config,
        chunking: {
          ...this.config.chunking,
          ...(config.chunking || {})
        },
        retrieval: {
          ...this.config.retrieval,
          ...(config.retrieval || {}),
          hybridSearch: {
            ...this.config.retrieval.hybridSearch,
            ...(config.retrieval?.hybridSearch || {})
          }
        },
        reranking: {
          ...this.config.reranking,
          ...(config.reranking || {})
        }
      };
    }
    
    // Initialize circuit breaker for embedding API
    this.embeddingCircuitBreaker = createRateLimitAwareCircuitBreaker(
      async (text: string) => {
        // This would be replaced with actual embedding API call
        return this.generateEmbedding(text);
      },
      {
        timeout: 10000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000,
        volumeThreshold: 3,
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 5000,
        jitter: true
      },
      'rag-embedding'
    );
    
    logger.info('RAG System initialized');
  }
  
  /**
   * Generate embeddings for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // This would be replaced with actual embedding API call
    // For now, simulate with random embedding vector
    const orchestration = getAIOrchestration();
    if (!orchestration) {
      throw new Error('AI Orchestration Layer not initialized');
    }
    
    try {
      // In a real implementation, this would call an embedding API
      // Simulate for now with random embedding
      // TODO: Implement actual embedding API calls
      const embeddingDimension = this.config.embeddingDimension;
      const embedding = Array(embeddingDimension).fill(0).map(() => Math.random() * 2 - 1);
      
      // Normalize the embedding vector
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      return embedding.map(val => val / magnitude);
    } catch (error) {
      logger.error(`Error generating embedding: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Get embeddings for a text with circuit breaker protection
   */
  public async getEmbedding(text: string): Promise<number[]> {
    return await this.embeddingCircuitBreaker.execute(text);
  }
  
  /**
   * Generate optimized prompt with retrieved context
   */
  public async generateEnhancedPrompt(
    query: string,
    messages: LLMMessage[],
    options?: {
      documentTypes?: DocumentType[];
      retrievalStrategy?: RetrievalStrategy;
      maxDocuments?: number;
      filterMetadata?: Record<string, any>;
    }
  ): Promise<RAGGenerationResult> {
    try {
      // Track start time for performance metrics
      const startTime = Date.now();
      
      // Emit retrieval start event
      this.emit(RAGEvent.RETRIEVAL_START, {
        query,
        timestamp: new Date(),
        options
      });
      
      // Check cache first
      const cacheKey = this.generateCacheKey(query, options);
      const cachedResult = this.getFromCache(cacheKey);
      
      // Use cache if available
      let retrievalResults: RetrievalResult;
      if (cachedResult) {
        retrievalResults = cachedResult;
        logger.debug(`Using cached retrieval results for query: ${query}`);
      } else {
        // Retrieve relevant documents
        retrievalResults = await this.retrieveRelevantDocuments(
          query,
          options?.documentTypes || [
            DocumentType.FAQ,
            DocumentType.KNOWLEDGE_BASE,
            DocumentType.PRODUCT
          ],
          options?.retrievalStrategy || this.config.retrieval.strategy,
          options?.maxDocuments || this.config.retrieval.topK,
          options?.filterMetadata
        );
        
        // Add to cache
        this.addToCache(cacheKey, retrievalResults);
      }
      
      // Apply reranking if enabled
      let selectedDocuments = retrievalResults.documents;
      if (this.config.reranking.enabled && selectedDocuments.length > 0) {
        selectedDocuments = this.rerankDocuments(
          selectedDocuments,
          query,
          messages
        );
      }
      
      // Create augmented prompt using retrieval results
      const augmentedPrompt = this.createAugmentedPrompt(
        messages,
        selectedDocuments,
        query
      );
      
      // Emit context generation event
      this.emit(RAGEvent.CONTEXT_GENERATION, {
        query,
        documents: selectedDocuments.length,
        latency: Date.now() - startTime,
        messageCount: augmentedPrompt.length
      });
      
      // Return the augmented prompt and retrieval information
      return {
        augmentedPrompt,
        retrievalResults,
        selectedDocuments,
        strategy: retrievalResults.strategy
      };
    } catch (error) {
      // Emit error event
      this.emit(RAGEvent.ERROR, {
        query,
        error: getErrorMessage(error),
        timestamp: new Date()
      });
      
      logger.error(`Error generating enhanced prompt: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Retrieve relevant documents based on the query
   */
  private async retrieveRelevantDocuments(
    query: string,
    documentTypes: DocumentType[],
    strategy: RetrievalStrategy,
    maxDocuments: number,
    filterMetadata?: Record<string, any>
  ): Promise<RetrievalResult> {
    try {
      // Start timing
      const startTime = Date.now();
      
      // Get query embedding
      const queryEmbedding = await this.getEmbedding(query);
      
      // Get database models
      const KnowledgeBase = mongoose.model('KnowledgeBase');
      const FAQ = mongoose.model('FAQ');
      const Product = mongoose.model('Product');
      
      // Prepare result
      const retrievalResult: RetrievalResult = {
        documents: [],
        strategy,
        query,
        timestamp: new Date(),
        latency: 0
      };
      
      // Build query based on strategy
      let dbQuery: any = {};
      
      // Add document type filter
      if (documentTypes.length > 0) {
        dbQuery.type = { $in: documentTypes };
      }
      
      // Add metadata filters if provided
      if (filterMetadata) {
        Object.entries(filterMetadata).forEach(([key, value]) => {
          dbQuery[`metadata.${key}`] = value;
        });
      }
      
      let documents: any[] = [];
      
      // Execute strategy
      switch (strategy) {
        case RetrievalStrategy.SEMANTIC_SEARCH:
          // Perform vector search
          documents = await this.performVectorSearch(
            queryEmbedding,
            dbQuery,
            maxDocuments
          );
          break;
          
        case RetrievalStrategy.HYBRID_SEARCH:
          // Perform hybrid search (vector + keyword)
          documents = await this.performHybridSearch(
            query,
            queryEmbedding,
            dbQuery,
            maxDocuments,
            this.config.retrieval.hybridSearch.keywordWeight,
            this.config.retrieval.hybridSearch.semanticWeight
          );
          break;
          
        case RetrievalStrategy.METADATA_FILTER:
          // Perform metadata filtered search
          documents = await this.performMetadataFilteredSearch(
            queryEmbedding,
            dbQuery,
            maxDocuments
          );
          break;
          
        case RetrievalStrategy.HIERARCHICAL:
          // Perform hierarchical search
          documents = await this.performHierarchicalSearch(
            query,
            queryEmbedding,
            dbQuery,
            maxDocuments
          );
          break;
          
        default:
          // Default to semantic search
          documents = await this.performVectorSearch(
            queryEmbedding,
            dbQuery,
            maxDocuments
          );
      }
      
      // Process documents
      retrievalResult.documents = documents.map(doc => ({
        id: doc._id.toString(),
        content: doc.content,
        type: doc.type,
        source: doc.source,
        metadata: doc.metadata || {},
        relevanceScore: doc.score || 0,
        chunks: doc.chunks
      }));
      
      // Calculate latency
      retrievalResult.latency = Date.now() - startTime;
      
      // Emit retrieval complete event
      this.emit(RAGEvent.RETRIEVAL_COMPLETE, {
        query,
        strategy,
        documentCount: retrievalResult.documents.length,
        latency: retrievalResult.latency
      });
      
      return retrievalResult;
    } catch (error) {
      logger.error(`Error retrieving documents: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Perform vector search on documents
   */
  private async performVectorSearch(
    queryEmbedding: number[],
    dbQuery: any,
    maxDocuments: number
  ): Promise<any[]> {
    // In a real implementation, this would use a vector database
    // For now, simulate with a mock response
    const KnowledgeBase = mongoose.model('KnowledgeBase');
    
    // This is a simulation - in real implementation would use:
    // - Vector search in MongoDB (if using Atlas)
    // - Pinecone, Weaviate, Qdrant, or similar vector DB
    // - Custom vector search implementation
    
    // Simulated vector search
    try {
      // Get documents
      const documents = await KnowledgeBase.find(dbQuery).limit(100);
      
      // Simulate relevance scoring
      const scoredDocuments = documents.map(doc => {
        // In a real implementation, this would compute similarity between
        // query embedding and document embedding
        const score = Math.random() * 0.3 + 0.7; // Simulate high relevance
        
        return {
          ...doc.toObject(),
          score
        };
      });
      
      // Sort by score
      scoredDocuments.sort((a, b) => b.score - a.score);
      
      // Return top N
      return scoredDocuments.slice(0, maxDocuments);
    } catch (error) {
      logger.error(`Error in vector search: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Perform hybrid search (combination of vector and keyword search)
   */
  private async performHybridSearch(
    query: string,
    queryEmbedding: number[],
    dbQuery: any,
    maxDocuments: number,
    keywordWeight: number,
    semanticWeight: number
  ): Promise<any[]> {
    try {
      // Get vector search results
      const vectorResults = await this.performVectorSearch(
        queryEmbedding,
        dbQuery,
        maxDocuments * 2
      );
      
      // Get keyword search results
      const keywordResults = await this.performKeywordSearch(
        query,
        dbQuery,
        maxDocuments * 2
      );
      
      // Combine results with weighted scoring
      const combinedResults = new Map();
      
      // Add vector results with semantic weight
      vectorResults.forEach(doc => {
        combinedResults.set(doc._id.toString(), {
          ...doc,
          score: doc.score * semanticWeight
        });
      });
      
      // Add or update with keyword results
      keywordResults.forEach(doc => {
        const docId = doc._id.toString();
        if (combinedResults.has(docId)) {
          // Document exists in both results, combine scores
          const existing = combinedResults.get(docId);
          combinedResults.set(docId, {
            ...existing,
            score: existing.score + (doc.score * keywordWeight)
          });
        } else {
          // Only in keyword results
          combinedResults.set(docId, {
            ...doc,
            score: doc.score * keywordWeight
          });
        }
      });
      
      // Convert to array and sort
      const results = Array.from(combinedResults.values());
      results.sort((a, b) => b.score - a.score);
      
      // Return top N
      return results.slice(0, maxDocuments);
    } catch (error) {
      logger.error(`Error in hybrid search: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Perform keyword search on documents
   */
  private async performKeywordSearch(
    query: string,
    dbQuery: any,
    maxDocuments: number
  ): Promise<any[]> {
    try {
      // In a real implementation, this would use full-text search
      const KnowledgeBase = mongoose.model('KnowledgeBase');
      
      // Add text search to query
      const textQuery = {
        ...dbQuery,
        $text: { $search: query }
      };
      
      // Execute search
      const documents = await KnowledgeBase.find(textQuery)
        .select({ score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(maxDocuments);
      
      return documents.map(doc => ({
        ...doc.toObject(),
        score: doc.score
      }));
    } catch (error) {
      logger.error(`Error in keyword search: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Perform metadata filtered search
   */
  private async performMetadataFilteredSearch(
    queryEmbedding: number[],
    dbQuery: any,
    maxDocuments: number
  ): Promise<any[]> {
    // This is similar to vector search but prioritizes metadata matching
    try {
      // Perform basic vector search
      const results = await this.performVectorSearch(
        queryEmbedding,
        dbQuery,
        maxDocuments * 2
      );
      
      // Boost scores based on metadata matches
      const boostedResults = results.map(doc => {
        let metadataScore = 0;
        
        // Calculate metadata match score based on query fields
        // This is a simplified implementation
        if (dbQuery) {
          Object.entries(dbQuery).forEach(([key, value]) => {
            if (key.startsWith('metadata.') && doc.metadata && 
                doc.metadata[key.replace('metadata.', '')] === value) {
              metadataScore += 0.2; // Boost score for each metadata match
            }
          });
        }
        
        return {
          ...doc,
          score: doc.score * (1 + metadataScore) // Boost score
        };
      });
      
      // Sort by adjusted score
      boostedResults.sort((a, b) => b.score - a.score);
      
      // Return top N
      return boostedResults.slice(0, maxDocuments);
    } catch (error) {
      logger.error(`Error in metadata filtered search: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Perform hierarchical search
   */
  private async performHierarchicalSearch(
    query: string,
    queryEmbedding: number[],
    dbQuery: any,
    maxDocuments: number
  ): Promise<any[]> {
    try {
      // 1. First-level search: coarse-grained topics/categories
      const categoryQuery = {
        ...dbQuery,
        'metadata.isCategory': true
      };
      
      const categoryResults = await this.performVectorSearch(
        queryEmbedding,
        categoryQuery,
        3 // Top categories
      );
      
      if (categoryResults.length === 0) {
        // Fallback to standard vector search if no categories match
        return this.performVectorSearch(queryEmbedding, dbQuery, maxDocuments);
      }
      
      // 2. Second-level search: documents within the top categories
      const categoryIds = categoryResults.map(cat => cat._id);
      const documentQuery = {
        ...dbQuery,
        'metadata.categoryId': { $in: categoryIds }
      };
      
      // Perform vector search within the selected categories
      const documentResults = await this.performVectorSearch(
        queryEmbedding,
        documentQuery,
        maxDocuments
      );
      
      // 3. Mix in some general results to ensure coverage
      if (documentResults.length < maxDocuments) {
        const generalQuery = {
          ...dbQuery,
          _id: { $nin: documentResults.map(doc => doc._id) } // Exclude already found
        };
        
        const generalResults = await this.performVectorSearch(
          queryEmbedding,
          generalQuery,
          maxDocuments - documentResults.length
        );
        
        // Combine results
        return [...documentResults, ...generalResults];
      }
      
      return documentResults;
    } catch (error) {
      logger.error(`Error in hierarchical search: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Rerank documents based on additional factors
   */
  private rerankDocuments(
    documents: RetrievedDocument[],
    query: string,
    messages: LLMMessage[]
  ): RetrievedDocument[] {
    // Copy documents to avoid mutating originals
    const rerankedDocs = [...documents];
    
    // Extract user's recent messages for context awareness
    const recentUserMessages = messages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content);
    
    // Apply reranking logic
    rerankedDocs.forEach(doc => {
      let scoreAdjustment = 0;
      
      // 1. Recency boost - if document has a timestamp, boost newer documents
      if (doc.metadata.timestamp) {
        const docDate = new Date(doc.metadata.timestamp);
        const ageInDays = (Date.now() - docDate.getTime()) / (1000 * 60 * 60 * 24);
        
        if (this.config.reranking.useRecency) {
          // Newer documents get a boost, max +0.1 for very recent docs
          scoreAdjustment += Math.max(0, 0.1 - (ageInDays / 30) * 0.1);
        }
      }
      
      // 2. Previous interaction boost
      if (this.config.reranking.usePreviousInteractions && recentUserMessages.length > 0) {
        // Check if document content is relevant to recent messages
        const contentRelevance = recentUserMessages.some(msg => {
          const relevanceScore = this.calculateTextSimilarity(msg, doc.content);
          return relevanceScore > 0.6; // Threshold for relevance
        });
        
        if (contentRelevance) {
          scoreAdjustment += 0.15; // Boost if relevant to conversation history
        }
      }
      
      // 3. Chunk-level scoring adjustment
      if (doc.chunks && doc.chunks.length > 0) {
        // Find the max chunk score
        const maxChunkScore = Math.max(...doc.chunks.map(c => c.relevanceScore));
        
        // If best chunk is significantly better than overall, adjust score
        if (maxChunkScore > doc.relevanceScore + 0.1) {
          scoreAdjustment += 0.05;
        }
      }
      
      // 4. Document type/source boost
      if (doc.type === DocumentType.FAQ) {
        scoreAdjustment += 0.05; // Slightly prefer FAQs
      } else if (doc.type === DocumentType.KNOWLEDGE_BASE && 
                doc.metadata.expertReviewed) {
        scoreAdjustment += 0.08; // Prefer expert-reviewed content
      }
      
      // Apply the score adjustment
      doc.relevanceScore = Math.min(1.0, doc.relevanceScore + scoreAdjustment);
    });
    
    // Sort by adjusted score
    rerankedDocs.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Apply threshold filtering
    const thresholdedDocs = rerankedDocs.filter(
      doc => doc.relevanceScore >= this.config.reranking.threshold
    );
    
    // Return top K documents
    return thresholdedDocs.slice(0, this.config.reranking.topK);
  }
  
  /**
   * Calculate text similarity score (simplified)
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    // This is a simplified text similarity function
    // In a real implementation, you would use embeddings or a more sophisticated approach
    
    // Tokenize texts (simple word-based tokenization)
    const tokens1 = new Set(text1.toLowerCase().split(/\s+/));
    const tokens2 = new Set(text2.toLowerCase().split(/\s+/));
    
    // Calculate Jaccard similarity
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return intersection.size / union.size;
  }
  
  /**
   * Create augmented prompt with retrieved context
   */
  private createAugmentedPrompt(
    messages: LLMMessage[],
    documents: RetrievedDocument[],
    query: string
  ): LLMMessage[] {
    // Clone messages to avoid mutating the original
    const augmentedMessages = [...messages];
    
    // Find the last user message
    const lastUserMessageIndex = augmentedMessages
      .map((msg, idx) => msg.role === 'user' ? idx : -1)
      .filter(idx => idx !== -1)
      .pop();
    
    if (lastUserMessageIndex === undefined) {
      // No user message found, just return original messages
      return augmentedMessages;
    }
    
    // Format the context from documents
    const formattedContext = documents
      .map((doc, index) => `[${index + 1}] ${doc.content}`)
      .join('\n\n');
    
    // Create a system message with the context
    const contextMessage: LLMMessage = {
      role: 'system',
      content: `I'm providing you with relevant information to help answer the user's question. 
Please use this context to inform your response:

${formattedContext}

Remember to cite the source numbers [1], [2], etc. when using specific information from the context.`
    };
    
    // Insert the context message before the last user message
    augmentedMessages.splice(lastUserMessageIndex, 0, contextMessage);
    
    return augmentedMessages;
  }
  
  /**
   * Generate cache key based on query and options
   */
  private generateCacheKey(
    query: string,
    options?: any
  ): string {
    return `${query}|${JSON.stringify(options || {})}`;
  }
  
  /**
   * Get result from cache if available and not expired
   */
  private getFromCache(key: string): RetrievalResult | null {
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }
    
    // Check if cache is expired
    const now = Date.now();
    if (now - cached.timestamp > this.config.cacheTTL * 1000) {
      // Cache expired, remove it
      this.cache.delete(key);
      return null;
    }
    
    return cached.result;
  }
  
  /**
   * Add result to cache
   */
  private addToCache(key: string, result: RetrievalResult): void {
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
    
    // Prune cache if it gets too large
    if (this.cache.size > 1000) {
      this.pruneCache();
    }
  }
  
  /**
   * Prune expired entries from cache
   */
  private pruneCache(): void {
    const now = Date.now();
    const expiryThreshold = now - this.config.cacheTTL * 1000;
    
    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < expiryThreshold) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance
let ragSystem: RAGSystem | null = null;

/**
 * Initialize the RAG System
 */
export async function initializeRAGSystem(config?: Partial<RAGConfig>): Promise<RAGSystem> {
  if (!ragSystem) {
    ragSystem = new RAGSystem(config);
  }
  
  return ragSystem;
}

/**
 * Get the RAG System instance
 */
export function getRAGSystem(): RAGSystem | null {
  return ragSystem;
}

export default RAGSystem;
