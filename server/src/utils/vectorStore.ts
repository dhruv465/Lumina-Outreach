/**
 * Vector Store Utility
 * 
 * Handles vector embeddings and similarity search for the RAG system.
 * This is a simplified implementation - in production, you'd use a
 * dedicated vector database like Pinecone, Weaviate, Qdrant, etc.
 */

import { logger } from '../index';

// For a real implementation, you'd use libraries like:
// - OpenAI's embeddings API
// - Pinecone, Weaviate, Qdrant client libraries
// - A local embedding model with TensorFlow.js

// Mock vector database for demonstration
interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
}

export class VectorStore {
  private vectors: Map<string, VectorRecord>;
  
  constructor() {
    this.vectors = new Map<string, VectorRecord>();
    logger.info('VectorStore initialized');
  }
  
  /**
   * Generate embeddings for text
   * In production, this would call an embeddings API or use a local model
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Simulate an embedding vector with pseudo-random values
    // In production, replace with actual embedding generation
    const simulatedDimension = 128;
    const vector: number[] = [];
    
    // Create a deterministic "embedding" based on text content
    // This ensures similar text gets similar vectors for demo purposes
    const hash = Array.from(text).reduce(
      (h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0
    );
    
    for (let i = 0; i < simulatedDimension; i++) {
      // Use hash plus position to create pseudo-random but deterministic values
      const value = Math.sin(hash * i) * 0.5 + 0.5;
      vector.push(value);
    }
    
    return vector;
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same dimensions');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Add a chunk to the vector store
   */
  async addChunk(id: string, text: string, metadata: Record<string, any> = {}): Promise<void> {
    try {
      const vector = await this.generateEmbedding(text);
      
      this.vectors.set(id, {
        id,
        vector,
        metadata
      });
      
      logger.debug(`Added vector for chunk ${id}`);
    } catch (error) {
      logger.error(`Error adding chunk to vector store: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Update a chunk in the vector store
   */
  async updateChunk(id: string, text: string, metadata?: Record<string, any>): Promise<void> {
    try {
      const existing = this.vectors.get(id);
      
      if (!existing) {
        throw new Error(`Chunk ${id} not found in vector store`);
      }
      
      const vector = await this.generateEmbedding(text);
      
      this.vectors.set(id, {
        id,
        vector,
        metadata: metadata || existing.metadata
      });
      
      logger.debug(`Updated vector for chunk ${id}`);
    } catch (error) {
      logger.error(`Error updating chunk in vector store: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Delete a chunk from the vector store
   */
  async deleteChunk(id: string): Promise<boolean> {
    try {
      const result = this.vectors.delete(id);
      logger.debug(`Deleted vector for chunk ${id}: ${result}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting chunk from vector store: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Delete all chunks for a document
   */
  async deleteByDocumentId(documentId: string): Promise<number> {
    try {
      let count = 0;
      
      for (const [id, record] of this.vectors.entries()) {
        if (record.metadata.documentId === documentId) {
          this.vectors.delete(id);
          count++;
        }
      }
      
      logger.debug(`Deleted ${count} vectors for document ${documentId}`);
      return count;
    } catch (error) {
      logger.error(`Error deleting document chunks from vector store: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Perform a similarity search
   */
  async search(
    query: string, 
    limit: number = 5,
    filterCriteria: Record<string, any> = {}
  ): Promise<{ id: string; score: number }[]> {
    try {
      const queryVector = await this.generateEmbedding(query);
      const results: { id: string; score: number }[] = [];
      
      // Apply filters and calculate similarities
      for (const record of this.vectors.values()) {
        // Check if record matches all filter criteria
        let matchesFilter = true;
        
        for (const [key, value] of Object.entries(filterCriteria)) {
          // Support for userId filter directly
          if (key === 'userId' && record.metadata.userId !== value.toString()) {
            matchesFilter = false;
            break;
          }
          
          // Skip non-metadata filters (will be handled at the database level)
          if (!record.metadata.hasOwnProperty(key)) {
            continue;
          }
          
          // Simple equality check
          if (record.metadata[key] !== value) {
            matchesFilter = false;
            break;
          }
        }
        
        if (!matchesFilter) {
          continue;
        }
        
        // Calculate similarity score
        const score = this.cosineSimilarity(queryVector, record.vector);
        
        results.push({
          id: record.id,
          score
        });
      }
      
      // Sort by score (descending) and limit results
      results.sort((a, b) => b.score - a.score);
      
      return results.slice(0, limit);
    } catch (error) {
      logger.error(`Error searching vector store: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
