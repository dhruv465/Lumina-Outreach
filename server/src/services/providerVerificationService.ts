export type ProviderModel = { name: string; value: string };
export type VerifyResult = { ok: boolean; error?: string; models?: ProviderModel[] };

const TIMEOUT_MS = 10_000;

async function probe(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; error?: string; body?: unknown }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `provider returned HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined; // key is valid even if the body is not JSON
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyDeepgramKey(apiKey: string): Promise<VerifyResult> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  const { ok, error } = await probe('https://api.deepgram.com/v1/projects', {
    Authorization: `Token ${apiKey}`,
  });
  return { ok, error };
}

// Chat-capable OpenAI models; the /v1/models list also contains embedding,
// audio, image, and moderation models that cannot drive a conversation.
const OPENAI_CHAT_ID = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NON_CHAT =
  /(audio|realtime|transcribe|tts|search|embedding|moderation|image|dall-e|whisper|instruct)/;

function parseOpenAiModels(body: unknown): ProviderModel[] {
  const data = (body as { data?: Array<{ id?: string }> })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((model) => model.id || '')
    .filter((id) => OPENAI_CHAT_ID.test(id) && !OPENAI_NON_CHAT.test(id))
    .sort()
    .map((id) => ({ name: id, value: id }));
}

function parseAnthropicModels(body: unknown): ProviderModel[] {
  const data = (body as { data?: Array<{ id?: string; display_name?: string }> })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((model) => model.id)
    .map((model) => ({ name: model.display_name || model.id!, value: model.id! }));
}

function parseGoogleModels(body: unknown): ProviderModel[] {
  const models = (
    body as {
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
    }
  )?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter(
      (model) =>
        model.name && model.supportedGenerationMethods?.includes('generateContent'),
    )
    .map((model) => ({
      name: model.displayName || model.name!,
      value: model.name!.replace(/^models\//, ''),
    }));
}

export async function verifyLlmKey(
  provider: 'openai' | 'anthropic' | 'google',
  apiKey: string,
): Promise<VerifyResult> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  switch (provider) {
    case 'openai': {
      const result = await probe('https://api.openai.com/v1/models', {
        Authorization: `Bearer ${apiKey}`,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, models: parseOpenAiModels(result.body) };
    }
    case 'anthropic': {
      const result = await probe('https://api.anthropic.com/v1/models', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      });
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, models: parseAnthropicModels(result.body) };
    }
    case 'google': {
      const result = await probe(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        {},
      );
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, models: parseGoogleModels(result.body) };
    }
    default:
      return { ok: false, error: `unknown provider: ${provider satisfies never}` };
  }
}
