import { FastifyRequest, FastifyReply } from 'fastify';
// callAnalyticsService removed - using unifiedAnalyticsService instead
import { unifiedAnalyticsService } from '../services/unifiedAnalyticsService';
import logger from '../utils/logger';

/**
 * Get call timeline metrics
 */
export const getCallTimeline = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { startDate, endDate, campaignId } = req.query as any;
    
    // Using unifiedAnalyticsService (interval parameter not supported)
    const timeline = await unifiedAnalyticsService.getCallTimeline(
      startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate ? new Date(endDate) : new Date(),
      campaignId
    );
    
    reply.send({
      success: true,
      data: timeline
    });
  } catch (error) {
    logger.error('Error getting call timeline:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve call timeline data'
    });
  }
};

/**
 * Get campaign performance metrics
 * TODO: Implement this method in unifiedAnalyticsService
 */
export const getCampaignPerformance = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    // Method not available in unifiedAnalyticsService - return placeholder
    reply.code(501).send({
      success: false,
      error: 'Campaign performance metrics endpoint not yet implemented'
    });
  } catch (error) {
    logger.error('Error getting campaign performance:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve campaign performance data'
    });
  }
};

/**
 * Get call distribution metrics
 * TODO: Implement this method in unifiedAnalyticsService
 */
export const getCallDistribution = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    // Method not available in unifiedAnalyticsService - return placeholder
    reply.code(501).send({
      success: false,
      error: 'Call distribution metrics endpoint not yet implemented'
    });
  } catch (error) {
    logger.error('Error getting call distribution:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve call distribution data'
    });
  }
};

/**
 * Get conversation metrics
 * TODO: Implement this method in unifiedAnalyticsService
 */
export const getConversationMetrics = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    // Method not available in unifiedAnalyticsService - return placeholder
    reply.code(501).send({
      success: false,
      error: 'Conversation metrics endpoint not yet implemented'
    });
  } catch (error) {
    logger.error('Error getting conversation metrics:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve conversation metrics data'
    });
  }
};

/**
 * Get detailed metrics for a specific call
 * TODO: Implement this method in unifiedAnalyticsService
 */
export const getDetailedCallMetrics = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const { id } = req.params as any;
  try {
    // Method not available in unifiedAnalyticsService - return placeholder
    reply.code(501).send({
      success: false,
      error: 'Detailed call metrics endpoint not yet implemented'
    });
  } catch (error) {
    logger.error(`Error getting detailed metrics for call ${id}:`, error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve detailed call metrics'
    });
  }
};

/**
 * Get system health and monitoring metrics
 */
export const getSystemHealth = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    // This would use the callMonitoring service to get system health
    // For now, we'll return a mock response
    const health = {
      cpuUsage: process.cpuUsage().user / 1000000,
      memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      callsInLastHour: 42,
      activeConversations: 5,
      queuedCalls: 12,
      systemStatus: 'healthy',
      lastUpdated: new Date()
    };
    
    reply.send({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error getting system health:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve system health data'
    });
  }
};

/**
 * Get unified call metrics for analytics page
 */
export const getUnifiedCallMetrics = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { startDate, endDate, campaignId } = req.query as any;
    
    // Use unified analytics service for consistent metrics
    const [metrics, timeline] = await Promise.all([
      unifiedAnalyticsService.getCallMetrics(startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate ? new Date(endDate) : new Date(), campaignId),
      unifiedAnalyticsService.getCallTimeline(startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate ? new Date(endDate) : new Date(), campaignId)
    ]);
    
    reply.send({
      success: true,
      data: {
        summary: metrics,
        timeline
      }
    });
  } catch (error) {
    logger.error('Error getting unified call metrics:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve unified call metrics'
    });
  }
};