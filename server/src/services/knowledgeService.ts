import { Types } from 'mongoose';
import path from 'path';
import fs from 'fs';
import { Document } from '../models/Document';
import { Chunk } from '../models/Chunk';
import { Category } from '../models/Category';
import { Tag } from '../models/Tag';
import { UsageMetric } from '../models/UsageMetric';
import { logger } from '../index';
import { DocumentProcessor } from '../utils/documentProcessor';
import { getRAGSystem } from './rag/ragSystem';

// Service singleton instance
let instance: KnowledgeService | null = null;

export interface DocumentFilter {
  categoryId?: string;
  tags?: string[];
  status?: string;
  query?: string;
}

export interface ChunkFilter {
  documentId?: string;
  tags?: string[];
}

export interface CategoryData {
  name: string;
  description?: string;
  parentId?: string;
}

export interface TagData {
  name: string;
  color?: string;
}

export interface ChunkUpdateData {
  content?: string;
  metadata?: Record<string, any>;
  tags?: string[];
  importance?: number;
}

export class KnowledgeService {
  private documentProcessor: DocumentProcessor;
  private vectorStore: any;
  private uploadPath: string;

  constructor() {
    this.documentProcessor = new DocumentProcessor();
    this.vectorStore = getRAGSystem();
    this.uploadPath = path.join(process.cwd(), 'uploads', 'documents');

    // Upload directory will be created lazily when first document is uploaded
  }

