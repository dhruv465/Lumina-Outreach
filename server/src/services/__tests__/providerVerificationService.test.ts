import { verifyDeepgramKey, verifyLlmKey } from '../providerVerificationService';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => mockFetch.mockReset());

describe('verifyDeepgramKey', () => {
  it('ok on 200', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
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
  it.each([
    ['openai', 'https://api.openai.com/v1/models'],
    ['anthropic', 'https://api.anthropic.com/v1/models'],
  ] as const)('%s hits %s', async (provider, url) => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await expect(verifyLlmKey(provider, 'k')).resolves.toEqual({ ok: true });
    expect(mockFetch.mock.calls[0][0]).toBe(url);
  });

  it('anthropic sends version header and x-api-key', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await verifyLlmKey('anthropic', 'sk-ant');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('sk-ant');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('google passes key as query param', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await verifyLlmKey('google', 'g-key');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?key=g-key',
    );
  });

  it('rejects unknown provider', async () => {
    const res = await verifyLlmKey('azure' as any, 'k');
    expect(res.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
