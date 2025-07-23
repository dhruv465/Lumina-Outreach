/**
 * Web Call Routes
 * 
 * This file defines the routes for web call testing API endpoints.
 */

import express from 'express';
import { initializeWebCall, endWebCall } from '../controllers/webCallController';
import { authenticate } from '../middleware/authMiddleware';
import { webCallRateLimit } from '../middleware/rateLimitMiddleware';
import { webCallErrorHandler } from '../middleware/webCallErrorHandler';
import { validateWebCallRequest } from '../middleware/validationMiddleware';

const router = express.Router();

/**
 * Initialize a web call session
 * @route POST /api/webcall/initialize
 * @group Web Call - Web call testing endpoints
 * @param {object} request.body - Web call initialization parameters
 * @param {string} request.body.campaignId - Campaign ID
 * @returns {object} 200 - Success response with session ID
 * @returns {object} 400 - Bad request
 * @returns {object} 401 - Unauthorized
 * @returns {object} 404 - Campaign not found
 * @returns {object} 429 - Too many requests
 * @returns {object} 500 - Server error
 * @security JWT
 */
router.post(
  '/initialize',
  authenticate,
  webCallRateLimit,
  validateWebCallRequest('initialize'),
  initializeWebCall
);

/**
 * End a web call session
 * @route POST /api/webcall/end/:sessionId
 * @group Web Call - Web call testing endpoints
 * @param {string} sessionId.path.required - Session ID
 * @param {object} request.body - Web call end parameters
 * @param {string} request.body.testId - Test ID
 * @returns {object} 200 - Success response
 * @returns {object} 400 - Bad request
 * @returns {object} 401 - Unauthorized
 * @returns {object} 403 - Forbidden
 * @returns {object} 404 - Session not found
 * @returns {object} 429 - Too many requests
 * @returns {object} 500 - Server error
 * @security JWT
 */
router.post(
  '/end/:sessionId',
  authenticate,
  webCallRateLimit,
  validateWebCallRequest('end'),
  endWebCall
);

/**
 * Get web call test results
 * @route GET /api/webcall/test/:testId
 * @group Web Call - Web call testing endpoints
 * @param {string} testId.path.required - Test ID
 * @returns {object} 200 - Success response with test results
 * @returns {object} 401 - Unauthorized
 * @returns {object} 403 - Forbidden
 * @returns {object} 404 - Test not found
 * @returns {object} 429 - Too many requests
 * @returns {object} 500 - Server error
 * @security JWT
 */
router.get(
  '/test/:testId',
  authenticate,
  webCallRateLimit,
  validateWebCallRequest('getTest'),
  (req, res) => {
    // This endpoint will be implemented later
    res.status(501).json({ message: 'Not implemented yet' });
  }
);

/**
 * Export web call transcript
 * @route GET /api/webcall/export/:testId
 * @group Web Call - Web call testing endpoints
 * @param {string} testId.path.required - Test ID
 * @param {string} format.query - Export format (json, txt, csv)
 * @returns {object} 200 - Success response with transcript
 * @returns {object} 401 - Unauthorized
 * @returns {object} 403 - Forbidden
 * @returns {object} 404 - Test not found
 * @returns {object} 429 - Too many requests
 * @returns {object} 500 - Server error
 * @security JWT
 */
router.get(
  '/export/:testId',
  authenticate,
  webCallRateLimit,
  validateWebCallRequest('exportTranscript'),
  (req, res) => {
    // This endpoint will be implemented later
    res.status(501).json({ message: 'Not implemented yet' });
  }
);

// Apply error handler middleware
router.use(webCallErrorHandler);

export default router;