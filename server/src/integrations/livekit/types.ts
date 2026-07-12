/**
 * Metadata contract between Lumina dispatch (this file) and the Python agent
 * (livekit-agent/agent.py). Keys are snake_case on the wire.
 * Tested against livekit-server-sdk 2.16.0 + livekit-agents ~=1.5.
 */
export interface ProviderConfigPayload {
  stt: { api_key: string; model: string };
  llm: { provider: string; api_key: string; model: string; temperature: number };
  tts: { api_key: string; voice: string };
}

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
  provider_config: ProviderConfigPayload;
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

/**
 * Normalize a phone number to E.164 for SIP dialing. Twilio SIP rejects
 * non-E.164 numbers (SIP 400 / 32101). Bare local numbers get the default
 * country code (LUMINA_DEFAULT_COUNTRY_CODE, default '+91'); already-'+'
 * numbers are stripped of formatting only; a national trunk-prefix '0' on an
 * 11-digit number is dropped.
 */
export function toE164(raw: string, defaultCountryCode?: string): string {
  const cc = defaultCountryCode || process.env.LUMINA_DEFAULT_COUNTRY_CODE || '+91';
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/\D/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `${cc}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `${cc}${digits.slice(1)}`;
  return `+${digits}`;
}
