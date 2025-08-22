/**
 * Call Health API Routes
 * 
 * Provides REST API endpoints for accessing call health monitoring data,
 * resilience metrics, and system status information.
 */

import express from 'express';
import { getCallResilienceService } from '../services/callResilienceService';
import { getCallMonitoringService } from '../services/callMonitoringService';
import { getFallbackTTSService } from '../services/fallbackTTSService';
import logger from '../utils/logger';

const router = express.Router();

/**
 * GET /api/calls/:callId/health
 * Get comprehensive health status for a specific call
 */
router.get('/:callId/health', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const monitoringService = getCallMonitoringService();
    const health = monitoringService.getCallHealth(callId);
    
    if (!health) {
      return res.status(404).json({
        error: 'Call not found or not being monitored',
        callId
      });
    }
    
    res.json(health);
  } catch (error) {
    logger.error('Error getting call health:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/calls/:callId/resilience
 * Get resilience status for a specific call
 */
router.get('/:callId/resilience', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const resilienceService = getCallResilienceService();
    const status = resilienceService.getCallStatus(callId);
    
    if (!status) {
      return res.status(404).json({
        error: 'Call not found in resilience monitoring',
        callId
      });
    }
    
    res.json(status);
  } catch (error) {
    logger.error('Error getting call resilience status:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/monitoring/overview
 * Get system-wide monitoring overview
 */
router.get('/monitoring/overview', async (req, res) => {
  try {
    const monitoringService = getCallMonitoringService();
    const resilienceService = getCallResilienceService();
    
    const stats = monitoringService.getMonitoringStats();
    const serviceHealth = resilienceService.getServiceHealth();
    const allCalls = monitoringService.getAllCallsHealth();
    
    res.json({
      stats,
      serviceHealth,
      activeCalls: allCalls.length,
      recentActivity: allCalls.slice(-10).map(call => ({
        callId: call.callId,
        status: call.overall,
        duration: call.metrics.duration,
        issues: call.issues.filter(i => !i.resolved).length
      }))
    });
  } catch (error) {
    logger.error('Error getting monitoring overview:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/monitoring/calls
 * Get health status for all active calls
 */
router.get('/monitoring/calls', async (req, res) => {
  try {
    const monitoringService = getCallMonitoringService();
    const calls = monitoringService.getAllCallsHealth();
    
    // Filter and sort based on query parameters
    const { status, limit = '50', offset = '0' } = req.query;
    
    let filtered = calls;
    if (status && typeof status === 'string') {
      filtered = calls.filter(call => call.overall === status);
    }
    
    const startIndex = parseInt(offset as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const paginated = filtered.slice(startIndex, startIndex + limitNum);
    
    res.json({
      calls: paginated,
      total: filtered.length,
      offset: startIndex,
      limit: limitNum
    });
  } catch (error) {
    logger.error('Error getting all calls health:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/calls/:callId/issues/:issueId/resolve
 * Mark a specific issue as resolved
 */
router.post('/:callId/issues/:issueId/resolve', async (req, res) => {
  try {
    const { callId, issueId } = req.params;
    
    const monitoringService = getCallMonitoringService();
    monitoringService.resolveIssue(callId, issueId);
    
    res.json({
      success: true,
      message: 'Issue marked as resolved',
      callId,
      issueId
    });
  } catch (error) {
    logger.error('Error resolving issue:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/calls/:callId/actions/fallback
 * Manually activate fallback mode for a call
 */
router.post('/:callId/actions/fallback', async (req, res) => {
  try {
    const { callId } = req.params;
    const { reason = 'Manual activation' } = req.body;
    
    const resilienceService = getCallResilienceService();
    resilienceService.activateFallback(callId, reason);
    
    res.json({
      success: true,
      message: 'Fallback mode activated',
      callId,
      reason
    });
  } catch (error) {
    logger.error('Error activating fallback:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/calls/:callId/actions/deactivate-fallback
 * Manually deactivate fallback mode for a call
 */
router.post('/:callId/actions/deactivate-fallback', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const resilienceService = getCallResilienceService();
    resilienceService.deactivateFallback(callId);
    
    res.json({
      success: true,
      message: 'Fallback mode deactivated',
      callId
    });
  } catch (error) {
    logger.error('Error deactivating fallback:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fallback/tts/test/:callId
 * Test fallback TTS capabilities
 */
router.get('/fallback/tts/test/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const fallbackTTS = getFallbackTTSService();
    const results = await fallbackTTS.testFallbacks(callId);
    
    res.json({
      callId,
      fallbackCapabilities: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error testing fallback TTS:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fallback/tts/cache/stats
 * Get TTS fallback cache statistics
 */
router.get('/fallback/tts/cache/stats', async (req, res) => {
  try {
    const fallbackTTS = getFallbackTTSService();
    const stats = fallbackTTS.getCacheStats();
    
    res.json(stats);
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/fallback/tts/cache
 * Clear TTS fallback cache
 */
router.delete('/fallback/tts/cache', async (req, res) => {
  try {
    const fallbackTTS = getFallbackTTSService();
    fallbackTTS.clearCache();
    
    res.json({
      success: true,
      message: 'TTS fallback cache cleared'
    });
  } catch (error) {
    logger.error('Error clearing cache:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/fallback/tts/messages
 * Get available prerecorded messages
 */
router.get('/fallback/tts/messages', async (req, res) => {
  try {
    const fallbackTTS = getFallbackTTSService();
    const messages = fallbackTTS.getPrerecordedMessages();
    
    res.json(messages);
  } catch (error) {
    logger.error('Error getting prerecorded messages:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/monitoring/alerts/rules
 * Get all monitoring alert rules
 */
router.get('/monitoring/alerts/rules', async (req, res) => {
  try {
    const monitoringService = getCallMonitoringService();
    
    // Access the alert rules (we'll need to add a getter method)
    // For now, return a placeholder response
    res.json({
      rules: [],
      message: 'Alert rules endpoint - implementation needed'
    });
  } catch (error) {
    logger.error('Error getting alert rules:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/monitoring/alerts/rules
 * Add a new monitoring alert rule
 */
router.post('/monitoring/alerts/rules', async (req, res) => {
  try {
    const monitoringService = getCallMonitoringService();
    const rule = req.body;
    
    // Validate rule structure
    if (!rule.id || !rule.name || !rule.condition || !rule.severity) {
      return res.status(400).json({
        error: 'Invalid rule structure',
        required: ['id', 'name', 'condition', 'severity']
      });
    }
    
    monitoringService.addAlertRule(rule);
    
    res.json({
      success: true,
      message: 'Alert rule added',
      rule
    });
  } catch (error) {
    logger.error('Error adding alert rule:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/monitoring/alerts/rules/:ruleId
 * Remove a monitoring alert rule
 */
router.delete('/monitoring/alerts/rules/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    
    const monitoringService = getCallMonitoringService();
    monitoringService.removeAlertRule(ruleId);
    
    res.json({
      success: true,
      message: 'Alert rule removed',
      ruleId
    });
  } catch (error) {
    logger.error('Error removing alert rule:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/monitoring/alerts/rules/:ruleId
 * Update a monitoring alert rule
 */
router.put('/monitoring/alerts/rules/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const updates = req.body;
    
    const monitoringService = getCallMonitoringService();
    monitoringService.updateAlertRule(ruleId, updates);
    
    res.json({
      success: true,
      message: 'Alert rule updated',
      ruleId,
      updates
    });
  } catch (error) {
    logger.error('Error updating alert rule:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/health/system
 * Get overall system health status
 */
router.get('/health/system', async (req, res) => {
  try {
    const resilienceService = getCallResilienceService();
    const monitoringService = getCallMonitoringService();
    
    const serviceHealth = resilienceService.getServiceHealth();
    const monitoringStats = monitoringService.getMonitoringStats();
    
    const overallHealthy = Object.values(serviceHealth).every(status => status);
    
    res.json({
      status: overallHealthy ? 'healthy' : 'degraded',
      services: serviceHealth,
      monitoring: monitoringStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting system health:', error);
    res.status(500).json({
      status: 'error',
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;