import {
  validateDatabaseLoadedConfig,
  validateDeepgramStartupConfig,
} from '../database-validation';

const lazyPerUserConfig = () => ({
  llmConfig: {
    providers: [
      { name: 'openai', apiKey: '', status: 'unverified' },
      { name: 'anthropic', apiKey: '', status: 'unverified' },
      { name: 'google', apiKey: '', status: 'unverified' },
    ],
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  deepgramConfig: {
    apiKey: '',
    sttModel: 'nova-3',
    ttsVoice: 'aura-2-thalia-en',
    isEnabled: true,
    status: 'unverified',
  },
});

describe('validateDatabaseLoadedConfig', () => {
  it('accepts lazy per-user defaults and ignores removed legacy providers', () => {
    const result = validateDatabaseLoadedConfig({
      ...lazyPerUserConfig(),
      elevenLabsConfig: { isEnabled: true, apiKey: '' },
      twilioConfig: { isEnabled: true, accountSid: '', authToken: '' },
    });

    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result.details ?? {})).not.toMatch(/ElevenLabs|Twilio/);
  });

  it('rejects a provider marked verified without an API key', () => {
    const config = lazyPerUserConfig();
    config.llmConfig.providers[0].status = 'verified';

    const result = validateDatabaseLoadedConfig(config);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('OpenAI LLM provider is verified but API key is missing');
  });

  it('reports the new Deepgram verification status without legacy model checks', () => {
    const config = lazyPerUserConfig();
    config.deepgramConfig.apiKey = 'encrypted-key';
    config.deepgramConfig.status = 'failed';
    Object.assign(config.deepgramConfig, {
      lastError: '401 Unauthorized',
      accountTier: 'free',
      primaryModel: 'nova-2',
    });

    const result = validateDatabaseLoadedConfig(config);

    expect(result.isValid).toBe(true);
    expect(result.details.warnings).toContain(
      'Deepgram verification failed: 401 Unauthorized',
    );
    expect(result.details.warnings.join(' ')).not.toMatch(/primary model|free tier/i);
  });
});

describe('validateDeepgramStartupConfig', () => {
  it('accepts a verified key with the new sttModel field', () => {
    expect(validateDeepgramStartupConfig({
      apiKey: 'encrypted-key',
      sttModel: 'nova-3',
      isEnabled: true,
      status: 'verified',
    })).toEqual({ isValid: true, error: undefined, details: undefined });
  });

  it('rejects missing sttModel even when a legacy primaryModel is present', () => {
    const result = validateDeepgramStartupConfig({
      apiKey: 'encrypted-key',
      primaryModel: 'nova-2',
      isEnabled: true,
      status: 'verified',
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('STT model not configured');
  });

  it('rejects an unverified Deepgram key', () => {
    const result = validateDeepgramStartupConfig({
      apiKey: 'encrypted-key',
      sttModel: 'nova-3',
      isEnabled: true,
      status: 'unverified',
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('has not been verified');
  });
});
