/**
 * deepgramMetrics.ts
 * Routes for Deepgram model compatibility metrics API
 */

import { FastifyInstance } from 'fastify';
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

export default async function (fastify, options: Record<string, any>) {
  // Apply authentication and rate limiting to all routes
  fastify.addHook('preHandler', fastify.authenticate);
  // fastify.addHook('preHandler', apiRateLimit); // apiRateLimit needs to be a fastify plugin or decorator

  /**
   * @route GET /api/deepgram-metrics/summary
   * @desc Get comprehensive metrics summary
   * @access Private
   */
  fastify.get('/summary', getMetricsSummary);

  /**
   * @route GET /api/deepgram-metrics/models
   * @desc Get all model usage metrics
   * @access Private
   */
  fastify.get('/models', getModelUsageMetrics);

  /**
   * @route GET /api/deepgram-metrics/models/:model
   * @desc Get usage metrics for specific model
   * @access Private
   */
  fastify.get('/models/:model', getModelUsageMetrics);

  /**
   * @route GET /api/deepgram-metrics/validation
   * @desc Get all model validation metrics
   * @access Private
   */
  fastify.get('/validation', getModelValidationMetrics);

  /**
   * @route GET /api/deepgram-metrics/validation/:model
   * @desc Get validation metrics for specific model
   * @access Private
   */
  fastify.get('/validation/:model', getModelValidationMetrics);

  /**
   * @route GET /api/deepgram-metrics/fallbacks
   * @desc Get model fallback metrics
   * @access Private
   */
  fastify.get('/fallbacks', getFallbackMetrics);

  /**
   * @route GET /api/deepgram-metrics/account-tier
   * @desc Get account tier metrics
   * @access Private
   */
  fastify.get('/account-tier', getAccountTierMetrics);

  /**
   * @route GET /api/deepgram-metrics/alerts
   * @desc Get alert metrics
   * @access Private
   */
  fastify.get('/alerts', getAlertMetrics);

  /**
   * @route GET /api/deepgram-metrics/performance
   * @desc Get performance statistics
   * @access Private
   */
  fastify.get('/performance', getPerformanceStats);

  /**
   * @route GET /api/deepgram-metrics/health
   * @desc Get metrics collection health status
   * @access Private
   */
  fastify.get('/health', getMetricsHealth);

  /**
   * @route POST /api/deepgram-metrics/reset
   * @desc Reset all metrics (admin only)
   * @access Private (Admin)
   */
  fastify.post('/reset', resetMetrics);
}