# BYO-Key Per-User Provider Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each user account stores its own Deepgram (STT+TTS) and LLM (OpenAI/Anthropic/Google) API keys, encrypted, via the existing Configuration page; every call runs on the call owner's keys delivered through LiveKit dispatch metadata; provider keys leave the agent's `.env.local`.

**Architecture:** `Configuration` becomes a per-user document (`ownerId`, unique). Keys are AES-256-GCM-encrypted at rest and masked on read. At dispatch time the server resolves campaign → owner → config, gates on verified keys, decrypts, and embeds a `provider_config` block in the job metadata. The Python agent builds its STT/LLM/TTS plugins from that block and fails fast without it. The frontend keeps the existing page design: Twilio and ElevenLabs cards removed, Deepgram card covers one key + STT model + Aura TTS voice, LLM card keeps three providers with refreshed model lists.

**Tech Stack:** Fastify + Mongoose + TypeScript (server, Node ≥18 global `fetch`), Jest, React/Vite (client, no unit tests — `npm run build` is the check), LiveKit Agents Python ~1.6 with `deepgram`/`openai`/`anthropic`/`google` plugins, pytest, `uv`.

**Spec:** `docs/superpowers/specs/2026-07-12-byok-provider-config-design.md`

## Global Constraints

- Commits are surgical: `git add <exact paths>` only — never `-A`/`-am`. Tree is clean at plan start; keep it that way.
- Canonical LLM provider names are lowercase: `openai`, `anthropic`, `google`.
- Encrypted-secret storage format: `enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`; master key from env `CONFIG_ENCRYPTION_KEY`.
- Masked key display format: `••••` + last 4 chars; a PUT value starting with `••••` means "unchanged".
- Strict BYO: no platform-key fallback anywhere; unconfigured/unverified keys block calls with actionable errors.
- Defaults: STT model `nova-3`, TTS voice `aura-2-thalia-en`, LLM `openai`/`gpt-4.1`, temperature `0.7`.
- Baselines before this plan: server `npx tsc --noEmit` clean, `npx jest` 53 tests green; client `npm run build` clean; agent `uv run --no-sync pytest` 15 pass / 2 pre-existing behavioral failures (harness gap, not regressions).
- Working directory for server commands: `/Users/dhruvsmac/Desktop/Project Lumina/server`; agent commands: `/Users/dhruvsmac/Desktop/Project Lumina/livekit-agent`; client: `/Users/dhruvsmac/Desktop/Project Lumina/client`.

---

### Task 1: Secret cipher utility

**Files:**
- Create: `server/src/utils/secretCipher.ts`
- Test: `server/src/utils/__tests__/secretCipher.test.ts`

**Interfaces:**
- Consumes: nothing (node `crypto` only).
- Produces (used by Tasks 2, 4, 5, 8):
  - `encryptSecret(plain: string): string` — `''` in → `''` out; otherwise `enc:v1:…`.
  - `decryptSecret(stored: string): string` — passes through values not starting with `enc:` (plaintext tolerance for migration); throws on tampered ciphertext.
  - `isEncrypted(value: string): boolean`
  - `maskSecret(plain: string): string` — `''` → `''`; short values → `••••`; else `••••` + last 4 chars.

- [ ] **Step 1: Write the failing test**

`server/src/utils/__tests__/secretCipher.test.ts`:

```typescript
describe('secretCipher', () => {
  beforeEach(() => {
    process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';
    jest.resetModules();
  });

  const load = () => require('../secretCipher') as typeof import('../secretCipher');

  it('round-trips a secret', () => {
    const { encryptSecret, decryptSecret, isEncrypted } = load();
    const stored = encryptSecret('sk-live-abcdef123456');
    expect(stored).toMatch(/^enc:v1:/);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe('sk-live-abcdef123456');
  });

  it('returns empty for empty input', () => {
    const { encryptSecret, decryptSecret } = load();
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('passes plaintext through decrypt (migration tolerance)', () => {
    const { decryptSecret, isEncrypted } = load();
    expect(decryptSecret('sk-plaintext-legacy')).toBe('sk-plaintext-legacy');
    expect(isEncrypted('sk-plaintext-legacy')).toBe(false);
  });

  it('throws on tampered ciphertext', () => {
    const { encryptSecret, decryptSecret } = load();
    const stored = encryptSecret('secret');
    const parts = stored.split(':');
    parts[4] = Buffer.from('tampered!').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('throws when CONFIG_ENCRYPTION_KEY missing', () => {
    delete process.env.CONFIG_ENCRYPTION_KEY;
    const { encryptSecret } = load();
    expect(() => encryptSecret('x')).toThrow(/CONFIG_ENCRYPTION_KEY/);
  });

  it('masks secrets', () => {
    const { maskSecret } = load();
    expect(maskSecret('')).toBe('');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('sk-live-abcdef123456')).toBe('••••3456');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/utils/__tests__/secretCipher.test.ts`
Expected: FAIL — `Cannot find module '../secretCipher'`.

- [ ] **Step 3: Write the implementation**

`server/src/utils/secretCipher.ts`:

