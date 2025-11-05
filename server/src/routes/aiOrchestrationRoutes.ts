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
  detectEmotion,
  detectIntent,
  detectObjection,
  scoreConversation,
  getMetrics,
  clearCache
} from '../controllers/aiOrchestrationController';

export default async function (fastify: FastifyInstance, options: Record<string, any>) {
  // Protected routes (require authentication)
  fastify.route({
    method: 'GET',
    url: '/status',
    preHandler: [fastify.authenticate],
    handler: getServiceStatus,
  });

  fastify.route({
    method: 'POST',
    url: '/chat',
    preHandler: [fastify.authenticate],
    handler: generateChatResponse,
  });

  fastify.route({
    method: 'POST',
    url: '/stream-chat',
    preHandler: [fastify.authenticate],
    handler: streamChatResponse,
  });

  fastify.route({
    method: 'POST',
    url: '/voice',
    preHandler: [fastify.authenticate],
    handler: synthesizeVoice,
  });

  fastify.route({
    method: 'POST',
    url: '/context',
    preHandler: [fastify.authenticate],
    handler: retrieveContext,
  });

  fastify.route({
    method: 'POST',
    url: '/speech',
    preHandler: [fastify.authenticate],
    handler: processSpeech,
  });

  fastify.route({
    method: 'POST',
    url: '/emotion',
    preHandler: [fastify.authenticate],
    handler: detectEmotion,
  });

  fastify.route({
    method: 'POST',
    url: '/intent',
    preHandler: [fastify.authenticate],
    handler: detectIntent,
  });

  fastify.route({
    method: 'POST',
    url: '/objection',
    preHandler: [fastify.authenticate],
    handler: detectObjection,
  });

  fastify.route({
    method: 'POST',
    url: '/quality',
    preHandler: [fastify.authenticate],
    handler: scoreConversation,
  });

  fastify.route({
    method: 'GET',
    url: '/metrics',
    preHandler: [fastify.authenticate],
    handler: getMetrics,
  });

  fastify.route({
    method: 'POST',
    url: '/cache/clear',
    preHandler: [fastify.authenticate],
    handler: clearCache,
  });

  // Admin-only routes
  fastify.route({
    method: 'PUT',
    url: '/config',
    preHandler: [fastify.authenticate],
    handler: updateConfiguration,
  });
}
