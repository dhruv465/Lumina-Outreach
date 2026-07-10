# LiveKit Integration Design — Project Lumina

**Date:** 2026-07-06
**Status:** Approved by user (design review passed)
**Source research:** `/Users/dhruvsmac/Desktop/SecBrain/projects/project-lumina/notes/livekit-integration-research.md`

## 1. Goal

Replace Lumina's custom real-time voice pipeline (Twilio Media Streams + Deepgram streaming + custom conversation engine + ElevenLabs TTS + Socket.IO audio transport) with the LiveKit Agents framework, while keeping the entire business layer (Fastify API, MongoDB, BullMQ batch calling, campaigns, leads, analytics, RAG) unchanged.

## 2. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Deployment | LiveKit Cloud now, self-host later | Free tier (1,000 agent min/mo) for validation; LiveKit is OSS so self-hosting stays open. Design avoids Cloud-only lock-in where cheap to do so. |
| Agent runtime | Python service (`livekit-agent/`) | Most mature Agents SDK: plugins, telephony examples, testing framework. |
| Dispatch | Fastify via `livekit-server-sdk` (npm) | Business orchestration stays in Node/TypeScript; clean HTTP/metadata boundary to the agent. |
| Telephony | Existing Twilio account → Elastic SIP Trunk → LiveKit SIP | Reuses numbers and account, official quickstart exists, no porting, works for non-US destinations. |
| Migration | Parallel pipelines + per-campaign feature flag, gradual cutover | Legacy Twilio pipeline stays as fallback until LiveKit path proves parity. |
| AI providers | Deepgram STT + Gemini LLM + ElevenLabs TTS via BYO-key plugins | Reuses existing accounts/tuning. LiveKit Inference is Cloud-only and would break the self-host path. |
| Dialogflow CX | Retired | Agent LLM + function tools handle intent natively. CX services + daily retraining cron deleted in Phase 4 cleanup. |

## 3. Architecture

```
React client ──REST──> Fastify API ──dispatch+SIP──> LiveKit Cloud ──Twilio SIP trunk──> PSTN
   (keep)                (keep)                          │
                            ▲                     Python agent (NEW)
MongoDB + BullMQ ───────────┤                     Deepgram│Gemini│ElevenLabs plugins
   (keep)                   └──────tools + webhooks───────┘
```

- **LiveKit replaces only the real-time voice layer.** One room per call; the Python agent and the SIP participant (the phone callee) join the same room.
- **Fastify remains the system of record and orchestrator.** It creates rooms, dispatches agents, dials SIP participants, and receives webhooks.
- **The agent is stateless per call.** All context (lead, campaign, script, callId) arrives via dispatch metadata; all side effects go through the Fastify API.

## 4. New Components

### 4.1 `livekit-agent/` (new top-level directory, Python)

```
livekit-agent/
├── agent.py            # Entrypoint + SalesAgent definition
├── tools/
│   └── lumina_api.py   # HTTP client + function tools against Fastify API
├── tests/              # LiveKit agent testing framework — required from day one
├── Dockerfile
├── livekit.toml        # LiveKit Cloud deployment config
├── requirements.txt    # matches LiveKit example repos; can move to pyproject.toml later
└── .env.example        # LIVEKIT_*, DEEPGRAM_, GOOGLE_, ELEVEN_, LUMINA_API_* — never committed
```

- `agent.py`: AgentSession with Silero VAD, Deepgram STT, Gemini LLM, ElevenLabs TTS, LiveKit turn detector. Instructions are built from the campaign script passed in dispatch metadata.
- `tools/lumina_api.py` function tools: `lookup_lead_info`, `schedule_callback`, `record_call_outcome`, `transfer_to_human`, `detect_voicemail`. Each calls the Fastify API authenticated with a dedicated service token.
- **All LiveKit API usage must be verified against live docs (MCP `livekit-docs` server / `lk docs`) at implementation time — never from model memory.** Exact plugin names, session parameters, and dispatch APIs are resolved during implementation, not in this spec.

### 4.2 `server/src/integrations/livekit/` (TypeScript, inside Fastify)

- `dispatchService.ts` — createRoom → createAgentDispatch (metadata JSON: `leadId`, `campaignId`, `callId`, `phoneNumber`, `script`) → createSipParticipant (outbound Twilio trunk). Uses `livekit-server-sdk`.
- `webhookHandler.ts` — receives signed LiveKit webhooks (room started/finished, participant joined/left) and drives Call record lifecycle: answered, duration, outcome, transcript persistence.
- `reconciliationJob.ts` — periodic poll of active-room status; marks stale/orphaned Call records failed when webhooks were missed or the agent crashed.
- `types.ts` — shared metadata contract between dispatch (TS) and agent (Python). Single source of truth documented in both repos' code comments.

### 4.3 Feature flag

- `voiceProvider: 'twilio' | 'livekit'` field on the Campaign model (default `'twilio'`).
- `callService.initiateCall()` branches on the flag. The BullMQ batch worker is unchanged — it calls the same entrypoint for both pipelines.