```typescript
import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function masterKey(): Buffer {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error('CONFIG_ENCRYPTION_KEY environment variable is not set');
  // Accept any string; derive a stable 32-byte key.
  return crypto.createHash('sha256').update(raw).digest();
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored; // plaintext tolerance during migration
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 6) return '••••';
  return `••••${plain.slice(-4)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest src/utils/__tests__/secretCipher.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/src/utils/secretCipher.ts server/src/utils/__tests__/secretCipher.test.ts
git commit -m "feat(config): AES-256-GCM secret cipher for BYO API keys"
```

---

### Task 2: Per-user Configuration model reshape

**Files:**
- Modify: `server/src/models/Configuration.ts` (full rewrite — current file is 983 lines of legacy Twilio/ElevenLabs/fallback machinery)
- Test: `server/src/models/__tests__/configuration.test.ts` (create; `server/src/models/__tests__/` may need creating)

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `maskSecret`, `isEncrypted` from `server/src/utils/secretCipher` (Task 1).
- Produces (used by Tasks 4, 5, 8):
  - `IConfiguration` with: `ownerId: ObjectId` (required, unique); `deepgramConfig { apiKey, sttModel, ttsVoice, isEnabled, status, lastVerified, lastError }`; `llmConfig { providers: [{ name: 'openai'|'anthropic'|'google', apiKey, status, lastVerified, lastError }], defaultProvider, defaultModel, temperature, maxTokens }`; `generalSettings`, `complianceSettings`, `webhookConfig`, `errorMessages`, `closingScripts`, `intentDetection`, `callResponses` kept as today (but no longer `required: true` — lazy per-user creation must succeed with defaults).
  - Instance method `getMaskedConfig(): object` — plain object with all `apiKey` fields replaced by `maskSecret(decryptSecret(value))`.
  - Pre-save hook encrypts any modified plaintext `apiKey` fields.
  - Static default: new docs get all three LLM providers pre-seeded with empty keys and `status: 'unverified'`.
- **Deleted:** `twilioConfig`, `elevenLabsConfig`, `ttsConfig`, `ragConfig`, `voiceAIConfig`, `deepgramConfig` legacy fields (fallbackModels, modelCompatibilityStatus, tier, retryAttempts, timeoutMs, firstTimeSetup*, accountTier, availableModels, primaryModel — replaced by `sttModel`).

- [ ] **Step 1: Write the failing test**

`server/src/models/__tests__/configuration.test.ts`:

```typescript
import mongoose from 'mongoose';

process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';
import Configuration from '../Configuration';
import { isEncrypted, decryptSecret } from '../../utils/secretCipher';

const ownerId = new mongoose.Types.ObjectId();

describe('Configuration model', () => {
  it('requires ownerId', () => {
    const doc = new Configuration({});
    const err = doc.validateSync();
    expect(err?.errors.ownerId).toBeDefined();
  });

  it('validates with only ownerId and sane defaults', () => {
    const doc = new Configuration({ ownerId });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.deepgramConfig.sttModel).toBe('nova-3');
    expect(doc.deepgramConfig.ttsVoice).toBe('aura-2-thalia-en');
    expect(doc.llmConfig.defaultProvider).toBe('openai');
    expect(doc.llmConfig.defaultModel).toBe('gpt-4.1');
    expect(doc.llmConfig.providers.map((p: any) => p.name)).toEqual([
      'openai', 'anthropic', 'google',
    ]);
  });

  it('rejects unknown llm provider names', () => {
    const doc = new Configuration({
      ownerId,
      llmConfig: { providers: [{ name: 'azure', apiKey: '' }] },
    });
    expect(doc.validateSync()).toBeDefined();
  });

  it('has no legacy provider fields', () => {
    const doc = new Configuration({ ownerId });
    expect((doc as any).twilioConfig).toBeUndefined();
    expect((doc as any).elevenLabsConfig).toBeUndefined();
    expect((doc as any).ttsConfig).toBeUndefined();
  });

  it('encrypts keys in pre-save hook and masks them in getMaskedConfig', async () => {
    const doc = new Configuration({ ownerId });
    doc.deepgramConfig.apiKey = 'dg-key-123456';
    doc.llmConfig.providers[0].apiKey = 'sk-openai-abcdef';
    // Run hook without a DB: execute pre('save') middleware directly.
    await new Promise<void>((resolve, reject) =>
      (doc as any).$__handleSave === undefined
        ? (doc.schema as any).s.hooks.execPre('save', doc, [], (e: any) => (e ? reject(e) : resolve()))
        : resolve(),
    );
    expect(isEncrypted(doc.deepgramConfig.apiKey)).toBe(true);
    expect(decryptSecret(doc.deepgramConfig.apiKey)).toBe('dg-key-123456');
    expect(isEncrypted(doc.llmConfig.providers[0].apiKey)).toBe(true);

    const masked = doc.getMaskedConfig!();
    expect(masked.deepgramConfig.apiKey).toBe('••••3456');
    expect(masked.llmConfig.providers[0].apiKey).toBe('••••cdef');
    expect(masked.llmConfig.providers[1].apiKey).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/models/__tests__/configuration.test.ts`
Expected: FAIL — defaults/fields don't match the legacy schema.

- [ ] **Step 3: Rewrite the model**

Replace `server/src/models/Configuration.ts` entirely:

```typescript
import mongoose from 'mongoose';
import { encryptSecret, decryptSecret, isEncrypted, maskSecret } from '../utils/secretCipher';

export type ProviderName = 'openai' | 'anthropic' | 'google';
export type VerifyStatus = 'unverified' | 'verified' | 'failed';

export interface ILlmProvider {
  name: ProviderName;
  apiKey: string;
  status: VerifyStatus;
  lastVerified?: Date | null;
  lastError?: string;
}

export interface IConfiguration extends mongoose.Document {
  ownerId: mongoose.Types.ObjectId;
  deepgramConfig: {
    apiKey: string;
    sttModel: string;
    ttsVoice: string;
    isEnabled: boolean;
    status: VerifyStatus;
    lastVerified?: Date | null;
    lastError?: string;
  };
  llmConfig: {
    providers: ILlmProvider[];
    defaultProvider: ProviderName;
    defaultModel: string;
    temperature: number;
    maxTokens: number;
  };
  generalSettings: {
    defaultLanguage: string;
    supportedLanguages: string[];
    maxConcurrentCalls: number;
    callRetryAttempts: number;
    callRetryDelay: number;
    maxCallDuration: number;
    defaultSystemPrompt: string;
    defaultTimeZone: string;
    workingHours: {
      start: string;
      end: string;
      timeZone: string;
      daysOfWeek: string[];
    };
  };
  complianceSettings: {
    recordCalls: boolean;
    callIntroduction?: string;
    maxCallsPerLeadPerDay: number;
    callBlackoutPeriod: { start: string; end: string };
  };
  webhookConfig: { secret: string; lastVerified?: Date | null; status?: VerifyStatus };
  errorMessages?: Record<string, string>;
  closingScripts?: Record<string, string>;
  intentDetection?: { closingPhrases?: string[]; objectionPhrases?: string[] };
  callResponses?: Record<string, string>;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  getMaskedConfig(): any;
}

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, enum: ['openai', 'anthropic', 'google'], required: true },
    apiKey: { type: String, default: '' },
    status: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
    lastVerified: { type: Date, default: null },
    lastError: { type: String, default: '' },
  },
  { _id: false },
);

const defaultProviders = () => [
  { name: 'openai', apiKey: '', status: 'unverified' },
  { name: 'anthropic', apiKey: '', status: 'unverified' },
  { name: 'google', apiKey: '', status: 'unverified' },
];

const ConfigurationSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    deepgramConfig: {
      apiKey: { type: String, default: '' },
      sttModel: { type: String, default: 'nova-3' },
      ttsVoice: { type: String, default: 'aura-2-thalia-en' },
      isEnabled: { type: Boolean, default: true },
      status: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
      lastVerified: { type: Date, default: null },
      lastError: { type: String, default: '' },
    },
    llmConfig: {
      providers: { type: [providerSchema], default: defaultProviders },
      defaultProvider: {
        type: String,
        enum: ['openai', 'anthropic', 'google'],
        default: 'openai',
      },
      defaultModel: { type: String, default: 'gpt-4.1' },
      temperature: { type: Number, min: 0, max: 2.0, default: 0.7 },
      maxTokens: { type: Number, min: 1, max: 32000, default: 150 },
    },
    generalSettings: {
      defaultLanguage: { type: String, default: 'English' },
      supportedLanguages: { type: [String], default: ['English', 'Hindi'] },
      maxConcurrentCalls: { type: Number, default: 10, min: 1, max: 100 },
      callRetryAttempts: { type: Number, default: 3, min: 0, max: 10 },
      callRetryDelay: { type: Number, default: 60, min: 15, max: 1440 },
      maxCallDuration: { type: Number, default: 300, min: 30, max: 3600 },
      defaultSystemPrompt: {
        type: String,
        default:
          'You are a professional sales representative making cold calls. Be polite, respectful, and helpful.',
      },
      defaultTimeZone: { type: String, default: 'America/New_York' },
      workingHours: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '18:00' },
        timeZone: { type: String, default: 'Asia/Kolkata' },
        daysOfWeek: {
          type: [String],
          enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        },
      },
    },
    complianceSettings: {
      recordCalls: { type: Boolean, default: true },
      callIntroduction: { type: String, default: '' },
      maxCallsPerLeadPerDay: { type: Number, default: 1, min: 1, max: 5 },
      callBlackoutPeriod: {
        start: { type: String, default: '21:00' },
        end: { type: String, default: '08:00' },
      },
    },
    webhookConfig: { secret: { type: String, default: '' } },
    errorMessages: { type: mongoose.Schema.Types.Mixed, default: {} },
    closingScripts: { type: mongoose.Schema.Types.Mixed, default: {} },
    intentDetection: {
      closingPhrases: { type: [String], default: [] },
      objectionPhrases: { type: [String], default: [] },
    },
    callResponses: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true },
);

// Encrypt any plaintext API keys before persisting.
ConfigurationSchema.pre('save', function (next) {
  try {
    const dg = this.deepgramConfig;
    if (dg?.apiKey && !isEncrypted(dg.apiKey)) dg.apiKey = encryptSecret(dg.apiKey);
    for (const p of this.llmConfig?.providers ?? []) {
      if (p.apiKey && !isEncrypted(p.apiKey)) p.apiKey = encryptSecret(p.apiKey);
    }
    next();
  } catch (err) {
    next(err as Error);
  }
});

ConfigurationSchema.methods.getMaskedConfig = function () {
  const obj = this.toObject();
  if (obj.deepgramConfig) {
    obj.deepgramConfig.apiKey = maskSecret(decryptSecret(obj.deepgramConfig.apiKey || ''));
  }
  for (const p of obj.llmConfig?.providers ?? []) {
    p.apiKey = maskSecret(decryptSecret(p.apiKey || ''));
  }
  return obj;
};

