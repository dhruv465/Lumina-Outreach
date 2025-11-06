import Call from '../models/Call';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import Configuration from '../models/Configuration';
import mongoose from 'mongoose';
import twilio from 'twilio';
import { unifiedAnalyticsService } from './unifiedAnalyticsService';

class CallService {
  async initiateCall(leadId: string, campaignId: string, scheduleTime?: Date, notes?: string) {
    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error('Lead not found');
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const configuration = await Configuration.findOne();
    if (!configuration || !configuration.twilioConfig.isEnabled) {
      throw new Error('Twilio is not configured or enabled');
    }

    const activeScript = campaign.script.versions.find(version => version.isActive);
    if (!activeScript) {
      throw new Error('No active script found for this campaign');
    }

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
      personalityId: campaign.voiceConfiguration?.voiceId,
      voiceProvider: campaign.voiceConfiguration?.provider,
      conversationLog: [],
    });

    if (scheduleTime) {
      await newCall.save();
      return newCall;
    }

    const client = twilio(
      configuration.twilioConfig.accountSid,
      configuration.twilioConfig.authToken
    );

    const baseUrl = process.env.WEBHOOK_BASE_URL;
    if (!baseUrl) {
      throw new Error('WEBHOOK_BASE_URL environment variable is not set');
    }

    const webhookUrls = require('../utils/webhookUrls').default;

    const twilioCall = await client.calls.create({
      url: webhookUrls.getVoiceWebhookUrl(newCall._id.toString()),
      to: lead.phoneNumber,
      from: configuration.twilioConfig.phoneNumbers[0],
      statusCallback: webhookUrls.getStatusWebhookUrl(newCall._id.toString()),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      record: configuration.complianceSettings.recordCalls,
      recordingStatusCallback: `${baseUrl}/api/calls/recording-webhook?callId=${newCall._id}`,
      recordingStatusCallbackEvent: ['completed'],
      recordingChannels: 'dual', // Record both channels separately for better quality
      recordingTrack: 'both', // Record both inbound and outbound audio
      timeout: configuration.generalSettings.maxCallDuration,
      machineDetection: 'DetectMessageEnd',
    });

    newCall.status = 'dialing';
    newCall.twilioSid = twilioCall.sid;
    newCall.startTime = new Date();

    lead.lastContacted = new Date();
    lead.callCount = (lead.callCount || 0) + 1;
    await lead.save();

    await newCall.save();

    return newCall;
  }

  async getCallHistory(options: any) {
    return unifiedAnalyticsService.getCallHistory(options);
  }

  async getCallById(id: string) {
    return Call.findById(id)
      .populate('leadId', 'name phoneNumber company email title')
      .populate('campaignId', 'name description goal');
  }

  async getCallRecording(id: string) {
    const call = await Call.findById(id);
    if (!call || !call.recordingUrl) {
      return null;
    }
    return call.recordingUrl;
  }

  async getCallTranscript(id: string) {
    const call = await Call.findById(id);
    if (!call || !call.transcript) {
      return null;
    }
    return { transcript: call.transcript, conversationLog: call.conversationLog };
  }

  async scheduleCallback(id: string, dateTime: Date, notes: string) {
    const call = await Call.findById(id);
    if (!call) {
      throw new Error('Call not found');
    }

    call.callback = {
      scheduled: true,
      dateTime,
      notes: notes || '',
    };

    await call.save();
    return call.callback;
  }

  async getCallAnalytics(campaignId?: string, startDate?: Date, endDate?: Date) {
    const [summary, callsByDay] = await Promise.all([
      unifiedAnalyticsService.getCallMetrics(startDate, endDate, campaignId),
      unifiedAnalyticsService.getCallTimeline(
        startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate || new Date(),
        campaignId
      ),
    ]);

    return { summary, callsByDay };
  }

  async exportCalls(options: any) {
    const { format = 'csv', status, campaignId, leadId, startDate, endDate, outcome } = options;

    const query: any = {};

    if (status) query.status = status;
    if (campaignId) query.campaign = campaignId;
    if (leadId) query.lead = leadId;
    if (outcome) query.outcome = outcome;

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate as string);
      if (endDate) query.startTime.$lte = new Date(endDate as string);
    }

    const calls = await Call.find(query)
      .sort({ startTime: -1 })
      .populate('leadId', 'name phoneNumber company email')
      .populate('campaignId', 'name');

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

    if (format === 'json') {
      return { format, data: exportData };
    } else if (format === 'csv') {
      const header = Object.keys(exportData[0] || {}).join(',') + '\n';
      const csv = exportData.length
        ? header +
        exportData
          .map((row: any) =>
            Object.values(row)
              .map(value => `"${String(value).replace(/"/g, '""')}"`)
              .join(','))
          .join('\n')
        : '';

      return { format, data: csv };
        } else {
          throw new Error('Unsupported format');
        }
      }
    
      async syncTwilioRecordings(days: number): Promise<any> {
        // Placeholder implementation
        return { success: true, message: 'Sync started' };
      }
    
      async getCallRecordingDetails(id: string): Promise<any> {
        // Placeholder implementation
        return null;
      }
    }
    
    export default new CallService();
    