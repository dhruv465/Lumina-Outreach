/**
 * Tests for the LiveKit reconciliation job (missed-webhook safety net).
 *
 * Deviates from the task brief's save()-based draft on purpose: finalization
 * is pinned to conditional atomic findOneAndUpdate (Task 11 review Fix A) so
 * a concurrent webhook or agent-outcome write always wins over the janitor.
 */
const mockListRooms = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn().mockImplementation(() => ({ listRooms: mockListRooms })),
}));
jest.mock('../../../models/Call', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOneAndUpdate: jest.fn() },
}));
// Silence winston output in tests; no assertions depend on logging.
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
import Call from '../../../models/Call';
import { reconcileStaleCalls, startLiveKitReconciliation } from '../reconciliationJob';

const mockFind = Call.find as unknown as jest.Mock;
const mockFindOneAndUpdate = Call.findOneAndUpdate as unknown as jest.Mock;

const CALL_ID = '64b0c0ffee0ddeadbeef1234';

function staleCall(status: string, id: string = CALL_ID) {
  return {
    _id: { toString: () => id },
    status,
    startTime: new Date(Date.now() - 30 * 60_000),
    endTime: undefined,
    duration: undefined,
  };
}

function setEnv() {
  process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
  process.env.LIVEKIT_API_KEY = 'k';
  process.env.LIVEKIT_API_SECRET = 's';
}

beforeEach(() => {
  mockListRooms.mockReset();
  mockFind.mockReset();
  mockFindOneAndUpdate.mockReset();
  setEnv();
});

describe('reconcileStaleCalls', () => {
  it('marks a stale dialing call failed when its room is gone', async () => {
    const call = staleCall('dialing');
    mockFind.mockResolvedValue([call]);
    mockListRooms.mockResolvedValue([]); // room no longer active
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...call,
      ...update.$set,
    }));
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(1);
    expect(mockListRooms).toHaveBeenCalledWith([`call-${CALL_ID}`]);
    const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: call._id, status: 'dialing' });
    expect(update.$set.status).toBe('failed');
    expect(update.$set.endTime).toBeInstanceOf(Date);
    expect(update.$set.duration).toBeUndefined();
    expect(options).toEqual({ new: true });
  });

  it('completes a stale in-progress call with duration when its room is gone', async () => {
    const call = staleCall('in-progress');
    mockFind.mockResolvedValue([call]);
    mockListRooms.mockResolvedValue([]);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...call,
      ...update.$set,
    }));
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(1);
    const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: call._id, status: 'in-progress' });
    expect(update.$set.status).toBe('completed');
    expect(update.$set.duration).toBeGreaterThan(0); // startTime was 30 min ago
  });

  it('leaves the call alone while its room is still active', async () => {
    mockFind.mockResolvedValue([staleCall('in-progress')]);
    mockListRooms.mockResolvedValue([{ name: `call-${CALL_ID}` }]);
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(0);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('queries only livekit calls stuck dialing/in-progress for over 10 minutes', async () => {
    mockFind.mockResolvedValue([]);
    await reconcileStaleCalls();
    const [query] = mockFind.mock.calls[0];
    expect(query['providerData.provider']).toBe('livekit');
    expect(query.status).toEqual({ $in: ['dialing', 'in-progress'] });
    expect(query.updatedAt.$lt).toBeInstanceOf(Date);
    const staleness = Date.now() - query.updatedAt.$lt.getTime();
    expect(staleness).toBeGreaterThanOrEqual(10 * 60_000 - 1_000);
    expect(staleness).toBeLessThanOrEqual(10 * 60_000 + 1_000);
  });

  it('does not count a call another writer finalized first', async () => {
    mockFind.mockResolvedValue([staleCall('dialing')]);
    mockListRooms.mockResolvedValue([]);
    mockFindOneAndUpdate.mockResolvedValue(null); // status changed since our read
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(0);
  });

  it('continues with the remaining calls when one room lookup fails', async () => {
    const bad = staleCall('dialing');
    const good = staleCall('in-progress', '64b0c0ffee0ddeadbeef5678');
    mockFind.mockResolvedValue([bad, good]);
    mockListRooms
      .mockRejectedValueOnce(new Error('livekit 502'))
      .mockResolvedValueOnce([]);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...good,
      ...update.$set,
    }));
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(1);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('returns 0 without touching the database when LiveKit env is not configured', async () => {
    delete process.env.LIVEKIT_URL;
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(0);
    expect(mockFind).not.toHaveBeenCalled();
  });
});

describe('startLiveKitReconciliation', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not schedule anything when LiveKit is not configured', () => {
    delete process.env.LIVEKIT_URL;
    jest.useFakeTimers();
    startLiveKitReconciliation();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('schedules a 15-minute interval whose tick runs reconciliation', async () => {
    jest.useFakeTimers();
    mockFind.mockResolvedValue([]);
    startLiveKitReconciliation();
    expect(jest.getTimerCount()).toBe(1);
    expect(mockFind).not.toHaveBeenCalled(); // no immediate tick
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(mockFind).toHaveBeenCalledTimes(1);
  });
});
