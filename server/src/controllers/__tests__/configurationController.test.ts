process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';

const mockFindOne = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../models/Configuration', () => ({
  __esModule: true,
  default: { findOne: mockFindOne, create: mockCreate },
}));

const mockVerifyDeepgram = jest.fn();
const mockVerifyLlm = jest.fn();
jest.mock('../../services/providerVerificationService', () => ({
  verifyDeepgramKey: (...a: any[]) => mockVerifyDeepgram(...a),
  verifyLlmKey: (...a: any[]) => mockVerifyLlm(...a),
}));

import {
  getSystemConfiguration,
  updateSystemConfiguration,
  verifyDeepgram,
  verifyLlm,
  getLLMOptions,
  getVoiceOptions,
  LLM_OPTIONS,
} from '../configurationController';
import { encryptSecret } from '../../utils/secretCipher';

const ownerId = '64b0c0ffee0ddeadbeef0001';

function fakeDoc(overrides: any = {}) {
  const doc: any = {
    ownerId,
    deepgramConfig: { apiKey: '', sttModel: 'nova-3', ttsVoice: 'aura-2-thalia-en', status: 'unverified' },
    llmConfig: {
      providers: [
        { name: 'openai', apiKey: '', status: 'unverified' },
        { name: 'anthropic', apiKey: '', status: 'unverified' },
        { name: 'google', apiKey: '', status: 'unverified' },
      ],
      defaultProvider: 'openai', defaultModel: 'gpt-4.1', temperature: 0.7, maxTokens: 150,
    },
    generalSettings: {}, complianceSettings: {},
    save: jest.fn().mockResolvedValue(undefined),
    getMaskedConfig: jest.fn().mockReturnValue({ masked: true }),
    ...overrides,
  };
  return doc;
}

function fakeReply() {
  const res: any = { statusCode: 200 };
  res.status = jest.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.send = jest.fn().mockReturnValue(res);
  return res;
}
const reqFor = (body: any = {}) => ({ user: { _id: ownerId, role: 'admin' }, body }) as any;

beforeEach(() => jest.clearAllMocks());

describe('getSystemConfiguration', () => {
  it('lazy-creates a per-user config and returns masked doc', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue(fakeDoc());
    const res = fakeReply();
    await getSystemConfiguration(reqFor(), res);
    expect(mockFindOne).toHaveBeenCalledWith({ ownerId });
    expect(mockCreate).toHaveBeenCalledWith({ ownerId });
    expect(res.send).toHaveBeenCalledWith({ masked: true });
  });
});

describe('updateSystemConfiguration', () => {
  it('replaces a key and resets status for a fresh value', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.status = 'verified';
    mockFindOne.mockResolvedValue(doc);
    const res = fakeReply();
    await updateSystemConfiguration(
      reqFor({ deepgramConfig: { apiKey: 'dg-new-key', ttsVoice: 'aura-luna-en' } }), res);
    expect(doc.deepgramConfig.apiKey).toBe('dg-new-key');
    expect(doc.deepgramConfig.status).toBe('unverified');
    expect(doc.deepgramConfig.ttsVoice).toBe('aura-luna-en');
    expect(doc.save).toHaveBeenCalled();
  });

  it('ignores masked placeholder values', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.apiKey = encryptSecret('dg-old');
    doc.deepgramConfig.status = 'verified';
    mockFindOne.mockResolvedValue(doc);
    await updateSystemConfiguration(reqFor({ deepgramConfig: { apiKey: '••••g-old' } }), fakeReply());
    expect(doc.deepgramConfig.apiKey).toContain('enc:v1:');
    expect(doc.deepgramConfig.status).toBe('verified');
  });

  it('updates llm provider key by name and default model', async () => {
    const doc = fakeDoc();
    mockFindOne.mockResolvedValue(doc);
    await updateSystemConfiguration(
      reqFor({ llmConfig: {
        providers: [{ name: 'anthropic', apiKey: 'sk-ant-new' }],
        defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-5',
      } }), fakeReply());
    expect(doc.llmConfig.providers[1].apiKey).toBe('sk-ant-new');
    expect(doc.llmConfig.providers[1].status).toBe('unverified');
    expect(doc.llmConfig.defaultProvider).toBe('anthropic');
    expect(doc.llmConfig.defaultModel).toBe('claude-sonnet-4-5');
  });
});

describe('verify endpoints', () => {
  it('verify-deepgram decrypts stored key, marks verified on ok', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.apiKey = encryptSecret('dg-stored');
    mockFindOne.mockResolvedValue(doc);
    mockVerifyDeepgram.mockResolvedValue({ ok: true });
    const res = fakeReply();
    await verifyDeepgram(reqFor(), res);
    expect(mockVerifyDeepgram).toHaveBeenCalledWith('dg-stored');
    expect(doc.deepgramConfig.status).toBe('verified');
    expect(doc.save).toHaveBeenCalled();
  });

  it('verify-llm marks failed and stores lastError on bad key', async () => {
    const doc = fakeDoc();
    doc.llmConfig.providers[0].apiKey = encryptSecret('sk-bad');
    mockFindOne.mockResolvedValue(doc);
    mockVerifyLlm.mockResolvedValue({ ok: false, error: 'provider returned HTTP 401' });
    const res = fakeReply();
    await verifyLlm(reqFor({ provider: 'openai' }), res);
    expect(doc.llmConfig.providers[0].status).toBe('failed');
    expect(doc.llmConfig.providers[0].lastError).toContain('401');
  });

  it('verify-llm 400s on unknown provider', async () => {
    mockFindOne.mockResolvedValue(fakeDoc());
    const res = fakeReply();
    await verifyLlm(reqFor({ provider: 'azure' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('options endpoints', () => {
  it('llm-options exposes the three lowercase providers', async () => {
    const res = fakeReply();
    await getLLMOptions(reqFor(), res);
    expect(res.send).toHaveBeenCalledWith(LLM_OPTIONS);
    expect(LLM_OPTIONS.providers.map((p) => p.value)).toEqual(['openai', 'anthropic', 'google']);
  });

  it('voice-options returns the aura catalog', async () => {
    const res = fakeReply();
    await getVoiceOptions(reqFor(), res);
    const payload = (res.send as jest.Mock).mock.calls[0][0];
    expect(payload.voices[0].value).toBe('aura-2-thalia-en');
  });
});
