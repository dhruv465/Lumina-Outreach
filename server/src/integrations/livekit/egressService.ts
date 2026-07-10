import fs from 'fs';
import path from 'path';
import { EgressClient, EncodedFileOutput, EncodedFileType, GCPUpload } from 'livekit-server-sdk';
import Configuration from '../../models/Configuration';
import logger, { getErrorMessage } from '../../utils/logger';

/**
 * Starts an audio-only RoomComposite egress for a LiveKit call room, recording
 * the conversation to GCS. The resulting `egress_ended` webhook maps the file
 * back to the call by room name (see webhookHandler.ts) -- the egressId is
 * intentionally not persisted.
 *
 * This is opt-in and best-effort: it is gated on both the compliance
 * recording switch and a configured GCS bucket, and every failure mode here
 * is a silent skip (logged) rather than a thrown error, so a caller can await
 * this without needing to guard the call from a recording-start failure. (The
 * one caller we have, dispatchService.ts, still wraps this in its own
 * try/catch as defense in depth against unexpected errors, e.g. Mongo being
 * down when reading Configuration.)
 */
export async function startCallRecording(roomName: string): Promise<void> {
  const bucket = process.env.LIVEKIT_RECORDING_GCS_BUCKET;
  if (!bucket) return;

  const configuration = await Configuration.findOne();
  if (!configuration?.complianceSettings?.recordCalls) return;

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    logger.warn('LiveKit call recording skipped: GOOGLE_APPLICATION_CREDENTIALS not set');
    return;
  }

  let credentials: string;
  try {
    credentials = fs.readFileSync(path.resolve(process.cwd(), credentialsPath), 'utf-8');
  } catch (error) {
    logger.warn(
      `LiveKit call recording skipped: could not read GCS credentials file: ${getErrorMessage(error)}`
    );
    return;
  }

  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    logger.warn('LiveKit call recording skipped: LiveKit credentials not configured');
    return;
  }

  const egressClient = new EgressClient(url, apiKey, apiSecret);
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.OGG,
    filepath: '{room_name}-{time}.ogg',
    output: {
      case: 'gcp',
      value: new GCPUpload({ credentials, bucket }),
    },
  });

  // audioOnly: true records a single mixed audio file. `layout` and
  // `customBaseUrl` are intentionally left unset -- setting either routes the
  // recording through the video pipeline and loses the audio-only billing
  // rate (see https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/).
  await egressClient.startRoomCompositeEgress(roomName, output, { audioOnly: true });
  logger.info(`LiveKit call recording started room=${roomName}`);
}
