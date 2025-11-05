import Call from '../models/Call';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import logger from '../utils/logger';
import mongoose from 'mongoose';

export interface UnifiedCallMetrics {
  totalCalls: number;
  completedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageDuration: number;
  totalDuration: number;
  successRate: number;
  conversionRate: number;
  negativeRate: number;
  outcomes: Record<string, number>;
}

export interface CallTimelineData {
  date: string;
  totalCalls: number;
  completedCalls: number;
  successfulCalls: number;
  averageDuration: number;
}

export interface DashboardOverview {
  stats: {
    campaigns: number;
    leads: number;
    calls: number;
    successfulCalls: number;
    conversionRate: number;
    callsToday: number;
    averageDuration: number;
  };
  recentActivity: {
    calls: any[];
    campaigns: any[];
    upcomingCallbacks: any[];
  };
}

class UnifiedAnalyticsService {
  /**
   * Get standardized call metrics with consistent definitions
   */
  async getCallMetrics(
    startDate?: Date,
    endDate?: Date,
    campaignId?: string,
    userId?: string
  ): Promise<UnifiedCallMetrics> {
    try {
      // Build query with consistent field names
      const matchCriteria: any = {};
      
      // Use createdAt for consistent date filtering across all endpoints
      if (startDate || endDate) {
        matchCriteria.createdAt = {};
        if (startDate) matchCriteria.createdAt.$gte = startDate;
        if (endDate) matchCriteria.createdAt.$lte = endDate;
      }
      
      if (campaignId) {
        matchCriteria.campaignId = new mongoose.Types.ObjectId(campaignId);
      }

      // Aggregate call data with standardized definitions
      const analytics = await Call.aggregate([
        { $match: matchCriteria },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            
            // Completed calls: status is 'completed'
            completedCalls: { 
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
            },
            
            // Successful calls: completed AND positive outcome
            successfulCalls: {
              $sum: { 
                $cond: [
                  { 
                    $and: [
                      { $eq: ["$status", "completed"] },
                      { $in: ["$outcome", ["positive", "interested", "callback", "callback-requested", "successful", "connected"]] }
                    ]
                  }, 
                  1, 
                  0
                ] 
              }
            },
            
            // Failed calls: status is 'failed'
            failedCalls: { 
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] }
            },
            
            // Only count duration for completed calls
            totalDuration: { 
              $sum: { 
                $cond: [
                  { $eq: ["$status", "completed"] },
                  { $ifNull: ["$duration", 0] },
                  0
                ]
              }
            },
            
            // Count negative outcomes
            negativeOutcomes: {
              $sum: { 
                $cond: [
                  { 
                    $and: [
                      { $eq: ["$status", "completed"] },
                      { $in: ["$outcome", ["not-interested", "do-not-call", "hostile"]] }
                    ]
                  }, 
                  1, 
                  0
                ] 
              }
            },
            
            // Collect all outcomes for distribution
            allOutcomes: { $push: "$outcome" }
          }
        },
        {
          $project: {
            _id: 0,
            totalCalls: 1,
            completedCalls: 1,
            successfulCalls: 1,
            failedCalls: 1,
            totalDuration: 1,
            negativeOutcomes: 1,
            allOutcomes: 1,
            
            // Calculate average duration (only for completed calls)
            averageDuration: {
              $cond: [
                { $eq: ["$completedCalls", 0] },
                0,
                { $round: [{ $divide: ["$totalDuration", "$completedCalls"] }, 0] }
              ]
            },
            
            // Success rate: successful calls / total calls
            successRate: {
              $cond: [
                { $eq: ["$totalCalls", 0] },
                0,
                { $multiply: [{ $divide: ["$successfulCalls", "$totalCalls"] }, 100] }
              ]
            },
            
            // Conversion rate: successful calls / completed calls
            conversionRate: {
              $cond: [
                { $eq: ["$completedCalls", 0] },
                0,
                { $multiply: [{ $divide: ["$successfulCalls", "$completedCalls"] }, 100] }
              ]
            },
            
            // Negative rate: negative outcomes / completed calls
            negativeRate: {
              $cond: [
                { $eq: ["$completedCalls", 0] },
                0,
                { $multiply: [{ $divide: ["$negativeOutcomes", "$completedCalls"] }, 100] }
              ]
            }
          }
        }
      ]);

      const result = analytics.length > 0 ? analytics[0] : {
        totalCalls: 0,
        completedCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageDuration: 0,
        totalDuration: 0,
        successRate: 0,
        conversionRate: 0,
        negativeRate: 0,
        allOutcomes: []
      };

      // Process outcome distribution
      const outcomes: Record<string, number> = {};
      if (result.allOutcomes && result.allOutcomes.length > 0) {
        result.allOutcomes.forEach((outcome: string) => {
          if (outcome) {
            outcomes[outcome] = (outcomes[outcome] || 0) + 1;
          }
        });
      }

      // Remove temporary field and add outcomes
      delete result.allOutcomes;
      result.outcomes = outcomes;

      return result;
    } catch (error) {
      logger.error('Error getting unified call metrics:', error);
      throw error;
    }
  }

  /**
   * Get call timeline data with consistent metrics
   */
  async getCallTimeline(
    startDate: Date,
    endDate: Date,
    campaignId?: string
  ): Promise<CallTimelineData[]> {
    try {
      const matchCriteria: any = {
        createdAt: { $gte: startDate, $lte: endDate }
      };
      
      if (campaignId) {
        matchCriteria.campaignId = new mongoose.Types.ObjectId(campaignId);
      }

      const callsByDay = await Call.aggregate([
        { $match: matchCriteria },
        {
          $group: {
            _id: { 
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } 
            },
            totalCalls: { $sum: 1 },
            completedCalls: { 
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
            },
            successfulCalls: {
              $sum: { 
                $cond: [
                  { 
                    $and: [
                      { $eq: ["$status", "completed"] },
                      { $in: ["$outcome", ["interested", "callback-requested", "successful"]] }
                    ]
                  }, 
                  1, 
                  0
                ] 
              }
            },
            totalDuration: { 
              $sum: { 
                $cond: [
                  { $eq: ["$status", "completed"] },
                  { $ifNull: ["$duration", 0] },
                  0
                ]
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            date: "$_id",
            totalCalls: 1,
            completedCalls: 1,
            successfulCalls: 1,
            averageDuration: {
              $cond: [
                { $eq: ["$completedCalls", 0] },
                0,
                { $round: [{ $divide: ["$totalDuration", "$completedCalls"] }, 0] }
              ]
            }
          }
        },
        { $sort: { date: 1 } }
      ]);

      return callsByDay;
    } catch (error) {
      logger.error('Error getting call timeline:', error);
      throw error;
    }
  }

  /**
   * Get dashboard overview with consistent metrics
   */
  async getDashboardOverview(userId?: string): Promise<DashboardOverview> {
    try {
      // Get counts for various entities
      const campaignQuery = userId ? { createdBy: userId } : {};
      
      // Calculate today's date range (start and end of today)
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      
      const [campaignCount, leadCount, callMetrics, callsToday] = await Promise.all([
        Campaign.countDocuments(campaignQuery),
        Lead.countDocuments({}),
        this.getCallMetrics(), // Use unified metrics
        Call.countDocuments({
          createdAt: {
            $gte: startOfToday,
            $lt: endOfToday
          }
        })
      ]);

      // Get recent calls with consistent population
      const recentCalls = await Call.find()
        .sort({ createdAt: -1 })  // Use createdAt consistently
        .limit(5)
        .populate('leadId', 'name phoneNumber')
        .populate('campaignId', 'name');
        
      // Get upcoming callbacks (scheduled calls)
      const upcomingCallbacks = await Call.find({
        status: 'scheduled',
        scheduledAt: { $gte: new Date() } // Only future scheduled calls
      })
        .sort({ scheduledAt: 1 }) // Sort by earliest first
        .limit(5)
        .populate('leadId', 'name phoneNumber')
        .populate('campaignId', 'name');
        
      // Get active campaigns
      const activeCampaigns = await Campaign.find(campaignQuery)
        .sort({ createdAt: -1 })
        .limit(5);

      return {
        stats: {
          campaigns: campaignCount,
          leads: leadCount,
          calls: callMetrics.totalCalls,
          successfulCalls: callMetrics.successfulCalls,
          conversionRate: callMetrics.conversionRate,
          callsToday: callsToday,
          averageDuration: callMetrics.averageDuration
        },
        recentActivity: {
          calls: recentCalls,
          campaigns: activeCampaigns,
          upcomingCallbacks: upcomingCallbacks
        }
      };
    } catch (error) {
      logger.error('Error getting dashboard overview:', error);
      throw error;
    }
  }

  /**
   * Get call history with consistent filtering and population
   */
  async getCallHistory(options: {
    page?: number;
    limit?: number;
    status?: string;
    campaignId?: string;
    leadId?: string;
    startDate?: Date;
    endDate?: Date;
    outcome?: string;
  }) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        campaignId,
        leadId,
        startDate,
        endDate,
        outcome
      } = options;

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      // Build query with consistent field names
      const query: any = {};

      if (status) query.status = status;
      if (campaignId) query.campaignId = campaignId;
      if (leadId) query.leadId = leadId;
      if (outcome) query.outcome = outcome;

      // Use createdAt for consistent date filtering
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      // Execute query with consistent population
      const calls = await Call.find(query)
        .sort({ createdAt: -1 })  // Use createdAt consistently
        .skip(skip)
        .limit(limitNum)
        .populate('leadId', 'name phoneNumber company')
        .populate('campaignId', 'name');

      // Get total count for pagination
      const total = await Call.countDocuments(query);

      return {
        calls,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      };
    } catch (error) {
      logger.error('Error getting call history:', error);
      throw error;
    }
  }
  async getSystemHealth() {
    try {
      const callsInLastHour = await Call.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      });

      const activeConversations = await Call.countDocuments({ status: "in-progress" });

      const queuedCalls = await Call.countDocuments({ status: "queued" });

      return {
        cpuUsage: process.cpuUsage().user / 1000000,
        memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        callsInLastHour,
        activeConversations,
        queuedCalls,
        systemStatus: "healthy",
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error("Error getting system health:", error);
      throw error;
    }
  }
}

export const unifiedAnalyticsService = new UnifiedAnalyticsService();
