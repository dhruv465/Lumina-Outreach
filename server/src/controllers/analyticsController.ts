import { FastifyRequest, FastifyReply } from 'fastify';
import Campaign from '../models/Campaign';
import mongoose from 'mongoose';
import Call from '../models/Call';
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
    const { campaignId } = req.query as any;

    const callMetrics = await unifiedAnalyticsService.getCallMetrics(undefined, undefined, campaignId);

    const campaignMetrics = await Campaign.aggregate([
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          activeCampaigns: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          completedCampaigns: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
    ]);

    const result = {
      ...callMetrics,
      ...(campaignMetrics.length > 0 ? campaignMetrics[0] : {}),
    };

    reply.send({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting campaign performance:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve campaign performance data',
    });
  }
};

/**
 * Get call distribution metrics
 * TODO: Implement this method in unifiedAnalyticsService
 */
export const getCallDistribution = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { campaignId } = req.query as any;

    const callMetrics = await unifiedAnalyticsService.getCallMetrics(undefined, undefined, campaignId);

    const result = {
      byStatus: {
        completed: callMetrics.completedCalls,
        failed: callMetrics.failedCalls,
        other: callMetrics.totalCalls - callMetrics.completedCalls - callMetrics.failedCalls,
      },
      byOutcome: callMetrics.outcomes,
    };

    reply.send({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting call distribution:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve call distribution data',
    });
  }
};

/**
 * Get conversation metrics
 * TODO: Implement this method in unifiedAnalyticsService
 */
export const getConversationMetrics = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const { campaignId } = req.query as any;

    const matchCriteria: any = {};
    if (campaignId) {
      matchCriteria.campaignId = new mongoose.Types.ObjectId(campaignId);
    }

    const conversationMetrics = await Call.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          totalConversations: { $sum: 1 },
          totalMessages: { $sum: { $size: "$conversationLog" } },
          totalDuration: { $sum: "$duration" },
        },
      },
      {
        $project: {
          _id: 0,
          totalConversations: 1,
          averageMessagesPerConversation: {
            $cond: [
              { $eq: ["$totalConversations", 0] },
              0,
              { $divide: ["$totalMessages", "$totalConversations"] },
            ],
          },
          averageConversationDuration: {
            $cond: [
              { $eq: ["$totalConversations", 0] },
              0,
              { $divide: ["$totalDuration", "$totalConversations"] },
            ],
          },
        },
      },
    ]);

    const result = conversationMetrics.length > 0 ? conversationMetrics[0] : {};

    reply.send({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting conversation metrics:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to retrieve conversation metrics data',
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
    const call = await Call.findById(id);

    if (!call) {
      reply.code(404).send({
        success: false,
        error: "Call not found",
      });
      return;
    }

    reply.send({
      success: true,
      data: call.metrics,
    });
  } catch (error) {
    logger.error(`Error getting detailed metrics for call ${id}:`, error);
    reply.code(500).send({
      success: false,
      error: "Failed to retrieve detailed call metrics",
    });
  }
};

/**
 * Get system health and monitoring metrics
 */
export const getSystemHealth = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    const health = await unifiedAnalyticsService.getSystemHealth();
    
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