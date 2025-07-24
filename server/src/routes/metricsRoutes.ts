/**
 * metricsRoutes.ts
 * Routes for metrics and monitoring API endpoints
 */

import express from 'express';
import * as metricsController from '../controllers/metricsController';
import { authenticate } from '../middleware/auth';
import { roleCheck } from '../middleware/roleCheck';

const router = express.Router();

// All metrics routes require authentication
router.use(authenticate);

// Get Deepgram model metrics
router.get('/deepgram', roleCheck(['admin', 'manager']), metricsController.getDeepgramMetrics);

// Get system performance metrics
router.get('/performance', roleCheck(['admin', 'manager']), metricsController.getPerformanceMetrics);

// Get alert history
router.get('/alerts', roleCheck(['admin', 'manager']), metricsController.getAlertHistory);

// Acknowledge an alert
router.post('/alerts/:id/acknowledge', roleCheck(['admin', 'manager']), metricsController.acknowledgeAlert);

// Run model compatibility diagnostic
router.post('/deepgram/diagnostic', roleCheck(['admin']), metricsController.runModelCompatibilityDiagnostic);

// Get metrics collection status
router.get('/status', roleCheck(['admin', 'manager']), metricsController.getMetricsStatus);

export default router;
