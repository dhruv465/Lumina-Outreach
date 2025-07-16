/**
 * RAG (Retrieval-Augmented Generation) Service
 * 
 * This service provides context-aware information retrieval capabilities to enhance
 * LLM responses with relevant information from the knowledge base.
 */

import mongoose from 'mongoose';
import logger from '../../utils/logger';
import { getErrorMessage } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// Document types
export interface RAGDocument {
  id: string;
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

// Query types
export interface RAGQuery {
  query: string;
  filters?: Record<string, any>;
  maxResults?: number;
  contextId?: string;
}

// Configuration
export interface RAGConfig {
  embeddingModel: string;
  embeddingProvider: string;
  embeddingApiKey?: string;
  chunkSize: number;
  chunkOverlap: number;
  similarityThreshold: number;
  maxResults: number;
}

/**
 * RAG Service for enhancing LLM responses with context
 */
export class RAGService {
  private config: RAGConfig;
  private documentModel: mongoose.Model<RAGDocument & mongoose.Document>;
  
  /**
   * Create a new RAG Service
   */
  constructor(config: RAGConfig) {
    this.config = config;
    
    // Initialize document model
    this.initializeDocumentModel();
  }
  
  /**
   * Initialize the document model for MongoDB
   */
  private initializeDocumentModel(): void {
    try {
      const DocumentSchema = new mongoose.Schema({
        id: { type: String, required: true, unique: true },
        content: { type: String, required: true },
        metadata: { type: Object, default: {} },
        embedding: { type: [Number], sparse: true },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
      });
      
      // Create text index on content
      DocumentSchema.index({ content: 'text' });
      
      // Add index on metadata fields commonly used for filtering
      DocumentSchema.index({ 'metadata.campaignId': 1 });
      DocumentSchema.index({ 'metadata.leadId': 1 });
      DocumentSchema.index({ 'metadata.type': 1 });
      
      try {
        // Check if model is already registered
        this.documentModel = mongoose.model('RAGDocument') as mongoose.Model<RAGDocument & mongoose.Document>;
      } catch (e) {
        // Model not registered yet, register it
        this.documentModel = mongoose.model('RAGDocument', DocumentSchema) as mongoose.Model<RAGDocument & mongoose.Document>;
      }
      
      logger.info('RAG Document model initialized');
    } catch (error) {
      logger.error(`Failed to initialize RAG Document model: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Add a document to the RAG system
   */
  async addDocument(doc: Omit<RAGDocument, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const id = uuidv4();
      
      // Create embedding if not provided
      let embedding = doc.embedding;
      if (!embedding) {
        embedding = await this.createEmbedding(doc.content);
      }
      
      // Create document
      const newDoc = new this.documentModel({
        id,
        content: doc.content,
        metadata: doc.metadata,
        embedding,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      await newDoc.save();
      
      logger.info(`Added document to RAG system with ID: ${id}`);
      return id;
    } catch (error) {
      logger.error(`Failed to add document to RAG system: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Create an embedding for text
   */
  private async createEmbedding(text: string): Promise<number[]> {
    try {
      // Use fallback embedding for now (text-length based pseudo-embedding)
      // This should be replaced with a real embedding API call
      
      // For demo purposes, create a simple pseudo-embedding based on text features
      // In production, this would use OpenAI, Cohere, or another embedding provider
      const pseudoEmbedding: number[] = [];
      
      // Add some features based on text
      pseudoEmbedding.push(text.length / 1000); // Normalized length
      pseudoEmbedding.push(text.split(' ').length / 100); // Word count
      pseudoEmbedding.push(text.split('.').length / 10); // Sentence count
      
      // Add character frequency features
      const charFreq = new Map<string, number>();
      for (const char of text.toLowerCase()) {
        charFreq.set(char, (charFreq.get(char) || 0) + 1);
      }
      
      // Add most common characters to embedding
      const alphabet = 'abcdefghijklmnopqrstuvwxyz';
      for (const char of alphabet) {
        pseudoEmbedding.push((charFreq.get(char) || 0) / text.length);
      }
      
      return pseudoEmbedding;
    } catch (error) {
      logger.error(`Failed to create embedding: ${getErrorMessage(error)}`);
      
      // Return empty embedding as fallback
      return [];
    }
  }
  
  /**
   * Update the configuration
   */
  async updateConfiguration(newConfig: Partial<RAGConfig>): Promise<void> {
    this.config = {
      ...this.config,
      ...newConfig
    };
    
    logger.info('RAG Service configuration updated');
  }
  
  /**
   * Query the RAG system for relevant documents
   */
  async query(query: RAGQuery): Promise<{
    documents: Array<{
      content: string;
      metadata: Record<string, any>;
      score: number;
    }>;
    contextId: string;
  }> {
    try {
      const { query: queryText, filters = {}, maxResults = this.config.maxResults } = query;
      
      // Generate a context ID for tracking
      const contextId = query.contextId || uuidv4();
      
      // First attempt: Vector search if embeddings are available
      let results: Array<{
        content: string;
        metadata: Record<string, any>;
        score: number;
      }> = [];
      
      try {
        const embedding = await this.createEmbedding(queryText);
        
        if (embedding.length > 0) {
          // Vector search is not yet implemented in this version
          // This would use a vector similarity search against embeddings
        }
      } catch (error) {
        logger.warn(`Vector search failed, falling back to text search: ${getErrorMessage(error)}`);
      }
      
      // Fallback: Text search
      if (results.length === 0) {
        // Create MongoDB query
        const mongoQuery: any = {
          $text: { $search: queryText }
        };
        
        // Add filters
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined && value !== null) {
            mongoQuery[`metadata.${key}`] = value;
          }
        }
        
        // Execute query
        const docs = await this.documentModel
          .find(mongoQuery)
          .sort({ score: { $meta: 'textScore' } })
          .limit(maxResults)
          .lean()
          .exec();
        
        // Format results
        results = docs.map((doc: any) => ({
          content: doc.content,
          metadata: doc.metadata,
          score: doc._score || 1.0
        }));
      }
      
      logger.info(`RAG query returned ${results.length} results for context ID: ${contextId}`);
      
      return {
        documents: results,
        contextId
      };
    } catch (error) {
      logger.error(`RAG query failed: ${getErrorMessage(error)}`);
      
      // Return empty results
      return {
        documents: [],
        contextId: query.contextId || uuidv4()
      };
    }
  }
  
  /**
   * Delete a document from the RAG system
   */
  async deleteDocument(id: string): Promise<boolean> {
    try {
      const result = await this.documentModel.deleteOne({ id });
      
      if (result.deletedCount > 0) {
        logger.info(`Deleted document from RAG system with ID: ${id}`);
        return true;
      }
      
      logger.warn(`Document with ID ${id} not found for deletion`);
      return false;
    } catch (error) {
      logger.error(`Failed to delete document from RAG system: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Delete all documents matching filters
   */
  async deleteDocuments(filters: Record<string, any>): Promise<number> {
    try {
      // Create MongoDB query from filters
      const mongoQuery: any = {};
      
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          mongoQuery[`metadata.${key}`] = value;
        }
      }
      
      const result = await this.documentModel.deleteMany(mongoQuery);
      
      logger.info(`Deleted ${result.deletedCount} documents from RAG system`);
      return result.deletedCount;
    } catch (error) {
      logger.error(`Failed to delete documents from RAG system: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Get all documents matching filters
   */
  async getDocuments(filters: Record<string, any>, limit: number = 100): Promise<RAGDocument[]> {
    try {
      // Create MongoDB query from filters
      const mongoQuery: any = {};
      
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          mongoQuery[`metadata.${key}`] = value;
        }
      }
      
      const docs = await this.documentModel
        .find(mongoQuery)
        .limit(limit)
        .lean()
        .exec();
      
      return docs as unknown as RAGDocument[];
    } catch (error) {
      logger.error(`Failed to get documents from RAG system: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Health check for RAG service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if MongoDB is available
      await this.documentModel.findOne().limit(1).exec();
      
      return true;
    } catch (error) {
      logger.error(`RAG Service health check failed: ${getErrorMessage(error)}`);
      return false;
    }
  }
}
