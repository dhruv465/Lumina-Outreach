import { AgentDispatchClient } from 'livekit-server-sdk';
import mongoose from 'mongoose';
import Call, { ICall } from '../../models/Call';
import Lead from '../../models/Lead';
import Campaign from '../../models/Campaign';
import logger, { getErrorMessage } from '../../utils/logger';
import { LiveKitDispatchMetadata, roomNameForCall, toE164 } from './types';
import { startCallRecording } from './egressService';
import { buildProviderConfig, ProviderConfigError } from './providerConfig';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

export async function dispatchOutboundCall(meta: LiveKitDispatchMetadata): Promise<string> {
  const url = requireEnv('LIVEKIT_URL');
  const apiKey = requireEnv('LIVEKIT_API_KEY');
  const apiSecret = requireEnv('LIVEKIT_API_SECRET');
  const agentName = process.env.LIVEKIT_AGENT_NAME || 'lumina-outbound';

  const client = new AgentDispatchClient(url, apiKey, apiSecret);
  const roomName = roomNameForCall(meta.call_id);
  await client.createDispatch(roomName, agentName, { metadata: JSON.stringify(meta) });
  logger.info(`LiveKit dispatch created room=${roomName} agent=${agentName}`);
  return roomName;
}

export async function initiateLiveKitCall(params: {
  leadId: string;
  campaignId: string;
  scheduleTime?: Date;
  notes?: string;
  initiatingUserId?: string;
}): Promise<ICall> {
  const { leadId, campaignId, scheduleTime, notes, initiatingUserId } = params;

  const lead = await Lead.findById(leadId);
  if (!lead) throw new Error('Lead not found');
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const activeScript = campaign.script.versions.find((v) => v.isActive);
  if (!activeScript) throw new Error('No active script found for this campaign');

  const ownerId = campaign.createdBy?.toString() || initiatingUserId;
  if (!ownerId) {
    throw new ProviderConfigError('Campaign has no owner and no initiating user; cannot resolve API keys.');
  }
  const providerConfig = await buildProviderConfig(ownerId);

  // Twilio SIP requires E.164; bare local numbers (e.g. "9579813746") fail with
  // SIP 400/32101. Normalize once and use for both the record and the dial.
  const dialNumber = toE164(lead.phoneNumber);

  const newCall = new Call({
    leadId: new mongoose.Types.ObjectId(leadId),
    campaignId: new mongoose.Types.ObjectId(campaignId),
    phoneNumber: dialNumber,
    status: scheduleTime ? 'scheduled' : 'queued',
    scheduledAt: scheduleTime || new Date(),
    notes: notes || '',
    maxRetries: 0,
    retryCount: 0,
    recordCall: false,
    priority: 'medium',
    personalityId: campaign.voiceConfiguration?.voiceId,
    voiceProvider: 'livekit',
    conversationLog: [],
  });

  if (scheduleTime) {
    await newCall.save();
    return newCall;
  }

  await newCall.save();
  let roomName: string;
  try {
    roomName = await dispatchOutboundCall({
      call_id: newCall._id.toString(),
      lead_id: leadId,
      campaign_id: campaignId,
      phone_number: dialNumber,
      script: activeScript.content,
      opening_message: campaign.openingMessage || '',
      voice_id: campaign.voiceConfiguration?.voiceId || '',
      lead_name: lead.name || '',
      transfer_to: campaign.transferPhoneNumber || '',
      provider_config: providerConfig,
    });
  } catch (error) {
    newCall.status = 'failed';
    await newCall.save();
    logger.error(
      `LiveKit dispatch failed for call ${newCall._id.toString()}: ${getErrorMessage(error)}`
    );
    throw error;
  }

  // Best-effort: recording is opt-in (compliance switch + GCS bucket) and a
  // failure here must never fail the call itself.
  try {
    await startCallRecording(roomName, ownerId);
  } catch (error) {
    logger.warn(
      `LiveKit call recording failed to start for room ${roomName}: ${getErrorMessage(error)}`
    );
  }

  newCall.status = 'dialing';
  newCall.startTime = new Date();
  newCall.providerData = { provider: 'livekit', callId: roomName };
  await newCall.save();

  lead.lastContacted = new Date();
  lead.callCount = (lead.callCount || 0) + 1;
  await lead.save();

  return newCall;
}
