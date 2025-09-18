import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';
import { RealTelephonyService, getTelephonyService } from '../services/realTelephonyService';

// Helper function to get telephony service with error handling
const getTelephonyServiceSafely = (): RealTelephonyService => {
  try {
    return getTelephonyService();
  } catch (error) {
    throw new Error('Telephony service not initialized. Please check server configuration.');
  }
};

// @desc    Queue a new call
// @route   POST /api/telephony/queue-call
// @access  Private
export const queueCall = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const {
      leadId,
      campaignId,
      phoneNumber,
      personalityId,
      abTestVariantId,
      priority = 'medium',
      scheduledAt,
      maxRetries = 3
    } = req.body as any;

    if (!leadId || !campaignId || !phoneNumber) {
      return res.status(400).send({
        message: 'Lead ID, campaign ID, and phone number are required'
      });
    }

    const callbackUrl = `${process.env.API_BASE_URL || 'http://localhost:8000'}/api/telephony`;

    const telephonyService = getTelephonyServiceSafely();
    const callId = await telephonyService.makeCall((req.body as any).to, (req.body as any).from, callbackUrl, {});

    res.status(201).send({
      success: true,
      callId,
      message: 'Call queued successfully'
    });
  } catch (error) {
    logger.error('Error in queueCall:', error);
    res.status(500).send({
      message: 'Failed to queue call',
      error: handleError(error)
    });
  }
};

// @desc    Handle Twilio voice webhook
// @route   POST /api/telephony/voice-webhook
// @access  Public (Twilio webhook)
export const handleVoiceWebhook = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const telephonyService = getTelephonyServiceSafely();
    await telephonyService.handleWebhook('voice', req.body);
  } catch (error) {
    logger.error('Error in handleVoiceWebhook:', error);
    res.type('text/xml');
    // NO HARDCODED ERROR MESSAGES - use minimal XML response
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Hangup/>
      </Response>`);
  }
};

// @desc    Handle Twilio status webhook
// @route   POST /api/telephony/status-webhook
// @access  Public (Twilio webhook)
export const handleStatusWebhook = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const telephonyService = getTelephonyServiceSafely();
    await telephonyService.handleWebhook('status', req.body);
  } catch (error) {
    logger.error('Error in handleStatusWebhook:', error);
    res.status(500).send('Error');
  }
};

// @desc    Handle Twilio recording webhook
// @route   POST /api/telephony/recording-webhook
// @access  Public (Twilio webhook)
export const handleRecordingWebhook = async (req: FastifyRequest, res: FastifyReply) => {
  try {
  } catch (error) {
    logger.error('Error in handleRecordingWebhook:', error);
    res.status(500).send('Error');
  }
};

// @desc    Get call queue status
// @route   GET /api/telephony/queue
// @access  Private
export const getCallQueue = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const telephonyService = getTelephonyServiceSafely();
    const queue = await telephonyService.getActiveCalls();
    const activeConversations = await telephonyService.getActiveCalls();

    res.send({
      success: true,
      queue: {
        pending: queue.length,
        active: activeConversations.length,
        details: {
          queuedCalls: queue,
          activeConversations: activeConversations.map(conv => ({
            callId: conv.id,
            startTime: conv.startTime,
            phoneNumber: conv.to,
            conversationState: conv.status
          }))
        }
      }
    });
  } catch (error) {
    logger.error('Error in getCallQueue:', error);
    res.status(500).send({
      message: 'Failed to fetch call queue',
      error: handleError(error)
    });
  }
};

// @desc    Get telephony metrics
// @route   GET /api/telephony/metrics
// @access  Private
export const getTelephonyMetrics = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { timeRange = '24h' } = req.query as any;
    const telephonyService = getTelephonyServiceSafely();
    const metrics = await telephonyService.getCallData(timeRange as string);

    res.send({
      success: true,
      metrics,
      timeRange
    });
  } catch (error) {
    logger.error('Error in getTelephonyMetrics:', error);
    res.status(500).send({
      message: 'Failed to fetch telephony metrics',
      error: handleError(error)
    });
  }
};

// @desc    Pause/stop a call
// @route   PUT /api/telephony/calls/:callId/pause
// @access  Private
export const pauseCall = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { callId } = req.params as any;
    
    const telephonyService = getTelephonyServiceSafely();
    await telephonyService.endCall(callId);
    
    res.send({
      success: true,
      message: 'Call paused successfully'
    });
  } catch (error) {
    logger.error('Error in pauseCall:', error);
    res.status(500).send({
      message: 'Failed to pause call',
      error: handleError(error)
    });
  }
};

// @desc    Bulk queue calls for campaign
// @route   POST /api/telephony/bulk-queue
// @access  Private
export const bulkQueueCalls = async (req: FastifyRequest & { user?: any }, res: FastifyReply) => {
  try {
    const { 
      campaignId, 
      leadIds, 
      personalityId, 
      abTestVariantId,
      priority = 'medium',
      scheduledAt,
      staggerInterval = 60 // seconds between calls
    } = req.body as any;

    if (!campaignId || !leadIds || !Array.isArray(leadIds)) {
      return res.status(400).send({
        message: 'Campaign ID and lead IDs array are required'
      });
    }

    const results = [];
    const callbackUrl = `${process.env.API_BASE_URL || 'http://localhost:8000'}/api/telephony`;

    for (let i = 0; i < leadIds.length; i++) {
      try {
        const leadId = leadIds[i];
        const scheduleTime = scheduledAt 
          ? new Date(new Date(scheduledAt).getTime() + (i * staggerInterval * 1000))
          : new Date(Date.now() + (i * staggerInterval * 1000));

        // In a real implementation, you'd fetch the lead's phone number
        const phoneNumber = `+1234567890${i}`; // Placeholder

        const telephonyService = getTelephonyServiceSafely();
        const callId = await telephonyService.makeCall((req.body as any).to, (req.body as any).from, callbackUrl, {});

        results.push({
          leadId,
          callId,
          scheduledAt: scheduleTime,
          status: 'queued'
        });
      } catch (error) {
        results.push({
          leadId: leadIds[i],
          status: 'failed',
          error: (error as any).message
        });
      }
    }

    const successCount = results.filter(r => r.status === 'queued').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    res.send({
      success: true,
      summary: {
        total: leadIds.length,
        queued: successCount,
        failed: failCount
      },
      results
    });
  } catch (error) {
    logger.error('Error in bulkQueueCalls:', error);
    res.status(500).send({
      message: 'Bulk call queueing failed',
      error: handleError(error)
    });
  }
};
