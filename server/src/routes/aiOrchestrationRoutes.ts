/**
 * AI Orchestration Routes
 * 
 * API routes for AI orchestration services, including LLM interactions,
 * voice synthesis, and context retrieval.
 */

import express from 'express';
import {
  getServiceStatus,
  generateChatResponse,
  streamChatResponse,
  synthesizeVoice,
  retrieveContext,
  updateConfiguration
} from '../controllers/aiOrchestrationController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Protected routes (require authentication)
router.get('/status', authenticate, getServiceStatus);
router.post('/chat', authenticate, generateChatResponse);
router.post('/stream-chat', authenticate, streamChatResponse);
router.post('/voice', authenticate, synthesizeVoice);
router.post('/context', authenticate, retrieveContext);

// Admin-only routes
router.put('/config', authenticate, updateConfiguration);

export default router;
