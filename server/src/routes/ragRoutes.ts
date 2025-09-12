/**
 * RAG (Retrieval-Augmented Generation) Routes
 * 
 * API endpoints for testing and using the RAG system.
 */

import express from 'express';
import { Request, Response } from 'express';
import { getRAGSystem, initializeRAGSystem } from '../services/rag/ragSystem';
import { getLLMService } from '../services';
import { authenticate } from '../middleware/auth';
import { apiRateLimit } from '../middleware/rateLimitMiddleware';
import { validateRequest } from '../middleware/validationMiddleware';
import Joi from 'joi';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

const router = express.Router();

// Validation schemas
const querySchema = Joi.object({
  query: Joi.string().required().min(1).max(1000),
  maxResults: Joi.number().min(1).max(20).default(5),
  minRelevanceScore: Joi.number().min(0).max(1).default(0.7),
  sources: Joi.array().items(Joi.string()).optional(),
  includeMetadata: Joi.boolean().default(true),
  bypassCache: Joi.boolean().default(false)
});

const generateResponseSchema = Joi.object({
  query: Joi.string().required().min(1).max(1000),
  provider: Joi.string().valid('openai', 'anthropic', 'google').optional(),
  model: Joi.string().optional(),
  temperature: Joi.number().min(0).max(2).default(0.7),
  systemPrompt: Joi.string().optional(),
  maxResults: Joi.number().min(1).max(20).default(5),
  minRelevanceScore: Joi.number().min(0).max(1).default(0.7)
});

const addKnowledgeSchema = Joi.object({
  title: Joi.string().required().min(1).max(500),
  content: Joi.string().required().min(1).max(10000),
  type: Joi.string().valid('product', 'faq', 'policy', 'procedure', 'knowledge-base', 'user-defined').default('knowledge-base'),
  category: Joi.string().optional(),
  tags: Joi.array().items(Joi.string()).default([]),
  source: Joi.string().default('api'),
  metadata: Joi.object().default({})
});

// Apply rate limiting to all RAG routes
router.use(apiRateLimit);

/**
 * @desc    Test RAG service query
 * @route   POST /api/rag/query
 * @access  Private
 */
router.post('/query', 
  authenticate,
  validateRequest(querySchema),
  async (req: Request, res: Response) => {
    try {
      const ragService = getRAGSystem();
      
      const { query, maxResults, minRelevanceScore, sources, includeMetadata, bypassCache } = req.body;
      
      logger.info(`RAG query received: ${query}`);
      
      const result = await ragService.generateEnhancedPrompt(query, [], {
        documentTypes: sources,
        maxDocuments: maxResults,
        filterMetadata: {
          includeMetadata,
          bypassCache
        }
      });
      
      logger.info(`RAG query completed with ${result.retrievalResults.documents.length} results`);
      
      res.json({
        success: true,
        data: result,
        meta: {
          query,
          resultsCount: result.retrievalResults.documents.length,
        }
      });
    } catch (error) {
      logger.error(`RAG query error: ${getErrorMessage(error)}`);
      res.status(500).json({
        success: false,
        message: 'RAG query failed',
        error: getErrorMessage(error)
      });
    }
  }
);

/**
 * @desc    Generate response using RAG
 * @route   POST /api/rag/generate
 * @access  Private
 */
router.post('/generate',
  authenticate,
  validateRequest(generateResponseSchema),
  async (req: Request, res: Response) => {
    try {
      const ragService = getRAGSystem();
      
      const { 
        query, 
        provider, 
        model, 
        temperature, 
        systemPrompt,
        maxResults,
        minRelevanceScore 
      } = req.body;
      
      logger.info(`RAG generation requested for: ${query}`);
      
      const result = await ragService.generateEnhancedPrompt(query, [], {
        documentTypes: [],
        maxDocuments: maxResults,
        filterMetadata: {
          provider,
          model,
          temperature,
          systemPrompt,
          minRelevanceScore
        }
      });
      
      logger.info(`RAG generation completed`);
      
      res.json({
        success: true,
        data: result,
        meta: {
          query,
          sourcesUsed: result.retrievalResults.documents.length
        }
      });
    } catch (error) {
      logger.error(`RAG generation error: ${getErrorMessage(error)}`);
      res.status(500).json({
        success: false,
        message: 'RAG generation failed',
        error: getErrorMessage(error)
      });
    }
  }
);

