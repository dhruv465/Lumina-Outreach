/**
 * deepgramMetrics.ts
 * Routes for Deepgram model compatibility metrics API
 */

import { Router } from 'express';
import {
  getMetricsSummary,
  getModelUsageMetrics,
  getModelValidationMetrics,
  getFallbackMetrics,
  getAccountTierMetrics,
  getAlertMetrics,
  getPerformanceStats,
  resetMetrics,
  getMetricsHealth
} from '../controllers/deepgramMetricsController';
import { authenticate } from '../middleware/authMiddleware';
import { apiRateLimit } from '../middleware/rateLimitMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Apply rate limiting to prevent abuse
router.use(apiRateLimit);

/**
 * @route GET /api/deepgram-metrics/summary
 * @desc Get comprehensive metrics summary
 * @access Private
 */
router.get('/summary', getMetricsSummary);

/**
 * @route GET /api/deepgram-metrics/models
 * @desc Get all model usage metrics
 * @access Private
 */
router.get('/models', getModelUsageMetrics);

/**
 * @route GET /api/deepgram-metrics/models/:model
 * @desc Get usage metrics for specific model
 * @access Private
 */
router.get('/models/:model', getModelUsageMetrics);

/**
 * @route GET /api/deepgram-metrics/validation
 * @desc Get all model validation metrics
 * @access Private
 */
router.get('/validation', getModelValidationMetrics);

/**
 * @route GET /api/deepgram-metrics/validation/:model
 * @desc Get validation metrics for specific model
 * @access Private
 */
router.get('/validation/:model', getModelValidationMetrics);

/**
 * @route GET /api/deepgram-metrics/fallbacks
 * @desc Get model fallback metrics
 * @access Private
 */
router.get('/fallbacks', getFallbackMetrics);

/**
 * @route GET /api/deepgram-metrics/account-tier
 * @desc Get account tier metrics
 * @access Private
 */
router.get('/account-tier', getAccountTierMetrics);

/**
 * @route GET /api/deepgram-metrics/alerts
 * @desc Get alert metrics
 * @access Private
 */
router.get('/alerts', getAlertMetrics);

/**
 * @route GET /api/deepgram-metrics/performance
 * @desc Get performance statistics
 * @access Private
 */
router.get('/performance', getPerformanceStats);

/**
 * @route GET /api/deepgram-metrics/health
 * @desc Get metrics collection health status
 * @access Private
 */
router.get('/health', getMetricsHealth);

/**
 * @route POST /api/deepgram-metrics/reset
 * @desc Reset all metrics (admin only)
 * @access Private (Admin)
 */
router.post('/reset', resetMetrics);

export default router;