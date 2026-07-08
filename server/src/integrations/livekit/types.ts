/**
 * Metadata contract between Lumina dispatch (this file) and the Python agent
 * (livekit-agent/agent.py). Keys are snake_case on the wire.
 * Tested against livekit-server-sdk 2.16.0 + livekit-agents ~=1.5.
 */
export interface LiveKitDispatchMetadata {
  call_id: string;
  lead_id: string;
  campaign_id: string;
  phone_number: string;
  script: string;
  opening_message: string;
  voice_id: string;
  lead_name: string;
  transfer_to: string;
}

export const LIVEKIT_ROOM_PREFIX = 'call-';

export function roomNameForCall(callId: string): string {
  return `${LIVEKIT_ROOM_PREFIX}${callId}`;
}

export function callIdFromRoomName(roomName: string): string | null {
  if (!roomName.startsWith(LIVEKIT_ROOM_PREFIX)) return null;
  const id = roomName.slice(LIVEKIT_ROOM_PREFIX.length);
  return /^[a-f0-9]{24}$/.test(id) ? id : null;
}
