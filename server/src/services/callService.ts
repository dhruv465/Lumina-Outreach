import Call from '../models/Call';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import { unifiedAnalyticsService } from './unifiedAnalyticsService';
import logger from '../utils/logger';

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

    // LiveKit-only: all outbound calling is routed through the LiveKit agent.
    // (Legacy Twilio calling path removed during the LiveKit consolidation.)
    const { initiateLiveKitCall } = await import('../integrations/livekit/dispatchService');
    return initiateLiveKitCall({ leadId, campaignId, scheduleTime, notes });
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

  async getCallRecordingDetails(id: string): Promise<any> {
    try {
      const call = await Call.findById(id);
      if (!call || !call.recordingUrl) return null;

      return {
        callId: call._id,
        recordingUrl: call.recordingUrl,
        provider: 'livekit',
      };
    } catch (error) {
      logger.error(`Error getting recording details: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

export default new CallService();
