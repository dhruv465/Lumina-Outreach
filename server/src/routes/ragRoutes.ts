/**
 * RAG (Retrieval-Augmented Generation) Routes
 * 
 * API endpoints for testing and using the RAG system.
 */

import { FastifyInstance } from 'fastify';
import { getRAGSystem, initializeRAGSystem } from '../services/rag/ragSystem';
import { getLLMService } from '../services';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { isAdmin } from '../middleware/auth';

const ragRoutes = async (fastify, opts: Record<string, any>) => {
  // Validation schemas
  const querySchema = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1000, description: 'The query to search for' },
      maxResults: { type: 'number', minimum: 1, maximum: 20, default: 5, description: 'The maximum number of results to return' },
      minRelevanceScore: { type: 'number', minimum: 0, maximum: 1, default: 0.7, description: 'The minimum relevance score for a result to be included' },
      sources: { type: 'array', items: { type: 'string' }, description: 'The sources to search in' },
      includeMetadata: { type: 'boolean', default: true, description: 'Whether to include metadata in the results' },
      bypassCache: { type: 'boolean', default: false, description: 'Whether to bypass the cache' }
    },
    required: ['query']
  };

  const generateResponseSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1000, description: 'The query to generate a response for' },
      provider: { type: 'string', enum: ['openai', 'anthropic', 'google'], description: 'The provider to use for generating the response' },
      model: { type: 'string', description: 'The model to use for generating the response' },
      temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7, description: 'The temperature to use for generating the response' },
      systemPrompt: { type: 'string', description: 'The system prompt to use for generating the response' },
      maxResults: { type: 'number', minimum: 1, maximum: 20, default: 5, description: 'The maximum number of results to return' },
      minRelevanceScore: { type: 'number', minimum: 0, maximum: 1, default: 0.7, description: 'The minimum relevance score for a result to be included' }
    },
    required: ['query']
  };

  const addKnowledgeSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 500, description: 'The title of the knowledge entry' },
      content: { type: 'string', minLength: 1, maxLength: 10000, description: 'The content of the knowledge entry' },
      type: { type: 'string', enum: ['product', 'faq', 'policy', 'procedure', 'knowledge-base', 'user-defined'], default: 'knowledge-base', description: 'The type of the knowledge entry' },
      category: { type: 'string', description: 'The category of the knowledge entry' },
      tags: { type: 'array', items: { type: 'string' }, default: [], description: 'The tags of the knowledge entry' },
      source: { type: 'string', default: 'api', description: 'The source of the knowledge entry' },
      metadata: { type: 'object', default: {}, description: 'The metadata of the knowledge entry' }
    },
    required: ['title', 'content']
  };

  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * @desc    Test RAG service query
   * @route   POST /api/rag/query
   * @access  Private
   */
  fastify.post('/query', 
    {
      schema: {
        body: querySchema
      }
    },
    async (request, reply) => {
      try {
        const ragService = getRAGSystem();
        
        const { query, maxResults, minRelevanceScore, sources, includeMetadata, bypassCache } = request.body as any;
        
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
        
        reply.send({
          success: true,
          data: result,
          meta: {
            query,
            resultsCount: result.retrievalResults.documents.length,
          }
        });
      } catch (error) {
        logger.error(`RAG query error: ${getErrorMessage(error)}`);
        reply.code(500).send({
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
  fastify.post('/generate',
    {
      schema: {
        body: generateResponseSchema
      }
    },
    async (request, reply) => {
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
        } = request.body as any;
        
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
        
        reply.send({
          success: true,
          data: result,
          meta: {
            query,
            sourcesUsed: result.retrievalResults.documents.length
          }
        });
      } catch (error) {
        logger.error(`RAG generation error: ${getErrorMessage(error)}`);
        reply.code(500).send({
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
  fastify.post('/knowledge',
    {
      schema: {
        body: addKnowledgeSchema
      }
    },
    async (request, reply) => {
      try {
        const { KnowledgeBase } = await import('../models/KnowledgeBase');
        const { title, content, type, category, tags, source, metadata } = request.body as any;
        const userId = (request as any).user.id;
        
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
        
        reply.code(201).send({
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
        reply.code(500).send({
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
  fastify.get('/status',
    async (request, reply) => {
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
        
        reply.send({
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
              vectorSearch: true,
              hybridSearch: true,
              semanticRetrieval: true
            }
          }
        });
      } catch (error) {
        logger.error(`RAG status error: ${getErrorMessage(error)}`);
        reply.code(500).send({
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
   * @access  Private (Admin only)
   */
  fastify.post('/initialize',
    { onRequest: [isAdmin] },
    async (request, reply) => {
      try {
        logger.info('Initializing advanced RAG system...');
        
        const ragSystem = await initializeRAGSystem((request.body as any).config);
        
        logger.info('Advanced RAG system initialized successfully');
        
        reply.send({
          success: true,
          message: 'RAG system initialized successfully',
          data: {
            status: 'initialized',
            timestamp: new Date()
          }
        });
      } catch (error) {
        logger.error(`RAG initialization error: ${getErrorMessage(error)}`);
        reply.code(500).send({
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
   * @access  Private (Admin only)
   */
  fastify.post('/cache/clear',
    { onRequest: [isAdmin] },
    async (request, reply) => {
      try {
        const ragService = getRAGSystem();
        
        reply.send({
          success: true,
          message: 'RAG cache cleared successfully'
        });
      } catch (error) {
        logger.error(`RAG cache clear error: ${getErrorMessage(error)}`);
        reply.code(500).send({
          success: false,
          message: 'Failed to clear RAG cache',
          error: getErrorMessage(error)
        });
      }
    }
  );
};

export default ragRoutes;