import express from 'express';
import { authenticate } from '../middleware/auth';
import mongoose from 'mongoose';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import Call from '../models/Call';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';


const router = express.Router();

// Debug route to check lead and campaign existence
router.post('/verify-ids', authenticate, async (req, res) => {
  try {
    const { leadId, campaignId } = req.body;
    
    logger.info('Verifying IDs:', { leadId, campaignId });
    
    // Log the raw request for debugging
    logger.info('Request body:', req.body);
    
    // Check if IDs are valid MongoDB ObjectIDs
    const isValidLeadId = mongoose.isValidObjectId(leadId);
    const isValidCampaignId = mongoose.isValidObjectId(campaignId);
    
    let leadObj = null;
    let campaignObj = null;
    
    if (isValidLeadId) {
      leadObj = await Lead.findById(leadId);
    }
    
    if (isValidCampaignId) {
      campaignObj = await Campaign.findById(campaignId);
    }
    
    return res.status(200).json({
      isValidLeadId,
      isValidCampaignId,
      leadExists: !!leadObj,
      campaignExists: !!campaignObj,
      leadInfo: leadObj ? {
        id: leadObj._id,
        name: leadObj.name,
        phoneNumber: leadObj.phoneNumber
      } : null,
      campaignInfo: campaignObj ? {
        id: campaignObj._id,
        name: campaignObj.name
      } : null
    });
  } catch (error) {
    logger.error('Error in verify-ids:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Debug route for call creation
router.post('/test-call-creation', authenticate, async (req, res) => {
  try {
    const { leadId, campaignId } = req.body;
    
    logger.info('Testing call creation with:', { leadId, campaignId });
    
    // Validate IDs
    if (!leadId || !campaignId) {
      return res.status(400).json({ message: 'Lead ID and Campaign ID are required' });
    }
    
    // Check if lead and campaign exist
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    
    // Try to create a call with minimal fields
    const testCall = new Call({
      leadId: new mongoose.Types.ObjectId(leadId),
      campaignId: new mongoose.Types.ObjectId(campaignId),
      phoneNumber: lead.phoneNumber,
      status: 'queued',
      scheduledAt: new Date(),
      maxRetries: 3,
      retryCount: 0,
      recordCall: false,
      priority: 'medium',
      conversationLog: []
    });
    
    // Save and return the call
    const savedCall = await testCall.save();
    
    // Clean up - delete the test call
    await Call.findByIdAndDelete(savedCall._id);
    
    return res.status(200).json({
      success: true,
      message: 'Test call created and deleted successfully',
      callId: savedCall._id
    });
  } catch (error) {
    logger.error('Error in test-call-creation:', error);
    return res.status(500).json({
      message: 'Server error',
      error: handleError(error),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Add debug database endpoint
router.get('/database', async (req, res) => {
  try {
    console.log('Debug: Checking database state...');
    
    // Get total call count
    const totalCalls = await Call.countDocuments();
    console.log(`Total calls in database: ${totalCalls}`);
    
    // Get a sample of calls to see their structure
    const sampleCalls = await Call.find({}).limit(5).lean();
    console.log('Sample calls:', JSON.stringify(sampleCalls, null, 2));
    
    // Check date field usage
    const callsWithStartTime = await Call.countDocuments({ startTime: { $exists: true, $ne: null } });
    const callsWithCreatedAt = await Call.countDocuments({ createdAt: { $exists: true, $ne: null } });
    const callsWithScheduledAt = await Call.countDocuments({ scheduledAt: { $exists: true, $ne: null } });
    
    console.log(`Calls with startTime: ${callsWithStartTime}`);
    console.log(`Calls with createdAt: ${callsWithCreatedAt}`);
    console.log(`Calls with scheduledAt: ${callsWithScheduledAt}`);
    
    // Check status distribution
    const statusDistribution = await Call.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    console.log('Status distribution:', statusDistribution);
    
    // Check outcome distribution
    const outcomeDistribution = await Call.aggregate([
      { $group: { _id: '$outcome', count: { $sum: 1 } } }
    ]);
    console.log('Outcome distribution:', outcomeDistribution);
    
    // Check recent calls
    const recentCalls = await Call.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('status outcome createdAt startTime scheduledAt duration')
      .lean();
    console.log('Recent calls:', recentCalls);
    
    res.json({
      totalCalls,
      callsWithStartTime,
      callsWithCreatedAt,
      callsWithScheduledAt,
      statusDistribution,
      outcomeDistribution,
      sampleCalls: sampleCalls.slice(0, 2), // Only send first 2 to avoid overwhelming response
      recentCalls
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: 'Debug failed', details: error.message });
  }
});

export default router;
