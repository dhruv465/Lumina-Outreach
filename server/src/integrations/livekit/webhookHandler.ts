import Call from '../../models/Call';
import logger from '../../utils/logger';
import { callIdFromRoomName } from './types';

interface LiveKitWebhookEvent {
  event: string;
  room?: { name: string };
  participant?: { identity: string };
}

const TERMINAL_STATUSES = ['completed', 'failed', 'no-answer', 'busy', 'voicemail'];

export async function handleLiveKitEvent(event: LiveKitWebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  if (!roomName) return;
  const callId = callIdFromRoomName(roomName);
  if (!callId) return;

  const call = await Call.findById(callId);
  if (!call) {
    logger.warn(`LiveKit webhook for unknown call ${callId} (${event.event})`);
    return;
  }
  if (TERMINAL_STATUSES.includes(call.status)) return;

  switch (event.event) {
    case 'participant_joined': {
      // The SIP participant's identity is the dialed phone number (set by the agent).
      if (event.participant?.identity === call.phoneNumber) {
        call.status = 'in-progress';
        call.startTime = call.startTime || new Date();
        await call.save();
      }
      break;
    }
    case 'room_finished': {
      call.endTime = new Date();
      if (call.status === 'in-progress') {
        call.status = 'completed';
        if (call.startTime) {
          call.duration = Math.round((call.endTime.getTime() - call.startTime.getTime()) / 1000);
        }
      } else {
        call.status = 'failed';
      }
      await call.save();
      logger.info(`LiveKit call ${callId} finalized as ${call.status}`);
      break;
    }
    default:
      break;
  }
}
