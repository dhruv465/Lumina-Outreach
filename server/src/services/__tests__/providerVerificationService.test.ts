import { verifyDeepgramKey, verifyLlmKey } from '../providerVerificationService';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => mockFetch.mockReset());

describe('verifyDeepgramKey', () => {
  it('ok on 200', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ projects: [] }));
    await expect(verifyDeepgramKey('dg-key')).resolves.toEqual({ ok: true });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.deepgram.com/v1/projects');
    expect(opts.headers.Authorization).toBe('Token dg-key');
  });

  it('fails with status on 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const res = await verifyDeepgramKey('bad');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });

  it('fails gracefully on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ENOTFOUND'));
    const res = await verifyDeepgramKey('dg-key');
    expect(res).toEqual({ ok: false, error: 'ENOTFOUND' });
  });

  it('rejects empty key without a network call', async () => {
    const res = await verifyDeepgramKey('');
    expect(res.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('verifyLlmKey', () => {
  it('openai hits models endpoint and returns filtered chat models', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-4.1' },
          { id: 'gpt-4o' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'gpt-3.5-turbo-instruct' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'o3-mini' },
          { id: 'dall-e-3' },
        ],
      }),
    );
    const res = await verifyLlmKey('openai', 'k');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    expect(res.ok).toBe(true);
    expect(res.models).toEqual([
      { name: 'gpt-4.1', value: 'gpt-4.1' },
      { name: 'gpt-4o', value: 'gpt-4o' },
      { name: 'o3-mini', value: 'o3-mini' },
    ]);
  });

  it('anthropic sends version header and maps display names', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
          { id: 'claude-haiku-4-5' },
        ],
      }),
    );
    const res = await verifyLlmKey('anthropic', 'sk-ant');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect(opts.headers['x-api-key']).toBe('sk-ant');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(res.models).toEqual([
      { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
      { name: 'claude-haiku-4-5', value: 'claude-haiku-4-5' },
    ]);
  });

  it('google filters to generateContent models and strips the models/ prefix', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Text Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }),
    );
    const res = await verifyLlmKey('google', 'g-key');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?key=g-key',
    );
    expect(res.models).toEqual([
      { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    ]);
  });

  it('still verifies when the body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });
    const res = await verifyLlmKey('openai', 'k');
    expect(res.ok).toBe(true);
    expect(res.models).toEqual([]);
  });

  it('fails with status on 401 and returns no models', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const res = await verifyLlmKey('openai', 'bad');
    expect(res).toEqual({ ok: false, error: 'provider returned HTTP 401' });
  });

  it('rejects unknown provider', async () => {
    const res = await verifyLlmKey('azure' as any, 'k');
    expect(res.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
