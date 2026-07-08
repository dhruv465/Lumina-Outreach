/**
 * Tests for the LiveKit webhook handler (atomic call finalization, Task 11
 * review Fix A) and route-level error semantics (401 vs 500, Fix B).
 *
 * The route tests live in this suite (rather than a routes/__tests__ file) so
 * the whole LiveKit webhook surface is pinned in one place; the route is
 * exercised for real through fastify.inject with only the SDK's
 * WebhookReceiver mocked.
 */
const mockReceive = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  WebhookReceiver: jest.fn().mockImplementation(() => ({ receive: mockReceive })),
}));
jest.mock('../../../models/Call', () => ({
  __esModule: true,
  default: { findById: jest.fn(), findOneAndUpdate: jest.fn() },
}));
// Silence winston output in tests; no assertions depend on logging.
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
import Fastify from 'fastify';
import Call from '../../../models/Call';
import { handleLiveKitEvent } from '../webhookHandler';
import livekitWebhookRoutes from '../../../routes/livekitWebhookRoutes';

const mockFindById = Call.findById as unknown as jest.Mock;
const mockFindOneAndUpdate = Call.findOneAndUpdate as unknown as jest.Mock;

const CALL_ID = '64b0c0ffee0ddeadbeef1234';
const ROOM = { name: `call-${CALL_ID}` };
const TERMINAL = ['completed', 'failed', 'no-answer', 'busy', 'voicemail'];

function fakeCall(overrides: Partial<any> = {}) {
  return {
    _id: CALL_ID,
    status: 'dialing',
    phoneNumber: '+911234567890',
    startTime: undefined,
    endTime: undefined,
    duration: undefined,
    ...overrides,
  };
}

