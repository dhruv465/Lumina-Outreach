/**
 * Call Health API Routes
 * 
 * Provides REST API endpoints for accessing call health monitoring data,
 * resilience metrics, and system status information.
 */

import { FastifyInstance } from 'fastify';
import { getCallResilienceService } from '../services/callResilienceService';
import { getCallMonitoringService } from '../services/callMonitoringService';
import { getFallbackTTSService } from '../services/fallbackTTSService';
import logger from '../utils/logger';

const healthRoutes = async (fastify, opts: Record<string, any>) => {
  /**
   * GET /api/calls/:callId/health
   * Get comprehensive health status for a specific call
   */
  fastify.get('/:callId/health', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      
      const monitoringService = getCallMonitoringService();
      const health = monitoringService.getCallHealth(callId);
      
      if (!health) {
        return reply.code(404).send({
          error: 'Call not found or not being monitored',
          callId
        });
      }
      
      reply.send(health);
    } catch (error) {
      logger.error('Error getting call health:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/calls/:callId/resilience
   * Get resilience status for a specific call
   */
  fastify.get('/:callId/resilience', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      
      const resilienceService = getCallResilienceService();
      const status = resilienceService.getCallStatus(callId);
      
      if (!status) {
        return reply.code(404).send({
          error: 'Call not found in resilience monitoring',
          callId
        });
      }
      
      reply.send(status);
    } catch (error) {
      logger.error('Error getting call resilience status:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/monitoring/overview
   * Get system-wide monitoring overview
   */
  fastify.get('/monitoring/overview', async (request, reply) => {
    try {
      const monitoringService = getCallMonitoringService();
      const resilienceService = getCallResilienceService();
      
      const stats = monitoringService.getMonitoringStats();
      const serviceHealth = resilienceService.getServiceHealth();
      const allCalls = monitoringService.getAllCallsHealth();
      
      reply.send({
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
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/monitoring/calls
   * Get health status for all active calls
   */
  fastify.get('/monitoring/calls', async (request, reply) => {
    try {
      const monitoringService = getCallMonitoringService();
      const calls = monitoringService.getAllCallsHealth();
      
      // Filter and sort based on query parameters
      const { status, limit = '50', offset = '0' } = request.query as any;
      
      let filtered = calls;
      if (status && typeof status === 'string') {
        filtered = calls.filter(call => call.overall === status);
      }
      
      const startIndex = parseInt(offset as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const paginated = filtered.slice(startIndex, startIndex + limitNum);
      
      reply.send({
        calls: paginated,
        total: filtered.length,
        offset: startIndex,
        limit: limitNum
      });
    } catch (error) {
      logger.error('Error getting all calls health:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/calls/:callId/issues/:issueId/resolve
   * Mark a specific issue as resolved
   */
  fastify.post('/:callId/issues/:issueId/resolve', async (request, reply) => {
    try {
      const { callId, issueId } = request.params as any;
      
      const monitoringService = getCallMonitoringService();
      monitoringService.resolveIssue(callId, issueId);
      
      reply.send({
        success: true,
        message: 'Issue marked as resolved',
        callId,
        issueId
      });
    } catch (error) {
      logger.error('Error resolving issue:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/calls/:callId/actions/fallback
   * Manually activate fallback mode for a call
   */
  fastify.post('/:callId/actions/fallback', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      const { reason = 'Manual activation' } = request.body as any;
      
      const resilienceService = getCallResilienceService();
      resilienceService.activateFallback(callId, reason);
      
      reply.send({
        success: true,
        message: 'Fallback mode activated',
        callId,
        reason
      });
    } catch (error) {
      logger.error('Error activating fallback:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/calls/:callId/actions/deactivate-fallback
   * Manually deactivate fallback mode for a call
   */
  fastify.post('/:callId/actions/deactivate-fallback', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      
      const resilienceService = getCallResilienceService();
      resilienceService.deactivateFallback(callId);
      
      reply.send({
        success: true,
        message: 'Fallback mode deactivated',
        callId
      });
    } catch (error) {
      logger.error('Error deactivating fallback:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/fallback/tts/test/:callId
   * Test fallback TTS capabilities
   */
  fastify.get('/fallback/tts/test/:callId', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      
      const fallbackTTS = getFallbackTTSService();
      const results = await fallbackTTS.testFallbacks(callId);
      
      reply.send({
        callId,
        fallbackCapabilities: results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error testing fallback TTS:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/fallback/tts/cache/stats
   * Get TTS fallback cache statistics
   */
  fastify.get('/fallback/tts/cache/stats', async (request, reply) => {
    try {
      const fallbackTTS = getFallbackTTSService();
      const stats = fallbackTTS.getCacheStats();
      
      reply.send(stats);
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/fallback/tts/cache
   * Clear TTS fallback cache
   */
  fastify.delete('/fallback/tts/cache', async (request, reply) => {
    try {
      const fallbackTTS = getFallbackTTSService();
      fallbackTTS.clearCache();
      
      reply.send({
        success: true,
        message: 'TTS fallback cache cleared'
      });
    } catch (error) {
      logger.error('Error clearing cache:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/fallback/tts/messages
   * Get available prerecorded messages
   */
  fastify.get('/fallback/tts/messages', async (request, reply) => {
    try {
      const fallbackTTS = getFallbackTTSService();
      const messages = fallbackTTS.getPrerecordedMessages();
      
      reply.send(messages);
    } catch (error) {
      logger.error('Error getting prerecorded messages:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/monitoring/alerts/rules
   * Get all monitoring alert rules
   */
  fastify.get('/monitoring/alerts/rules', async (request, reply) => {
    try {
      const monitoringService = getCallMonitoringService();
      
      // Access the alert rules (we'll need to add a getter method)
      // For now, return a placeholder response
      reply.send({
        rules: [],
        message: 'Alert rules endpoint - implementation needed'
      });
    } catch (error) {
      logger.error('Error getting alert rules:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/monitoring/alerts/rules
   * Add a new monitoring alert rule
   */
  fastify.post('/monitoring/alerts/rules', async (request, reply) => {
    try {
      const monitoringService = getCallMonitoringService();
      const rule = request.body as any;
      
      // Validate rule structure
      if (!rule.id || !rule.name || !rule.condition || !rule.severity) {
        return reply.code(400).send({
          error: 'Invalid rule structure',
          required: ['id', 'name', 'condition', 'severity']
        });
      }
      
      monitoringService.addAlertRule(rule);
      
      reply.send({
        success: true,
        message: 'Alert rule added',
        rule
      });
    } catch (error) {
      logger.error('Error adding alert rule:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/monitoring/alerts/rules/:ruleId
   * Remove a monitoring alert rule
   */
  fastify.delete('/monitoring/alerts/rules/:ruleId', async (request, reply) => {
    try {
      const { ruleId } = request.params as any;
      
      const monitoringService = getCallMonitoringService();
      monitoringService.removeAlertRule(ruleId);
      
      reply.send({
        success: true,
        message: 'Alert rule removed',
        ruleId
      });
    } catch (error) {
      logger.error('Error removing alert rule:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PUT /api/monitoring/alerts/rules/:ruleId
   * Update a monitoring alert rule
   */
  fastify.put('/monitoring/alerts/rules/:ruleId', async (request, reply) => {
    try {
      const { ruleId } = request.params as any;
      const updates = request.body;
      
      const monitoringService = getCallMonitoringService();
      monitoringService.updateAlertRule(ruleId, updates);
      
      reply.send({
        success: true,
        message: 'Alert rule updated',
        ruleId,
        updates
      });
    } catch (error) {
      logger.error('Error updating alert rule:', error);
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/health/system
   * Get overall system health status
   */
  fastify.get('/health/system', async (request, reply) => {
    try {
      const resilienceService = getCallResilienceService();
      const monitoringService = getCallMonitoringService();
      
      const serviceHealth = resilienceService.getServiceHealth();
      const monitoringStats = monitoringService.getMonitoringStats();
      
      const overallHealthy = Object.values(serviceHealth).every(status => status);
      
      reply.send({
        status: overallHealthy ? 'healthy' : 'degraded',
        services: serviceHealth,
        monitoring: monitoringStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error getting system health:', error);
      reply.code(500).send({
        status: 'error',
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
};

export default healthRoutes;