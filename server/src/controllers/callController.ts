import { FastifyRequest, FastifyReply } from 'fastify';
import Call from '../models/Call';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import Configuration from '../models/Configuration';
import { logger } from '../index';
import mongoose from 'mongoose';
import { handleError } from '../utils/errorHandling';
import twilio from 'twilio';
import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import { unifiedAnalyticsService } from '../services/unifiedAnalyticsService';
import { getVoiceAIService } from '../services';

// Define a function to get preferred voice ID since the import is missing
function getPreferredVoiceId(): string {
  return 'default'; // Default voice ID if none is configured
}

// ... (rest of the file)

// Initialize Voice AI Service
const voiceAIService = getVoiceAIService();

// @desc    Initiate a new AI call to a lead
// @route   POST /api/calls/initiate
// @access  Private
export const initiateCall = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { leadId, campaignId, scheduleTime, notes } = req.body as any;

    // Log the received request for debugging
    logger.info('Call initiate request:', { 
      body: req.body, 
      leadId: (req.body as any).leadId, 
      campaignId: (req.body as any).campaignId 
    });

    if (!leadId || !campaignId) {
      logger.error('Missing required fields:', { leadId, campaignId });
      return res.status(400).send({ message: 'Lead ID and Campaign ID are required' });
    }

    // Check if lead and campaign exist
    const lead = await Lead.findById(leadId);
    if (!lead) {
      logger.error(`Lead not found with ID: ${leadId}`);
      return res.status(404).send({ message: 'Lead not found' });
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      logger.error(`Campaign not found with ID: ${campaignId}`);
      return res.status(404).send({ message: 'Campaign not found' });
    }

    // Get system configuration
    const configuration = await Configuration.findOne();
    const isDemoMode = process.env.NODE_ENV === 'development' && process.env.DEMO_MODE === 'true';
    
    if (!isDemoMode && (!configuration || !configuration.twilioConfig.isEnabled)) {
      logger.error('Twilio not configured:', { configuration: configuration?.twilioConfig });
      return res.status(400).send({ message: 'Twilio is not configured or enabled' });
    }

    // Check if we have an active script
    const activeScript = campaign.script.versions.find(version => version.isActive);
    if (!activeScript) {
      return res.status(400).send({ message: 'No active script found for this campaign' });
    }

    // Create a new call record first (before using it in TwiML)
    const newCall = new Call({
      leadId: new mongoose.Types.ObjectId(leadId),
      campaignId: new mongoose.Types.ObjectId(campaignId),
      phoneNumber: lead.phoneNumber,
      status: scheduleTime ? 'scheduled' : 'queued',
      scheduledAt: scheduleTime || new Date(),
      notes: notes || '',
      maxRetries: configuration.generalSettings.callRetryAttempts,
      retryCount: 0,
      recordCall: configuration.complianceSettings.recordCalls,
      priority: 'medium',
      personalityId: campaign.voiceConfiguration?.voiceId, // Store campaign voice ID
      voiceProvider: campaign.voiceConfiguration?.provider, // Store voice provider
      conversationLog: []
    });

    // If call is scheduled for future, we're done
    if (scheduleTime) {
      await newCall.save();
      return res.status(201).send({
        message: 'Call scheduled successfully',
        call: newCall
      });
    } 

    try {
      // Initialize Twilio client with configuration
      const client = twilio(
        configuration.twilioConfig.accountSid,
        configuration.twilioConfig.authToken
      );

      // Get webhook base URL from environment variable only
      const baseUrl = process.env.WEBHOOK_BASE_URL;
      
      if (!baseUrl) {
        logger.error('WEBHOOK_BASE_URL environment variable is not set');
        return res.status(500).send({
          success: false,
          message: 'Server configuration error: webhook base URL not configured'
        });
      }
      
      // Import the webhook URL utility
      const webhookUrls = require('../utils/webhookUrls').default;
      
      // Create the Twilio call with webhook URL
      // The webhook will handle voice synthesis to avoid API key issues here
      const twilioCall = await client.calls.create({
        url: webhookUrls.getVoiceWebhookUrl(newCall._id.toString()),
        to: lead.phoneNumber,
        from: configuration.twilioConfig.phoneNumbers[0],
        statusCallback: webhookUrls.getStatusWebhookUrl(newCall._id.toString()),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        record: configuration.complianceSettings.recordCalls,
        recordingStatusCallback: `${baseUrl}/api/calls/recording-webhook?callId=${newCall._id}`,
        recordingStatusCallbackEvent: ['completed'],
        timeout: configuration.generalSettings.maxCallDuration,
        // Change this to DetectMessageEnd to ensure webhook is always called
        machineDetection: 'DetectMessageEnd'
      });

      // Update call record with Twilio data
      newCall.status = 'dialing';
      newCall.twilioSid = twilioCall.sid;
      newCall.startTime = new Date();
      
      // Update lead's last contacted date
      lead.lastContacted = new Date();
      lead.callCount = (lead.callCount || 0) + 1;
      await lead.save();

      logger.info('Twilio call initiated successfully:', { 
        callSid: twilioCall.sid, 
        status: twilioCall.status,
        to: lead.phoneNumber,
        campaignId: campaign._id,
        voiceId: campaign.voiceConfiguration?.voiceId || (await getPreferredVoiceId())
      });
    } catch (error) {
      logger.error('Error initiating Twilio call:', error);
      newCall.status = 'failed';
      newCall.notes = `Failed to initiate: ${handleError(error)}`;
      
      // Save the failed call and return error
      await newCall.save();
      return res.status(500).send({
        message: 'Failed to initiate call',
        error: handleError(error)
      });
    }

    await newCall.save();

    return res.status(201).send({
      message: 'Call initiated successfully',
      call: newCall
    });
  } catch (error) {
    logger.error('Error in initiateCall:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// Rest of the controller methods remain the same...
// @desc    Get call history with filtering and pagination
// @route   GET /api/calls
// @access  Private
export const getCallHistory = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
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
    } = req.query as any;

    // Use unified analytics service for consistent call history
    const result = await unifiedAnalyticsService.getCallHistory({
      page: Number(page),
      limit: Number(limit),
      status: status as string,
      campaignId: campaignId as string,
      leadId: leadId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      outcome: outcome as string
    });

    return res.status(200).send(result);
  } catch (error) {
    logger.error('Error in getCallHistory:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Get detailed information about a specific call
// @route   GET /api/calls/:id
// @access  Private
export const getCallById = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const call = await Call.findById((req.params as any).id)
      .populate('leadId', 'name phoneNumber company email title')
      .populate('campaignId', 'name description goal');

    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }

    return res.status(200).send({ call });
  } catch (error) {
    logger.error('Error in getCallById:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

async function getTwilioRecordingUrl(call: any, client: twilio.Twilio): Promise<string | null> {
  let twilioRecordingUrl = (call as any).metrics?.twilioRecordingUrl;

  if (!twilioRecordingUrl && (call as any).recordingUrl?.includes('api.twilio.com')) {
    twilioRecordingUrl = (call as any).recordingUrl;
  }

  if (!twilioRecordingUrl) {
    const recordings = await client.recordings.list({ callSid: call.twilioSid });
    if (recordings.length > 0) {
      twilioRecordingUrl = recordings[0].uri.startsWith('http') 
        ? recordings[0].uri 
        : `https://api.twilio.com${recordings[0].uri.replace('.json', '')}`;
      
      await Call.findByIdAndUpdate(call._id, {
        'metrics.twilioRecordingUrl': twilioRecordingUrl
      });
    } else {
      return null;
    }
  }

  return twilioRecordingUrl;
}

// @desc    Get call recording URL
// @route   GET /api/calls/:id/recording
// @access  Private
export const getCallRecording = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const call = await Call.findById((req.params as any).id);

    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }

    if (!(call as any).recordingUrl) {
      return res.status(404).send({ message: 'No recording available for this call' });
    }

    const isStream = (req.query as any).stream === 'true';
    
    if (isStream) {
      const configuration = await Configuration.findOne();
      console.log('Twilio configuration check:', {
        hasConfiguration: !!configuration,
        hasTwilioConfig: !!configuration?.twilioConfig,
        hasAccountSid: !!configuration?.twilioConfig?.accountSid,
        hasAuthToken: !!configuration?.twilioConfig?.authToken,
        isEnabled: configuration?.twilioConfig?.isEnabled
      });
      
      if (!configuration || !configuration.twilioConfig || !configuration.twilioConfig.accountSid || !configuration.twilioConfig.authToken) {
        logger.error('Twilio configuration missing or incomplete:', {
          hasConfiguration: !!configuration,
          hasTwilioConfig: !!configuration?.twilioConfig,
          hasAccountSid: !!configuration?.twilioConfig?.accountSid,
          hasAuthToken: !!configuration?.twilioConfig?.authToken
        });
        return res.status(500).send({ 
          message: 'Twilio configuration not found or incomplete',
          details: {
            hasConfiguration: !!configuration,
            hasTwilioConfig: !!configuration?.twilioConfig,
            hasAccountSid: !!configuration?.twilioConfig?.accountSid,
            hasAuthToken: !!configuration?.twilioConfig?.authToken
          }
        });
      }
      
      try {
        const client = twilio(
          configuration.twilioConfig.accountSid,
          configuration.twilioConfig.authToken
        );

        const twilioRecordingUrl = await getTwilioRecordingUrl(call, client);
        console.log('Twilio recording URL retrieved:', twilioRecordingUrl);

        if (!twilioRecordingUrl) {
          logger.error('Recording not found in Twilio for call:', call._id);
          return res.status(404).send({ message: 'Recording not found in Twilio' });
        }

        const axios = require('axios');
        const auth = {
          username: configuration.twilioConfig.accountSid,
          password: configuration.twilioConfig.authToken
        };
        
        console.log('Fetching recording from Twilio with auth:', {
          url: twilioRecordingUrl,
          hasAuth: !!auth.username && !!auth.password
        });
        
        const response = await axios({
          method: 'get',
          url: twilioRecordingUrl,
          responseType: 'stream',
          auth: auth,
          timeout: 30000 // 30 second timeout
        });
        
        console.log('Twilio recording response:', {
          status: response.status,
          contentType: response.headers['content-type'],
          contentLength: response.headers['content-length']
        });
        
        res.header('Content-Type', response.headers['content-type']);
        res.header('Content-Length', response.headers['content-length']);
        res.header('Accept-Ranges', 'bytes');
        
        return res.send(response.data);
      } catch (error) {
        logger.error('Error streaming recording:', error);
        
        // Check if it's an axios error with response
        if ((error as any).response) {
          const axiosError = error as any;
          logger.error('Axios error details:', {
            status: axiosError.response.status,
            statusText: axiosError.response.statusText,
            data: axiosError.response.data,
            headers: axiosError.response.headers
          });
          
          if (axiosError.response.status === 401) {
            return res.status(401).send({
              message: 'Authentication failed with Twilio',
              error: 'Invalid Twilio credentials'
            });
          }
        }
        
        return res.status(500).send({
          message: 'Error streaming recording',
          error: (error as Error).message,
          details: (error as any).response ? {
            status: (error as any).response.status,
            statusText: (error as any).response.statusText
          } : undefined
        });
      }
    } else {
      const streamUrl = `/api/calls/${call._id}/recording?stream=true`;
      return res.status(200).send({ 
        recordingUrl: streamUrl
      });
    }
  } catch (error) {
    logger.error('Error in getCallRecording:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

// @desc    Get call transcript
// @route   GET /api/calls/:id/transcript
// @access  Private
export const getCallTranscript = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const call = await Call.findById((req.params as any).id);

    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }

    if (!(call as any).transcript) {
      return res.status(404).send({ message: 'No transcript available for this call' });
    }

    return res.status(200).send({ 
      transcript: (call as any).transcript,
      conversationLog: (call as any).conversationLog
    });
  } catch (error) {
    logger.error('Error in getCallTranscript:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

// @desc    Schedule a callback for a lead
// @route   POST /api/calls/:id/schedule-callback
// @access  Private
export const scheduleCallback = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { dateTime, notes } = req.body as any;

    if (!dateTime) {
      return res.status(400).send({ message: 'Callback date and time are required' });
    }

    const call = await Call.findById((req.params as any).id);
    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }

    // Update call with callback information
    (call as any).callback = {
      scheduled: true,
      dateTime: new Date(dateTime),
      notes: notes || ''
    };

    await call.save();

    // Schedule callback in a real implementation would involve 
    // setting up a job to trigger at the specified time

    return res.status(200).send({
      message: 'Callback scheduled successfully',
      callback: (call as any).callback
    });
  } catch (error) {
    logger.error('Error in scheduleCallback:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

// @desc    Get call analytics (metrics and statistics)
// @route   GET /api/calls/analytics
// @access  Private
export const getCallAnalytics = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { campaignId, startDate, endDate } = req.query as any;

    // Parse dates
    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    // Use unified analytics service for consistent metrics
    const [summary, callsByDay] = await Promise.all([
      unifiedAnalyticsService.getCallMetrics(start, end, campaignId as string),
      unifiedAnalyticsService.getCallTimeline(
        start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default to last 30 days
        end || new Date(),
        campaignId as string
      )
    ]);

    return res.status(200).send({
      summary,
      callsByDay
    });
  } catch (error) {
    logger.error('Error in getCallAnalytics:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

// @desc    Export call data to CSV, JSON, or Excel
// @route   GET /api/calls/export
// @access  Private
export const exportCalls = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { 
      format = 'csv',
      status, 
      campaignId, 
      leadId,
      startDate,
      endDate,
      outcome
    } = req.query as any;

    // Build query
    const query: any = {};

    if (status) query.status = status;
    if (campaignId) query.campaign = campaignId;
    if (leadId) query.lead = leadId;
    if (outcome) query.outcome = outcome;

    // Date range filtering
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate as string);
      if (endDate) query.startTime.$lte = new Date(endDate as string);
    }

    // Get calls with populated lead and campaign info
    const calls = await Call.find(query)
      .sort({ startTime: -1 })
      .populate('leadId', 'name phoneNumber company email')
      .populate('campaignId', 'name');

    // Process calls for export
    const exportData = calls.map((call: any) => ({
      id: call._id,
      leadName: call.leadId?.name || 'Unknown',
      leadPhone: call.leadId?.phoneNumber || 'N/A',
      leadEmail: call.leadId?.email || 'N/A',
      leadCompany: call.leadId?.company || 'N/A',
      campaignName: call.campaignId?.name || 'Unknown',
      status: call.status,
      startTime: call.startTime,
      endTime: call.endTime,
      duration: call.duration,
      outcome: call.outcome || 'unknown',
      notes: call.notes || '',
      hasRecording: !!call.recordingUrl,
    }));

    // Export based on requested format
    if (format === 'json') {
      // Send JSON
      return res.status(200).send({ calls: exportData });
    } 
    else if (format === 'csv') {
      // Convert to CSV using a simple method without external dependencies
      const header = Object.keys(exportData[0] || {}).join(',') + '\n';
      const csv = exportData.length 
        ? header + exportData.map((row: any) => 
            Object.values(row).map(value => 
              `"${String(value).replace(/"/g, '""')}"`
            ).join(',')
          ).join('\n')
        : header;
      
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=calls-export.csv');
      return res.status(200).send(csv);
    }
    else if (format === 'xlsx') {
      // For XLSX, we'll return JSON with a message to implement client-side Excel export
      // In a real implementation, you would use a library like exceljs
      return res.status(200).send({ 
        calls: exportData,
        message: 'XLSX export is handled on the client side'
      });
    }
    else {
      return res.status(400).send({ message: 'Unsupported export format' });
    }
  } catch (error) {
    logger.error('Error in exportCalls:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

// @desc    Sync all Twilio recordings
// @route   POST /api/calls/sync-recordings
// @access  Private (Admin only)
export const syncTwilioRecordings = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    // Temporarily allow all authenticated users (remove this check later for production)
    if (!req.user) {
      return res.status(403).send({ message: 'Authentication required' });
    }

    // Get days parameter from request (default to 30)
    const days = (req.body as any).days ? parseInt((req.body as any).days, 10) : 30;
    
    // Import the service
    const { twilioRecordingsService } = await import('../services/twilioRecordingsService');
    
    // Sync recordings
    const result = await twilioRecordingsService.syncAllRecordings(days);
    
    return res.status(200).send({
      success: true,
      message: `Successfully synced ${result.matchedRecordings} recordings out of ${result.totalRecordings} total recordings`,
      data: result
    });
  } catch (error) {
    logger.error('Error in syncTwilioRecordings:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};

// @desc    Get call recording details from Twilio
// @route   GET /api/calls/:id/recording-details
// @access  Private
export const getCallRecordingDetails = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const call = await Call.findById((req.params as any).id);

    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }

    if (!call.twilioSid) {
      return res.status(404).send({ message: 'No Twilio SID found for this call' });
    }

    // Get Twilio configuration
    const configuration = await Configuration.findOne();
    if (!configuration || !configuration.twilioConfig || !configuration.twilioConfig.accountSid || !configuration.twilioConfig.authToken) {
      return res.status(500).send({ message: 'Twilio configuration not found' });
    }

    // Initialize Twilio client
    const client = twilio(
      configuration.twilioConfig.accountSid,
      configuration.twilioConfig.authToken
    );

    // Get recordings for this call
    const recordings = await client.recordings.list({ callSid: call.twilioSid });

    if (recordings.length === 0) {
      return res.status(404).send({ message: 'No recordings found for this call' });
    }

    // Get the most recent recording
    const latestRecording = recordings[0];
    
    // Check if we need to update the recording URL in our database
    if (!call.recordingUrl) {
      const proxyUrl = `/api/calls/${call._id}/recording?stream=true`;
      const twilioUrl = latestRecording.uri.startsWith('http') 
        ? latestRecording.uri 
        : `https://api.twilio.com${latestRecording.uri.replace('.json', '')}`;
      
      await Call.findByIdAndUpdate(call._id, {
        recordingUrl: proxyUrl,
        'metrics.callRecordingUrl': proxyUrl,
        'metrics.twilioRecordingUrl': twilioUrl
      });
    }

    return res.status(200).send({
      success: true,
      recording: {
        sid: latestRecording.sid,
        duration: latestRecording.duration,
        channels: latestRecording.channels,
        status: latestRecording.status,
        source: latestRecording.source,
        dateCreated: latestRecording.dateCreated,
        uri: latestRecording.uri,
        url: `/api/calls/${call._id}/recording?stream=true`
      }
    });
  } catch (error) {
    logger.error('Error in getCallRecordingDetails:', error);
    return res.status(500).send({
      message: 'Server error',
      error: (error as Error).message
    });
  }
};