describe('handleLiveKitEvent', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindOneAndUpdate.mockReset();
  });

  it('ignores rooms that are not lumina calls', async () => {
    await handleLiveKitEvent({ event: 'room_finished', room: { name: 'other-room' } });
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  describe('participant_joined', () => {
    it('atomically transitions dialing -> in-progress when the SIP participant joins', async () => {
      mockFindOneAndUpdate.mockResolvedValue(fakeCall({ status: 'in-progress' }));
      await handleLiveKitEvent({
        event: 'participant_joined',
        room: ROOM,
        participant: { identity: '+911234567890' },
      });
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ _id: CALL_ID, status: 'dialing', phoneNumber: '+911234567890' });
      expect(update.$set).toEqual({ status: 'in-progress' });
      expect(update.$min.startTime).toBeInstanceOf(Date);
      expect(options).toEqual({ new: true });
    });

    it('cannot transition a call when the agent participant joins (identity pinned in filter)', async () => {
      mockFindOneAndUpdate.mockResolvedValue(null);
      await handleLiveKitEvent({
        event: 'participant_joined',
        room: ROOM,
        participant: { identity: 'agent-AJ_123' },
      });
      // The conditional update requires phoneNumber === joining identity, so
      // an agent identity can never match a call document: no status change.
      const [filter] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter.phoneNumber).toBe('agent-AJ_123');
      expect(filter.status).toBe('dialing');
    });

    it('is a no-op on duplicate delivery (status no longer dialing)', async () => {
      mockFindOneAndUpdate.mockResolvedValue(null); // filter missed: already in-progress
      await expect(
        handleLiveKitEvent({
          event: 'participant_joined',
          room: ROOM,
          participant: { identity: '+911234567890' },
        })
      ).resolves.toBeUndefined();
    });

    it('skips the database entirely when the event has no participant identity', async () => {
      await handleLiveKitEvent({ event: 'participant_joined', room: ROOM });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('room_finished', () => {
    it('completes an in-progress call with duration via a terminal-guarded update', async () => {
      const started = new Date(Date.now() - 65_000);
      mockFindById.mockResolvedValue(fakeCall({ status: 'in-progress', startTime: started }));
      mockFindOneAndUpdate.mockImplementation(async (_filter, update) =>
        fakeCall({ ...update.$set })
      );
      await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ _id: CALL_ID, status: { $nin: TERMINAL } });
      expect(update.$set.status).toBe('completed');
      expect(update.$set.endTime).toBeInstanceOf(Date);
      expect(update.$set.duration).toBeGreaterThanOrEqual(60);
      expect(options).toEqual({ new: true });
    });

    it('fails a still-dialing call without a duration', async () => {
      mockFindById.mockResolvedValue(fakeCall({ status: 'dialing' }));
      mockFindOneAndUpdate.mockImplementation(async (_filter, update) =>
        fakeCall({ ...update.$set })
      );
      await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
      const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter.status).toEqual({ $nin: TERMINAL });
      expect(update.$set.status).toBe('failed');
      expect(update.$set.duration).toBeUndefined();
    });

    it('leaves terminal calls untouched', async () => {
      mockFindById.mockResolvedValue(fakeCall({ status: 'completed' }));
      await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does not throw when a concurrent write finalized the call first', async () => {
      mockFindById.mockResolvedValue(fakeCall({ status: 'in-progress', startTime: new Date() }));
      mockFindOneAndUpdate.mockResolvedValue(null); // lost the race to an agent outcome write
      await expect(
        handleLiveKitEvent({ event: 'room_finished', room: ROOM })
      ).resolves.toBeUndefined();
    });

    it('warns and exits for unknown calls without writing', async () => {
      mockFindById.mockResolvedValue(null);
      await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('egress_ended', () => {
    const RECORDING_URL = 'https://storage.googleapis.com/lumina-recordings/call-xyz.ogg';

    it('ignores egress events for rooms that are not lumina calls (room name comes from egressInfo, not room)', async () => {
      await handleLiveKitEvent({
        event: 'egress_ended',
        room: ROOM, // should be ignored for this event type
        egressInfo: { roomName: 'other-room', fileResults: [{ location: RECORDING_URL }] },
      });
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('sets recordingUrl from the file result location via an atomic update', async () => {
      mockFindById.mockResolvedValue(fakeCall({ status: 'completed' }));
      mockFindOneAndUpdate.mockResolvedValue(
        fakeCall({ status: 'completed', recordingUrl: RECORDING_URL })
      );
      await handleLiveKitEvent({
        event: 'egress_ended',
        egressInfo: {
          roomName: ROOM.name,
          fileResults: [{ location: RECORDING_URL, filename: 'call-xyz.ogg' }],
        },
      });
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ _id: CALL_ID });
      expect(update.$set).toEqual({ recordingUrl: RECORDING_URL });
      expect(options).toEqual({ new: true });
    });

    it('warns and exits for unknown calls without writing', async () => {
      mockFindById.mockResolvedValue(null);
      await handleLiveKitEvent({
        event: 'egress_ended',
        egressInfo: { roomName: ROOM.name, fileResults: [{ location: RECORDING_URL }] },
      });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does nothing when the egress has no file result location', async () => {
      await handleLiveKitEvent({
        event: 'egress_ended',
        egressInfo: { roomName: ROOM.name, fileResults: [] },
      });
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});

describe('livekitWebhookRoutes error semantics', () => {
  async function inject() {
    const app = Fastify();
    await app.register(livekitWebhookRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/livekit',
      payload: '{"event":"room_finished"}',
      headers: {
        'content-type': 'application/webhook+json',
        authorization: 'jwt-token',
      },
    });
    await app.close();
    return res;
  }

  beforeEach(() => {
    mockReceive.mockReset();
    mockFindById.mockReset();
    mockFindOneAndUpdate.mockReset();
    process.env.LIVEKIT_API_KEY = 'k';
    process.env.LIVEKIT_API_SECRET = 's';
  });

  it('returns 200 when the event verifies and is handled', async () => {
    mockReceive.mockResolvedValue({ event: 'room_finished', room: ROOM });
    mockFindById.mockResolvedValue(fakeCall({ status: 'in-progress', startTime: new Date() }));
    mockFindOneAndUpdate.mockResolvedValue(fakeCall({ status: 'completed' }));
    const res = await inject();
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when signature verification fails', async () => {
    mockReceive.mockRejectedValue(new Error('invalid signature'));
    const res = await inject();
    expect(res.statusCode).toBe(401);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 when event processing fails so LiveKit redelivers', async () => {
    mockReceive.mockResolvedValue({ event: 'room_finished', room: ROOM });
    mockFindById.mockRejectedValue(new Error('mongo down'));
    const res = await inject();
    expect(res.statusCode).toBe(500);
  });
});
