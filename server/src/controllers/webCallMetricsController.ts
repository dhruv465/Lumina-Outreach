import { Request, Response } from 'express';
import WebCallTest from '../models/WebCallTest';
import Call from '../models/Call';
import Campaign from '../models/Campaign';

/**
 * Get web call test metrics
 * Returns metrics for web call tests within the specified time range
 */
export const getWebCallMetrics = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { timeRange = '24h' } = req.query;
    
    // Calculate date range based on timeRange parameter
    const now = new Date();
    let startDate = new Date();
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '24h':
      default:
        startDate.setDate(now.getDate() - 1);
        break;
    }
    
    // Fetch web call tests within the date range
    const tests = await WebCallTest.find({
      createdAt: { $gte: startDate }
    })
    .sort({ createdAt: -1 })
    .populate('campaignId', 'name')
    .lean();
    
    // Transform data to include campaign name
    const formattedTests = tests.map(test => ({
      testId: test._id,
      campaignId: test.campaignId,
      campaignName: (test.campaignId as any).name,
      startTime: test.startTime,
      endTime: test.endTime,
      duration: test.duration,
      metrics: test.metrics,
      status: test.status
    }));
    
    return res.status(200).json({
      success: true,
      tests: formattedTests
    });
  } catch (error) {
    console.error('Error fetching web call metrics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch web call metrics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get campaign performance comparison
 * Compares metrics between web calls and real calls for each campaign
 */
export const getCampaignComparison = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { timeRange = '24h' } = req.query;
    
    // Calculate date range based on timeRange parameter
    const now = new Date();
    let startDate = new Date();
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '24h':
      default:
        startDate.setDate(now.getDate() - 1);
        break;
    }
    
    // Get all active campaigns
    const campaigns = await Campaign.find({
      status: { $in: ['Active', 'Draft', 'Paused'] }
    }).lean();
    
    // For each campaign, get web call and real call metrics
    const campaignPerformance = await Promise.all(
      campaigns.map(async (campaign) => {
        // Get web call tests for this campaign
        const webCallTests = await WebCallTest.find({
          campaignId: campaign._id,
          createdAt: { $gte: startDate }
        }).lean();
        
        // Get real calls for this campaign
        const realCalls = await Call.find({
          campaignId: campaign._id,
          createdAt: { $gte: startDate }
        }).lean();
        
        // Calculate web call metrics
        const webCallCount = webCallTests.length;
        const webCallAvgResponseTime = webCallTests.length > 0
          ? webCallTests.reduce((sum, test) => sum + (test.metrics?.responseTime?.avg || 0), 0) / webCallTests.length
          : 0;
        const webCallAvgDuration = webCallTests.length > 0
          ? webCallTests.reduce((sum, test) => sum + (test.duration || 0), 0) / webCallTests.length
          : 0;
        const webCallSuccessRate = webCallTests.length > 0
          ? (webCallTests.filter(test => test.status === 'completed').length / webCallTests.length) * 100
          : 0;
        
        // Calculate real call metrics
        const realCallCount = realCalls.length;
        const realCallAvgResponseTime = realCalls.length > 0
          ? realCalls.reduce((sum, call) => sum + ((call.metrics as any)?.responseTime?.avg || 0), 0) / realCalls.length
          : 0;
        const realCallAvgDuration = realCalls.length > 0
          ? realCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / realCalls.length
          : 0;
        const realCallSuccessRate = realCalls.length > 0
          ? (realCalls.filter(call => call.status === 'completed').length / realCalls.length) * 100
          : 0;
        
        return {
          campaignId: campaign._id,
          campaignName: campaign.name,
          webCallCount,
          realCallCount,
          webCallAvgResponseTime,
          realCallAvgResponseTime,
          webCallAvgDuration,
          realCallAvgDuration,
          webCallSuccessRate,
          realCallSuccessRate
        };
      })
    );
    
    // Filter out campaigns with no data
    const filteredCampaignPerformance = campaignPerformance.filter(
      campaign => campaign.webCallCount > 0 || campaign.realCallCount > 0
    );
    
    return res.status(200).json({
      success: true,
      campaigns: filteredCampaignPerformance
    });
  } catch (error) {
    console.error('Error fetching campaign comparison:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign comparison',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};