## 5. Call Flow (outbound)

1. Campaign/batch trigger → BullMQ job → `callService.initiateCall()` → flag check.
2. LiveKit path: `dispatchService` creates room, dispatches agent with metadata, creates SIP participant to dial the lead.
3. Agent joins room, waits for pickup, runs STT→LLM→TTS conversation; tools call the Fastify API.
4. Call ends (hangup or agent-initiated) → LiveKit webhook → Call record updated → existing post-call analytics run on the transcript.

Inbound calling is out of scope for this integration (outbound sales is the core use case); the design does not preclude adding inbound dispatch rules later.

## 6. What Is Replaced / Kept / Retired

**Replaced by LiveKit (deleted in Phase 4):** `twilioStreamHandler.ts`, `conversationEngineService.ts`, `conversationStateMachine.ts`, `deepgramService.ts` (streaming path), `deepgramTTSService.ts`, `elevenlabsSDKService.ts` + extension, `enhancedVoiceAIService.ts`, `streamingAudioPipeline.ts`, `optimizedRealTimeAudioPipeline.ts`, `audioStreamManager.ts`, `audioStreamingService.ts`, `streamingTTSService.ts`, `streamingVoiceSynthesis`, audio codec utils, `realTelephonyService.ts`, Twilio webhook stream handlers, `enhancedBargeInDetectionService.ts`, `websocketConnectionPool.ts` (audio path), Socket.IO audio transport.

**Kept unchanged:** React client, Fastify routes for leads/campaigns/analytics/auth, all Mongoose models (plus the new Campaign flag), BullMQ batch infrastructure, RAG/knowledge services (exposed to the agent as tools or context in a later iteration), Google Sheets export, PII masking, Sentry.

**Retired (deleted in Phase 4):** Dialogflow CX intent-analysis services, the daily retraining cron, and the CX-specific parts of the HITL feedback pipeline. The feedback dashboard UI may be repurposed for transcript review later — out of scope here.

## 7. Migration Phases

| Phase | Scope | Exit criterion |
|---|---|---|
| **1 — Spike** | LiveKit Cloud account, Twilio Elastic SIP trunk configured, adapt `outbound-caller-python` example, place one real outbound call. Measure end-to-end latency vs. current pipeline. | A working phone conversation through LiveKit; latency measured and acceptable. |
| **2 — Bridge** | Full `livekit-agent/` with tools + tests, `dispatchService`, `webhookHandler`, Campaign flag, Call record lifecycle parity. | 5 real calls with correct MongoDB Call records end-to-end. |
| **3 — Parity** | Voicemail-detection tool, call recording (LiveKit Egress), transfer-to-human (SIP REFER — verify Twilio trunk support), DTMF passthrough (only if a campaign requires IVR/gatekeeper navigation — decided during Phase 3), batch calls at low concurrency through LiveKit. | Feature parity checklist green on a real campaign. |
| **4 — Rollout + cleanup** | A/B campaigns on both pipelines, migrate all campaigns, then delete legacy voice files, Socket.IO audio path, Dialogflow CX services + cron. | All campaigns on LiveKit; legacy voice code removed; docs updated. |

## 8. Error Handling

- Dispatch failure → Call marked failed; BullMQ retry policy applies.
- SIP outcomes (busy, no-answer, rejected) → mapped to existing Call outcome states.
- Agent crash mid-call → LiveKit job supervision restarts the worker; `reconciliationJob` catches orphaned Call records.
- Webhooks are signature-verified; missed webhooks are covered by reconciliation polling.

## 9. Testing

- **Python agent:** LiveKit agent testing framework from day one — tool invocation, conversation behavior, voicemail path. The repo currently has zero tests; the agent service starts clean.
- **TypeScript:** unit tests for `dispatchService` metadata contract and `webhookHandler` state transitions.
- **End-to-end:** manual real-call checklist per phase (documented in the implementation plan).

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| ElevenLabs plugin latency worse than hand-tuned legacy pipeline | Measured in Phase 1; explicit kill criterion before Phase 2. |
| Version drift between npm `livekit-server-sdk` and Python `livekit-agents` | Pin both; record tested pair in the metadata contract doc. |
| Regional caller-ID / DLT rules when calling India via Twilio trunk | Verified in Phase 1 with a real test call. |
| Secrets exposure (repo has prior credential-leak history) | LiveKit keys in `.env` only; gitignore audited before first commit of each phase. |
| Cloud-only feature creep blocking later self-host | BYO-key plugins already chosen; any Cloud-only dependency (Egress config, observability) documented when introduced. |

## 11. Cost Envelope

- Phases 1–2 fit in LiveKit Cloud free tier (1,000 agent session minutes/month).
- Twilio per-minute voice costs unchanged (same trunk/account). Deepgram/Gemini/ElevenLabs billed directly on existing accounts.
