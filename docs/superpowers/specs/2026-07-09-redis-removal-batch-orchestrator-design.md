# Redis Removal + Mongo-Backed Batch Orchestrator — Design

**Date:** 2026-07-09
**Status:** Approved (brainstorming)
**Related:** `docs/superpowers/plans/2026-07-06-Livekit-integration.md` (Tasks 18–21)

## Context

The LiveKit migration (Phases 1–3) is code-complete. The Fastify backend does
not boot cleanly because `batchCallService.ts` instantiates a BullMQ `Queue` and
`Worker` at module import (`export const batchCallService = new BatchCallService()`),
and BullMQ hard-connects to Redis. With no Redis running, boot logs flood with
`ECONNREFUSED 127.0.0.1:6379` and the server does not render properly.

LiveKit itself needs **no** Redis (agent dispatch + SIP + WebSocket workers cover
the core path). Redis is present only for the legacy BullMQ batch queue. The batch
**state already lives in MongoDB** (`BatchCall` doc: `leadIds`, `stats`, `config`,
`status`) — BullMQ only adds scheduling, concurrency, retry, and delay.

## Problem

The server requires Redis solely because of BullMQ in the batch path. We want the
server to boot with zero Redis while keeping batch/campaign calling fully working
on LiveKit + MongoDB, with durable resume across restarts.

## Goals

- Server boots and runs with **no Redis** available.
- Batch/bulk calling and campaigns work end-to-end via LiveKit dispatch (legacy
  Twilio path preserved per-campaign until Task 21).
- In-flight batches survive a server restart (durable resume, no double-dialing).
- Preserve batch semantics: concurrency cap, delay-between-calls, retries, budget
  guard, live stats.
- Public API of `batchCallService` unchanged (`createBatch`, `getBatchStatus`,
  `listBatches`) so callers (`batchCallController`, `campaignService`) are untouched.

## Non-Goals

- No distributed multi-worker queue (in-process, single-server — acceptable for
  the pilot; a queue can return later without being Redis-required).
- No removal of Redis from the legacy voice-pipeline services (that is Task 21).
- No change to how individual calls are dialed (LiveKit `initiateLiveKitCall` /
  Twilio path unchanged).

## Design

### 1. Architecture

Remove BullMQ from `batchCallService`. Batch calling becomes an in-process async
orchestrator with MongoDB as the single source of truth and LiveKit (or legacy
Twilio, per campaign `telephonyProvider`) as the dialer. No Redis in the batch path.

### 2. Data model change (durability)

Add one field to `BatchCall`:

```
processedLeadIds: mongoose.Types.ObjectId[]   // default []
```

A lead is `$addToSet`-marked into `processedLeadIds` the moment its dispatch is
initiated. **Pending = `leadIds − processedLeadIds`.** Provider-agnostic; no change
to the `Call` model. (Crash window: if the process dies after a dispatch succeeds
but before the `$addToSet`, that one lead could be re-dialed on resume — acceptable
for the pilot; the mark happens immediately after dispatch returns to minimize it.)

### 3. Orchestrator (`batchCallService` internals)

- `createBatch(params)` — writes the `BatchCall` doc (status `processing`) exactly
  as today, then fires `runBatch(batch._id)` **without awaiting** and returns the
  batch immediately (non-blocking, same contract as the old `addBulk`).
- `runBatch(batchId)`:
  1. Load batch; compute `pending = leadIds − processedLeadIds`.
  2. Process `pending` through a **concurrency window** of
     `min(config.maxConcurrency, LUMINA_BATCH_CONCURRENCY env [default 2])`.
  3. Per lead: budget guard (`FinancialService.isCampaignBudgetAvailable`) — if
     depleted, stop the batch (mark `paused`, log reason); else `processSingleCall`.
  4. On dispatch success: `$addToSet` `processedLeadIds`, `updateBatchStats('successful')`.
     On terminal failure (after `config.retryCount` retries): `$addToSet`
     `processedLeadIds`, `updateBatchStats('failed')`.
  5. Honor `config.delayBetweenCalls` between dispatch starts.
  6. When `pending` is exhausted and `stats.queued <= 0` → mark `completed`,
     set `completedAt`.
- `processSingleCall(data)` — unchanged branching: `campaign.telephonyProvider ===
  'livekit'` → `initiateLiveKitCall`; else legacy Twilio via `getTelephonyService`.
- **Concurrency runner:** a small hand-rolled promise pool (no new dependency).
- Remove the `bullmq` import, `callQueue`, `callWorker`, and their event handlers;
  fold the `completed`/`failed` stat updates into the loop.

### 4. Boot-time resume

Export `resumeInterruptedBatches()` on the service. In `index.ts`, after the Mongo
connection is established, call it once. It finds `BatchCall`s with `status:
'processing'` and calls `runBatch` for each. Because `pending` excludes
`processedLeadIds`, already-dialed leads are skipped — no double-dialing.

### 5. Redis-removal scope

- Rewrite `batchCallService` (the confirmed boot-blocker). Remove `bullmq` from
  `server/package.json`.
- **Verify the server boots with Redis stopped** and no other startup path hard-
  requires Redis. `redisService` already has a NodeCache fallback
  (`USE_MEMORY_STORE`); confirm caching/sessions degrade gracefully rather than
  throwing at boot. If another import-time hard-Redis connection is found, make it
  lazy/optional (minimal), but do **not** refactor the legacy voice-pipeline Redis
  users — that is Task 21.

### 6. Error handling & edge cases

- Empty `leadIds` → batch immediately `completed`.
- `runBatch` is fire-and-forget; wrap its body in try/catch, log failures, never
  crash the server. A per-lead dispatch throw is caught, retried, then counted
  `failed`.
- Resume is idempotent via `processedLeadIds`; running `runBatch` twice for the
  same batch is safe (pending shrinks to empty).
- Budget depletion mid-batch stops further dispatch and marks the batch `paused`.

### 7. Testing (TDD)

Unit tests (Jest, mocking Mongo models + `initiateLiveKitCall` + `FinancialService`):
- pending calc skips `processedLeadIds`;
- concurrency window never exceeds the cap;
- budget depletion halts dispatch and marks `paused`;
- stats increment correctly on success and failure;
- `resumeInterruptedBatches` re-runs only unprocessed leads;
- `createBatch` returns without awaiting the run.

## Sequencing — relationship to remaining LiveKit tasks (18–21)

The implementation plan will lead with this Redis-removal work (it unblocks the
server and the batch feature), then carry the remaining LiveKit migration tasks as
the next priorities, per the existing LiveKit plan:

1. **Batch Redis-removal** (this spec) — server boots Redis-free; batch on Mongo+LiveKit.
2. **Task 18** — batch run verification (now Redis-free) + Task 14 5-call lifecycle gate.
3. **Task 19** — deploy agent to LiveKit Cloud (infra runbook + `livekit.toml`).
4. **Task 20** — campaign migration (script already written, commit `6ab8ae4e`; run gated on A/B parity).
5. **Task 21** — legacy Twilio + Dialogflow removal (large entangled refactor; gated on Task 20 and a verified LiveKit path).

## Risks

- **In-process durability window:** tiny crash window between dispatch and
  `processedLeadIds` mark (accepted; pilot scale).
- **Single-server:** no horizontal scale for batches until a queue returns
  (out of scope; documented).
- **Legacy Twilio branch retained:** `batchCallService` still references
  `realTelephonyService` (a Task 21 delete target); acceptable until Task 21.
