import { roomNameForCall, callIdFromRoomName } from '../types';

const mockCreateDispatch = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  AgentDispatchClient: jest.fn().mockImplementation(() => ({
    createDispatch: mockCreateDispatch,
  })),
}));

const mockCallCtor = jest.fn();
jest.mock('../../../models/Call', () => ({
  __esModule: true,
  default: mockCallCtor,
}));

const mockLeadFindById = jest.fn();
jest.mock('../../../models/Lead', () => ({
  __esModule: true,
  default: { findById: mockLeadFindById },
}));

const mockCampaignFindById = jest.fn();
jest.mock('../../../models/Campaign', () => ({
  __esModule: true,
  default: { findById: mockCampaignFindById },
}));

const mockBuildProviderConfig = jest.fn();
jest.mock('../providerConfig', () => ({
  __esModule: true,
  buildProviderConfig: (...a: any[]) => mockBuildProviderConfig(...a),
  ProviderConfigError: class ProviderConfigError extends Error {},
}));

import logger from '../../../utils/logger';
import { dispatchOutboundCall, initiateLiveKitCall } from '../dispatchService';

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
      transfer_to: '',
      provider_config: {
        stt: { api_key: 'dg', model: 'nova-3' },
        llm: { provider: 'openai', api_key: 'sk', model: 'gpt-4.1', temperature: 0.7 },
        tts: { api_key: 'dg', voice: 'aura-2-thalia-en' },
      },
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
        transfer_to: '',
        provider_config: {
          stt: { api_key: '', model: '' },
          llm: { provider: '', api_key: '', model: '', temperature: 0 },
          tts: { api_key: '', voice: '' },
        },
      }),
    ).rejects.toThrow('LIVEKIT_URL');
  });
});

describe('initiateLiveKitCall', () => {
  const leadId = '64b0c0ffee0ddeadbeef0001';
  const campaignId = '64b0c0ffee0ddeadbeef0002';
  const mockCallSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'key';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_AGENT_NAME = 'lumina-outbound';

    mockCallCtor.mockImplementation((doc: any) => ({
      ...doc,
      _id: { toString: () => '64b0c0ffee0ddeadbeef9999' },
      save: mockCallSave,
    }));
    mockLeadFindById.mockResolvedValue({
      phoneNumber: '+911234567890',
      name: 'Ravi',
      save: jest.fn(),
    });
    mockCampaignFindById.mockResolvedValue({
      script: { versions: [{ isActive: true, content: 'sell' }] },
      openingMessage: '',
      voiceConfiguration: { voiceId: 'v1' },
      createdBy: { toString: () => '64b0c0ffee0ddeadbeef0001' },
    });
    mockBuildProviderConfig.mockResolvedValue({
      stt: { api_key: 'dg', model: 'nova-3' },
      llm: { provider: 'openai', api_key: 'sk', model: 'gpt-4.1', temperature: 0.7 },
      tts: { api_key: 'dg', voice: 'aura-2-thalia-en' },
    });
  });

  it('embeds provider_config in dispatch metadata', async () => {
    mockCreateDispatch.mockResolvedValue({});
    await initiateLiveKitCall({ leadId, campaignId });
    const sent = JSON.parse(mockCreateDispatch.mock.calls[0][2].metadata);
    expect(sent.provider_config.llm.provider).toBe('openai');
    expect(sent.provider_config.stt.api_key).toBe('dg');
    expect(mockBuildProviderConfig).toHaveBeenCalledWith('64b0c0ffee0ddeadbeef0001');
  });

  it('prefers the campaign owner over the initiating user', async () => {
    mockCreateDispatch.mockResolvedValue({});
    await initiateLiveKitCall({
      leadId,
      campaignId,
      initiatingUserId: '64b0c0ffee0ddeadbeef0002',
    });
    expect(mockBuildProviderConfig).toHaveBeenCalledWith('64b0c0ffee0ddeadbeef0001');
  });

  it('falls back to the initiating user when the campaign has no owner', async () => {
    mockCampaignFindById.mockResolvedValue({
      script: { versions: [{ isActive: true, content: 'sell' }] },
      openingMessage: '',
      voiceConfiguration: { voiceId: 'v1' },
    });
    mockCreateDispatch.mockResolvedValue({});

    await initiateLiveKitCall({
      leadId,
      campaignId,
      initiatingUserId: '64b0c0ffee0ddeadbeef0002',
    });

    expect(mockBuildProviderConfig).toHaveBeenCalledWith('64b0c0ffee0ddeadbeef0002');
  });

  it('rejects before creating a Call when provider config is unavailable', async () => {
    const { ProviderConfigError } = jest.requireMock('../providerConfig');
    mockBuildProviderConfig.mockRejectedValue(new ProviderConfigError('Configure and verify your API keys'));
    await expect(initiateLiveKitCall({ leadId, campaignId })).rejects.toThrow(/API keys/);
    expect(mockCallCtor).not.toHaveBeenCalled();
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  it('marks the call failed, logs, and rethrows when dispatch fails', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    mockCreateDispatch.mockRejectedValue(new Error('livekit unavailable'));

    await expect(
      initiateLiveKitCall({ leadId, campaignId }),
    ).rejects.toThrow('livekit unavailable');

    const call = mockCallCtor.mock.results[0].value;
    expect(call.status).toBe('failed');
    // saved once as queued, then again after being marked failed
    expect(mockCallSave).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('livekit unavailable'),
    );
  });
});
