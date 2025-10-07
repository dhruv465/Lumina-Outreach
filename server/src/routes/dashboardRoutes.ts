import { FastifyInstance } from 'fastify';
import {
  getDashboardOverview,
  getCallMetrics,
  getLeadMetrics,
  getAgentPerformance,
  getGeographicalDistribution,
  getTimeSeriesData,
  exportDashboardData
} from '../controllers/dashboardController';
import { cacheResponse } from '../utils/responseCache';

const dashboardRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Dashboard routes with caching for better performance
  // Cache for 30 seconds - dashboard data doesn't need to be real-time accurate
  fastify.get('/overview', { preHandler: cacheResponse(30) }, getDashboardOverview);
  fastify.get('/call-metrics', { preHandler: cacheResponse(30) }, getCallMetrics);
  fastify.get('/lead-metrics', { preHandler: cacheResponse(30) }, getLeadMetrics);
  fastify.get('/agent-performance', { preHandler: cacheResponse(60) }, getAgentPerformance);
  fastify.get('/geographical-distribution', { preHandler: cacheResponse(120) }, getGeographicalDistribution);
  fastify.get('/time-series', { preHandler: cacheResponse(60) }, getTimeSeriesData);
  
  // Don't cache export - it's a download
  fastify.get('/export', exportDashboardData);
};

export default dashboardRoutes;