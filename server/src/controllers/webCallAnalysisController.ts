import { Request, Response } from 'express';
import logger from '../utils/logger';
import { EnhancedErrorHandlingService } from '../services/enhancedErrorHandling';
import WebCallTest from '../models/WebCallTest';
import webCallResponsePipeline from '../services/webCallResponsePipeline';
import CampaignService from '../services/campaignService';
import { SessionState } from '../services/webCallService';

const enhancedErrorHandling = new EnhancedErrorHandlingService();

/**
 * Get analysis results for a web call test
 */
export const getTestAnalysis = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { testId } = req.params;
    
    if (!testId) {
      return res.status(400).json({ error: 'Test ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the test
    const test = await WebCallTest.findById(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Verify the user owns this test
    if (test.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to access this test' });
    }
    
    // Check if analysis exists
    if (test.analysis) {
      return res.status(200).json({
        success: true,
        testId,
        analysis: test.analysis
      });
    } else {
      return res.status(404).json({ 
        error: 'Analysis not found',
        message: 'Analysis has not been generated for this test yet'
      });
    }
  } catch (error) {
    logger.error(`Error getting test analysis: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get test analysis',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Generate analysis for a web call test
 */
export const generateTestAnalysis = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { testId } = req.params;
    
    if (!testId) {
      return res.status(400).json({ error: 'Test ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the test
    const test = await WebCallTest.findById(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Verify the user owns this test
    if (test.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to access this test' });
    }
    
    // Get campaign for system prompt
    const campaignService = new CampaignService();
    const campaign = await campaignService.getCampaign(test.campaignId.toString());
    
    if (!campaign || !campaign.systemPrompt) {
      return res.status(400).json({ 
        error: 'Campaign not found or missing system prompt',
        message: 'Cannot generate analysis without campaign system prompt'
      });
    }
    
    // Check if test has transcript and responses
    if (!test.transcript || test.transcript.length === 0 || !test.agentResponses || test.agentResponses.length === 0) {
      return res.status(400).json({ 
        error: 'Insufficient data',
        message: 'Test does not have enough conversation data for analysis'
      });
    }
    
    // Create a session-like object from the test data
    const sessionData = {
      id: test._id.toString(),
      campaignId: test.campaignId.toString(),
      userId: test.userId.toString(),
      status: 'ended' as SessionState,
      startTime: test.startTime,
      endTime: test.endTime || new Date(),
      lastActivityTime: test.updatedAt,
      transcript: test.transcript.map(entry => ({
        speaker: entry.speaker,
        text: entry.text,
        timestamp: entry.timestamp,
        isFinal: entry.isFinal
      })),
      metrics: {
        responseTime: test.metrics.responseTime.avg ? [test.metrics.responseTime.avg] : [],
        userSpeakingTime: test.metrics.userSpeakingTime || 0,
        agentSpeakingTime: test.metrics.agentSpeakingTime || 0,
        interruptions: test.metrics.interruptions || 0,
        speechToTextLatency: test.metrics.speechToTextLatency || 0,
        textToSpeechLatency: test.metrics.textToSpeechLatency || 0,
        llmLatency: test.metrics.llmLatency || 0,
        totalTurns: test.agentResponses.length
      },
      resources: {
        audioBuffers: new Map(),
        currentSpeaker: null
      },
      config: {
        inactivityTimeout: 300000,
        maxSessionDuration: 1800000
      }
    };
    
    // Start analysis (this will be async)
    res.status(202).json({
      success: true,
      message: 'Analysis generation started',
      testId
    });
    
    // Run analysis in the background
    webCallResponsePipeline.analyzeSession(sessionData, campaign.systemPrompt)
      .then(async (analysisResults) => {
        // Save analysis results to database
        await webCallResponsePipeline.saveAnalysisToDatabase(sessionData.id, testId);
        logger.info(`Analysis completed for web call test ${testId}`);
      })
      .catch(error => {
        logger.error(`Failed to analyze web call test ${testId}: ${error.message}`);
      });
      
    return;
  } catch (error) {
    logger.error(`Error generating test analysis: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to generate test analysis',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Get recommendations for improving a campaign based on test results
 */
export const getCampaignRecommendations = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { campaignId } = req.params;
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get campaign
    const campaignService = new CampaignService();
    const campaign = await campaignService.getCampaign(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Get recent tests for this campaign
    const tests = await WebCallTest.find({
      campaignId,
      status: 'completed',
      analysis: { $exists: true }
    })
    .sort({ createdAt: -1 })
    .limit(5);
    
    if (tests.length === 0) {
      return res.status(404).json({ 
        error: 'No analyzed tests found',
        message: 'No analyzed tests found for this campaign'
      });
    }
    
    // Collect all recommendations
    const allRecommendations = tests
      .filter(test => test.analysis?.recommendations?.items)
      .flatMap(test => test.analysis!.recommendations!.items);
    
    // Group recommendations by area
    const recommendationsByArea: Record<string, any[]> = {};
    allRecommendations.forEach(rec => {
      if (!recommendationsByArea[rec.area]) {
        recommendationsByArea[rec.area] = [];
      }
      recommendationsByArea[rec.area].push(rec);
    });
    
    // Get system prompt suggestions
    const systemPromptSuggestions = tests
      .filter(test => test.analysis?.recommendations?.systemPromptSuggestions)
      .map(test => test.analysis!.recommendations!.systemPromptSuggestions);
    
    return res.status(200).json({
      success: true,
      campaignId,
      recommendationsByArea,
      systemPromptSuggestions,
      testsAnalyzed: tests.length
    });
  } catch (error) {
    logger.error(`Error getting campaign recommendations: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get campaign recommendations',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

export default {
  getTestAnalysis,
  generateTestAnalysis,
  getCampaignRecommendations
};