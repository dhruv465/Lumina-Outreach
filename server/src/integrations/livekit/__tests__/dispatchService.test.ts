import { roomNameForCall, callIdFromRoomName } from '../types';

const mockCreateDispatch = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  AgentDispatchClient: jest.fn().mockImplementation(() => ({
    createDispatch: mockCreateDispatch,
  })),
}));

import { dispatchOutboundCall } from '../dispatchService';

describe('room name mapping', () => {
  it('builds and parses round-trip', () => {
    const id = '64b0c0ffee0ddeadbeef1234';
    expect(callIdFromRoomName(roomNameForCall(id))).toBe(id);
  });
  it('rejects foreign room names', () => {
    expect(callIdFromRoomName('random-room')).toBeNull();
    expect(callIdFromRoomName('call-notahexid')).toBeNull();
  });
});

describe('dispatchOutboundCall', () => {
  beforeEach(() => {
    mockCreateDispatch.mockReset();
    process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'key';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_AGENT_NAME = 'lumina-outbound';
  });

  it('creates dispatch on call room with serialized metadata', async () => {
    mockCreateDispatch.mockResolvedValue({});
    const meta = {
      call_id: '64b0c0ffee0ddeadbeef1234',
      lead_id: 'l1',
      campaign_id: 'c1',
      phone_number: '+911234567890',
      script: 'sell',
      opening_message: '',
      voice_id: 'v1',
      lead_name: 'Ravi',
    };
    const room = await dispatchOutboundCall(meta);
    expect(room).toBe('call-64b0c0ffee0ddeadbeef1234');
    expect(mockCreateDispatch).toHaveBeenCalledWith(
      'call-64b0c0ffee0ddeadbeef1234',
      'lumina-outbound',
      { metadata: JSON.stringify(meta) },
    );
  });

  it('throws when LIVEKIT_URL missing', async () => {
    delete process.env.LIVEKIT_URL;
    await expect(
      dispatchOutboundCall({
        call_id: 'x', lead_id: '', campaign_id: '', phone_number: '',
        script: '', opening_message: '', voice_id: '', lead_name: '',
      }),
    ).rejects.toThrow('LIVEKIT_URL');
  });
});
