/**
 * AI Orchestration Routes
 * 
 * API routes for AI orchestration services, including LLM interactions,
 * voice synthesis, and context retrieval.
 */

import { FastifyInstance } from 'fastify';
import {
  getServiceStatus,
  generateChatResponse,
  streamChatResponse,
  synthesizeVoice,
  retrieveContext,
  updateConfiguration,
  processSpeech,
  analyzeText, // New import
  scoreConversation,
  getMetrics,
  clearCache
} from '../controllers/aiOrchestrationController';

export default async function (fastify: FastifyInstance, options: Record<string, any>) {
  // Protected routes (require authentication)
  fastify.route({
    method: 'GET',
    url: '/status',
    preHandler: [(fastify as any).authenticate],
    handler: getServiceStatus,
  });

  fastify.route({
    method: 'POST',
    url: '/chat',
    preHandler: [(fastify as any).authenticate],
    handler: generateChatResponse,
  });

  fastify.route({
    method: 'POST',
    url: '/stream-chat',
    preHandler: [(fastify as any).authenticate],
    handler: streamChatResponse,
  });

  fastify.route({
    method: 'POST',
    url: '/voice',
    preHandler: [(fastify as any).authenticate],
    handler: synthesizeVoice,
  });

  fastify.route({
    method: 'POST',
    url: '/context',
    preHandler: [(fastify as any).authenticate],
    handler: retrieveContext,
  });

  fastify.route({
    method: 'POST',
    url: '/speech',
    preHandler: [(fastify as any).authenticate],
    handler: processSpeech,
  });

  fastify.route({
    method: 'POST',
    url: '/analyze-text',
    preHandler: [(fastify as any).authenticate],
    handler: analyzeText,
  });

  fastify.route({
    method: 'POST',
    url: '/quality',
    preHandler: [(fastify as any).authenticate],
    handler: scoreConversation,
  });

  fastify.route({
    method: 'GET',
    url: '/metrics',
    preHandler: [(fastify as any).authenticate],
    handler: getMetrics,
  });

  fastify.route({
    method: 'POST',
    url: '/cache/clear',
    preHandler: [(fastify as any).authenticate],
    handler: clearCache,
  });

  // Admin-only routes
  fastify.route({
    method: 'PUT',
    url: '/config',
    preHandler: [(fastify as any).authenticate],
    handler: updateConfiguration,
  });
}
