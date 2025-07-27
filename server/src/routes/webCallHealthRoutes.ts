/**
 * Web Call Health Routes
 * 
 * Routes for monitoring and managing web call service health
 */

import express from 'express';
import { getWebCallHealth, resetCircuitBreaker, getServiceHealth } from '../controllers/webCallHealthController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Get overall health status
router.get('/health', authenticate, getWebCallHealth);

// Get health status for a specific service
router.get('/health/:serviceId', authenticate, getServiceHealth);

// Reset circuit breaker (admin only - simplified authentication for now)
router.post('/health/reset/:serviceId', authenticate, resetCircuitBreaker);

export default router;