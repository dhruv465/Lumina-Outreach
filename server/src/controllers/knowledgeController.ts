/**
 * Knowledge Management Controller
 * 
 * Handles API endpoints for document management, content chunking,
 * categorization, and search for the RAG knowledge base.
 */

import { Request, Response } from 'express';
import { getKnowledgeService } from '../services/knowledgeService';
import { logger } from '../index';

// Utility function to handle errors
const handleError = (error: any, res: Response, message: string) => {
  logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  return res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'Unknown error'
  });
};

// @desc    Upload documents
// @route   POST /api/knowledge/documents
// @access  Private
export const uploadDocuments = async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded'
      });
    }
    
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const { categoryId, tags } = req.body;
    
    const results = await Promise.all(
      files.map(file => knowledgeService.processDocument(file, userId, categoryId, tags))
    );
    
    res.status(201).json({
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
export const getDocuments = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    
    const { page = 1, limit = 20, categoryId, tags, status, query } = req.query;
    
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
    
    res.json({
      success: true,
      ...documents
    });
  } catch (error) {
    return handleError(error, res, 'Error getting documents');
  }
};

// @desc    Get document by ID
// @route   GET /api/knowledge/documents/:id
// @access  Private
export const getDocumentById = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const documentId = req.params.id;
    
    const document = await knowledgeService.getDocumentById(documentId, userId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.json({
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
export const updateDocument = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const documentId = req.params.id;
    const updates = req.body;
    
    const updatedDocument = await knowledgeService.updateDocument(documentId, userId, updates);
    
    if (!updatedDocument) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.json({
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
export const deleteDocument = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const documentId = req.params.id;
    
    const result = await knowledgeService.deleteDocument(documentId, userId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.json({
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
export const getChunks = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    
    const { page = 1, limit = 50, documentId, tags } = req.query;
    
    const chunks = await knowledgeService.getChunks(
      userId,
      Number(page),
      Number(limit),
      {
        documentId: documentId as string,
        tags: tags ? (tags as string).split(',') : undefined
      }
    );
    
    res.json({
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
export const getChunkById = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const chunkId = req.params.id;
    
    const chunk = await knowledgeService.getChunkById(chunkId, userId);
    
    if (!chunk) {
      return res.status(404).json({
        success: false,
        message: 'Chunk not found'
      });
    }
    
    res.json({
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
export const updateChunk = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const chunkId = req.params.id;
    const { content, metadata, tags, importance } = req.body;
    
    const updatedChunk = await knowledgeService.updateChunk(chunkId, userId, {
      content,
      metadata,
      tags,
      importance
    });
    
    if (!updatedChunk) {
      return res.status(404).json({
        success: false,
        message: 'Chunk not found'
      });
    }
    
    res.json({
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
export const getCategories = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    
    const categories = await knowledgeService.getCategories(userId);
    
    res.json({
      success: true,
      categories
    });
  } catch (error) {
    return handleError(error, res, 'Error getting categories');
  }
};

// @desc    Create category
// @route   POST /api/knowledge/categories
// @access  Private
export const createCategory = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const { name, description, parentId } = req.body;
    
    const category = await knowledgeService.createCategory(userId, {
      name,
      description,
      parentId
    });
    
    res.status(201).json({
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
export const updateCategory = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const categoryId = req.params.id;
    const { name, description, parentId } = req.body;
    
    const updatedCategory = await knowledgeService.updateCategory(categoryId, userId, {
      name,
      description,
      parentId
    });
    
    if (!updatedCategory) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    res.json({
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
export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const categoryId = req.params.id;
    
    const result = await knowledgeService.deleteCategory(categoryId, userId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    res.json({
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
export const getTags = async (req: Request, res: Response) => {
  try {
    // Defensive guard to ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    
    const tags = await knowledgeService.getTags(userId);
    
    res.json({
      success: true,
      tags
    });
  } catch (error) {
    return handleError(error, res, 'Error getting tags');
  }
};

// @desc    Create tag
// @route   POST /api/knowledge/tags
// @access  Private
export const createTag = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const { name, color } = req.body;
    
    const tag = await knowledgeService.createTag(userId, { name, color });
    
    res.status(201).json({
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
export const searchKnowledge = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const { query, filters, limit = 10 } = req.body;
    
    const results = await knowledgeService.searchKnowledge(
      userId,
      query,
      filters,
      Number(limit)
    );
    
    res.json({
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
export const getUsageAnalytics = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const { startDate, endDate } = req.query;
    
    const analytics = await knowledgeService.getUsageAnalytics(
      userId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    
    res.json({
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
export const getPerformanceAnalytics = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    const { startDate, endDate } = req.query;
    
    const analytics = await knowledgeService.getPerformanceAnalytics(
      userId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    
    res.json({
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
export const getKnowledgeGaps = async (req: Request, res: Response) => {
  try {
    const knowledgeService = getKnowledgeService();
    const userId = req.user.id;
    
    const gaps = await knowledgeService.getKnowledgeGaps(userId);
    
    res.json({
      success: true,
      gaps
    });
  } catch (error) {
    return handleError(error, res, 'Error getting knowledge gaps');
  }
};