const Configuration = mongoose.model<IConfiguration>('Configuration', ConfigurationSchema);
export default Configuration;
```

- [ ] **Step 4: Run the model test**

Run: `cd server && npx jest src/models/__tests__/configuration.test.ts`
Expected: 5 tests PASS. (If the pre-save-hook invocation shim in the test proves brittle against the installed mongoose version, simplify the test to call the hook body via `doc.save()` against `mongodb-memory-server` **only if** that dep already exists; otherwise extract the hook body into an exported `encryptConfigKeys(doc)` helper in the model file and test that directly — keep the hook a one-line wrapper.)

- [ ] **Step 5: Find and fix compile breakage from the schema change**

Run: `cd server && npx tsc --noEmit`

Expected: errors in legacy consumers referencing deleted fields (`twilioConfig`, `elevenLabsConfig`, `ttsConfig`, `voiceAIConfig`, `ragConfig`, `primaryModel`, etc.). Survey them:

Run: `cd server && grep -rn "twilioConfig\|elevenLabsConfig\|ttsConfig\|voiceAIConfig\|ragConfig" src --include='*.ts' -l`

Known consumers (verify against grep output): `controllers/configurationController.ts` (rewritten in Task 4 — for now it will be the bulk of errors; proceed to Task 4 before demanding a clean tsc), `services/aiOrchestrationService.ts`, `services/egressService.ts` (uses `complianceSettings.recordCalls` — unaffected), possibly `controllers/modelManagementController.ts`. For consumers OTHER than the two controllers rewritten in Task 4: update references to the new fields or delete dead code paths, smallest change that compiles. Do not refactor beyond that.

- [ ] **Step 6: Commit (model + non-controller consumers)**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/src/models/Configuration.ts server/src/models/__tests__/configuration.test.ts
git add <each additional consumer file actually touched>
git commit -m "feat(config): per-user Configuration model with encrypted BYO keys"
```

Note: `npx tsc --noEmit` is allowed to still fail inside `configurationController.ts`/`configurationRoutes.ts` after this commit; Task 4 fixes them. Record this in the task report.

---

### Task 3: Provider key verification service

**Files:**
- Create: `server/src/services/providerVerificationService.ts`
- Test: `server/src/services/__tests__/providerVerificationService.test.ts`

**Interfaces:**
- Consumes: global `fetch` (Node ≥18).
- Produces (used by Task 4):
  - `type VerifyResult = { ok: boolean; error?: string }`
  - `verifyDeepgramKey(apiKey: string): Promise<VerifyResult>` — `GET https://api.deepgram.com/v1/projects`, header `Authorization: Token <key>`.
  - `verifyLlmKey(provider: 'openai' | 'anthropic' | 'google', apiKey: string): Promise<VerifyResult>` —
    - openai: `GET https://api.openai.com/v1/models`, `Authorization: Bearer <key>`
    - anthropic: `GET https://api.anthropic.com/v1/models`, headers `x-api-key: <key>`, `anthropic-version: 2023-06-01`
    - google: `GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>`

- [ ] **Step 1: Write the failing test**

`server/src/services/__tests__/providerVerificationService.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/services/__tests__/providerVerificationService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`server/src/services/providerVerificationService.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest src/services/__tests__/providerVerificationService.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/src/services/providerVerificationService.ts server/src/services/__tests__/providerVerificationService.test.ts
git commit -m "feat(config): live key verification for Deepgram/OpenAI/Anthropic/Google"
```

---

### Task 4: Per-user configuration controller + routes rewrite

**Files:**
- Modify: `server/src/controllers/configurationController.ts` (full rewrite — replaces ~1,400 lines of legacy handlers)
- Modify: `server/src/routes/configurationRoutes.ts` (full rewrite)
- Delete if now-unreferenced: `server/src/controllers/modelManagementController.ts` (verify with grep before deleting)
- Test: `server/src/controllers/__tests__/configurationController.test.ts` (create)

**Interfaces:**
- Consumes: `Configuration` model (Task 2), `verifyDeepgramKey`/`verifyLlmKey` (Task 3), `decryptSecret` (Task 1). `request.user` is the full user object set by `middleware/auth.ts` (`request.user._id`, `request.user.role`).
- Produces (used by client, Task 7):
  - `GET /api/configuration/` → masked per-user config (lazy-created on first read with `ownerId = request.user._id`).
  - `PUT /api/configuration/` → body `{ deepgramConfig?, llmConfig?, generalSettings?, complianceSettings? }`. API-key values starting with `••••` (or empty when a key already exists) leave the stored key untouched; any other value replaces the key and resets that provider's `status` to `'unverified'`. Responds with masked config.
  - `POST /api/configuration/verify-deepgram` → runs live check on stored key, updates `status/lastVerified/lastError`, returns `{ ok, status, error? }`.
  - `POST /api/configuration/verify-llm` body `{ provider }` → same for that provider entry.
  - `GET /api/configuration/llm-options` → static refreshed catalog (exact shape below).
  - `GET /api/configuration/voice-options` → `{ voices: [{ value, name }] }` Aura catalog (exact list below).
- All legacy endpoints removed: test-twilio, test-elevenlabs, test-deepgram-tts, test-voice, test-call, api-key delete, llm-models/dynamic, test-llm-chat, all Deepgram model-management routes, `modelManagementController` routes.

**LLM options catalog (single source, exported for tests):**

```typescript
export const LLM_OPTIONS = {
  providers: [
    {
      name: 'OpenAI', value: 'openai',
      models: [
        { name: 'GPT-4.1', value: 'gpt-4.1' },
        { name: 'GPT-4.1 mini', value: 'gpt-4.1-mini' },
        { name: 'GPT-4o', value: 'gpt-4o' },
        { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
      ],
    },
    {
      name: 'Anthropic', value: 'anthropic',
      models: [
        { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
        { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
        { name: 'Claude Opus 4.1', value: 'claude-opus-4-1' },
      ],
    },
    {
      name: 'Google', value: 'google',
      models: [
        { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
        { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
        { name: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
      ],
    },
  ],
};

export const AURA_VOICES = [
  'aura-2-thalia-en', 'aura-asteria-en', 'aura-luna-en', 'aura-stella-en',
  'aura-athena-en', 'aura-hera-en', 'aura-orion-en', 'aura-arcas-en',
  'aura-perseus-en', 'aura-angus-en', 'aura-orpheus-en', 'aura-helios-en',
  'aura-zeus-en',
].map((v) => ({ value: v, name: v.replace(/^aura(-2)?-/, '').replace(/-en$/, '') }));
```

- [ ] **Step 1: Write the failing tests**

`server/src/controllers/__tests__/configurationController.test.ts` — follow the module-mock pattern used in `server/src/integrations/livekit/__tests__/dispatchService.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest src/controllers/__tests__/configurationController.test.ts`
Expected: FAIL — new exports don't exist yet.

- [ ] **Step 3: Rewrite the controller**

Replace `server/src/controllers/configurationController.ts` with a lean per-user controller exporting exactly: `getSystemConfiguration`, `updateSystemConfiguration`, `verifyDeepgram`, `verifyLlm`, `getLLMOptions`, `getVoiceOptions`, `LLM_OPTIONS`, `AURA_VOICES`. Implementation outline (write it fully, no legacy carry-over):

```typescript
import { FastifyReply, FastifyRequest } from 'fastify';
import Configuration from '../models/Configuration';
import { verifyDeepgramKey, verifyLlmKey } from '../services/providerVerificationService';
import { decryptSecret } from '../utils/secretCipher';
import logger, { getErrorMessage } from '../utils/logger';

// LLM_OPTIONS and AURA_VOICES exactly as in the Interfaces section above.

const MASK_PREFIX = '••••';
const isPlaceholder = (v: unknown) => typeof v !== 'string' || v === '' || v.startsWith(MASK_PREFIX);

async function configFor(req: FastifyRequest) {
  const ownerId = (req.user as any)._id;
  return (await Configuration.findOne({ ownerId })) ?? (await Configuration.create({ ownerId }));
}

export const getSystemConfiguration = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const doc = await configFor(req);
    res.status(200).send(doc.getMaskedConfig());
  } catch (error) {
    logger.error(`getSystemConfiguration failed: ${getErrorMessage(error)}`);
    res.status(500).send({ message: 'Failed to load configuration' });
  }
};

export const updateSystemConfiguration = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = (req.body ?? {}) as any;
    const doc = await configFor(req);

    if (body.deepgramConfig) {
      const dg = body.deepgramConfig;
      if (!isPlaceholder(dg.apiKey)) {
        doc.deepgramConfig.apiKey = dg.apiKey;
        doc.deepgramConfig.status = 'unverified';
      }
      if (typeof dg.sttModel === 'string' && dg.sttModel) doc.deepgramConfig.sttModel = dg.sttModel;
      if (typeof dg.ttsVoice === 'string' && dg.ttsVoice) doc.deepgramConfig.ttsVoice = dg.ttsVoice;
      if (typeof dg.isEnabled === 'boolean') doc.deepgramConfig.isEnabled = dg.isEnabled;
    }

    if (body.llmConfig) {
      for (const incoming of body.llmConfig.providers ?? []) {
        const target = doc.llmConfig.providers.find((p) => p.name === incoming.name);
        if (!target) continue;
        if (!isPlaceholder(incoming.apiKey)) {
          target.apiKey = incoming.apiKey;
          target.status = 'unverified';
          target.lastError = '';
        }
      }
      const { defaultProvider, defaultModel, temperature, maxTokens } = body.llmConfig;
      if (defaultProvider) doc.llmConfig.defaultProvider = defaultProvider;
      if (defaultModel) doc.llmConfig.defaultModel = defaultModel;
      if (typeof temperature === 'number') doc.llmConfig.temperature = temperature;
      if (typeof maxTokens === 'number') doc.llmConfig.maxTokens = maxTokens;
    }

    if (body.generalSettings) Object.assign(doc.generalSettings, body.generalSettings);
    if (body.complianceSettings) Object.assign(doc.complianceSettings, body.complianceSettings);
    doc.updatedBy = (req.user as any)._id;

    await doc.save();
    res.status(200).send(doc.getMaskedConfig());
  } catch (error) {
    logger.error(`updateSystemConfiguration failed: ${getErrorMessage(error)}`);
    res.status(500).send({ message: 'Failed to save configuration' });
  }
};

export const verifyDeepgram = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const doc = await configFor(req);
    const result = await verifyDeepgramKey(decryptSecret(doc.deepgramConfig.apiKey || ''));
    doc.deepgramConfig.status = result.ok ? 'verified' : 'failed';
    doc.deepgramConfig.lastVerified = result.ok ? new Date() : doc.deepgramConfig.lastVerified;
    doc.deepgramConfig.lastError = result.ok ? '' : result.error || 'verification failed';
    await doc.save();
    res.status(200).send({ ok: result.ok, status: doc.deepgramConfig.status, error: result.error });
  } catch (error) {
    res.status(500).send({ message: getErrorMessage(error) });
  }
};

