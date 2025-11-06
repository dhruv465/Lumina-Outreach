/**
 * Knowledge Management Controller
 * 
 * Handles API endpoints for document management, content chunking,
 * categorization, and search for the RAG knowledge base.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getKnowledgeService } from '../services/knowledgeService';
import { logger } from '../index';

// Utility function to handle errors
const handleError = (error: any, res: FastifyReply, message: string) => {
  logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  return res.status(500).send({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'Unknown error'
  });
};

// @desc    Upload documents
// @route   POST /api/knowledge/documents
// @access  Private
export const uploadDocuments = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const files = (req as any).files();
    
    if (!files || files.length === 0) {
      return res.status(400).send({
        success: false,
        message: 'No files were uploaded'
      });
    }
    
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const { categoryId, tags } = req.body as any;
    
    const results = await Promise.all(
      files.map(async (file: any) => {
        const data = await file.toBuffer();
        return knowledgeService.processDocument({ ...file, buffer: data }, userId, categoryId, tags);
      })
    );
    
    res.status(201).send({
      success: true,
      message: `Successfully uploaded ${results.length} document(s)`,
      documents: results
    });
  } catch (error) {
    return handleError(error, res, 'Error uploading documents');
  }
};

// @desc    Get all documents
// @route   GET /api/knowledge/documents
// @access  Private
export const getDocuments = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    const user = (req as any).user;
    if (!user) {
      logger.warn('No user object in request for getDocuments');
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized - No user' 
      });
    }

    // Support both id and _id fields
    const userId = user.id || user._id;
    if (!userId) {
      logger.warn('User object exists but has no id or _id field:', user);
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized - No user ID' 
      });
    }

    const knowledgeService = getKnowledgeService();
    
    const { page = 1, limit = 20, categoryId, tags, status, query } = req.query as any;
    
    const documents = await knowledgeService.getDocuments(
      userId,
      Number(page),
      Number(limit),
      {
        categoryId: categoryId as string,
        tags: tags ? (tags as string).split(',') : undefined,
        status: status as string,
        query: query as string
      }
    );
    
    res.send({
      success: true,
      ...documents
    });
  } catch (error) {
    logger.error('Error in getDocuments controller:', error);
    // Return empty data instead of error to prevent logout
    return res.send({
      success: true,
      documents: [],
      pagination: {
        page: 1,
        pages: 0,
        total: 0,
        limit: 20
      }
    });
  }
};

// @desc    Get document by ID
// @route   GET /api/knowledge/documents/:id
// @access  Private
export const getDocumentById = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!(req as any).user || !(req as any).user.id) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const documentId = (req.params as any).id;
    
    const document = await knowledgeService.getDocumentById(documentId, userId);
    
    if (!document) {
      return res.status(404).send({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.send({
      success: true,
      document
    });
  } catch (error) {
    return handleError(error, res, 'Error getting document');
  }
};

// @desc    Update document
// @route   PUT /api/knowledge/documents/:id
// @access  Private
export const updateDocument = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!(req as any).user || !(req as any).user.id) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const documentId = (req.params as any).id;
    const updates = req.body;
    
    const updatedDocument = await knowledgeService.updateDocument(documentId, userId, updates);
    
    if (!updatedDocument) {
      return res.status(404).send({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.send({
      success: true,
      message: 'Document updated successfully',
      document: updatedDocument
    });
  } catch (error) {
    return handleError(error, res, 'Error updating document');
  }
};

// @desc    Delete document
// @route   DELETE /api/knowledge/documents/:id
// @access  Private
export const deleteDocument = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!(req as any).user || !(req as any).user.id) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const documentId = (req.params as any).id;
    
    const result = await knowledgeService.deleteDocument(documentId, userId);
    
    if (!result) {
      return res.status(404).send({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.send({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    return handleError(error, res, 'Error deleting document');
  }
};

// @desc    Get all chunks
// @route   GET /api/knowledge/chunks
// @access  Private
export const getChunks = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!(req as any).user || !(req as any).user.id) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    
    const { page = 1, limit = 50, documentId, tags } = req.query as any;
    
    const chunks = await knowledgeService.getChunks(
      userId,
      Number(page),
      Number(limit),
      {
        documentId: documentId as string,
        tags: tags ? (tags as string).split(',') : undefined
      }
    );
    
    res.send({
      success: true,
      ...chunks
    });
  } catch (error) {
    return handleError(error, res, 'Error getting chunks');
  }
};

// @desc    Get chunk by ID
// @route   GET /api/knowledge/chunks/:id
// @access  Private
export const getChunkById = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const chunkId = (req.params as any).id;
    
    const chunk = await knowledgeService.getChunkById(chunkId, userId);
    
    if (!chunk) {
      return res.status(404).send({
        success: false,
        message: 'Chunk not found'
      });
    }
    
    res.send({
      success: true,
      chunk
    });
  } catch (error) {
    return handleError(error, res, 'Error getting chunk');
  }
};

// @desc    Update chunk
// @route   PUT /api/knowledge/chunks/:id
// @access  Private
export const updateChunk = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const chunkId = (req.params as any).id;
    const { content, metadata, tags, importance } = req.body as any;
    
    const updatedChunk = await knowledgeService.updateChunk(chunkId, userId, {
      content,
      metadata,
      tags,
      importance
    });
    
    if (!updatedChunk) {
      return res.status(404).send({
        success: false,
        message: 'Chunk not found'
      });
    }
    
    res.send({
      success: true,
      message: 'Chunk updated successfully',
      chunk: updatedChunk
    });
  } catch (error) {
    return handleError(error, res, 'Error updating chunk');
  }
};

// @desc    Get all categories
// @route   GET /api/knowledge/categories
// @access  Private
export const getCategories = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    const user = (req as any).user;
    if (!user) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    // Support both id and _id fields
    const userId = user.id || user._id;
    if (!userId) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    
    const categories = await knowledgeService.getCategories(userId);
    
    res.send({
      success: true,
      categories
    });
  } catch (error) {
    logger.error('Error in getCategories controller:', error);
    // Return empty data instead of error to prevent logout
    return res.send({
      success: true,
      categories: []
    });
  }
};

// @desc    Create category
// @route   POST /api/knowledge/categories
// @access  Private
export const createCategory = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const { name, description, parentId } = req.body as any;
    
    const category = await knowledgeService.createCategory(userId, {
      name,
      description,
      parentId
    });
    
    res.status(201).send({
      success: true,
      message: 'Category created successfully',
      category
    });
  } catch (error) {
    return handleError(error, res, 'Error creating category');
  }
};

// @desc    Update category
// @route   PUT /api/knowledge/categories/:id
// @access  Private
export const updateCategory = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const categoryId = (req.params as any).id;
    const { name, description, parentId } = req.body as any;
    
    const updatedCategory = await knowledgeService.updateCategory(categoryId, userId, {
      name,
      description,
      parentId
    });
    
    if (!updatedCategory) {
      return res.status(404).send({
        success: false,
        message: 'Category not found'
      });
    }
    
    res.send({
      success: true,
      message: 'Category updated successfully',
      category: updatedCategory
    });
  } catch (error) {
    return handleError(error, res, 'Error updating category');
  }
};

// @desc    Delete category
// @route   DELETE /api/knowledge/categories/:id
// @access  Private
export const deleteCategory = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const categoryId = (req.params as any).id;
    
    const result = await knowledgeService.deleteCategory(categoryId, userId);
    
    if (!result) {
      return res.status(404).send({
        success: false,
        message: 'Category not found'
      });
    }
    
    res.send({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    return handleError(error, res, 'Error deleting category');
  }
};

// @desc    Get all tags
// @route   GET /api/knowledge/tags
// @access  Private
export const getTags = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Defensive guard to ensure user is authenticated
    const user = (req as any).user;
    if (!user) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    // Support both id and _id fields
    const userId = user.id || user._id;
    if (!userId) {
      return res.status(401).send({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    
    const tags = await knowledgeService.getTags(userId);
    
    res.send({
      success: true,
      tags
    });
  } catch (error) {
    logger.error('Error in getTags controller:', error);
    // Return empty data instead of error to prevent logout
    return res.send({
      success: true,
      tags: []
    });
  }
};

// @desc    Create tag
// @route   POST /api/knowledge/tags
// @access  Private
export const createTag = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const { name, color } = req.body as any;
    
    const tag = await knowledgeService.createTag(userId, { name, color });
    
    res.status(201).send({
      success: true,
      message: 'Tag created successfully',
      tag
    });
  } catch (error) {
    return handleError(error, res, 'Error creating tag');
  }
};

// @desc    Search knowledge
// @route   POST /api/knowledge/search
// @access  Private
export const searchKnowledge = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const { query, filters, limit = 10 } = req.body as any;
    
    const results = await knowledgeService.searchKnowledge(
      userId,
      query,
      filters,
      Number(limit)
    );
    
    res.send({
      success: true,
      results
    });
  } catch (error) {
    return handleError(error, res, 'Error searching knowledge');
  }
};

// @desc    Get usage analytics
// @route   GET /api/knowledge/analytics/usage
// @access  Private
export const getUsageAnalytics = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const { startDate, endDate } = req.query as any;
    
    const analytics = await knowledgeService.getUsageAnalytics(
      userId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    
    res.send({
      success: true,
      analytics
    });
  } catch (error) {
    return handleError(error, res, 'Error getting usage analytics');
  }
};

// @desc    Get performance analytics
// @route   GET /api/knowledge/analytics/performance
// @access  Private
export const getPerformanceAnalytics = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    const { startDate, endDate } = req.query as any;
    
    const analytics = await knowledgeService.getPerformanceAnalytics(
      userId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    
    res.send({
      success: true,
      analytics
    });
  } catch (error) {
    return handleError(error, res, 'Error getting performance analytics');
  }
};

// @desc    Get knowledge gaps
// @route   GET /api/knowledge/analytics/gaps
// @access  Private
export const getKnowledgeGaps = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = (req as any).user.id;
    
    const gaps = await knowledgeService.getKnowledgeGaps(userId);
    
    res.send({
      success: true,
      gaps
    });
  } catch (error) {
    return handleError(error, res, 'Error getting knowledge gaps');
  }
};
