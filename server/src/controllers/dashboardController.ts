import { FastifyRequest, FastifyReply } from 'fastify';
import Call from '../models/Call';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';
import { unifiedAnalyticsService } from '../services/unifiedAnalyticsService';

// @desc    Get dashboard overview
// @route   GET /api/dashboard/overview
// @access  Private
export const getDashboardOverview = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    // Use unified analytics service for consistent metrics
    const overview = await unifiedAnalyticsService.getDashboardOverview(req.user?.id);
    
    res.status(200).send(overview);
  } catch (error) {
    logger.error('Error in getDashboardOverview:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get call metrics
// @route   GET /api/dashboard/call-metrics
// @access  Private
export const getCallMetrics = async (_req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    // Use unified analytics service for consistent call metrics
    const metrics = await unifiedAnalyticsService.getCallMetrics();
    
    // Transform to expected format for backward compatibility
    const callStatusDistribution = [
      { _id: 'completed', count: metrics.completedCalls },
      { _id: 'failed', count: metrics.failedCalls },
      { _id: 'other', count: metrics.totalCalls - metrics.completedCalls - metrics.failedCalls }
    ].filter(item => item.count > 0);
    
    const callOutcomeDistribution = Object.entries(metrics.outcomes).map(([outcome, count]) => ({
      _id: outcome,
      count
    }));
    
    res.status(200).send({
      statusDistribution: callStatusDistribution,
      outcomeDistribution: callOutcomeDistribution,
      averageDuration: metrics.averageDuration
    });
  } catch (error) {
    logger.error('Error in getCallMetrics:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get lead metrics
// @route   GET /api/dashboard/lead-metrics
// @access  Private
export const getLeadMetrics = async (_req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    // Get lead source distribution
    const leadSourceDistribution = await Lead.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    
    // Get lead status distribution
    const leadStatusDistribution = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    // Get conversion by source
    const leadConversionBySource = await Lead.aggregate([
      { $match: { status: 'Converted' } },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    
    res.status(200).send({
      sourceDistribution: leadSourceDistribution,
      statusDistribution: leadStatusDistribution,
      conversionBySource: leadConversionBySource
    });
  } catch (error) {
    logger.error('Error in getLeadMetrics:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get agent performance metrics
// @route   GET /api/dashboard/agent-performance
// @access  Private
export const getAgentPerformance = async (_req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    // Fetch actual agent performance data from database
    const callsData = await Call.find({}).sort('-createdAt').limit(200);
    
    // Calculate performance metrics
    const totalCalls = callsData.length;
    const successfulCalls = callsData.filter(call => call.outcome === 'successful').length;
    const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;
    
    // Calculate average call time
    const totalCallTime = callsData.reduce((acc, call) => {
      return acc + (call.duration || 0);
    }, 0);
    const averageCallTime = totalCalls > 0 ? totalCallTime / totalCalls : 0;
    
    // Calculate other metrics
    const positiveResponses = callsData.filter(call => 
      call.outcome === 'interested' || call.outcome === 'successful'
    ).length;
    const positiveResponseRate = totalCalls > 0 ? positiveResponses / totalCalls : 0;
    
    const convertedLeads = await Lead.countDocuments({ status: 'converted' });
    const totalLeads = await Lead.countDocuments({});
    const leadConversionRate = totalLeads > 0 ? convertedLeads / totalLeads : 0;
    
    // Return the performance data
    const performanceData = {
      callVolume: totalCalls,
      successRate,
      averageCallTime,
      positiveResponseRate,
      leadConversionRate,
      callQualityScore: 0.85, // This would be calculated based on actual feedback data
      improvement: {
        weekOverWeek: 0, // This would be calculated by comparing with previous week's data
        monthOverMonth: 0 // This would be calculated by comparing with previous month's data
      }
    };
    
    res.status(200).send(performanceData);
  } catch (error) {
    logger.error('Error in getAgentPerformance:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get geographical distribution of calls
// @route   GET /api/dashboard/geographical
// @access  Private
export const getGeographicalDistribution = async (_req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    // Get geographical distribution from the database
    const geoData = await Call.aggregate([
      {
        $lookup: {
          from: 'leads',
          localField: 'lead',
          foreignField: '_id',
          as: 'leadData'
        }
      },
      { $unwind: '$leadData' },
      {
        $group: {
          _id: '$leadData.region',
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$outcome', 'successful'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          region: '$_id',
          count: 1,
          successRate: { $divide: ['$successful', '$count'] },
          _id: 0
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    res.status(200).send(geoData);
  } catch (error) {
    logger.error('Error in getGeographicalDistribution:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get time series data for dashboard charts
// @route   GET /api/dashboard/time-series
// @access  Private
export const getTimeSeriesData = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { metric, period = 'week' } = req.query as { metric?: string; period?: string };
    
    // Create time range based on period
    const startDate = new Date();
    const labels = [];
    
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
      
      // Generate daily labels for the past week
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
      }
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
      
      // Generate weekly labels for the past month
      for (let i = 4; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - (i * 7));
        labels.push(`Week ${i+1}`);
      }
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
      
      // Generate monthly labels for the past year
      for (let i = 11; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        labels.push(date.toLocaleDateString('en-US', { month: 'short' }));
      }
    }
    
    // Query the database for time series data based on the metric
    let data;
    
    if (metric === 'calls') {
      data = await Call.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: period === 'week' ? '%Y-%m-%d' : period === 'month' ? '%Y-%U' : '%Y-%m',
                date: '$createdAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
    } else if (metric === 'conversions') {
      data = await Call.aggregate([
        { $match: { createdAt: { $gte: startDate }, outcome: 'successful' } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: period === 'week' ? '%Y-%m-%d' : period === 'month' ? '%Y-%U' : '%Y-%m',
                date: '$createdAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
    } else {
      // Default to total calls
      data = await Call.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: period === 'week' ? '%Y-%m-%d' : period === 'month' ? '%Y-%U' : '%Y-%m',
                date: '$createdAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
    }
    
    // Format the result for the chart
    const chartData = {
      labels,
      datasets: [
        {
          label: metric || 'Calls',
          data: data.map((item: any) => item.count)
        }
      ]
    };
    
    res.status(200).send(chartData);
  } catch (error) {
    logger.error('Error in getTimeSeriesData:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Export dashboard data
// @route   GET /api/dashboard/export
// @access  Private
export const exportDashboardData = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { format = 'json' } = req.query as { format?: string };
    
    // Get basic stats
    const callCount = await Call.countDocuments();
    const leadCount = await Lead.countDocuments();
    const campaignCount = await Campaign.countDocuments({ createdBy: req.user.id });
    
    // Get call stats
    const callsByStatus = await Call.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    // Get lead stats
    const leadsByStatus = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    // Prepare export data
    const exportData = {
      generatedAt: new Date(),
      overview: {
        totalCalls: callCount,
        totalLeads: leadCount,
        totalCampaigns: campaignCount
      },
      callStats: callsByStatus,
      leadStats: leadsByStatus
    };
    
    if (format === 'json') {
      return res.status(200).send(exportData);
    } else if (format === 'csv') {
      // Convert to CSV
      let csv = 'Data Type,Category,Count\n';
      
      // Add call stats
      callsByStatus.forEach(stat => {
        csv += `Call,${stat._id},${stat.count}\n`;
      });
      
      // Add lead stats
      leadsByStatus.forEach(stat => {
        csv += `Lead,${stat._id},${stat.count}\n`;
      });
      
      // Add overview
      csv += `Overview,Total Calls,${callCount}\n`;
      csv += `Overview,Total Leads,${leadCount}\n`;
      csv += `Overview,Total Campaigns,${campaignCount}\n`;
      
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=dashboard-export.csv');
      return res.status(200).send(csv);
    } else {
      return res.status(400).send({ message: 'Unsupported export format' });
    }
  } catch (error) {
    logger.error('Error in exportDashboardData:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
    return;
  }
};

