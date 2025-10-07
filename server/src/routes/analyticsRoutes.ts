import { FastifyInstance } from 'fastify';
import {
  getCallTimeline,
  getCampaignPerformance,
  getCallDistribution,
  getConversationMetrics,
  getDetailedCallMetrics,
  getSystemHealth,
  getUnifiedCallMetrics
} from '../controllers/analyticsController';
import { cacheResponse } from '../utils/responseCache';

const analyticsRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Analytics routes with caching - these are expensive queries
  fastify.get('/unified-metrics', { preHandler: cacheResponse(45) }, getUnifiedCallMetrics);
  fastify.get('/call-timeline', { preHandler: cacheResponse(60) }, getCallTimeline);
  fastify.get('/campaign-performance', { preHandler: cacheResponse(90) }, getCampaignPerformance);
  fastify.get('/call-distribution', { preHandler: cacheResponse(120) }, getCallDistribution);
  fastify.get('/conversation-metrics', { preHandler: cacheResponse(60) }, getConversationMetrics);
  
  // Individual call metrics - shorter cache since they might be actively monitored
  fastify.get('/calls/:id/metrics', { preHandler: cacheResponse(15) }, getDetailedCallMetrics);
  
  // System health - cache for 30 seconds
  fastify.get('/system-health', { preHandler: cacheResponse(30) }, getSystemHealth);
};

export default analyticsRoutes;