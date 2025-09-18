/**
 * AI Service Routes
 * 
 * This module defines the API routes for the AI services, including
 * LLM, RAG, Voice, Speech, and other AI capabilities.
 */

import { FastifyInstance } from 'fastify';
import * as aiController from '../controllers/aiController';

const aiRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.post('/llm', aiController.processLLM);
  fastify.post('/rag', aiController.processRAG);
  fastify.post('/voice', aiController.processVoice);
  fastify.post('/speech', aiController.processSpeech);
  fastify.post('/emotion', aiController.detectEmotion);
  fastify.post('/intent', aiController.detectIntent);
  fastify.post('/objection', aiController.detectObjection);
  fastify.post('/quality', aiController.scoreConversation);
  fastify.get('/metrics', aiController.getMetrics);
  fastify.post('/cache/clear', aiController.clearCache);
  fastify.post('/config/update', aiController.updateConfig);
};

export default aiRoutes;