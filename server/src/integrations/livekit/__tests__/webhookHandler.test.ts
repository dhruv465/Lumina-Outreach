jest.mock('../../../models/Call', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));
// Silence winston output in tests; no assertions depend on logging.
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
import Call from '../../../models/Call';
import { handleLiveKitEvent } from '../webhookHandler';

const mockFindById = Call.findById as jest.Mock;

function fakeCall(overrides: Partial<any> = {}) {
  return {
    _id: '64b0c0ffee0ddeadbeef1234',
    status: 'dialing',
    phoneNumber: '+911234567890',
    startTime: undefined,
    endTime: undefined,
    duration: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ROOM = { name: 'call-64b0c0ffee0ddeadbeef1234' };

describe('handleLiveKitEvent', () => {
  beforeEach(() => mockFindById.mockReset());

  it('ignores rooms that are not lumina calls', async () => {
    await handleLiveKitEvent({ event: 'room_finished', room: { name: 'other-room' } });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('marks call in-progress when SIP participant joins', async () => {
    const call = fakeCall();
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({
      event: 'participant_joined',
      room: ROOM,
      participant: { identity: '+911234567890' },
    });
    expect(call.status).toBe('in-progress');
    expect(call.startTime).toBeInstanceOf(Date);
    expect(call.save).toHaveBeenCalled();
  });

  it('does not change status when agent participant joins', async () => {
    const call = fakeCall();
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({
      event: 'participant_joined',
      room: ROOM,
      participant: { identity: 'agent-AJ_123' },
    });
    expect(call.status).toBe('dialing');
  });

  it('completes an in-progress call on room_finished with duration', async () => {
    const started = new Date(Date.now() - 65_000);
    const call = fakeCall({ status: 'in-progress', startTime: started });
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
    expect(call.status).toBe('completed');
    expect(call.endTime).toBeInstanceOf(Date);
    expect(call.duration).toBeGreaterThanOrEqual(60);
    expect(call.save).toHaveBeenCalled();
  });

  it('fails a still-dialing call on room_finished', async () => {
    const call = fakeCall({ status: 'dialing' });
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
    expect(call.status).toBe('failed');
  });

  it('leaves terminal calls untouched', async () => {
    const call = fakeCall({ status: 'completed' });
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
    expect(call.save).not.toHaveBeenCalled();
  });
});
