/**
 * deepgramMetricsRoutes.ts
 * Routes for Deepgram model metrics API
 */

import express from 'express';
import * as deepgramMetricsController from '../controllers/deepgramMetricsController';
import { authenticate } from '../middleware/authMiddleware';

const router = express.Router();

// Get metrics summary (requires authentication)
router.get('/summary', authenticate, deepgramMetricsController.getMetricsSummary || ((req, res) => res.status(501).json({ error: 'Not implemented' })));

// Get specific metrics (requires authentication)
router.get('/model-usage', authenticate, deepgramMetricsController.getModelUsageMetrics || ((req, res) => res.status(501).json({ error: 'Not implemented' })));
router.get('/model-validation', authenticate, deepgramMetricsController.getModelValidationMetrics || ((req, res) => res.status(501).json({ error: 'Not implemented' })));
router.get('/fallbacks', authenticate, deepgramMetricsController.getFallbackMetrics || ((req, res) => res.status(501).json({ error: 'Not implemented' })));
router.get('/account-tier', authenticate, deepgramMetricsController.getAccountTierMetrics || ((req, res) => res.status(501).json({ error: 'Not implemented' })));
router.get('/alerts', authenticate, deepgramMetricsController.getRecentAlerts || ((req, res) => res.status(501).json({ error: 'Not implemented' })));

// Admin routes (requires admin authentication)
router.post('/reset', authenticate, deepgramMetricsController.resetMetrics || ((req, res) => res.status(501).json({ error: 'Not implemented' })));

export default router;