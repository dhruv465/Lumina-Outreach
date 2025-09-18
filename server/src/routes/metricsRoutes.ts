/**
 * metricsRoutes.ts
 * Routes for metrics and monitoring API endpoints
 */

import { FastifyInstance } from 'fastify';
import * as metricsController from '../controllers/metricsController';

const metricsRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Get Deepgram model metrics
  fastify.get('/deepgram', { onRequest: [fastify.roleCheck(['admin', 'manager'])] }, metricsController.getDeepgramMetrics);

  // Get system performance metrics
  fastify.get('/performance', { onRequest: [fastify.roleCheck(['admin', 'manager'])] }, metricsController.getPerformanceMetrics);

  // Get alert history
  fastify.get('/alerts', { onRequest: [fastify.roleCheck(['admin', 'manager'])] }, metricsController.getAlertHistory);

  // Acknowledge an alert
  fastify.post('/alerts/:id/acknowledge', { onRequest: [fastify.roleCheck(['admin', 'manager'])] }, metricsController.acknowledgeAlert);

  // Run model compatibility diagnostic
  fastify.post('/deepgram/diagnostic', { onRequest: [fastify.roleCheck(['admin'])] }, metricsController.runModelCompatibilityDiagnostic);

  // Get metrics collection status
  fastify.get('/status', { onRequest: [fastify.roleCheck(['admin', 'manager'])] }, metricsController.getMetricsStatus);
};

export default metricsRoutes;