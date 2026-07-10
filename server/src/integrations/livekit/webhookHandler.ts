import Call from '../../models/Call';
import logger from '../../utils/logger';
import { callIdFromRoomName } from './types';

interface LiveKitWebhookEvent {
  event: string;
  room?: { name: string };
  participant?: { identity: string };
  // Set when event is egress_*. `room` above is NOT populated for these
  // events, so the room name must be read from here instead.
  egressInfo?: {
    roomName?: string;
    fileResults?: { location?: string; filename?: string }[];
  };
}

const TERMINAL_STATUSES = ['completed', 'failed', 'no-answer', 'busy', 'voicemail'];

export async function handleLiveKitEvent(event: LiveKitWebhookEvent): Promise<void> {
  const roomName = event.event === 'egress_ended' ? event.egressInfo?.roomName : event.room?.name;
  if (!roomName) return;
  const callId = callIdFromRoomName(roomName);
  if (!callId) return;

  switch (event.event) {
    case 'participant_joined': {
      // The SIP participant's identity is the dialed phone number (set by the
      // agent), so pinning phoneNumber in the filter means only the callee
      // joining can trigger the transition; agent joins never match.
      // Matching status 'dialing' makes the update atomic and idempotent:
      // duplicate deliveries and races with terminal writes are no-ops.
      const identity = event.participant?.identity;
      if (!identity) return;
      // $min keeps an earlier dial-time startTime when already set and
      // creates the field when missing.
      await Call.findOneAndUpdate(
        { _id: callId, status: 'dialing', phoneNumber: identity },
        { $set: { status: 'in-progress' }, $min: { startTime: new Date() } },
        { new: true }
      );
      break;
    }
    case 'room_finished': {
      const call = await Call.findById(callId);
      if (!call) {
        logger.warn(`LiveKit webhook for unknown call ${callId} (${event.event})`);
        return;
      }
      if (TERMINAL_STATUSES.includes(call.status)) return;

      const endTime = new Date();
      const update: { status: string; endTime: Date; duration?: number } = {
        status: call.status === 'in-progress' ? 'completed' : 'failed',
        endTime,
      };
      if (call.status === 'in-progress' && call.startTime) {
        update.duration = Math.round((endTime.getTime() - call.startTime.getTime()) / 1000);
      }
      // Conditional atomic update: if a concurrent write (e.g. the agent's
      // outcome report) landed a terminal status between our read and this
      // write, the filter misses and we do not clobber it.
      const updated = await Call.findOneAndUpdate(
        { _id: callId, status: { $nin: TERMINAL_STATUSES } },
        { $set: update },
        { new: true }
      );
      if (updated) {
        logger.info(`LiveKit call ${callId} finalized as ${updated.status}`);
      }
      break;
    }
    case 'egress_ended': {
      const recordingUrl = event.egressInfo?.fileResults?.[0]?.location;
      if (!recordingUrl) {
        logger.warn(`LiveKit egress_ended for call ${callId} has no file result location`);
        return;
      }
      const call = await Call.findById(callId);
      if (!call) {
        logger.warn(`LiveKit webhook for unknown call ${callId} (${event.event})`);
        return;
      }
      const updated = await Call.findOneAndUpdate(
        { _id: callId },
        { $set: { recordingUrl } },
        { new: true }
      );
      if (updated) {
        logger.info(`LiveKit call ${callId} recording URL set from egress`);
      }
      break;
    }
    default:
      break;
  }
}
