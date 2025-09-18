/**
 * deepgramMetricsRoutes.ts
 * Routes for Deepgram model metrics API
 */

import { FastifyInstance } from 'fastify';
import * as deepgramMetricsController from '../controllers/deepgramMetricsController';

const deepgramMetricsRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Get metrics summary (requires authentication)
  fastify.get('/summary', deepgramMetricsController.getMetricsSummary || ((req, res) => res.code(501).send({ error: 'Not implemented' })));

  // Get specific metrics (requires authentication)
  fastify.get('/model-usage', deepgramMetricsController.getModelUsageMetrics || ((req, res) => res.code(501).send({ error: 'Not implemented' })));
  fastify.get('/model-validation', deepgramMetricsController.getModelValidationMetrics || ((req, res) => res.code(501).send({ error: 'Not implemented' })));
  fastify.get('/fallbacks', deepgramMetricsController.getFallbackMetrics || ((req, res) => res.code(501).send({ error: 'Not implemented' })));
  fastify.get('/account-tier', deepgramMetricsController.getAccountTierMetrics || ((req, res) => res.code(501).send({ error: 'Not implemented' })));
  fastify.get('/alerts', deepgramMetricsController.getRecentAlerts || ((req, res) => res.code(501).send({ error: 'Not implemented' })));

  // Admin routes (requires admin authentication)
  fastify.post('/reset', deepgramMetricsController.resetMetrics || ((req, res) => res.code(501).send({ error: 'Not implemented' })));
};

export default deepgramMetricsRoutes;