export const verifyLlm = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider } = (req.body ?? {}) as { provider?: string };
    const doc = await configFor(req);
    const target = doc.llmConfig.providers.find((p) => p.name === provider);
    if (!target) {
      res.status(400).send({ message: `Unknown provider: ${provider}` });
      return;
    }
    const result = await verifyLlmKey(target.name, decryptSecret(target.apiKey || ''));
    target.status = result.ok ? 'verified' : 'failed';
    target.lastVerified = result.ok ? new Date() : target.lastVerified;
    target.lastError = result.ok ? '' : result.error || 'verification failed';
    await doc.save();
    res.status(200).send({ ok: result.ok, status: target.status, error: result.error });
  } catch (error) {
    res.status(500).send({ message: getErrorMessage(error) });
  }
};

export const getLLMOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  res.status(200).send(LLM_OPTIONS);
};

export const getVoiceOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  res.status(200).send({ voices: AURA_VOICES });
};
```

- [ ] **Step 4: Rewrite the routes**

Replace `server/src/routes/configurationRoutes.ts`:

```typescript
import {
  getSystemConfiguration,
  updateSystemConfiguration,
  verifyDeepgram,
  verifyLlm,
  getLLMOptions,
  getVoiceOptions,
} from '../controllers/configurationController';

const configurationRoutes = async (fastify: any, _opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', getSystemConfiguration);
  fastify.put('/', updateSystemConfiguration);
  fastify.post('/verify-deepgram', verifyDeepgram);
  fastify.post('/verify-llm', verifyLlm);
  fastify.get('/llm-options', getLLMOptions);
  fastify.get('/voice-options', getVoiceOptions);
};

export default configurationRoutes;
```

Check `modelManagementController` for other references: `grep -rn "modelManagementController" server/src --include='*.ts'`. If only the old routes file referenced it, `git rm server/src/controllers/modelManagementController.ts`. Same check for any helper modules that only the deleted legacy handlers used (`grep` each import that disappears from the controller); remove ones that become orphaned.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd server && npx jest src/controllers/__tests__/configurationController.test.ts && npx tsc --noEmit`
Expected: new suite PASS; tsc CLEAN (this task must clear any residue Task 2 left in these two files). If other files still reference deleted controller exports (`grep -rn "testTwilioConnection\|verifyElevenLabsApiKey\|getDynamicProviderModels" server/src`), fix or delete those references now.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npx jest`
Expected: all suites PASS (53 baseline + new; some legacy suites may have referenced removed exports — fix them, don't skip them).

- [ ] **Step 7: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/src/controllers/configurationController.ts server/src/routes/configurationRoutes.ts server/src/controllers/__tests__/configurationController.test.ts
git add <any deleted/fixed files from steps 4-6>
git commit -m "feat(config): per-user BYO-key configuration API with verify endpoints"
```

---

### Task 5: provider_config in dispatch metadata

**Files:**
- Create: `server/src/integrations/livekit/providerConfig.ts`
- Modify: `server/src/integrations/livekit/types.ts` (extend `LiveKitDispatchMetadata`)
- Modify: `server/src/integrations/livekit/dispatchService.ts` (`initiateLiveKitCall`)
- Modify: `server/src/controllers/batchCallController.ts` (gate `createBatch`)
- Modify: the HTTP handler that calls `callService.initiateCall` (locate with `grep -rn "initiateCall" server/src/controllers`) — map `ProviderConfigError` → 400
- Test: `server/src/integrations/livekit/__tests__/providerConfig.test.ts` (create), `server/src/integrations/livekit/__tests__/dispatchService.test.ts` (extend)

**Interfaces:**
- Consumes: `Configuration` model (Task 2), `decryptSecret` (Task 1), `Campaign.createdBy`.
- Produces (used by Task 6 agent and Task 8 scripts):

```typescript
// types.ts additions
export interface ProviderConfigPayload {
  stt: { api_key: string; model: string };
  llm: { provider: string; api_key: string; model: string; temperature: number };
  tts: { api_key: string; voice: string };
}
// LiveKitDispatchMetadata gains:
//   provider_config: ProviderConfigPayload;

// providerConfig.ts
export class ProviderConfigError extends Error {}          // → HTTP 400 at the route layer
export async function buildProviderConfig(ownerId: string): Promise<ProviderConfigPayload>;
```

- `buildProviderConfig` throws `ProviderConfigError('Configure and verify your API keys in Configuration before calling.')` when: no Configuration doc, Deepgram key empty/unverified, or the `defaultProvider`'s key empty/unverified.

- [ ] **Step 1: Write the failing tests**

`server/src/integrations/livekit/__tests__/providerConfig.test.ts`:

```typescript
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
```

Extend `dispatchService.test.ts` — in the existing `initiateLiveKitCall` describe block:
1. Add module mocks at the top of the file (alongside the existing ones):

```typescript
const mockBuildProviderConfig = jest.fn();
jest.mock('../providerConfig', () => ({
  __esModule: true,
  buildProviderConfig: (...a: any[]) => mockBuildProviderConfig(...a),
  ProviderConfigError: class ProviderConfigError extends Error {},
}));
```

2. In `beforeEach`, extend the campaign mock with an owner and default the resolver:

```typescript
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
```

3. New tests:

```typescript
it('embeds provider_config in dispatch metadata', async () => {
  mockCreateDispatch.mockResolvedValue({});
  await initiateLiveKitCall({ leadId, campaignId });
  const sent = JSON.parse(mockCreateDispatch.mock.calls[0][2].metadata);
  expect(sent.provider_config.llm.provider).toBe('openai');
  expect(sent.provider_config.stt.api_key).toBe('dg');
  expect(mockBuildProviderConfig).toHaveBeenCalledWith('64b0c0ffee0ddeadbeef0001');
});

it('rejects before creating a Call when provider config is unavailable', async () => {
  const { ProviderConfigError } = jest.requireMock('../providerConfig');
  mockBuildProviderConfig.mockRejectedValue(new ProviderConfigError('Configure and verify your API keys'));
  await expect(initiateLiveKitCall({ leadId, campaignId })).rejects.toThrow(/API keys/);
  expect(mockCallCtor).not.toHaveBeenCalled();
  expect(mockCreateDispatch).not.toHaveBeenCalled();
});
```

