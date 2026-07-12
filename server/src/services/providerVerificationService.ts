export type VerifyResult = { ok: boolean; error?: string };

const TIMEOUT_MS = 10_000;

async function probe(url: string, headers: Record<string, string>): Promise<VerifyResult> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return { ok: true };
    return { ok: false, error: `provider returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyDeepgramKey(apiKey: string): Promise<VerifyResult> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  return probe('https://api.deepgram.com/v1/projects', { Authorization: `Token ${apiKey}` });
}

export async function verifyLlmKey(
  provider: 'openai' | 'anthropic' | 'google',
  apiKey: string,
): Promise<VerifyResult> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  switch (provider) {
    case 'openai':
      return probe('https://api.openai.com/v1/models', { Authorization: `Bearer ${apiKey}` });
    case 'anthropic':
      return probe('https://api.anthropic.com/v1/models', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      });
    case 'google':
      return probe(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        {},
      );
    default:
      return { ok: false, error: `unknown provider: ${provider satisfies never}` };
  }
}