  /**
   * Process an uploaded document
   */
  async processDocument(
    file: any,
    userId: string,
    categoryId?: string,
    tags?: string[]
  ) {
    try {
      // Save document metadata
      const document = await Document.create({
        fileName: file.filename,
        fileType: file.mimetype,
        filePath: file.filepath,
        fileSize: file.file.bytesRead,
        userId,
        categoryId: categoryId ? new Types.ObjectId(categoryId) : undefined,
        tags: tags || [],
        status: 'processing'
      });

      // Process document asynchronously
      this.processDocumentAsync(document._id.toString())
        .catch(err => {
          logger.error(`Error processing document ${document._id}: ${err.message}`);
          Document.findByIdAndUpdate(document._id, {
            status: 'error',
            processingError: err.message
          }).exec();
        });

      return {
        id: document._id,
        fileName: document.fileName,
        status: document.status
      };
    } catch (error) {
      logger.error(`Error processing document: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Process document in background
   */
  private async processDocumentAsync(documentId: string) {
    try {
      const document = await Document.findById(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      // Extract text content
      const content = await this.documentProcessor.extractText(document.filePath);

      // Split content into chunks
      const chunks = this.documentProcessor.splitTextIntoChunks(content);

      // Create chunk records and embed them
      const chunkIds = [];

      for (const [index, chunkText] of chunks.entries()) {
        // Create chunk in database
        const chunk = await Chunk.create({
          documentId: document._id,
          userId: document.userId,
          content: chunkText,
          index,
          metadata: {
            fileName: document.fileName,
            pageNumber: index + 1 // Simple page number assumption
          }
        });

        chunkIds.push(chunk._id);

        // Generate embeddings and store in vector database
        await this.vectorStore.addChunk(chunk._id.toString(), chunkText, {
          documentId: document._id.toString(),
          fileName: document.fileName
        });
      }

      // Update document with completion status
      await Document.findByIdAndUpdate(document._id, {
        status: 'processed',
        chunkCount: chunks.length,
        chunks: chunkIds,
        processingCompleted: new Date()
      });

      logger.info(`Document ${documentId} processed successfully with ${chunks.length} chunks`);
    } catch (error) {
      logger.error(`Error in async document processing: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get documents with pagination
   */
  async getDocuments(
    userId: string,
    page: number = 1,
    limit: number = 20,
    filters: DocumentFilter = {}
  ) {
    try {
      const query: any = { userId };

      if (filters.categoryId) {
        query.categoryId = new Types.ObjectId(filters.categoryId);
      }

      if (filters.tags && filters.tags.length > 0) {
        query.tags = { $all: filters.tags };
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.query) {
        query.$text = { $search: filters.query };
      }

      const total = await Document.countDocuments(query);
      const documents = await Document.find(query)
        .populate('categoryId', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return {
        documents,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      };
    } catch (error) {
      logger.error(`Error getting documents: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get document by ID
   */
  async getDocumentById(documentId: string, userId: string) {
    try {
      return await Document.findOne({
        _id: new Types.ObjectId(documentId),
        userId
      })
        .populate('categoryId', 'name')
        .populate('chunks')
        .lean();
    } catch (error) {
      logger.error(`Error getting document by ID: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Update document
   */
  async updateDocument(documentId: string, userId: string, updates: any) {
    try {
      // Prevent updating certain fields
      const allowedUpdates = ['name', 'description', 'categoryId', 'tags', 'metadata'];
      const updateData: any = {};

      Object.keys(updates).forEach(key => {
        if (allowedUpdates.includes(key)) {
          updateData[key] = updates[key];
        }
      });

      if (updateData.categoryId) {
        updateData.categoryId = new Types.ObjectId(updateData.categoryId);
      }

      return await Document.findOneAndUpdate(
        { _id: new Types.ObjectId(documentId), userId },
        updateData,
        { new: true }
      ).lean();
    } catch (error) {
      logger.error(`Error updating document: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId: string, userId: string) {
    try {
      const document = await Document.findOne({
        _id: new Types.ObjectId(documentId),
        userId
      });

      if (!document) {
        return false;
      }

      // Delete associated chunks
      await Chunk.deleteMany({ documentId: document._id });

      // Remove vectors from store
      await this.vectorStore.deleteByDocumentId(documentId);

      // Delete file if it exists
      if (document.filePath && fs.existsSync(document.filePath)) {
        fs.unlinkSync(document.filePath);
      }

      // Delete document record
      await document.deleteOne();

      return true;
    } catch (error) {
      logger.error(`Error deleting document: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get chunks with pagination
   */
  async getChunks(
    userId: string,
    page: number = 1,
    limit: number = 50,
    filters: ChunkFilter = {}
  ) {
    try {
      const query: any = { userId };

      if (filters.documentId) {
        query.documentId = new Types.ObjectId(filters.documentId);
      }

      if (filters.tags && filters.tags.length > 0) {
        query.tags = { $all: filters.tags };
      }

      const total = await Chunk.countDocuments(query);
      const chunks = await Chunk.find(query)
        .populate('documentId', 'fileName')
        .sort({ index: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return {
        chunks,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      };
    } catch (error) {
      logger.error(`Error getting chunks: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get chunk by ID
   */
  async getChunkById(chunkId: string, userId: string) {
    try {
      return await Chunk.findOne({
        _id: new Types.ObjectId(chunkId),
        userId
      })
        .populate('documentId', 'fileName')
        .lean();
    } catch (error) {
      logger.error(`Error getting chunk by ID: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Update chunk
   */
  async updateChunk(chunkId: string, userId: string, updates: ChunkUpdateData) {
    try {
      const chunk = await Chunk.findOneAndUpdate(
        { _id: new Types.ObjectId(chunkId), userId },
        updates,
        { new: true }
      ).lean();

      if (chunk && updates.content) {
        // Update vector store if content changed
        await this.vectorStore.updateChunk(chunkId, updates.content);
      }

      return chunk;
    } catch (error) {
      logger.error(`Error updating chunk: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get categories
   */
  async getCategories(userId: string) {
    try {
      return await Category.find({ userId })
        .populate('parentId', 'name')
        .sort({ name: 1 })
        .lean();
    } catch (error) {
      logger.error(`Error getting categories: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Create category
   */
  async createCategory(userId: string, data: CategoryData) {
    try {
      const categoryData: any = {
        name: data.name,
        description: data.description,
        userId
      };

      if (data.parentId) {
        categoryData.parentId = new Types.ObjectId(data.parentId);
      }

      return await Category.create(categoryData);
    } catch (error) {
      logger.error(`Error creating category: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Update category
   */
  async updateCategory(categoryId: string, userId: string, data: CategoryData) {
    try {
      const updateData: any = {
        name: data.name,
        description: data.description
      };

      if (data.parentId) {
        updateData.parentId = new Types.ObjectId(data.parentId);
      } else if (data.parentId === null) {
        updateData.parentId = null;
      }

      return await Category.findOneAndUpdate(
        { _id: new Types.ObjectId(categoryId), userId },
        updateData,
        { new: true }
      ).lean();
    } catch (error) {
      logger.error(`Error updating category: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Delete category
   */
  async deleteCategory(categoryId: string, userId: string) {
    try {
      // Check if category has documents
      const documentCount = await Document.countDocuments({
        categoryId: new Types.ObjectId(categoryId),
        userId
      });

      if (documentCount > 0) {
        throw new Error('Category has associated documents and cannot be deleted');
      }

      // Check if category has children
      const childrenCount = await Category.countDocuments({
        parentId: new Types.ObjectId(categoryId),
        userId
      });

      if (childrenCount > 0) {
        throw new Error('Category has child categories and cannot be deleted');
      }

      const result = await Category.deleteOne({
        _id: new Types.ObjectId(categoryId),
        userId
      });

      return result.deletedCount > 0;
    } catch (error) {
      logger.error(`Error deleting category: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get tags
   */
  async getTags(userId: string) {
    try {
      return await Tag.find({ userId }).sort({ name: 1 }).lean();
    } catch (error) {
      logger.error(`Error getting tags: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Create tag
   */
  async createTag(userId: string, data: TagData) {
    try {
      return await Tag.create({
        name: data.name,
        color: data.color || '#cccccc',
        userId
      });
    } catch (error) {
      logger.error(`Error creating tag: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Search knowledge base
   */
  async searchKnowledge(
    userId: string,
    query: string,
    filters: any = {},
    limit: number = 10
  ) {
    try {
      // Track search for analytics
      await UsageMetric.create({
        userId,
        action: 'search',
        query,
        timestamp: new Date()
      });

      // Convert filters
      const filterParams: any = { userId };

      if (filters?.categoryId) {
        filterParams.categoryId = new Types.ObjectId(filters.categoryId);
      }

      if (filters?.tags && filters.tags.length > 0) {
        filterParams.tags = { $all: filters.tags };
      }

      // Perform vector search
      const results = await this.vectorStore.search(query, limit, filterParams);

      // If no results from vector search, return empty array
      if (!results || results.length === 0) {
        logger.debug(`No vector search results found for query: ${query}`);
        return [];
      }

      // Hydrate results with full chunk data
      const hydratedResults = [];

      for (const result of results) {
        try {
          const chunk = await Chunk.findById(result.id)
            .populate({
              path: 'documentId',
              select: 'fileName',
              populate: {
                path: 'categoryId',
                select: 'name'
              }
            })
            .lean();

          if (chunk) {
            hydratedResults.push({
              ...chunk,
              score: result.score
            });
          }
        } catch (chunkError) {
          logger.debug(`Error hydrating chunk ${result.id}: ${chunkError instanceof Error ? chunkError.message : String(chunkError)}`);
          // Continue with other results
        }
      }

      return hydratedResults;
    } catch (error) {
      logger.error(`Error searching knowledge: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ) {
    try {
      const query: any = { userId };

      if (startDate || endDate) {
        query.timestamp = {};

        if (startDate) {
          query.timestamp.$gte = startDate;
        }

        if (endDate) {
          query.timestamp.$lte = endDate;
        }
      }

      const metrics = await UsageMetric.find(query).lean();

      // Calculate analytics
      const totalSearches = metrics.filter(m => m.action === 'search').length;
      const totalRetrievals = metrics.filter(m => m.action === 'retrieval').length;

      // Group by day
      const dailyUsage: Record<string, { searches: number, retrievals: number }> = {};

      metrics.forEach(metric => {
        const day = metric.timestamp.toISOString().split('T')[0];

        if (!dailyUsage[day]) {
          dailyUsage[day] = { searches: 0, retrievals: 0 };
        }

        if (metric.action === 'search') {
          dailyUsage[day].searches++;
        } else if (metric.action === 'retrieval') {
          dailyUsage[day].retrievals++;
        }
      });

      // Most common search terms
      const searchTerms: Record<string, number> = {};

      metrics
        .filter(m => m.action === 'search' && m.query)
        .forEach(metric => {
          if (!searchTerms[metric.query]) {
            searchTerms[metric.query] = 0;
          }
          searchTerms[metric.query]++;
        });

      const topSearchTerms = Object.entries(searchTerms)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, count }));

      return {
        totalSearches,
        totalRetrievals,
        dailyUsage: Object.entries(dailyUsage).map(([date, data]) => ({
          date,
          ...data
        })),
        topSearchTerms
      };
    } catch (error) {
      logger.error(`Error getting usage analytics: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get performance analytics
   */
  async getPerformanceAnalytics(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ) {
    try {
      const query: any = { userId };

      if (startDate || endDate) {
        query.timestamp = {};

        if (startDate) {
          query.timestamp.$gte = startDate;
        }

        if (endDate) {
          query.timestamp.$lte = endDate;
        }
      }

      const metrics = await UsageMetric.find(query).lean();

      // Calculate average retrieval time
      const retrievalMetrics = metrics.filter(m =>
        m.action === 'retrieval' && typeof m.responseTime === 'number'
      );

      const avgRetrievalTime = retrievalMetrics.length > 0
        ? retrievalMetrics.reduce((sum, m) => sum + (m.responseTime || 0), 0) / retrievalMetrics.length
        : 0;

      // Calculate relevance scores
      const relevanceMetrics = metrics.filter(m =>
        m.action === 'feedback' && typeof m.relevanceScore === 'number'
      );

      const avgRelevanceScore = relevanceMetrics.length > 0
        ? relevanceMetrics.reduce((sum, m) => sum + (m.relevanceScore || 0), 0) / relevanceMetrics.length
        : 0;

      return {
        avgRetrievalTime,
        avgRelevanceScore,
        totalFeedbackCount: relevanceMetrics.length,
        retrievalCount: retrievalMetrics.length
      };
    } catch (error) {
      logger.error(`Error getting performance analytics: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get knowledge gaps
   */
  async getKnowledgeGaps(userId: string) {
    try {
      // Find searches with no results
      const noResultSearches = await UsageMetric.aggregate([
        { $match: { userId: new Types.ObjectId(userId), action: 'search', resultCount: 0 } },
        { $group: { _id: '$query', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Find searches with low relevance
      const lowRelevanceSearches = await UsageMetric.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            action: 'feedback',
            relevanceScore: { $lt: 3 }
          }
        },
        { $group: { _id: '$query', avgScore: { $avg: '$relevanceScore' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      return {
        noResultQueries: noResultSearches.map(item => ({
          query: item._id,
          count: item.count
        })),
        lowRelevanceQueries: lowRelevanceSearches.map(item => ({
          query: item._id,
          avgScore: item.avgScore,
          count: item.count
        }))
      };
    } catch (error) {
      logger.error(`Error getting knowledge gaps: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

/**
 * Get the knowledge service instance
 */
export const getKnowledgeService = (): KnowledgeService => {
  if (!instance) {
    instance = new KnowledgeService();
  }
  return instance;
};