Also update the two existing `dispatchOutboundCall` tests: their `meta` fixture objects gain a `provider_config` field (any valid `ProviderConfigPayload` literal) so they satisfy the extended interface.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest src/integrations/livekit/__tests__/providerConfig.test.ts src/integrations/livekit/__tests__/dispatchService.test.ts`
Expected: FAIL — module and field don't exist.

- [ ] **Step 3: Implement**

`server/src/integrations/livekit/types.ts` — add above `LiveKitDispatchMetadata` and extend it:

```typescript
export interface ProviderConfigPayload {
  stt: { api_key: string; model: string };
  llm: { provider: string; api_key: string; model: string; temperature: number };
  tts: { api_key: string; voice: string };
}

export interface LiveKitDispatchMetadata {
  // ...existing nine fields unchanged...
  provider_config: ProviderConfigPayload;
}
```

`server/src/integrations/livekit/providerConfig.ts`:

```typescript
import Configuration from '../../models/Configuration';
import { decryptSecret } from '../../utils/secretCipher';
import { ProviderConfigPayload } from './types';

const GUIDANCE = 'Configure and verify your API keys in Configuration before calling.';

export class ProviderConfigError extends Error {
  constructor(message = GUIDANCE) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export async function buildProviderConfig(ownerId: string): Promise<ProviderConfigPayload> {
  const cfg = await Configuration.findOne({ ownerId });
  if (!cfg) throw new ProviderConfigError();

  const dg = cfg.deepgramConfig;
  if (!dg?.apiKey || dg.status !== 'verified') {
    throw new ProviderConfigError(`Deepgram key missing or unverified. ${GUIDANCE}`);
  }

  const providerName = cfg.llmConfig.defaultProvider;
  const llm = cfg.llmConfig.providers.find((p) => p.name === providerName);
  if (!llm?.apiKey || llm.status !== 'verified') {
    throw new ProviderConfigError(`LLM key for ${providerName} missing or unverified. ${GUIDANCE}`);
  }

  const dgKey = decryptSecret(dg.apiKey);
  return {
    stt: { api_key: dgKey, model: dg.sttModel },
    llm: {
      provider: providerName,
      api_key: decryptSecret(llm.apiKey),
      model: cfg.llmConfig.defaultModel,
      temperature: cfg.llmConfig.temperature,
    },
    tts: { api_key: dgKey, voice: dg.ttsVoice },
  };
}
```

`dispatchService.ts` — in `initiateLiveKitCall`, after the campaign/script guards and **before** `new Call(...)`:

```typescript
const ownerId = campaign.createdBy?.toString();
if (!ownerId) throw new ProviderConfigError('Campaign has no owner; cannot resolve API keys.');
const providerConfig = await buildProviderConfig(ownerId);
```

and add to the `dispatchOutboundCall({ ... })` payload: `provider_config: providerConfig,`. Import both names from `./providerConfig`.

`batchCallController.ts` — in `createBatch`, right after the existing campaign-ownership check, gate the whole batch:

```typescript
import { buildProviderConfig, ProviderConfigError } from '../integrations/livekit/providerConfig';
// inside createBatch, campaign already loaded:
try {
  await buildProviderConfig(campaign.createdBy.toString());
} catch (err) {
  if (err instanceof ProviderConfigError) {
    res.status(400).send({ message: err.message });
    return;
  }
  throw err;
}
```

Single-call HTTP handler (found via `grep -rn "initiateCall" server/src/controllers`) — wrap the service call:

```typescript
if (error instanceof ProviderConfigError) {
  res.status(400).send({ message: error.message });
  return;
}
```

(add to its existing catch block, keeping current error handling for other errors).

- [ ] **Step 4: Run tests + typecheck + full suite**

Run: `cd server && npx jest && npx tsc --noEmit`
Expected: all PASS/clean. Watch for other compile sites constructing `LiveKitDispatchMetadata` (e.g. batch service) — they now need `provider_config`; batch flows through `initiateLiveKitCall`, so only tests and gate scripts construct it directly.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/src/integrations/livekit/providerConfig.ts server/src/integrations/livekit/types.ts server/src/integrations/livekit/dispatchService.ts server/src/controllers/batchCallController.ts server/src/integrations/livekit/__tests__/providerConfig.test.ts server/src/integrations/livekit/__tests__/dispatchService.test.ts
git add <single-call controller file>
git commit -m "feat(livekit): per-owner provider_config in dispatch metadata, gated on verified keys"
```

---

### Task 6: Agent consumes provider_config

**Files:**
- Create: `livekit-agent/providers.py`
- Modify: `livekit-agent/agent.py` (entrypoint + session construction; remove ElevenLabs)
- Modify: `livekit-agent/pyproject.toml` (swap `elevenlabs` extra for `anthropic`)
- Modify: `livekit-agent/.env.example` (drop provider keys)
- Test: `livekit-agent/tests/test_providers.py` (create)

**Interfaces:**
- Consumes: `meta["provider_config"]` — the `ProviderConfigPayload` JSON from Task 5.
- Produces:

```python
@dataclass(frozen=True)
class ProviderConfig:
    stt_api_key: str; stt_model: str
    llm_provider: str; llm_api_key: str; llm_model: str; llm_temperature: float
    tts_api_key: str; tts_voice: str

def parse_provider_config(meta: dict) -> ProviderConfig | None   # None on missing/malformed
def build_stt(cfg: ProviderConfig)   # deepgram.STT
def build_llm(cfg: ProviderConfig)   # openai/anthropic/google LLM; ValueError on unknown provider
def build_tts(cfg: ProviderConfig)   # deepgram.TTS
```

- [ ] **Step 1: Add the anthropic plugin dependency**

In `livekit-agent/pyproject.toml` change the extras line to:

```toml
    "livekit-agents[anthropic,deepgram,google,openai,silero,turn-detector]~=1.5",
```

(`elevenlabs` removed, `anthropic` added.) Then:

Run: `cd livekit-agent && uv sync`
Expected: resolves and installs `livekit-plugins-anthropic`; verify with `uv run --no-sync python -c "from livekit.plugins import anthropic; print(anthropic.LLM)"`.

- [ ] **Step 2: Verify constructor signatures against the installed SDK**

Run:

```bash
cd livekit-agent && uv run --no-sync python -c "
import inspect
from livekit.plugins import deepgram, openai, anthropic, google
print('dg stt:', 'api_key' in inspect.signature(deepgram.STT.__init__).parameters)
print('dg tts:', 'api_key' in inspect.signature(deepgram.TTS.__init__).parameters)
print('oai responses:', 'api_key' in inspect.signature(openai.responses.LLM.__init__).parameters)
print('anthropic:', 'api_key' in inspect.signature(anthropic.LLM.__init__).parameters)
print('google:', 'api_key' in inspect.signature(google.LLM.__init__).parameters)
"
```

Expected: all `True`. If `openai.responses.LLM` lacks `api_key`, use `openai.LLM(model=…, api_key=…)` instead in `build_llm` and note it in the task report. If `google.LLM` requires `vertexai=False` or a different kwarg name (some versions use `api_key`, some read `GOOGLE_API_KEY`), match what the signature shows and record the deviation.

- [ ] **Step 3: Write the failing tests**

`livekit-agent/tests/test_providers.py`:

```python
import pytest

from providers import ProviderConfig, parse_provider_config, build_llm, build_stt, build_tts

VALID_META = {
    "call_id": "abc",
    "provider_config": {
        "stt": {"api_key": "dg-key", "model": "nova-3"},
        "llm": {"provider": "openai", "api_key": "sk-oai", "model": "gpt-4.1", "temperature": 0.7},
        "tts": {"api_key": "dg-key", "voice": "aura-luna-en"},
    },
}


def cfg_for(provider: str) -> ProviderConfig:
    return ProviderConfig(
        stt_api_key="dg-key", stt_model="nova-3",
        llm_provider=provider, llm_api_key="k", llm_model="m", llm_temperature=0.7,
        tts_api_key="dg-key", tts_voice="aura-luna-en",
    )


def test_parse_valid_metadata():
    cfg = parse_provider_config(VALID_META)
    assert cfg is not None
    assert cfg.stt_api_key == "dg-key"
    assert cfg.llm_provider == "openai"
    assert cfg.tts_voice == "aura-luna-en"


@pytest.mark.parametrize("meta", [
    {},                                             # missing block
    {"provider_config": None},                      # null
    {"provider_config": {"stt": {}}},               # missing sections
    {"provider_config": {"stt": {"api_key": ""}, "llm": {}, "tts": {}}},  # empty keys
])
def test_parse_rejects_bad_metadata(meta):
    assert parse_provider_config(meta) is None


def test_build_stt_and_tts_are_deepgram():
    from livekit.plugins import deepgram
    cfg = cfg_for("openai")
    assert isinstance(build_stt(cfg), deepgram.STT)
    assert isinstance(build_tts(cfg), deepgram.TTS)


def test_build_llm_selects_plugin_per_provider():
    from livekit.plugins import anthropic, google
    assert isinstance(build_llm(cfg_for("anthropic")), anthropic.LLM)
    assert isinstance(build_llm(cfg_for("google")), google.LLM)
    build_llm(cfg_for("openai"))  # constructs without raising


def test_build_llm_rejects_unknown_provider():
    with pytest.raises(ValueError):
        build_llm(cfg_for("azure"))
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd livekit-agent && uv run --no-sync pytest tests/test_providers.py -v`
Expected: FAIL — `ModuleNotFoundError: providers`.

- [ ] **Step 5: Implement providers.py**

`livekit-agent/providers.py`:

```python
"""Build STT/LLM/TTS plugins from the per-call provider_config dispatched by the
Lumina server (BYO-key SaaS: keys come from the call owner's Configuration,
never from this process's environment)."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from livekit.plugins import anthropic, deepgram, google, openai

logger = logging.getLogger("lumina-outbound")


@dataclass(frozen=True)
class ProviderConfig:
    stt_api_key: str
    stt_model: str
    llm_provider: str
    llm_api_key: str
    llm_model: str
    llm_temperature: float
    tts_api_key: str
    tts_voice: str


def parse_provider_config(meta: dict) -> ProviderConfig | None:
    pc = meta.get("provider_config")
    if not isinstance(pc, dict):
        return None
    try:
        stt, llm, tts = pc["stt"], pc["llm"], pc["tts"]
        cfg = ProviderConfig(
            stt_api_key=stt["api_key"],
            stt_model=stt.get("model", "nova-3"),
            llm_provider=llm["provider"],
            llm_api_key=llm["api_key"],
            llm_model=llm["model"],
            llm_temperature=float(llm.get("temperature", 0.7)),
            tts_api_key=tts["api_key"],
            tts_voice=tts.get("voice", "aura-2-thalia-en"),
        )
    except (KeyError, TypeError, ValueError) as e:
        logger.error("malformed provider_config: %s", e)
        return None
    if not (cfg.stt_api_key and cfg.llm_api_key and cfg.tts_api_key):
        logger.error("provider_config has empty api keys")
        return None
    return cfg


def build_stt(cfg: ProviderConfig) -> deepgram.STT:
    # language="en" matches the barge-in fix (fast interims on PSTN overlap).
    return deepgram.STT(model=cfg.stt_model, language="en", api_key=cfg.stt_api_key)


def build_llm(cfg: ProviderConfig):
    if cfg.llm_provider == "openai":
        return openai.responses.LLM(model=cfg.llm_model, api_key=cfg.llm_api_key)
    if cfg.llm_provider == "anthropic":
        return anthropic.LLM(model=cfg.llm_model, api_key=cfg.llm_api_key)
    if cfg.llm_provider == "google":
        return google.LLM(model=cfg.llm_model, api_key=cfg.llm_api_key)
    raise ValueError(f"unknown llm provider: {cfg.llm_provider}")


def build_tts(cfg: ProviderConfig) -> deepgram.TTS:
    # Deepgram Aura: the voice is the TTS model name.
    return deepgram.TTS(model=cfg.tts_voice, api_key=cfg.tts_api_key)
```

(Adjust constructor kwargs per Step 2's findings; keep temperature out of constructors unless Step 2 shows the plugin accepts it — the session-level default is acceptable and noted in the report if so.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd livekit-agent && uv run --no-sync pytest tests/test_providers.py -v`
Expected: all PASS.

- [ ] **Step 7: Wire the entrypoint**

In `livekit-agent/agent.py`:

1. Imports: remove `elevenlabs` from the `livekit.plugins` import; add `from providers import parse_provider_config, build_llm, build_stt, build_tts`. The `deepgram`/`openai` plugin imports remain only if still referenced elsewhere in the file — check and drop if not.
2. Delete the `DEFAULT_VOICE_ID = os.getenv("ELEVEN_DEFAULT_VOICE_ID", …)` line.
3. In `entrypoint`, right after `call_id`/`phone_number` are read and `lumina` is constructed, add the fail-fast gate:

```python
    provider_cfg = parse_provider_config(meta)
    if provider_cfg is None:
        logger.error("no provider_config in job metadata; aborting call_id=%s", call_id)
        if call_id:
            await lumina.post_outcome(call_id, "failed", "provider config missing")
        ctx.shutdown("provider config missing")
        return
```

4. Replace the hardcoded pipeline in `AgentSession(...)`:

```python
        stt=build_stt(provider_cfg),
        llm=build_llm(provider_cfg),
        tts=build_tts(provider_cfg),
```

(The existing comment block about nova-3/"en" moves to `build_stt` in providers.py — already there. `turn_handling`, noise cancellation, AMD, transfer logic untouched.)

- [ ] **Step 8: Run the full agent test suite**

Run: `cd livekit-agent && uv run --no-sync pytest -v`
Expected: prior tests still pass (15 baseline + new; the 2 pre-existing behavioral failures remain — not regressions). Any existing test that constructed an `AgentSession` or metadata fixture needs `provider_config` added to its fixture — update those fixtures with the `VALID_META["provider_config"]` block.

- [ ] **Step 9: Update .env.example**

In `livekit-agent/.env.example` remove `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `ELEVEN_API_KEY`, `ELEVEN_DEFAULT_VOICE_ID` lines; keep `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SIP_OUTBOUND_TRUNK_ID`, `LUMINA_API_URL`, `LUMINA_SERVICE_API_KEY`. Add a comment: `# Provider keys (Deepgram/LLM) are BYO per user — configured in the app, delivered per call.` Do NOT edit `.env.local` (user's live file — they remove keys themselves after verifying).

- [ ] **Step 10: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add livekit-agent/providers.py livekit-agent/tests/test_providers.py livekit-agent/agent.py livekit-agent/pyproject.toml livekit-agent/uv.lock livekit-agent/.env.example
git add <any test fixture files updated in step 8>
git commit -m "feat(agent): build STT/LLM/TTS from per-call provider_config; drop ElevenLabs"
```

---

### Task 7: Frontend Configuration page rework

**Files:**
- Modify: `client/src/services/configApi.ts` (align endpoints)
- Modify: `client/src/pages/Configuration.tsx` (remove Twilio + ElevenLabs; Deepgram card; LLM card rewire)

**Interfaces:**
- Consumes (Task 4 API): `GET /configuration`, `PUT /configuration`, `POST /configuration/verify-deepgram`, `POST /configuration/verify-llm {provider}`, `GET /configuration/llm-options`, `GET /configuration/voice-options`.
- Produces: no downstream code consumers; `npm run build` and manual QA are the gates.

No unit-test runner exists in the client — the check cycle is `npm run build` (tsc + vite) after each step.

- [ ] **Step 1: Rewrite configApi.ts surface**

Open `client/src/services/configApi.ts`; remove functions calling deleted endpoints (`test-twilio`, `test-elevenlabs`, `test-deepgram-tts`, `test-voice`, `test-call`, `api-key` delete, `llm-models/dynamic`, `test-llm-chat`, model-management routes). Keep/add exactly:

```typescript
getConfiguration()                    // GET /configuration
updateConfiguration(payload)          // PUT /configuration
verifyDeepgram()                      // POST /configuration/verify-deepgram
verifyLlm(provider: string)           // POST /configuration/verify-llm  body {provider}
getLLMOptions()                       // GET /configuration/llm-options
getVoiceOptions()                     // GET /configuration/voice-options
```

matching the file's existing axios/fetch wrapper style.

- [ ] **Step 2: Strip Twilio and ElevenLabs from Configuration.tsx**

Working through `client/src/pages/Configuration.tsx` (3,179 lines):

- State interface + `useState` initial object: delete `twilioAccountSid`, `twilioAuthToken`, `twilioPhoneNumber`, `twilioStatus`, all `elevenLabs*` fields, `deepgramTTS*`-fallback fields, TTS fallback-provider fields (`elevenlabs`/`deepgram` provider selector at lines ~2157-2158).
- Delete the Twilio card JSX, ElevenLabs card JSX (voice library, quota display, custom-voice limit toasts), the ElevenLabs/Deepgram-TTS debounce timers (`elevenLabsDebounceTimer`, `deepgramTTSDebounceTimer`) and their `useEffect`s, `loadVoices`-from-ElevenLabs logic, `testingVoice`/test-call dialog state and handlers that hit deleted endpoints.
- Delete Twilio validation in the save handler (the page currently blocks save on Twilio fields — memory: client still validates Twilio despite LiveKit-only backend).

Run after this step: `cd client && npm run build` — expect failures only in code not yet rewritten (next steps); fix forward, don't commit until green.

- [ ] **Step 3: Build the Deepgram card**

One card, same visual components (Card/CardTitle/Input/Select/Button) as the rest of the page:

- API key `Input` (type password) — displays the masked value from GET; editing replaces it wholesale. On save, send the field only if the user typed something that doesn't start with `••••`.
- "Verify" `Button` → `configApi.verifyDeepgram()` → toast + status badge from response (`ok`/`status`).
- STT model `Select`: options `nova-3` (default), `nova-2`.
- TTS voice `Select`: options from `configApi.getVoiceOptions()` (fetched on mount).
- Status badge pattern copied from the page's existing verified/failed chips.

State shape for this card:

```typescript
deepgram: {
  apiKey: string;        // masked from server, or user-typed replacement
  sttModel: string;
  ttsVoice: string;
  status: 'unverified' | 'verified' | 'failed';
}
```

- [ ] **Step 4: Rewire the LLM card**

Keep the card's existing layout: one key input + verify button + status badge per provider (OpenAI, Anthropic, Google), default-provider select, default-model select (models filtered to the selected provider from `getLLMOptions()`), temperature slider. Changes:

- Provider identity is the lowercase `value` (`openai`/`anthropic`/`google`) everywhere in state and payloads.
- Verify button per provider → `configApi.verifyLlm(provider)`.
- Model list comes from `getLLMOptions()` — delete any hardcoded model arrays and "dynamic model fetch" code paths.
- Save payload for the PUT:

```typescript
{
  deepgramConfig: { apiKey?, sttModel, ttsVoice },
  llmConfig: {
    providers: [{ name, apiKey? }, ...],   // apiKey omitted when untouched/masked
    defaultProvider, defaultModel, temperature,
  },
  generalSettings: { ...unchanged page section... },
  complianceSettings: { ...unchanged page section... },
}
```

- [ ] **Step 5: Reconcile load/save plumbing**

Update the GET→state mapping (currently lines ~640-700) and the save handler (~760-930) to the new state shape; remove the `SET`/`NOT SET` debug logging for deleted fields. General settings and compliance sections stay untouched.

- [ ] **Step 6: Build + lint**

Run: `cd client && npm run build && npm run lint`
Expected: both clean. Fix all errors (unused imports and dead handlers will surface here).

- [ ] **Step 7: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add client/src/pages/Configuration.tsx client/src/services/configApi.ts
git commit -m "feat(client): BYO-key Configuration page — Deepgram STT/TTS + LLM providers, Twilio/ElevenLabs removed"
```

If other client files import removed configApi functions (`grep -rn "testTwilioConnection\|testElevenLabsConnection\|testDeepgramTTSConnection" client/src`), fix them in this task and include them in the commit.

---

### Task 8: Migration script + gate-call owner support

**Files:**
- Create: `server/scripts/migrate-config-to-byok.js`
- Modify: `.superpowers/sdd/gate-call.cjs`

**Interfaces:**
- Consumes: Mongo collections `configurations`, `users`, `campaigns` (raw driver — no TS models in scripts, matching `server/scripts/migrate-campaigns-to-livekit.js`); cipher format from Task 1; `ProviderConfigPayload` shape from Task 5.
- Produces: idempotent one-shot migration; gate-call dispatches with a real owner's `provider_config`.

- [ ] **Step 1: Write the migration script**

`server/scripts/migrate-config-to-byok.js` (mirror the structure/arg-handling of `migrate-campaigns-to-livekit.js`: `MONGODB_URI` env, `--dry-run` flag, summary output):

```javascript
// Migrate the legacy singleton Configuration doc to per-user BYOK.
// Usage: node --env-file=.env scripts/migrate-config-to-byok.js [--dry-run]
// Requires MONGODB_URI and CONFIG_ENCRYPTION_KEY.
const crypto = require('crypto');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const PREFIX = 'enc:v1:';

function masterKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error('CONFIG_ENCRYPTION_KEY is required');
  return crypto.createHash('sha256').update(raw).digest();
}
function encryptSecret(plain) {
  if (!plain) return '';
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const configs = db.collection('configurations');
  const campaigns = db.collection('campaigns');

  const admin = await users.findOne({ role: 'admin' }, { sort: { createdAt: 1 } });
  if (!admin) throw new Error('No admin user found to own the legacy configuration');

  const legacy = await configs.findOne({ ownerId: { $exists: false } });
  if (!legacy) {
    console.log('No legacy (ownerless) configuration found — nothing to migrate.');
  } else {
    const set = { ownerId: admin._id };
    const unset = { twilioConfig: '', elevenLabsConfig: '', ttsConfig: '', ragConfig: '', voiceAIConfig: '' };

    // Deepgram: carry the old STT key forward into the new shape.
    const oldDgKey = legacy.deepgramConfig?.apiKey || '';
    set.deepgramConfig = {
      apiKey: encryptSecret(oldDgKey),
      sttModel: 'nova-3',
      ttsVoice: 'aura-2-thalia-en',
      isEnabled: true,
      status: 'unverified', // force re-verification under the new pipeline
      lastVerified: null,
      lastError: '',
    };

    // LLM: normalize names to lowercase, encrypt keys, keep only the 3 canonical providers.
    const canonical = ['openai', 'anthropic', 'google'];
    const oldProviders = legacy.llmConfig?.providers || [];
    set['llmConfig.providers'] = canonical.map((name) => {
      const old = oldProviders.find((p) => (p.name || '').toLowerCase() === name);
      return {
        name,
        apiKey: encryptSecret(old?.apiKey || ''),
        status: 'unverified',
        lastVerified: null,
        lastError: '',
      };
    });
    set['llmConfig.defaultProvider'] = (legacy.llmConfig?.defaultProvider || 'openai').toLowerCase();
    set['llmConfig.defaultModel'] = 'gpt-4.1';

    console.log(`Assigning legacy config ${legacy._id} to admin ${admin.email || admin._id}`);
    if (!DRY) await configs.updateOne({ _id: legacy._id }, { $set: set, $unset: unset });
  }

  // Campaign voices: anything that isn't an Aura voice is a legacy ElevenLabs id — clear it.
  const stale = await campaigns.countDocuments({
    'voiceConfiguration.voiceId': { $exists: true, $ne: '', $not: /^aura-/ },
  });
  console.log(`${stale} campaign(s) with legacy voice ids ${DRY ? '(dry-run, not modified)' : '— clearing'}`);
  if (!DRY && stale > 0) {
    await campaigns.updateMany(
      { 'voiceConfiguration.voiceId': { $exists: true, $ne: '', $not: /^aura-/ } },
      { $set: { 'voiceConfiguration.voiceId': '' } },
    );
  }

  await mongoose.disconnect();
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run against the dev database**

Run: `cd server && node --env-file=.env scripts/migrate-config-to-byok.js --dry-run`
Expected: prints the legacy config id + admin owner + stale campaign count, modifies nothing. Then run without `--dry-run` and re-run with `--dry-run` again to confirm idempotence ("No legacy (ownerless) configuration found").

- [ ] **Step 3: Update gate-call.cjs**

Extend `.superpowers/sdd/gate-call.cjs`: after the existing arg parsing, load the owner's config from Mongo and attach `provider_config` to `meta` (raw driver + inline decrypt — the script already requires from `server/node_modules`):

```javascript
// args: [phone] [callId] [transferTo] [--owner email]
const ownerFlag = process.argv.indexOf('--owner');
const ownerEmail = ownerFlag > -1 ? process.argv[ownerFlag + 1] : null;

async function loadProviderConfig() {
  const mongoose = require('/Users/dhruvsmac/Desktop/Project Lumina/server/node_modules/mongoose');
  const crypto = require('crypto');
  const PREFIX = 'enc:v1:';
  const key = crypto.createHash('sha256').update(process.env.CONFIG_ENCRYPTION_KEY || '').digest();
  const dec = (v) => {
    if (!v) return '';
    if (!v.startsWith(PREFIX)) return v;
    const [iv, tag, ct] = v.slice(PREFIX.length).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  };
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const owner = ownerEmail
    ? await db.collection('users').findOne({ email: ownerEmail })
    : await db.collection('users').findOne({ role: 'admin' });
  if (!owner) throw new Error(`owner not found${ownerEmail ? `: ${ownerEmail}` : ' (no admin user)'}`);
  const cfg = await db.collection('configurations').findOne({ ownerId: owner._id });
  if (!cfg) throw new Error(`no configuration for owner ${owner.email}`);
  const llm = cfg.llmConfig.providers.find((p) => p.name === cfg.llmConfig.defaultProvider);
  const dgKey = dec(cfg.deepgramConfig.apiKey);
  await mongoose.disconnect();
  return {
    stt: { api_key: dgKey, model: cfg.deepgramConfig.sttModel },
    llm: {
      provider: cfg.llmConfig.defaultProvider, api_key: dec(llm.apiKey),
      model: cfg.llmConfig.defaultModel, temperature: cfg.llmConfig.temperature,
    },
    tts: { api_key: dgKey, voice: cfg.deepgramConfig.ttsVoice },
  };
}
```

and inside the existing async IIFE, before `createDispatch`: `meta.provider_config = await loadProviderConfig();`. Update the usage comment at the top of the file (`node --env-file=server/.env .superpowers/sdd/gate-call.cjs [phone] [callId] [transferTo] [--owner email]` — note it now needs `MONGODB_URI` + `CONFIG_ENCRYPTION_KEY` in that env).

- [ ] **Step 4: Verify gate-call assembles config (no live call needed)**

Run: `cd "/Users/dhruvsmac/Desktop/Project Lumina" && node --env-file=server/.env -e "process.argv=[process.argv[0],'x']; /* smoke */" && echo "syntax ok"` — then the real check: temporarily add `console.log(JSON.stringify(meta.provider_config.llm.provider))` before dispatch OR run it against a wrong LIVEKIT_URL to fail after config assembly; simplest deterministic check:

Run: `cd "/Users/dhruvsmac/Desktop/Project Lumina" && LIVEKIT_URL= node --env-file=server/.env .superpowers/sdd/gate-call.cjs +910000000000 cfg-smoke 2>&1 | head -5`
Expected: exits with the "Missing LIVEKIT_URL" guard *after* successfully loading provider config — reorder the guard to run before Mongo access if it doesn't, and instead verify by pointing at a bogus phone with real env: config load errors (missing key/config) surface before dispatch. Whichever probe is used, the acceptance is: no exception from `loadProviderConfig()` with real env, and `meta.provider_config.stt.api_key` non-empty (log it masked: `dgKey.slice(-4)`).

- [ ] **Step 5: Commit**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/scripts/migrate-config-to-byok.js .superpowers/sdd/gate-call.cjs
git commit -m "feat(config): BYOK migration script + gate-call per-owner provider config"
```

---

### Task 9: Env examples, boot guard, full verification

**Files:**
- Modify: `server/.env.example` (add `CONFIG_ENCRYPTION_KEY`)
- Modify: `server/src/index.ts` (production boot guard)
- Verify: whole-repo build/test pass + live smoke

- [ ] **Step 1: Boot guard for the master key**

In `server/src/index.ts`, alongside the existing startup env handling (near the dotenv/config section at the top), add:

```typescript
if (process.env.NODE_ENV === 'production' && !process.env.CONFIG_ENCRYPTION_KEY) {
  // BYO keys cannot be decrypted without it; refuse to boot rather than fail per-call.
  throw new Error('CONFIG_ENCRYPTION_KEY must be set in production');
}
```

- [ ] **Step 2: Env examples**

`server/.env.example`: add under a `# BYO-key encryption` comment: `CONFIG_ENCRYPTION_KEY=change-me-32-bytes-random`. Remove any `TWILIO_*`, `ELEVENLABS_*`/`ELEVEN_*`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY` entries if still present (check first: `grep -nE "TWILIO|ELEVEN|DEEPGRAM|OPENAI" server/.env.example`).

Also add `CONFIG_ENCRYPTION_KEY` to the developer's real `server/.env` (generate: `openssl rand -hex 32`) — needed for the dev server and the Task 8 migration. Do not commit `.env`.

- [ ] **Step 3: Full verification sweep**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina/server" && npx tsc --noEmit && npx jest
cd "/Users/dhruvsmac/Desktop/Project Lumina/client" && npm run build
cd "/Users/dhruvsmac/Desktop/Project Lumina/livekit-agent" && uv run --no-sync pytest
```

Expected: tsc clean; all jest suites green; client build clean; pytest green except the 2 pre-existing behavioral failures.

Boot check (server must run Redis-free as before, now also loading the new model):

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina/server" && npm run dev &   # or restart existing dev server
sleep 15 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health/system   # expect 200
```

- [ ] **Step 4: Live smoke (user-dependent — keys + phone)**

Preconditions: migration ran (Task 8), user verified their Deepgram + at least one LLM key on the page, agent worker restarted on new code (`pkill -f "agent.py dev"; cd livekit-agent && uv run --no-sync python agent.py dev`).

- Place one frontend call (`POST /api/calls/initiate` path) per configured LLM provider; confirm: dial + conversation on Deepgram voice, transcript/outcome persisted, no `ELEVEN`/`OPENAI_API_KEY` env reads in agent logs.
- Negative check: with a second (fresh, unconfigured) user account, attempt a call → expect HTTP 400 "Configure and verify your API keys…".

- [ ] **Step 5: Commit + report**

```bash
cd "/Users/dhruvsmac/Desktop/Project Lumina"
git add server/.env.example server/src/index.ts
git commit -m "chore(config): CONFIG_ENCRYPTION_KEY boot guard + env example"
```

Report remaining user-dependent items (Task 9 Step 4 results, `.env.local` provider-key removal on the user's machine) in the final summary.

---

## Self-Review Notes

- Spec coverage: data model → Task 2; encryption → Tasks 1-2; call-flow gating + metadata → Task 5; verification endpoints → Tasks 3-4; agent → Task 6; frontend → Task 7; migration + gate-call → Task 8; boot guard/env/docs-of-env → Task 9. Spec's "README/docs" touch is limited to `.env.example` files (spec Stage/docs rewrite remains a deferred item from the previous plan, out of scope here).
- Type consistency: `ProviderConfigPayload` (Task 5) ⇄ agent `parse_provider_config` fields (Task 6) ⇄ gate-call assembly (Task 8) all use `stt/llm/tts` + `api_key/model/voice/provider/temperature` snake_case keys. Provider names lowercase everywhere (`LLM_OPTIONS.providers[].value`, model enum, metadata, agent switch).
- Known risk, called out in tasks: exact plugin constructor kwargs (`openai.responses.LLM(api_key=…)`, `google.LLM(api_key=…)`) are verified against the installed SDK in Task 6 Step 2 before use; mongoose pre-save hook test shim in Task 2 has an explicit fallback strategy.
