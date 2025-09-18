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

const dashboardRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Dashboard routes
  fastify.get('/overview', getDashboardOverview);
  fastify.get('/call-metrics', getCallMetrics);
  fastify.get('/lead-metrics', getLeadMetrics);
  fastify.get('/agent-performance', getAgentPerformance);
  fastify.get('/geographical-distribution', getGeographicalDistribution);
  fastify.get('/time-series', getTimeSeriesData);
  fastify.get('/export', exportDashboardData);
};

export default dashboardRoutes;