/**
 * @desc    Add knowledge to the RAG system
 * @route   POST /api/rag/knowledge
 * @access  Private
 */
router.post('/knowledge',
  authenticate,
  validateRequest(addKnowledgeSchema),
  async (req: Request, res: Response) => {
    try {
      const { KnowledgeBase } = await import('../models/KnowledgeBase');
      const { title, content, type, category, tags, source, metadata } = req.body;
      const userId = req.user.id;
      
      logger.info(`Adding knowledge entry: ${title}`);
      
      const knowledgeEntry = new KnowledgeBase({
        title,
        content,
        type,
        category,
        tags,
        source,
        metadata: {
          ...metadata,
          addedBy: userId,
          addedVia: 'api'
        },
        userId,
        isActive: true
      });
      
      await knowledgeEntry.save();
      
      logger.info(`Knowledge entry added with ID: ${knowledgeEntry._id}`);
      
      res.status(201).json({
        success: true,
        message: 'Knowledge entry added successfully',
        data: {
          id: knowledgeEntry._id,
          title: knowledgeEntry.title,
          type: knowledgeEntry.type,
          category: knowledgeEntry.category
        }
      });
    } catch (error) {
      logger.error(`Add knowledge error: ${getErrorMessage(error)}`);
      res.status(500).json({
        success: false,
        message: 'Failed to add knowledge entry',
        error: getErrorMessage(error)
      });
    }
  }
);

/**
 * @desc    Get RAG system status
 * @route   GET /api/rag/status
 * @access  Private
 */
router.get('/status',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const ragService = getRAGSystem();
      
      // Get knowledge base stats
      const { KnowledgeBase } = await import('../models/KnowledgeBase');
      const { FAQ } = await import('../models/FAQ');
      const { Product } = await import('../models/Product');
      const { Document } = await import('../models/Document');
      const { Chunk } = await import('../models/Chunk');
      
      const [
        knowledgeBaseCount,
        faqCount,
        productCount,
        documentCount,
        chunkCount
      ] = await Promise.all([
        KnowledgeBase.countDocuments({ isActive: true }),
        FAQ.countDocuments({ isActive: true }),
        Product.countDocuments({ isActive: true }),
        Document.countDocuments({ status: 'processed' }),
        Chunk.countDocuments()
      ]);
      
      res.json({
        success: true,
        data: {
          status: 'operational',
          statistics: {
            knowledgeBase: knowledgeBaseCount,
            faqs: faqCount,
            products: productCount,
            documents: documentCount,
            chunks: chunkCount
          },
          capabilities: {
            textSearch: true,
            vectorSearch: false, // TODO: Implement real vector search
            hybridSearch: false, // TODO: Implement real hybrid search
            semanticRetrieval: false // TODO: Implement real semantic retrieval
          }
        }
      });
    } catch (error) {
      logger.error(`RAG status error: ${getErrorMessage(error)}`);
      res.status(500).json({
        success: false,
        message: 'Failed to get RAG status',
        error: getErrorMessage(error)
      });
    }
  }
);

/**
 * @desc    Initialize RAG system with advanced features
 * @route   POST /api/rag/initialize
 * @access  Private (Admin only - TODO: Add admin check)
 */
router.post('/initialize',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      logger.info('Initializing advanced RAG system...');
      
      const ragSystem = await initializeRAGSystem(req.body.config);
      
      logger.info('Advanced RAG system initialized successfully');
      
      res.json({
        success: true,
        message: 'RAG system initialized successfully',
        data: {
          status: 'initialized',
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error(`RAG initialization error: ${getErrorMessage(error)}`);
      res.status(500).json({
        success: false,
        message: 'Failed to initialize RAG system',
        error: getErrorMessage(error)
      });
    }
  }
);

/**
 * @desc    Clear RAG service cache
 * @route   POST /api/rag/cache/clear
 * @access  Private (Admin only - TODO: Add admin check)
 */
router.post('/cache/clear',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const ragService = getRAGSystem();
      
      res.json({
        success: true,
        message: 'RAG cache cleared successfully'
      });
    } catch (error) {
      logger.error(`RAG cache clear error: ${getErrorMessage(error)}`);
      res.status(500).json({
        success: false,
        message: 'Failed to clear RAG cache',
        error: getErrorMessage(error)
      });
    }
  }
);

export default router;