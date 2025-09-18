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
  updateConfiguration
} from '../controllers/aiOrchestrationController';

export default async function (fastify, options: Record<string, any>) {
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

  // Admin-only routes
  fastify.route({
    method: 'PUT',
    url: '/config',
    preHandler: [fastify.authenticate],
    handler: updateConfiguration,
  });
}