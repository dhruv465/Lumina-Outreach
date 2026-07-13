process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';

const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
jest.mock('../../models/Configuration', () => ({
  __esModule: true,
  default: { findOneAndUpdate: mockFindOneAndUpdate, updateOne: mockUpdateOne },
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
    generalSettings: {}, complianceSettings: {}, webhookConfig: { secret: '' },
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

  it('updates the per-user webhook secret and saves', async () => {
    const doc = fakeDoc();
    doc.webhookConfig.secret = 'old-webhook-secret';
    mockFindOneAndUpdate.mockResolvedValue(doc);

    await updateSystemConfiguration(
      reqFor({ webhookConfig: { secret: 'new-webhook-secret' } }),
      fakeReply(),
    );

    expect(doc.webhookConfig.secret).toBe('new-webhook-secret');
    expect(doc.save).toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['masked', '••••cret'],
  ])('keeps the existing webhook secret for the %s placeholder', async (_label, secret) => {
    const doc = fakeDoc();
    doc.webhookConfig.secret = 'existing-webhook-secret';
    mockFindOneAndUpdate.mockResolvedValue(doc);

    await updateSystemConfiguration(reqFor({ webhookConfig: { secret } }), fakeReply());

    expect(doc.webhookConfig.secret).toBe('existing-webhook-secret');
  });
});

describe('verify endpoints', () => {
  it('verify-deepgram decrypts the snapshot and atomically marks that key verified', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('dg-stored');
    doc.deepgramConfig.apiKey = storedKey;
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyDeepgram.mockResolvedValue({ ok: true });
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const res = fakeReply();
    await verifyDeepgram(reqFor(), res);
    expect(mockVerifyDeepgram).toHaveBeenCalledWith('dg-stored');
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { ownerId, 'deepgramConfig.apiKey': storedKey },
      { $set: {
        'deepgramConfig.status': 'verified',
        'deepgramConfig.lastVerified': expect.any(Date),
        'deepgramConfig.lastError': '',
      } },
    );
    expect(doc.save).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith({ ok: true, status: 'verified', error: undefined });
  });

  it('verify-deepgram atomically marks the snapshotted key failed', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('dg-bad');
    doc.deepgramConfig.apiKey = storedKey;
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyDeepgram.mockResolvedValue({ ok: false, error: 'provider returned HTTP 401' });
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await verifyDeepgram(reqFor(), fakeReply());

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { ownerId, 'deepgramConfig.apiKey': storedKey },
      { $set: {
        'deepgramConfig.status': 'failed',
        'deepgramConfig.lastError': 'provider returned HTTP 401',
      } },
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('verify-deepgram returns 409 when the key changes during verification', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('dg-old');
    doc.deepgramConfig.apiKey = storedKey;
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyDeepgram.mockImplementation(async () => {
      doc.deepgramConfig.apiKey = encryptSecret('dg-replacement');
      return { ok: true };
    });
    mockUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const res = fakeReply();

    await verifyDeepgram(reqFor(), res);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { ownerId, 'deepgramConfig.apiKey': storedKey },
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.send).toHaveBeenCalledWith({
      message: 'API key changed during verification. Verify the current key again.',
    });
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('verify-llm atomically marks the snapshotted provider key failed', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('sk-bad');
    doc.llmConfig.providers[0].apiKey = storedKey;
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyLlm.mockResolvedValue({ ok: false, error: 'provider returned HTTP 401' });
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const res = fakeReply();
    await verifyLlm(reqFor({ provider: 'openai' }), res);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      {
        ownerId,
        'llmConfig.providers': { $elemMatch: { name: 'openai', apiKey: storedKey } },
      },
      { $set: {
        'llmConfig.providers.$[provider].status': 'failed',
        'llmConfig.providers.$[provider].lastError': 'provider returned HTTP 401',
      } },
      { arrayFilters: [{ 'provider.name': 'openai', 'provider.apiKey': storedKey }] },
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('verify-llm atomically marks the snapshotted provider key verified', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('sk-good');
    doc.llmConfig.providers[0].apiKey = storedKey;
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyLlm.mockResolvedValue({
      ok: true,
      models: [{ name: 'gpt-4.1', value: 'gpt-4.1' }],
    });
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const res = fakeReply();

    await verifyLlm(reqFor({ provider: 'openai' }), res);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      {
        ownerId,
        'llmConfig.providers': { $elemMatch: { name: 'openai', apiKey: storedKey } },
      },
      { $set: {
        'llmConfig.providers.$[provider].status': 'verified',
        'llmConfig.providers.$[provider].lastVerified': expect.any(Date),
        'llmConfig.providers.$[provider].lastError': '',
        'llmConfig.providers.$[provider].availableModels': [
          { name: 'gpt-4.1', value: 'gpt-4.1' },
        ],
      } },
      { arrayFilters: [{ 'provider.name': 'openai', 'provider.apiKey': storedKey }] },
    );
    expect(res.send).toHaveBeenCalledWith({
      ok: true,
      status: 'verified',
      error: undefined,
      models: [{ name: 'gpt-4.1', value: 'gpt-4.1' }],
    });
  });

  it('verify-llm returns 409 when the provider key changes during verification', async () => {
    const doc = fakeDoc();
    const storedKey = encryptSecret('sk-old');
    doc.llmConfig.providers[0].apiKey = storedKey;
    mockFindOneAndUpdate.mockResolvedValue(doc);
    mockVerifyLlm.mockImplementation(async () => {
      doc.llmConfig.providers[0].apiKey = encryptSecret('sk-replacement');
      return { ok: true };
    });
    mockUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const res = fakeReply();

    await verifyLlm(reqFor({ provider: 'openai' }), res);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      {
        ownerId,
        'llmConfig.providers': { $elemMatch: { name: 'openai', apiKey: storedKey } },
      },
      expect.any(Object),
      { arrayFilters: [{ 'provider.name': 'openai', 'provider.apiKey': storedKey }] },
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.send).toHaveBeenCalledWith({
      message: 'API key changed during verification. Verify the current key again.',
    });
    expect(doc.save).not.toHaveBeenCalled();
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
