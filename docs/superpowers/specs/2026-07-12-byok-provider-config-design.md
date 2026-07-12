# BYO-Key Provider Configuration (SaaS) — Design

Date: 2026-07-12
Status: Approved by user (chat), pending spec review

## Goal

Turn Lumina into a BYO-key SaaS: each user account stores its own TTS/STT/LLM
API keys in the database via the existing Configuration page, and every call
runs on that user's keys. The agent's `.env.local` stops carrying provider
keys; env holds platform infrastructure only (LiveKit, SIP trunk, Mongo,
internal service key).

Decisions locked with user:

- **Per-user tenancy.** Each user has their own `Configuration` document.
  Organizations/teams are out of scope.
- **STT and TTS are fixed to Deepgram.** One Deepgram key covers both.
  ElevenLabs is removed from the agent, schema, and page.
- **LLM is user's choice** among the three providers already present in the
  codebase: OpenAI, Anthropic, Google. Model lists refreshed to current
  models.
- **Key delivery: inside dispatch metadata.** Server decrypts keys at
  dispatch time and embeds them in the LiveKit job metadata. Accepted
  trade-off: keys transit and rest in LiveKit Cloud job records for the job's
  lifetime and are visible in the LiveKit dashboard. Upgrade path if posture
  needs tightening later: agent fetches the config bundle from the existing
  internal API (`LUMINA_SERVICE_API_KEY` auth) instead — the metadata shape
  below becomes the response shape, so the switch is contained.
- **Page design stays as-is.** Existing Configuration page structure and UX
  kept; Twilio and ElevenLabs cards removed; remaining cards rewired.
- **Strict BYO.** No platform-key fallback. Calls are blocked with a clear
  error until the user's keys are configured and verified.

## 1. Data model (server)

`server/src/models/Configuration.ts`:

- Add `ownerId: ObjectId ref User`, `required`, **unique index** — one config
  doc per user. Every `Configuration.findOne()` becomes
  `Configuration.findOne({ ownerId })`; controller creates the doc on first
  read for a user (same lazy-create pattern as today).
- `deepgramConfig` (reshaped): `apiKey` (encrypted), `sttModel` (default
  `nova-3`), `ttsVoice` (default `aura-2-thalia-en`; options = the Aura voice
  list already in the schema), `isEnabled`, `status`
  (`unverified|verified|failed`), `lastVerified`, `lastError`. The legacy
  Deepgram fallback/compatibility-tracking fields (fallbackModels,
  modelCompatibilityStatus, tier, retry/timeout knobs, first-time-setup
  flags) are dropped.
- `llmConfig` (kept, trimmed): `providers[{ name: 'openai'|'anthropic'|'google',
  apiKey (encrypted), status, lastVerified, lastError }]`, `defaultProvider`,
  `defaultModel`, `temperature`. `maxTokens` kept. Runtime `llmService`
  field dropped.
- **Deleted from schema:** `twilioConfig`, `elevenLabsConfig`,
  `ttsConfig` (the ElevenLabs/fallback-provider machinery), `ragConfig`
  ElevenLabs references. `voiceAIConfig` personalities keep only what the
  page still renders; ElevenLabs-specific voice settings go.
- `generalSettings`, `complianceSettings`, `webhookConfig`, error
  messages/closing scripts/intent detection: unchanged, now per-user.

### Encryption at rest

- AES-256-GCM, app-layer, in a small `server/src/utils/secretCipher.ts`
  (encrypt/decrypt/isEncrypted). Master key from `CONFIG_ENCRYPTION_KEY`
  (32-byte, platform env secret; server refuses to boot without it in
  production). Stored format: `enc:v1:<iv>:<tag>:<ciphertext>` (base64
  segments) so future rotation/versioning is possible.
- Keys are encrypted in a schema setter or pre-save hook; decrypted only at
  dispatch time and for verification calls.
- All GET/config responses return masked keys (`sk-…abc4`), reusing the
  existing `getMaskedConfig` pattern. The frontend never receives plaintext
  keys back.

## 2. Call flow (server)

`initiateLiveKitCall` (and the batch orchestrator once per batch):

1. Resolve the call's owner: `campaign.createdBy` (fallback: initiating
   user).
2. Load `Configuration.findOne({ ownerId })`.
3. Gate: Deepgram key present + `status === 'verified'`, AND the
   `defaultProvider`'s LLM key present + verified. Otherwise reject with
   HTTP 400 and message "Configure and verify your API keys in Configuration
   before calling." Batch: reject at batch creation with the same message.
4. Decrypt keys, extend the dispatch metadata
   (`server/src/integrations/livekit/types.ts`):

```jsonc
{
  // ...existing LiveKitDispatchMetadata fields...
  "provider_config": {
    "stt": { "api_key": "…", "model": "nova-3" },
    "llm": { "provider": "openai", "api_key": "…", "model": "gpt-4.1", "temperature": 0.7 },
    "tts": { "api_key": "…", "voice": "aura-2-thalia-en" }
  }
}
```

