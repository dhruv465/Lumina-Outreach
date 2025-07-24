import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  getCallTimeline,
  getCampaignPerformance,
  getCallDistribution,
  getConversationMetrics,
  getDetailedCallMetrics,
  getSystemHealth,
  getUnifiedCallMetrics
} from '../controllers/analyticsController';

const router = express.Router();

// All routes should be authenticated
router.use(authenticate);

// Analytics routes
router.get('/unified-metrics', getUnifiedCallMetrics);
router.get('/call-timeline', getCallTimeline);
router.get('/campaign-performance', getCampaignPerformance);
router.get('/call-distribution', getCallDistribution);
router.get('/conversation-metrics', getConversationMetrics);
router.get('/calls/:id/metrics', getDetailedCallMetrics);
router.get('/system-health', getSystemHealth);

export default router;
