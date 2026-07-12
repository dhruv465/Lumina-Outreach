process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';

const mockFindOneAndUpdate = jest.fn();
jest.mock('../../models/Configuration', () => ({
  __esModule: true,
  default: { findOneAndUpdate: mockFindOneAndUpdate },
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
import logger from '../../utils/logger';

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

afterEach(() => jest.restoreAllMocks());

describe('getSystemConfiguration', () => {
  it('atomically lazy-creates a per-user config and returns masked doc', async () => {
    mockFindOneAndUpdate.mockResolvedValue(fakeDoc());
    const res = fakeReply();
    await getSystemConfiguration(reqFor(), res);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { ownerId },
      { $setOnInsert: { ownerId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(res.send).toHaveBeenCalledWith({ masked: true });
  });
});

describe('updateSystemConfiguration', () => {
  it('replaces a key and resets status for a fresh value', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.status = 'verified';
    doc.deepgramConfig.lastVerified = new Date('2026-01-01T00:00:00.000Z');
    doc.deepgramConfig.lastError = 'old key failed previously';
    mockFindOneAndUpdate.mockResolvedValue(doc);
    const res = fakeReply();
    await updateSystemConfiguration(
      reqFor({ deepgramConfig: { apiKey: 'dg-new-key', ttsVoice: 'aura-luna-en' } }), res);
    expect(doc.deepgramConfig.apiKey).toBe('dg-new-key');
    expect(doc.deepgramConfig.status).toBe('unverified');
    expect(doc.deepgramConfig.lastVerified).toBeNull();
    expect(doc.deepgramConfig.lastError).toBe('');
    expect(doc.deepgramConfig.ttsVoice).toBe('aura-luna-en');
    expect(doc.save).toHaveBeenCalled();
  });

  it('ignores masked placeholder values', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.apiKey = encryptSecret('dg-old');
    doc.deepgramConfig.status = 'verified';
    mockFindOneAndUpdate.mockResolvedValue(doc);
    await updateSystemConfiguration(reqFor({ deepgramConfig: { apiKey: '••••g-old' } }), fakeReply());
    expect(doc.deepgramConfig.apiKey).toContain('enc:v1:');
    expect(doc.deepgramConfig.status).toBe('verified');
  });

  it('keeps an existing Deepgram key when an empty value is submitted', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('dg-old');
    const lastVerified = new Date('2026-01-01T00:00:00.000Z');
    doc.deepgramConfig.apiKey = storedKey;
    doc.deepgramConfig.status = 'verified';
    doc.deepgramConfig.lastVerified = lastVerified;
    doc.deepgramConfig.lastError = '';
    mockFindOneAndUpdate.mockResolvedValue(doc);

    await updateSystemConfiguration(reqFor({ deepgramConfig: { apiKey: '' } }), fakeReply());

    expect(doc.deepgramConfig.apiKey).toBe(storedKey);
    expect(doc.deepgramConfig.status).toBe('verified');
    expect(doc.deepgramConfig.lastVerified).toBe(lastVerified);
    expect(doc.deepgramConfig.lastError).toBe('');
  });

  it('updates llm provider key by name and default model', async () => {
    const doc = fakeDoc();
    doc.llmConfig.providers[1].status = 'verified';
    doc.llmConfig.providers[1].lastVerified = new Date('2026-01-01T00:00:00.000Z');
    doc.llmConfig.providers[1].lastError = 'old key failed previously';
    mockFindOneAndUpdate.mockResolvedValue(doc);
    await updateSystemConfiguration(
      reqFor({ llmConfig: {
        providers: [{ name: 'anthropic', apiKey: 'sk-ant-new' }],
        defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-5',
      } }), fakeReply());
    expect(doc.llmConfig.providers[1].apiKey).toBe('sk-ant-new');
    expect(doc.llmConfig.providers[1].status).toBe('unverified');
    expect(doc.llmConfig.providers[1].lastVerified).toBeNull();
    expect(doc.llmConfig.providers[1].lastError).toBe('');
    expect(doc.llmConfig.defaultProvider).toBe('anthropic');
    expect(doc.llmConfig.defaultModel).toBe('claude-sonnet-4-5');
  });

  it.each([
    ['masked', '••••t-key'],
    ['empty', ''],
  ])('keeps an existing LLM key for the %s placeholder', async (_label, apiKey) => {
    const doc = fakeDoc();
    const target = doc.llmConfig.providers[0];
    const storedKey = encryptSecret('sk-current-key');
    const lastVerified = new Date('2026-01-01T00:00:00.000Z');
    target.apiKey = storedKey;
    target.status = 'verified';
    target.lastVerified = lastVerified;
    target.lastError = '';
    mockFindOneAndUpdate.mockResolvedValue(doc);

    await updateSystemConfiguration(
      reqFor({ llmConfig: { providers: [{ name: 'openai', apiKey }] } }),
      fakeReply(),
    );

    expect(target.apiKey).toBe(storedKey);
    expect(target.status).toBe('verified');
    expect(target.lastVerified).toBe(lastVerified);
    expect(target.lastError).toBe('');
  });
});

describe('verify endpoints', () => {
  it('verify-deepgram decrypts stored key, marks verified on ok', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.apiKey = encryptSecret('dg-stored');
    mockFindOneAndUpdate.mockResolvedValue(doc);
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
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyLlm.mockResolvedValue({ ok: false, error: 'provider returned HTTP 401' });
    const res = fakeReply();
    await verifyLlm(reqFor({ provider: 'openai' }), res);
    expect(doc.llmConfig.providers[0].status).toBe('failed');
    expect(doc.llmConfig.providers[0].lastError).toContain('401');
  });

  it('verify-llm 400s on unknown provider', async () => {
    mockFindOneAndUpdate.mockResolvedValue(fakeDoc());
    const res = fakeReply();
    await verifyLlm(reqFor({ provider: 'azure' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('logs Deepgram verification exceptions without returning the internal error', async () => {
    const doc = fakeDoc();
    doc.deepgramConfig.apiKey = encryptSecret('dg-stored');
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyDeepgram.mockRejectedValue(new Error('sensitive Deepgram failure detail'));
    const errorSpy = jest.spyOn(logger, 'error').mockReturnValue(logger);
    const res = fakeReply();

    await verifyDeepgram(reqFor(), res);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('sensitive Deepgram failure detail'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: 'Failed to verify Deepgram key' });
  });

  it('logs LLM verification exceptions without returning the internal error', async () => {
    const doc = fakeDoc();
    doc.llmConfig.providers[0].apiKey = encryptSecret('sk-stored');
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyLlm.mockRejectedValue(new Error('sensitive LLM failure detail'));
    const errorSpy = jest.spyOn(logger, 'error').mockReturnValue(logger);
    const res = fakeReply();

    await verifyLlm(reqFor({ provider: 'openai' }), res);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('sensitive LLM failure detail'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ message: 'Failed to verify LLM key' });
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