`voice_id` in the existing metadata now means a Deepgram Aura voice; the
`tts.voice` field is authoritative and `voice_id` is kept only for
back-compat during the transition.

### Verification endpoints

The page's per-provider "Verify" buttons hit live checks (existing
controller endpoints reworked):

- Deepgram: authenticated projects/balance request.
- OpenAI / Anthropic / Google: list-models (or minimal completions) request.

Success/failure updates `status`, `lastVerified`, `lastError` — the fields
the page already renders. `GET /api/configuration/llm-options` model lists
refreshed to current models (e.g. gpt-4.1 / gpt-4o family; claude-sonnet-4-5 /
claude-haiku-4-5; gemini-2.x family).

## 3. Agent (livekit-agent)

- Parse `meta["provider_config"]` in the entrypoint. Missing or malformed →
  log, `post_outcome(call_id, "failed", "provider config missing")`,
  shutdown before dialing. **No env fallback** for provider keys.
- Session construction:
  - `deepgram.STT(api_key=cfg.stt.api_key, model=cfg.stt.model, language="en")`
  - `deepgram.TTS(api_key=cfg.tts.api_key, model=cfg.tts.voice)`
  - LLM switch on `cfg.llm.provider`:
    - `openai` → `openai.responses.LLM(model=…, api_key=…)`
    - `anthropic` → `anthropic.LLM(model=…, api_key=…)`
    - `google` → `google.LLM(model=…, api_key=…)`
  - `temperature` passed through where the plugin supports it.
- ElevenLabs plugin import, `DEFAULT_VOICE_ID`, and dependency removed.
- `pyproject.toml`: extras become
  `livekit-agents[anthropic,deepgram,google,openai,silero,turn-detector]`.
- `.env.local` after this change: `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`, `SIP_OUTBOUND_TRUNK_ID`, `LUMINA_API_URL`,
  `LUMINA_SERVICE_API_KEY` only. `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`,
  `ELEVEN_API_KEY`, `ELEVEN_DEFAULT_VOICE_ID` removed.
- Barge-in/turn-handling, AMD, transfer, recording logic untouched.

## 4. Frontend (client/src/pages/Configuration.tsx)

Same page design and interaction patterns. Changes only:

- **Removed:** Twilio card (creds, verify, phone numbers), ElevenLabs card
  (key, voice library, quota), TTS fallback-provider controls.
- **Deepgram card:** one API key input + verify button, STT model select
  (nova-3 default), TTS voice select (Aura voices; server-provided list).
- **LLM card:** kept as today — three providers (OpenAI, Anthropic, Google)
  each with key input + verify + status badge; default provider and default
  model dropdowns fed by refreshed `llm-options`; temperature slider kept.
- Keys display masked once saved; entering a new value replaces the stored
  key. Save flow, toasts, status badges unchanged.

## 5. Migration & compatibility

- Migration script (pattern of `migrate-campaigns-to-livekit.js`):
  1. Assign the existing singleton Configuration doc to the admin user
     (`ownerId = <admin>`); encrypt any plaintext keys found in it; normalize
     LLM provider names and `defaultProvider` to lowercase canonical values
     (`OpenAI` → `openai`, etc.).
  2. Reset `Campaign.voiceId` values that are ElevenLabs voice IDs to the
     owner's `ttsVoice` (or clear, so the config default applies).
- `gate-call.cjs`: gains `--owner <email|id>` (default: admin user) so smoke
  calls resolve a real user config.
- Other users get a fresh Configuration doc lazily on first page load, with
  everything `unverified` and calls blocked until keys verified.

## 6. Error handling summary

| Failure | Behavior |
| --- | --- |
| No config / keys unverified at initiate | HTTP 400, actionable message, no dispatch |
| Batch creation without verified keys | HTTP 400 at creation, no batch |
| `provider_config` missing in job metadata | Agent posts `failed` outcome, shutdown, no dial |
| Provider rejects key mid-call | Session error path unchanged (call fails, webhook/reconciliation closes it); `lastError` on verify only |
| `CONFIG_ENCRYPTION_KEY` missing in production | Server refuses to boot |

## 7. Testing

- **Jest:** secretCipher round-trip + tamper detection; masking; owner
  resolution (campaign → config); dispatch metadata assembly includes
  correct decrypted `provider_config`; 400 paths (missing/unverified keys);
  per-user isolation (user A never receives user B's config).
- **Pytest:** `provider_config` parsing; session construction per LLM
  provider (plugin classes selected correctly, keys passed); fail-fast on
  missing config posts `failed` outcome.
- **Live smoke:** one call per LLM provider using the user's real keys
  (Deepgram STT/TTS + each of OpenAI/Anthropic/Google).

## Out of scope

- Organizations/teams, key sharing, roles beyond existing.
- Per-campaign provider overrides.
- Billing/usage metering on BYO keys.
- Agent-fetch key delivery (documented upgrade path only).
- LiveKit infra credential self-service (stays platform-managed).
