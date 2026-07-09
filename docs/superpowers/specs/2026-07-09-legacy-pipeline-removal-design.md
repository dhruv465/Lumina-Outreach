# Legacy Voice Pipeline Removal (Task 21) — Design

**Date:** 2026-07-09
**Status:** Approved decisions; deep refactor to be planned/executed
**Related:** `docs/superpowers/plans/2026-07-06-Livekit-integration.md` (Task 21), `notes/livekit-integration-map` (SecBrain)

## Context

The LiveKit consolidation is underway. All campaigns are migrated to `telephonyProvider: 'livekit'` (Task 20 done), and the **call paths are already LiveKit-only** (`callService.initiateCall`, `batchCallService.processSingleCall`, `Campaign` default) as of commit `5189a702`. The server boots Redis-free (health 200). This spec covers removing the remaining legacy custom voice pipeline so the server becomes a thin control plane and the LiveKit agent owns all real-time voice.

## Approved decisions

- **Purge Twilio entirely** from the server: remove the `twilio` SDK, Twilio calling (done), Twilio recordings sync, Twilio auth/webhooks. (The agent's SIP trunk `SIP_OUTBOUND_TRUNK_ID` is separate and stays.)
- **Keep Socket.IO** — the dashboard uses it (`AudioPlayer`, `useSocket`, `useSocketIO`, `Configuration.tsx`), it is NOT audio-pipeline-only.
- Keep `googleapis` (Google Sheets), MongoDB, LiveKit integration, RAG/knowledge, analytics, auth.

## Keep / Delete / Refactor manifest

### KEEP (thin control plane)
CRM + campaign + call + batch + analytics + dashboard routes; LiveKit integration (`dispatchService`, `webhookHandler`, `reconciliationJob`, `livekitInternalRoutes`, `livekitWebhookRoutes`, `types`); Mongo batch orchestrator; Socket.IO + client hooks; models; auth; Google Sheets; `financialService`; RAG/knowledge; the Python agent (`livekit-agent/`).

### DELETE (pure voice pipeline)
- **Services:** `twilioStreamHandler`, `conversationEngineService`, `conversationStateMachine`, `deepgramService`, `deepgramTTSService`, `deepgramUtils`, `deepgramAutoConfigService`, `deepgramConfigValidator`, `deepgramErrorHandler`, `elevenlabsSDKService`, `elevenlabsSDKExtension`, `elevenLabsConversationalService`, `enhancedVoiceAIService`, `streamingAudioPipeline`, `optimizedRealTimeAudioPipeline`, `audioStreamManager`, `audioStreamingService`, `streamingTTSService`, `streamingWebhookHandlers`, `enhancedBargeInDetectionService`, `realTelephonyService`, `realSpeechService`, `textToSpeechService`, `ttsProviderService`, `fallbackTTSService`, `websocketConnectionPool`, `connectionPreWarmingService`, `speechAnalysisService`, `twilioRecordingsService`.
- **Dialogflow:** `retrainingService` + Dialogflow CX services + the 2 AM retraining cron registration.
- **Routes:** `audioStreamingRoutes`, `deepgramTTSRoutes`, `streamingTTSRoutes`, `sttRoutes`, `ttsProviderRoutes`, `connectionPreWarmingRoutes`, `transcriptionRoutes`. Verify each is voice-pipeline-only before deleting.
- **Controllers:** `deepgramController`, `sttTestController`, `testDeepgramASRConnection` (voice-pipeline-only — verify no non-voice route uses them).
- **Utils:** `ttsServiceFactory`, `streamingVoiceSynthesis`.

### REFACTOR (surviving files that import legacy)
- **`index.ts`** — remove legacy service instantiations + route registrations + the retraining cron. **Keep Socket.IO setup.** (Largest single edit; the file already has uncommitted user changes.)
- **`aiOrchestrationService.ts`** — imports `EnhancedVoiceAIService`, `ConversationEngineService`, `SpeechAnalysisService` (voice) alongside `LLMService` (RAG/AI). Determine if any live endpoint uses it. If yes → strip the voice imports, keep LLM/RAG. If it is only wired to the old voice pipeline → delete it too (and `orchestrationLayer.ts`).
- **`configurationController.ts`** — remove references to voice-pipeline services + Twilio config UI paths that no longer apply.
- **`models/Campaign.ts`** — remove the `enhancedVoiceAIService` import/usage (identify what it references — likely a voice-config helper).
- **`callService.ts`** — remove `syncTwilioRecordings` + `twilio`/`twilioRecordingsService` imports; remove the `/sync-recordings` + `/recording-webhook` wiring in `callController.ts` + `callRoutes.ts`.
- **`parallelProcessingService.ts`** — remove `elevenlabsSDKService` usage, or delete the file if voice-pipeline-only.
- **`webhookHandlers.ts`** — remove Twilio voice/status webhook handling (keep only what non-voice features need, if any).

## Dependency prune (after code removal)
`npm uninstall`: `@deepgram/sdk`, `elevenlabs-node`, `twilio`, `@google-cloud/dialogflow-cx` (verify none imported). **Keep:** `socket.io` (dashboard), `googleapis` (Sheets), `@sentry/node`, mongoose, fastify, `livekit-server-sdk`.

## Staged execution order (bottom-up; `tsc` + `jest` after each stage)

1. **Decouple survivors** so nothing live imports a delete-target: refactor `aiOrchestrationService`, `configurationController`, `Campaign`, `parallelProcessingService`, `ttsServiceFactory`, `streamingVoiceSynthesis`, `webhookHandlers`; remove Twilio recordings from `callService`/`callController`/`callRoutes`.
2. **Remove `index.ts` registrations** for legacy services + routes + the retraining cron (keep Socket.IO).
3. **Delete leaf services** (now orphaned), then legacy routes, then legacy controllers.
4. **Dialogflow retirement** — delete CX services + cron.
5. **Dep prune** — `npm uninstall` the now-unused packages.
6. **Verify** — `tsc --noEmit` + `jest` + `npm run build`; boot server Redis-free; place one live LiveKit call end-to-end.
7. **Docs** — update `README.md` architecture + `LAUNCH_TODO.md`.

Each stage is its own commit with only that stage's paths (repo has ~90 uncommitted files — never `git add -A`). Per the consolidation decision, surviving files carrying pre-existing uncommitted edits are committed whole ("land it all").

## Prerequisite gate (strongly recommended before Stage 3 deletions)

Pass the **Task 14 lifecycle gate** (5 app-path LiveKit calls with the webhook configured) first, so the LiveKit replacement is verified before the Twilio fallback is deleted. Deleting the fallback while the replacement is unverified is the main risk.

## Risks

- **No fallback after deletion:** once legacy is gone, LiveKit is the only pipeline — verify it first.
- **`aiOrchestrationService` blast radius:** it is a hybrid; mis-refactoring could affect AI/RAG features. Handle it as its own careful stage.
- **`index.ts` is large + already dirty:** edit precisely; keep Socket.IO + all non-voice registrations intact.
- **Commit hygiene** against ~90 uncommitted files: strict per-path staging.
