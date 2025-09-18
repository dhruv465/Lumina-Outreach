/**
 * Knowledge Management Routes module defines the API routes for the knowledge management system,
 * which allows users to upload, organize, and manage documents for the RAG system.
 */

import { FastifyInstance } from 'fastify';
import * as knowledgeController from '../controllers/knowledgeController';

const knowledgeRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Document Management
  fastify.post(
    '/documents',
    knowledgeController.uploadDocuments
  );

  fastify.get(
    '/documents',
    knowledgeController.getDocuments
  );

  fastify.get(
    '/documents/:id',
    knowledgeController.getDocumentById
  );

  fastify.put(
    '/documents/:id',
    knowledgeController.updateDocument
  );

  fastify.delete(
    '/documents/:id',
    knowledgeController.deleteDocument
  );

  // Content Chunks
  fastify.get(
    '/chunks',
    knowledgeController.getChunks
  );

  fastify.get(
    '/chunks/:id',
    knowledgeController.getChunkById
  );

  fastify.put(
    '/chunks/:id',
    knowledgeController.updateChunk
  );

  // Categories
  fastify.get(
    '/categories',
    knowledgeController.getCategories
  );

  fastify.post(
    '/categories',
    knowledgeController.createCategory
  );

  fastify.put(
    '/categories/:id',
    knowledgeController.updateCategory
  );

  fastify.delete(
    '/categories/:id',
    knowledgeController.deleteCategory
  );

  // Tags
  fastify.get(
    '/tags',
    knowledgeController.getTags
  );

  fastify.post(
    '/tags',
    knowledgeController.createTag
  );

  // Search
  fastify.post(
    '/search',
    knowledgeController.searchKnowledge
  );

  // Analytics
  fastify.get(
    '/analytics/usage',
    knowledgeController.getUsageAnalytics
  );

  fastify.get(
    '/analytics/performance',
    knowledgeController.getPerformanceAnalytics
  );

  fastify.get(
    '/analytics/gaps',
    knowledgeController.getKnowledgeGaps
  );
};

export default knowledgeRoutes;