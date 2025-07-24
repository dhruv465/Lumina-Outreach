import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  getDashboardOverview,
  getCallMetrics,
  getLeadMetrics,
  getAgentPerformance,
  getGeographicalDistribution,
  getTimeSeriesData,
  exportDashboardData
} from '../controllers/dashboardController';

const router = express.Router();

// All routes are protected
router.use(authenticate);

// Dashboard routes
router.get('/overview', getDashboardOverview);
router.get('/call-metrics', getCallMetrics);
router.get('/lead-metrics', getLeadMetrics);
router.get('/agent-performance', getAgentPerformance);
router.get('/geographical-distribution', getGeographicalDistribution);
router.get('/time-series', getTimeSeriesData);
router.get('/export', exportDashboardData);

export default router;
