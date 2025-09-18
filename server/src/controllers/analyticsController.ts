import { FastifyRequest, FastifyReply } from 'fastify';
import { callAnalyticsService } from '../services';
import { unifiedAnalyticsService } from '../services/unifiedAnalyticsService';
import logger from '../utils/logger';

/**
 * Get call timeline metrics
 */
export const getCallTimeline = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { startDate, endDate, interval, campaignId } = req.query as any;
    
    const timeline = await callAnalyticsService.getCallTimeline(
      startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate ? new Date(endDate) : new Date(),
      interval || 'day',
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
 */
export const getCampaignPerformance = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { startDate, endDate, campaignIds } = req.query as any;
    
    const performance = await callAnalyticsService.getCampaignPerformanceMetrics(
      startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate ? new Date(endDate) : new Date(),
      campaignIds ? campaignIds.split(',') : undefined
    );
    
    reply.send({
      success: true,
      data: performance
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
 */
export const getCallDistribution = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { startDate, endDate, campaignId } = req.query as any;
    
    const distribution = await callAnalyticsService.getCallDistributionMetrics(
      startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate ? new Date(endDate) : new Date(),
      campaignId
    );
    
    reply.send({
      success: true,
      data: distribution
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
 */
export const getConversationMetrics = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { startDate, endDate, campaignId } = req.query as any;
    
    const metrics = await callAnalyticsService.getConversationMetrics(
      startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate ? new Date(endDate) : new Date(),
      campaignId
    );
    
    reply.send({
      success: true,
      data: metrics
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
 */
export const getDetailedCallMetrics = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const { id } = req.params as any;
  try {
    const metrics = await callAnalyticsService.getDetailedCallMetrics(id);
    
    reply.send({
      success: true,
      data: metrics
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