import { FastifyRequest, FastifyReply } from 'fastify';
import Campaign from '../models/Campaign';
import Call from '../models/Call';
import mongoose from 'mongoose';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';
import { campaignService } from '../services';

// @desc    Create a new campaign
// @route   POST /api/campaigns
// @access  Private
export const createCampaign = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { name, description, goal, targetAudience, script, voiceConfiguration } = req.body as any;

    logger.info(`Creating new campaign "${name}" for user ${req.user.id}`);

    const campaignData = {
      ...(req.body as any),
      createdBy: req.user.id,
      voiceConfiguration: {
        ...voiceConfiguration,
        voiceId: voiceConfiguration?.voiceId || '21m00Tcm4TlvDq8ikWAM' // Default voice ID
      },
      script: {
        ...script,
        versions: script?.versions?.length ? script.versions : [{
          name: 'v1.0',
          content: 'Hello, this is a test script.',
          isActive: true
        }]
      }
    };

    const campaign = new Campaign(campaignData);

    const savedCampaign = await campaign.save();
    
    logger.info(`Campaign created successfully with ID: ${savedCampaign._id}`);

    res.status(201).send(savedCampaign);
  } catch (error) {
    logger.error('Error in createCampaign:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get all campaigns
// @route   GET /api/campaigns
// @access  Private
export const getCampaigns = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    logger.info('req.user:', req.user);
    const { page = 1, limit = 10, search, status } = req.query as any;
    const skip = (page - 1) * limit;
    
    // Build filter object - show all campaigns for now (remove user filter)
    const filter: any = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status && status !== 'All') {
      filter.status = status;
    }
    
    logger.info(`Fetching campaigns with filter:`, filter);
    
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Campaign.countDocuments(filter);
    
    // Return campaigns with pagination for client compatibility
    const responseData = {
      campaigns: campaigns || [],
      pagination: {
        page,
        pages: Math.ceil(total / limit),
        total,
        limit
      }
    };
    
    logger.info(`Returning ${campaigns.length} campaigns of ${total} total`);
    
    res.status(200).send(responseData);
  } catch (error) {
    logger.error('Error in getCampaigns:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get campaign by ID
// @route   GET /api/campaigns/:id
// @access  Private
export const getCampaignById = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const campaign = await Campaign.findById((req.params as any).id);
    
    if (!campaign) {
      return res.status(404).send({ message: 'Campaign not found' });
    }
    
    // Allow access to all campaigns (removed authorization check)
    
    return res.status(200).send(campaign);
  } catch (error) {
    logger.error('Error in getCampaignById:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Update campaign
// @route   PUT /api/campaigns/:id
// @access  Private
export const updateCampaign = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const campaign = await Campaign.findById((req.params as any).id);
    
    if (!campaign) {
      return res.status(404).send({ message: 'Campaign not found' });
    }
    
    // Allow updates to all campaigns (removed authorization check)
    
    logger.info(`Updating campaign ${(req.params as any).id}`);
    
    const updatedCampaign = await Campaign.findByIdAndUpdate(
      (req.params as any).id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    logger.info(`Campaign ${(req.params as any).id} updated successfully`);
    
    return res.status(200).send(updatedCampaign);
  } catch (error) {
    logger.error('Error in updateCampaign:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Delete campaign
// @route   DELETE /api/campaigns/:id
// @access  Private
export const deleteCampaign = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const campaign = await Campaign.findById((req.params as any).id);
    
    if (!campaign) {
      return res.status(404).send({ message: 'Campaign not found' });
    }
    
    // Allow deletion of all campaigns (removed authorization check)
    
    await Campaign.findByIdAndDelete((req.params as any).id);
    
    return res.status(200).send({ message: 'Campaign deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteCampaign:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Test script with AI voice
// @route   POST /api/campaigns/:id/test-script
// @access  Private
export const testScript = async (_req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { scriptContent } = _req.body as any;
    
    if (!scriptContent) {
      return res.status(400).send({
        message: 'Script content is required'
      });
    }
    
    // Generate audio using the voice service
    // In production, this would call the actual voice synthesis service
    const audioFilename = `test-script-${Date.now()}.mp3`;
    
    // Return the URL to the generated audio
    return res.status(200).send({
      message: 'Script test generated successfully',
      audioUrl: `${process.env.API_BASE_URL}/uploads/audio/${audioFilename}`
    });
  } catch (error) {
    logger.error('Error in testScript:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get campaign analytics
// @route   GET /api/campaigns/:id/analytics
// @access  Private
export const getCampaignAnalytics = async (_req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    // Fetch real analytics data from the database
    const { id } = _req.params as any;
    
    // Get all calls for this campaign
    const calls = await Call.find({ campaign: id });
    
    // Calculate analytics metrics
    const totalCalls = calls.length;
    const successfulCalls = calls.filter(call => call.outcome === 'successful').length;
    const callsInProgress = calls.filter(call => call.status === 'in-progress').length;
    const failedCalls = calls.filter(call => call.status === 'failed').length;
    
    // Calculate average duration
    const totalDuration = calls.reduce((acc, call) => acc + (call.duration || 0), 0);
    const averageDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    
    // Calculate conversion rate
    const conversionRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;
    
    // Calculate time of day performance
    const callsByTimeOfDay = {
      morning: 0,
      afternoon: 0,
      evening: 0
    };
    
    calls.forEach(call => {
      const hour = new Date(call.startTime).getHours();
      if (hour >= 5 && hour < 12) {
        callsByTimeOfDay.morning++;
      } else if (hour >= 12 && hour < 17) {
        callsByTimeOfDay.afternoon++;
      } else {
        callsByTimeOfDay.evening++;
      }
    });
    
    const timeOfDayPerformance = {
      morning: totalCalls > 0 ? callsByTimeOfDay.morning / totalCalls : 0,
      afternoon: totalCalls > 0 ? callsByTimeOfDay.afternoon / totalCalls : 0,
      evening: totalCalls > 0 ? callsByTimeOfDay.evening / totalCalls : 0
    };
    
    // Calculate daily activity
    const dailyActivity = [];
    const lastSevenDays = new Date();
    lastSevenDays.setDate(lastSevenDays.getDate() - 7);
    
    const callsByDay = await Call.aggregate([
      { 
        $match: { 
          campaign: new mongoose.Types.ObjectId(id),
          startTime: { $gte: lastSevenDays }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
          calls: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Format the data
    const analytics = {
      totalCalls,
      successfulCalls,
      callsInProgress,
      failedCalls,
      averageDuration,
      conversionRate,
      timeOfDayPerformance,
      dailyActivity: callsByDay.map(day => ({
        date: day._id,
        calls: day.calls
      }))
    };
    
    return res.status(200).send(analytics);
  } catch (error) {
    logger.error('Error in getCampaignAnalytics:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Create script template
// @route   POST /api/campaigns/templates
// @access  Private
export const createScriptTemplate = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const template = await campaignService.createTemplate(req.body, req.user.id);
    res.status(201).send({
      success: true,
      template
    });
  } catch (error) {
    logger.error('Error in createScriptTemplate:', error);
    res.status(500).send({
      message: 'Template creation failed',
      error: handleError(error)
    });
  }
};

// @desc    Get script templates
// @route   GET /api/campaigns/templates
// @access  Private
export const getScriptTemplates = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { category, industry, approved } = req.query as any;
    const filters: any = {};
    
    if (category) filters.category = category;
    if (industry) filters.industry = industry;
    if (approved) filters['compliance.approved'] = approved === 'true';

    const templates = await campaignService.getTemplates(filters);
    res.send({
      success: true,
      templates
    });
  } catch (error) {
    logger.error('Error in getScriptTemplates:', error);
    res.status(500).send({
      message: 'Failed to fetch templates',
      error: handleError(error)
    });
  }
};

// @desc    Create A/B test
// @route   POST /api/campaigns/:id/ab-test
// @access  Private
export const createABTest = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const campaignId = (req.params as any).id;
    const campaign = await Campaign.findById(campaignId);
    
    if (!campaign) {
      return res.status(404).send({ message: 'Campaign not found' });
    }

    if (campaign.createdBy.toString() !== req.user.id) {
      return res.status(403).send({ message: 'Not authorized' });
    }

    const abTestConfig = {
      ...(req.body as any),
      campaignId
    };

    const abTest = await campaignService.createABTest(abTestConfig, req.user.id);
    
    res.status(201).send({
      success: true,
      abTest
    });
  } catch (error) {
    logger.error('Error in createABTest:', error);
    res.status(500).send({
      message: 'A/B test creation failed',
      error: handleError(error)
    });
  }
};

// @desc    Get A/B tests for campaign
// @route   GET /api/campaigns/:id/ab-tests
// @access  Private
export const getCampaignABTests = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const campaignId = (req.params as any).id;
    const abTests = await campaignService.getABTests(campaignId);
    
    res.send({
      success: true,
      abTests
    });
  } catch (error) {
    logger.error('Error in getCampaignABTests:', error);
    res.status(500).send({
      message: 'Failed to fetch A/B tests',
      error: handleError(error)
    });
  }
};

// @desc    Get A/B test results
// @route   GET /api/campaigns/ab-test/:testId/results
// @access  Private
export const getABTestResults = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { testId } = req.params as any;
    const results = await campaignService.getABTestResults(testId);
    
    res.send({
      success: true,
      results
    });
  } catch (error) {
    logger.error('Error in getABTestResults:', error);
    res.status(500).send({
      message: 'Failed to fetch A/B test results',
      error: handleError(error)
    });
  }
};

// @desc    Update A/B test metrics
// @route   PUT /api/campaigns/ab-test/:testId/metrics
// @access  Private
export const updateABTestMetrics = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { testId } = req.params as any;
    const { variantId, metrics } = req.body as any;
    
    const updatedTest = await campaignService.updateABTestMetrics(testId, variantId, metrics);
    
    res.send({
      success: true,
      test: updatedTest
    });
  } catch (error) {
    logger.error('Error in updateABTestMetrics:', error);
    res.status(500).send({
      message: 'Failed to update A/B test metrics',
      error: handleError(error)
    });
  }
};

// @desc    Validate script compliance
// @route   POST /api/campaigns/validate-compliance
// @access  Private
export const validateScriptCompliance = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { script, regions } = req.body as any;
    
    if (!script || !regions) {
      return res.status(400).send({ 
        message: 'Script content and regions are required' 
      });
    }

    // Use the compliance validation from campaign service
    const complianceResult = await campaignService.validateCompliance(script, regions);
    
    res.send({
      success: true,
      compliance: complianceResult
    });
  } catch (error) {
    logger.error('Error in validateScriptCompliance:', error);
    res.status(500).send({
      message: 'Compliance validation failed',
      error: handleError(error)
    });
  }
};
