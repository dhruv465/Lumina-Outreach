import express from 'express';
import { getWebCallMetrics, getCampaignComparison } from '../controllers/webCallMetricsController';
import { authenticate } from '../middleware/authMiddleware';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Get web call metrics
router.get('/metrics', getWebCallMetrics);

// Get campaign performance comparison
router.get('/comparison', getCampaignComparison);

export default router;