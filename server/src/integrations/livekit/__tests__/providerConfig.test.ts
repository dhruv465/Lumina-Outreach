process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';

const mockConfigFindOne = jest.fn();
jest.mock('../../../models/Configuration', () => ({
  __esModule: true,
  default: { findOne: mockConfigFindOne },
}));

import { buildProviderConfig, ProviderConfigError } from '../providerConfig';
import { encryptSecret } from '../../../utils/secretCipher';

const ownerId = '64b0c0ffee0ddeadbeef0001';

function verifiedConfig() {
  return {
    deepgramConfig: {
      apiKey: encryptSecret('dg-key'), sttModel: 'nova-3',
      ttsVoice: 'aura-luna-en', status: 'verified',
    },
    llmConfig: {
      providers: [
        { name: 'openai', apiKey: encryptSecret('sk-openai'), status: 'verified' },
        { name: 'anthropic', apiKey: '', status: 'unverified' },
        { name: 'google', apiKey: '', status: 'unverified' },
      ],
      defaultProvider: 'openai', defaultModel: 'gpt-4.1', temperature: 0.7,
    },
  };
}

beforeEach(() => mockConfigFindOne.mockReset());

describe('buildProviderConfig', () => {
  it('returns decrypted payload for verified keys', async () => {
    mockConfigFindOne.mockResolvedValue(verifiedConfig());
    await expect(buildProviderConfig(ownerId)).resolves.toEqual({
      stt: { api_key: 'dg-key', model: 'nova-3' },
      llm: { provider: 'openai', api_key: 'sk-openai', model: 'gpt-4.1', temperature: 0.7 },
      tts: { api_key: 'dg-key', voice: 'aura-luna-en' },
    });
    expect(mockConfigFindOne).toHaveBeenCalledWith({ ownerId });
  });

  it('throws ProviderConfigError when no config exists', async () => {
    mockConfigFindOne.mockResolvedValue(null);
    await expect(buildProviderConfig(ownerId)).rejects.toThrow(ProviderConfigError);
  });

  it('throws when deepgram key is unverified', async () => {
    const cfg = verifiedConfig();
    cfg.deepgramConfig.status = 'unverified';
    mockConfigFindOne.mockResolvedValue(cfg);
    await expect(buildProviderConfig(ownerId)).rejects.toThrow(/verify/i);
  });

  it('throws when the default LLM provider key is missing', async () => {
    const cfg = verifiedConfig();
    cfg.llmConfig.defaultProvider = 'anthropic';
    mockConfigFindOne.mockResolvedValue(cfg);
    await expect(buildProviderConfig(ownerId)).rejects.toThrow(ProviderConfigError);
  });
});
