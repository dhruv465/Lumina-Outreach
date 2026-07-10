import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import Call from '../models/Call';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';

const debugRoutes = async (fastify, opts: Record<string, any>) => {
  // Debug route to check lead and campaign existence
  fastify.post('/verify-ids', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { leadId, campaignId } = request.body as any;
      
      logger.info('Verifying IDs:', { leadId, campaignId });
      
      // Log the raw request for debugging
      logger.info('Request body:', request.body);
      
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
      
      return reply.code(200).send({
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
      return reply.code(500).send({
        message: 'Server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Debug route for call creation
  fastify.post('/test-call-creation', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { leadId, campaignId } = request.body as any;
      
      logger.info('Testing call creation with:', { leadId, campaignId });
      
      // Validate IDs
      if (!leadId || !campaignId) {
        return reply.code(400).send({ message: 'Lead ID and Campaign ID are required' });
      }
      
      // Check if lead and campaign exist
      const lead = await Lead.findById(leadId);
      if (!lead) {
        return reply.code(404).send({ message: 'Lead not found' });
      }
      
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) {
        return reply.code(404).send({ message: 'Campaign not found' });
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
      
      return reply.code(200).send({
        success: true,
        message: 'Test call created and deleted successfully',
        callId: savedCall._id
      });
    } catch (error) {
      logger.error('Error in test-call-creation:', error);
      return reply.code(500).send({
        message: 'Server error',
        error: handleError(error),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Add debug database endpoint
  fastify.get('/database', async (request, reply) => {
    try {
      logger.info('Debug: Checking database state...');
      
      // Get total call count
      const totalCalls = await Call.countDocuments();
      logger.info(`Total calls in database: ${totalCalls}`);
      
      // Get a sample of calls to see their structure
      const sampleCalls = await Call.find({}).limit(5).lean();
      logger.info('Sample calls:', JSON.stringify(sampleCalls, null, 2));
      
      // Check date field usage
      const callsWithStartTime = await Call.countDocuments({ startTime: { $exists: true, $ne: null } });
      const callsWithCreatedAt = await Call.countDocuments({ createdAt: { $exists: true, $ne: null } });
      const callsWithScheduledAt = await Call.countDocuments({ scheduledAt: { $exists: true, $ne: null } });
      
      logger.info(`Calls with startTime: ${callsWithStartTime}`);
      logger.info(`Calls with createdAt: ${callsWithCreatedAt}`);
      logger.info(`Calls with scheduledAt: ${callsWithScheduledAt}`);
      
      // Check status distribution
      const statusDistribution = await Call.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      logger.info('Status distribution:', statusDistribution);
      
      // Check outcome distribution
      const outcomeDistribution = await Call.aggregate([
        { $group: { _id: '$outcome', count: { $sum: 1 } } }
      ]);
      logger.info('Outcome distribution:', outcomeDistribution);
      
      // Check recent calls
      const recentCalls = await Call.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select('status outcome createdAt startTime scheduledAt duration')
        .lean();
      logger.info('Recent calls:', recentCalls);
      
      reply.send({
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
      logger.error('Debug error:', error);
      reply.code(500).send({ error: 'Debug failed', details: error.message });
    }
  });
};

export default debugRoutes;