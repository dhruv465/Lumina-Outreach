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

const analyticsRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/unified-metrics', getUnifiedCallMetrics);
  fastify.get('/call-timeline', getCallTimeline);
  fastify.get('/campaign-performance', getCampaignPerformance);
  fastify.get('/call-distribution', getCallDistribution);
  fastify.get('/conversation-metrics', getConversationMetrics);
  fastify.get('/calls/:id/metrics', getDetailedCallMetrics);
  fastify.get('/system-health', getSystemHealth);
};

export default analyticsRoutes;