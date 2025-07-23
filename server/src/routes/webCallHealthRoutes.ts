/**
 * Web Call Health Routes
 * 
 * Routes for monitoring and managing web call service health
 */

import express from 'express';
import { getWebCallHealth, resetCircuitBreaker, getServiceHealth } from '../controllers/webCallHealthController';
import { authenticate, authorize } from '../middleware/authMiddleware';

const router = express.Router();

// Get overall health status
router.get('/health', authenticate, getWebCallHealth);

// Get health status for a specific service
router.get('/health/:serviceId', authenticate, getServiceHealth);

// Reset circuit breaker (admin only)
router.post('/health/reset/:serviceId', authenticate, authorize(['admin']), resetCircuitBreaker);

export default router;