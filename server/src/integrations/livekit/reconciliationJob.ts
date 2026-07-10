import { RoomServiceClient } from 'livekit-server-sdk';
import Call from '../../models/Call';
import logger, { getErrorMessage } from '../../utils/logger';
import { roomNameForCall } from './types';

/** A live call is considered orphaned once its last update is older than this. */
const STALE_AFTER_MS = 10 * 60 * 1000;
const INTERVAL_MS = 15 * 60 * 1000;

/**
 * Safety net for missed LiveKit webhooks: finds calls stuck in
 * dialing/in-progress whose room is no longer active and finalizes them
 * (dialing -> failed, in-progress -> completed with duration).
 *
 * Returns the number of calls fixed.
 */
export async function reconcileStaleCalls(): Promise<number> {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return 0;

  const staleSince = new Date(Date.now() - STALE_AFTER_MS);
  const staleCalls = await Call.find({
    'providerData.provider': 'livekit',
    status: { $in: ['dialing', 'in-progress'] },
    updatedAt: { $lt: staleSince },
  });
  if (!staleCalls.length) return 0;

  const client = new RoomServiceClient(url, apiKey, apiSecret);
  let fixed = 0;
  for (const call of staleCalls) {
    const callId = call._id.toString();
    try {
      // listRooms returns active rooms only. The names filter must be
      // non-empty: an empty array would list every room on the project.
      const rooms = await client.listRooms([roomNameForCall(callId)]);
      if (rooms.length > 0) continue; // call genuinely still running

      const endTime = new Date();
      const update: { status: string; endTime: Date; duration?: number } = {
        status: call.status === 'in-progress' ? 'completed' : 'failed',
        endTime,
      };
      if (call.status === 'in-progress' && call.startTime) {
        update.duration = Math.round((endTime.getTime() - call.startTime.getTime()) / 1000);
      }
      // Conditional atomic update (Task 11 review Fix A): only finalize if
      // the call is still in the exact non-terminal state we observed; any
      // concurrent webhook or agent-outcome write wins and this is a no-op.
      const updated = await Call.findOneAndUpdate(
        { _id: call._id, status: call.status },
        { $set: update },
        { new: true }
      );
      if (!updated) continue;
      fixed += 1;
      logger.info(`Reconciled orphaned LiveKit call ${callId} -> ${updated.status}`);
    } catch (error) {
      logger.error(`Reconciliation failed for ${callId}: ${getErrorMessage(error)}`);
    }
  }
  return fixed;
}

export function startLiveKitReconciliation(): void {
  if (!process.env.LIVEKIT_URL) {
    logger.info('LiveKit not configured; reconciliation job not started');
    return;
  }
  const timer = setInterval(() => {
    reconcileStaleCalls().catch((error) =>
      logger.error(`LiveKit reconciliation tick failed: ${getErrorMessage(error)}`)
    );
  }, INTERVAL_MS);
  // The janitor must never keep the process alive on shutdown.
  timer.unref?.();
  logger.info('LiveKit reconciliation job started (15m interval)');
}
