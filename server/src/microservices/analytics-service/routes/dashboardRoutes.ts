/**
 * Dashboard Routes for Analytics Service
 * 
 * Provides real-time dashboard metrics and visualizations
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RedisClientType } from 'redis';
import { Db } from 'mongodb';
import { Server, IncomingMessage, ServerResponse } from 'http';

export function registerDashboardRoutes(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any>,
  db: Db,
  redisClient: RedisClientType
) {
  /**
   * Get real-time dashboard metrics
   */
  server.get('/dashboard/metrics', async (request, reply) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Fetch today's calls
      const calls = db.collection('calls');
      const todaysCalls = await calls.find({
        startTime: { $gte: today }
      }).toArray();
      
      // Calculate metrics
      const totalCalls = todaysCalls.length;
      const completedCalls = todaysCalls.filter(call => call.status === 'completed').length;
      const failedCalls = todaysCalls.filter(call => call.status === 'failed').length;
      const avgDuration = todaysCalls.length > 0 
        ? todaysCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / todaysCalls.length 
        : 0;
      
      // Calculate conversion rate
      const leads = db.collection('leads');
      const convertedLeads = await leads.countDocuments({
        lastCallTime: { $gte: today },
        status: 'converted'
      });
      
      const conversionRate = totalCalls > 0 ? (convertedLeads / totalCalls) * 100 : 0;
      
      // Calculate average call quality score
      const avgQualityScore = todaysCalls.length > 0
        ? todaysCalls.reduce((sum, call) => sum + (call.qualityScore || 0), 0) / todaysCalls.length
        : 0;
      
      // Get active calls from Redis
      const activeCalls = await redisClient.hGetAll('active_calls');
      const activeCallsCount = Object.keys(activeCalls).length;
      
      // Return metrics
      return {
        realTime: {
          activeCalls: activeCallsCount,
          lastUpdated: new Date()
        },
        today: {
          totalCalls,
          completedCalls,
          failedCalls,
          avgDuration: Math.round(avgDuration),
          conversionRate: parseFloat(conversionRate.toFixed(2)),
          avgQualityScore: parseFloat(avgQualityScore.toFixed(2))
        }
      };
    } catch (error) {
      server.log.error(`Error fetching dashboard metrics: ${error}`);
      reply.code(500).send({ error: 'Failed to fetch dashboard metrics' });
    }
  });

  /**
   * Get hourly call distribution for the current day
   */
  server.get('/dashboard/hourly', async (request, reply) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get calls collection
      const calls = db.collection('calls');
      
      // Aggregate calls by hour
      const hourlyDistribution = await calls.aggregate([
        {
          $match: {
            startTime: { $gte: today }
          }
        },
        {
          $group: {
            _id: { $hour: '$startTime' },
            count: { $sum: 1 },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
              }
            }
          }
        },
        {
          $sort: { '_id': 1 }
        }
      ]).toArray();
      
      // Format for 24-hour time series
      const hourlyData = Array(24).fill(0).map((_, hour) => {
        const hourData = hourlyDistribution.find(item => item._id === hour);
        return {
          hour,
          calls: hourData ? hourData.count : 0,
          successful: hourData ? hourData.successCount : 0
        };
      });
      
      return hourlyData;
    } catch (error) {
      server.log.error(`Error fetching hourly distribution: ${error}`);
      reply.code(500).send({ error: 'Failed to fetch hourly distribution' });
    }
  });

  /**
   * Get real-time active calls with metrics
   */
  server.get('/dashboard/active-calls', async (request, reply) => {
    try {
      // Get active calls from Redis
      const activeCalls = await redisClient.hGetAll('active_calls');
      
      if (!activeCalls || Object.keys(activeCalls).length === 0) {
        return [];
      }
      
      // Process active calls
      const activeCallsData = Object.entries(activeCalls).map(([callId, callData]) => {
        const call = JSON.parse(callData as string);
        
        return {
          callId,
          startTime: call.startTime,
          duration: call.duration,
          agentName: call.agentName,
          customerName: call.customerName,
          phoneNumber: call.phoneNumber,
          status: call.status,
          metrics: {
            latency: call.metrics?.latency || 0,
            interruptions: call.metrics?.interruptions || 0,
            customerEngagement: call.metrics?.customerEngagement || 0,
            scriptAdherence: call.metrics?.scriptAdherence || 0,
            conversationQuality: call.metrics?.conversationQuality || 0
          },
          currentEmotion: call.sentiment?.current || 'neutral',
          lastUpdated: call.lastUpdated
        };
      });
      
      return activeCallsData;
    } catch (error) {
      server.log.error(`Error fetching active calls: ${error}`);
      reply.code(500).send({ error: 'Failed to fetch active calls' });
    }
  });

  /**
   * Get overview stats for the dashboard
   */
  server.get('/dashboard/overview', async (request, reply) => {
    try {
      const { timeframe = '7d' } = request.query as any;
      
      // Determine date range based on timeframe
      const startDate = new Date();
      switch (timeframe) {
        case '1d':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        default:
          startDate.setDate(startDate.getDate() - 7);
      }
      
      // Get collections
      const calls = db.collection('calls');
      const campaigns = db.collection('campaigns');
      const leads = db.collection('leads');
      
      // Get counts
      const [callsCount, campaignsCount, leadsCount, completedCallsCount, convertedLeadsCount] = await Promise.all([
        calls.countDocuments({ startTime: { $gte: startDate } }),
        campaigns.countDocuments({ createdAt: { $gte: startDate } }),
        leads.countDocuments({ createdAt: { $gte: startDate } }),
        calls.countDocuments({ startTime: { $gte: startDate }, status: 'completed' }),
        leads.countDocuments({ 
          createdAt: { $gte: startDate }, 
          status: 'converted' 
        })
      ]);
      
      // Get recent activities
      const recentCalls = await calls.find()
        .sort({ startTime: -1 })
        .limit(5)
        .toArray();
        
      const recentCampaigns = await campaigns.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();
      
      // Calculate conversion rate
      const conversionRate = completedCallsCount > 0 
        ? (convertedLeadsCount / completedCallsCount) * 100 
        : 0;
      
      return {
        timeframe,
        stats: {
          calls: callsCount,
          campaigns: campaignsCount,
          leads: leadsCount,
          completedCalls: completedCallsCount,
          conversionRate: parseFloat(conversionRate.toFixed(2))
        },
        recentActivity: {
          calls: recentCalls,
          campaigns: recentCampaigns
        }
      };
    } catch (error) {
      server.log.error(`Error fetching dashboard overview: ${error}`);
      reply.code(500).send({ error: 'Failed to fetch dashboard overview' });
    }
  });
}
