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
import { protect, admin } from '../middleware/authMiddleware';

const router = express.Router();

// Protected routes (require authentication)
router.get('/status', protect, getServiceStatus);
router.post('/chat', protect, generateChatResponse);
router.post('/stream-chat', protect, streamChatResponse);
router.post('/voice', protect, synthesizeVoice);
router.post('/context', protect, retrieveContext);

// Admin-only routes
router.put('/config', protect, admin, updateConfiguration);

export default router;
