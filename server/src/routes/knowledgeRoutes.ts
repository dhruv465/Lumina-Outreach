/**
 * Knowledge Management Routes module defines the API routes for the knowledge management system,
 * which allows users to upload, organize, and manage documents for the RAG system.
 */

import express, { Request } from 'express';
import * as knowledgeController from '../controllers/knowledgeController';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validationMiddleware';
import { apiRateLimit } from '../middleware/rateLimitMiddleware';
import multer from 'multer';

// Extend the Express Request interface to include fileValidationError
declare global {
  namespace Express {
    interface Request {
      fileValidationError?: string;
    }
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/documents');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = file.originalname.split('.').pop();
    cb(null, `${file.fieldname}-${uniqueSuffix}.${fileExtension}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/json',
      'text/markdown'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Passing null as first parameter and false as second to reject file
      cb(null, false);
      // Set a custom property on the request object to indicate validation error
      req.fileValidationError = 'File type not supported. Please upload PDF, Word, Text, CSV, JSON, or Markdown files.';
    }
  }
});

const router = express.Router();

// Apply middleware to all routes
router.use(authenticate);
router.use(apiRateLimit);

// Document Management
router.post(
  '/documents',
  upload.array('documents', 10),
  knowledgeController.uploadDocuments
);

router.get(
  '/documents',
  knowledgeController.getDocuments
);

router.get(
  '/documents/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Document ID is required'
      }
    }
  }),
  knowledgeController.getDocumentById
);

router.put(
  '/documents/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Document ID is required'
      }
    }
  }),
  knowledgeController.updateDocument
);

router.delete(
  '/documents/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Document ID is required'
      }
    }
  }),
  knowledgeController.deleteDocument
);

// Content Chunks
router.get(
  '/chunks',
  knowledgeController.getChunks
);

router.get(
  '/chunks/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Chunk ID is required'
      }
    }
  }),
  knowledgeController.getChunkById
);

router.put(
  '/chunks/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Chunk ID is required'
      }
    },
    body: {
      content: {
        type: 'string',
        required: true,
        message: 'Content is required'
      }
    }
  }),
  knowledgeController.updateChunk
);

// Categories
router.get(
  '/categories',
  knowledgeController.getCategories
);

router.post(
  '/categories',
  validateRequest({
    body: {
      name: {
        type: 'string',
        required: true,
        message: 'Category name is required'
      }
    }
  }),
  knowledgeController.createCategory
);

router.put(
  '/categories/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Category ID is required'
      }
    },
    body: {
      name: {
        type: 'string',
        required: true,
        message: 'Category name is required'
      }
    }
  }),
  knowledgeController.updateCategory
);

router.delete(
  '/categories/:id',
  validateRequest({
    params: {
      id: {
        type: 'string',
        required: true,
        message: 'Category ID is required'
      }
    }
  }),
  knowledgeController.deleteCategory
);

// Tags
router.get(
  '/tags',
  knowledgeController.getTags
);

router.post(
  '/tags',
  validateRequest({
    body: {
      name: {
        type: 'string',
        required: true,
        message: 'Tag name is required'
      }
    }
  }),
  knowledgeController.createTag
);

// Search
router.post(
  '/search',
  validateRequest({
    body: {
      query: {
        type: 'string',
        required: true,
        message: 'Search query is required'
      }
    }
  }),
  knowledgeController.searchKnowledge
);

// Analytics
router.get(
  '/analytics/usage',
  knowledgeController.getUsageAnalytics
);

router.get(
  '/analytics/performance',
  knowledgeController.getPerformanceAnalytics
);

router.get(
  '/analytics/gaps',
  knowledgeController.getKnowledgeGaps
);

export default router;
