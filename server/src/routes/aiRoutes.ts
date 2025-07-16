/**
 * AI Service Routes
 * 
 * This module defines the API routes for the AI services, including
 * LLM, RAG, Voice, Speech, and other AI capabilities.
 */

import express from 'express';
import * as aiController from '../controllers/aiController';

const router = express.Router();

// For development, we'll skip authentication and validation temporarily
// TODO: Re-enable these in production
// router.use(authenticate);
// router.use(rateLimiter);

// LLM routes
router.post('/llm', aiController.processLLM);

// RAG routes
router.post('/rag', aiController.processRAG);

// Voice routes
router.post('/voice', aiController.processVoice);

// Speech routes
router.post('/speech', aiController.upload.single('audio'), aiController.processSpeech);

// Emotion detection routes
router.post('/emotion', aiController.detectEmotion);

// Intent detection routes
router.post('/intent', aiController.detectIntent);

// Objection detection routes
router.post('/objection', aiController.detectObjection);

// Conversation quality scoring routes
router.post('/quality', aiController.scoreConversation);

// Metrics routes
router.get('/metrics', aiController.getMetrics);

// Cache management routes
router.post('/cache/clear', aiController.clearCache);

// Configuration management routes
router.post('/config/update', aiController.updateConfig);

export default router;
