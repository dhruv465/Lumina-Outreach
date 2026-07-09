# Redis Removal + Mongo-Backed Batch Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hard Redis/BullMQ dependency so the Fastify server boots and runs with zero Redis, replacing BullMQ batch calling with an in-process MongoDB + LiveKit orchestrator that has durable restart resume — then finish the remaining LiveKit migration (Tasks 18–21).

**Architecture:** `batchCallService` drops BullMQ and instead drives an in-process async orchestrator: `createBatch` writes a `BatchCall` Mongo doc and fires a non-blocking `runBatch` loop that dispatches pending leads through a bounded concurrency pool to `initiateLiveKitCall` (or legacy Twilio per campaign), marking each lead into `BatchCall.processedLeadIds` for durable resume. On server boot, interrupted `processing` batches auto-resume. MongoDB is the single source of truth; Redis is gone from the batch path.

**Tech Stack:** Node.js, TypeScript, Fastify, Mongoose/MongoDB, Jest + ts-jest. LiveKit server SDK (`livekit-server-sdk`) for dispatch. No BullMQ, no Redis.

## Global Constraints

- Server MUST boot and serve requests with **no Redis running** (no unhandled `ECONNREFUSED 127.0.0.1:6379` at startup).
- `batchCallService` public API is unchanged: `createBatch(params)`, `getBatchStatus(batchId)`, `listBatches(limit)`. Callers `batchCallController` and `campaignService` must not need edits.
- Batch state lives in MongoDB (`BatchCall`). Pending leads = `leadIds − processedLeadIds`. Resume must never re-dial a lead already in `processedLeadIds`.
- Concurrency cap = `min(config.maxConcurrency, LUMINA_BATCH_CONCURRENCY env)`, `LUMINA_BATCH_CONCURRENCY` default `2`.
- Preserve batch semantics: per-call budget guard (`FinancialService.isCampaignBudgetAvailable`), `config.delayBetweenCalls`, `config.retryCount`, and live `stats` updates.
- Do NOT modify or delete legacy Twilio voice-pipeline files (that is Task 21, gated). The legacy Twilio branch in `processSingleCall` stays.
- Commit discipline: the repo has ~90 uncommitted files. `git add` ONLY the exact paths named in each task. Never `git add -A`, `git add .`, or `git commit -a`.
- `initiateLiveKitCall` signature (from `server/src/integrations/livekit/dispatchService.ts`): `initiateLiveKitCall(params: { leadId: string; campaignId: string; scheduleTime?: Date; notes?: string }): Promise<ICall>`.

---

## Task 1: Add `processedLeadIds` durability field to `BatchCall`

**Files:**
- Modify: `server/src/models/BatchCall.ts`
- Test: `server/src/models/__tests__/BatchCall.test.ts` (create)

**Interfaces:**
- Produces: `IBatchCall.processedLeadIds: mongoose.Types.ObjectId[]` (defaults to `[]`), persisted on the `BatchCall` schema.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/models/__tests__/BatchCall.test.ts
import mongoose from 'mongoose';
import BatchCall from '../BatchCall';

describe('BatchCall model', () => {
  it('defaults processedLeadIds to an empty array', () => {
    const doc = new BatchCall({
      name: 'b1',
      campaignId: new mongoose.Types.ObjectId(),
      leadIds: [new mongoose.Types.ObjectId()],
      createdBy: new mongoose.Types.ObjectId(),
    });
    expect(Array.isArray(doc.processedLeadIds)).toBe(true);
    expect(doc.processedLeadIds.length).toBe(0);
  });

  it('accepts ObjectIds in processedLeadIds', () => {
    const leadId = new mongoose.Types.ObjectId();
    const doc = new BatchCall({
      name: 'b2',
      campaignId: new mongoose.Types.ObjectId(),
      leadIds: [leadId],
      createdBy: new mongoose.Types.ObjectId(),
      processedLeadIds: [leadId],
    });
    expect(doc.processedLeadIds[0].toString()).toBe(leadId.toString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/models/__tests__/BatchCall.test.ts`
Expected: FAIL (`processedLeadIds` is undefined / not on the type).

- [ ] **Step 3: Add the field to the interface and schema**

In `server/src/models/BatchCall.ts`, add to the `IBatchCall` interface (after `leadIds`):

```typescript
  processedLeadIds: mongoose.Types.ObjectId[];
```

And to the schema (after the `leadIds` schema line):

```typescript
    processedLeadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: [] }],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest src/models/__tests__/BatchCall.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/models/BatchCall.ts server/src/models/__tests__/BatchCall.test.ts
git commit -m "feat(batch): add processedLeadIds durability field to BatchCall"
```

---

## Task 2: Bounded concurrency pool utility

**Files:**
- Create: `server/src/utils/concurrencyPool.ts`
- Test: `server/src/utils/__tests__/concurrencyPool.test.ts` (create)

**Interfaces:**
- Produces: `runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void>` — runs `worker` over every item with at most `limit` promises in flight; resolves when all complete. Never throws for an empty list.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/utils/__tests__/concurrencyPool.test.ts
import { runWithConcurrency } from '../concurrencyPool';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrency([...Array(10).keys()], 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('resolves immediately for an empty list', async () => {
    await expect(runWithConcurrency([], 2, async () => {})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/utils/__tests__/concurrencyPool.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pool**

```typescript
// server/src/utils/concurrencyPool.ts
/**
 * Run `worker` over every item with at most `limit` promises in flight.
 * Resolves when all items are processed. Worker rejections propagate.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  if (items.length === 0) return;

  let nextIndex = 0;
  async function runner(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runner()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest src/utils/__tests__/concurrencyPool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/concurrencyPool.ts server/src/utils/__tests__/concurrencyPool.test.ts
git commit -m "feat(batch): add bounded concurrency pool utility"
```

---

## Task 3: Rewrite `batchCallService` as an in-process orchestrator (remove BullMQ)

**Files:**
- Modify: `server/src/services/batchCallService.ts` (full rewrite of internals; keep public API)
- Test: `server/src/services/__tests__/batchCallService.test.ts` (create)

**Interfaces:**
- Consumes: `BatchCall` model incl. `processedLeadIds` (Task 1); `runWithConcurrency` (Task 2); `initiateLiveKitCall` (dispatchService); `FinancialService.isCampaignBudgetAvailable(campaignId): Promise<boolean>`; `getTelephonyService().makeCall(to, from, callbackUrl)`.
- Produces: `batchCallService.createBatch(params)`, `.getBatchStatus(batchId)`, `.listBatches(limit)` (unchanged signatures), plus `.runBatch(batchId: string): Promise<void>` and `.resumeInterruptedBatches(): Promise<void>` (used by Task 4). No BullMQ.

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/services/__tests__/batchCallService.test.ts
jest.mock('../../models/BatchCall');
jest.mock('../../models/Campaign');
jest.mock('../../models/Lead');
jest.mock('../../utils/financialService');
jest.mock('../../integrations/livekit/dispatchService', () => ({
  initiateLiveKitCall: jest.fn().mockResolvedValue({ _id: 'call1' }),
}));

import BatchCall from '../../models/BatchCall';
import Campaign from '../../models/Campaign';
import { FinancialService } from '../../utils/financialService';
import { initiateLiveKitCall } from '../../integrations/livekit/dispatchService';
import { batchCallService } from '../batchCallService';

const asMock = (fn: any) => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  asMock(FinancialService.isCampaignBudgetAvailable).mockResolvedValue(true);
  asMock(Campaign.findById).mockResolvedValue({ telephonyProvider: 'livekit' });
  asMock(BatchCall.findByIdAndUpdate).mockResolvedValue({ stats: { queued: 0 }, status: 'processing', save: jest.fn() });
  asMock(BatchCall.updateOne).mockResolvedValue({});
});

function fakeBatch(overrides: any = {}) {
  return {
    _id: 'batch1',
    campaignId: 'camp1',
    leadIds: ['L1', 'L2', 'L3'],
    processedLeadIds: [],
    config: { maxConcurrency: 10, retryCount: 1, delayBetweenCalls: 0 },
    stats: { total: 3, queued: 3, processed: 0, successful: 0, failed: 0 },
    status: 'processing',
    save: jest.fn(),
    ...overrides,
  };
}

describe('batchCallService.runBatch', () => {
  it('dispatches only pending leads (skips processedLeadIds)', async () => {
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch({ processedLeadIds: ['L1'] }));
    await batchCallService.runBatch('batch1');
    expect(asMock(initiateLiveKitCall).mock.calls.map((c) => c[0].leadId).sort())
      .toEqual(['L2', 'L3']);
  });

  it('marks each dispatched lead into processedLeadIds', async () => {
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    await batchCallService.runBatch('batch1');
    const addToSetLeads = asMock(BatchCall.updateOne).mock.calls
      .map((c) => c[1].$addToSet?.processedLeadIds)
      .filter(Boolean).sort();
    expect(addToSetLeads).toEqual(['L1', 'L2', 'L3']);
  });

  it('stops dispatching when campaign budget is depleted', async () => {
    asMock(FinancialService.isCampaignBudgetAvailable).mockResolvedValue(false);
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    await batchCallService.runBatch('batch1');
    expect(asMock(initiateLiveKitCall)).not.toHaveBeenCalled();
  });

  it('respects the concurrency cap from LUMINA_BATCH_CONCURRENCY', async () => {
    process.env.LUMINA_BATCH_CONCURRENCY = '1';
    let inFlight = 0; let maxInFlight = 0;
    asMock(initiateLiveKitCall).mockImplementation(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5)); inFlight--; return { _id: 'c' };
    });
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch({ leadIds: ['L1', 'L2', 'L3', 'L4'] }));
    await batchCallService.runBatch('batch1');
    expect(maxInFlight).toBe(1);
    delete process.env.LUMINA_BATCH_CONCURRENCY;
  });
});

describe('batchCallService.createBatch', () => {
  it('creates a batch doc and returns without awaiting the run', async () => {
    asMock(BatchCall.create).mockResolvedValue(fakeBatch());
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    const batch = await batchCallService.createBatch({
      name: 'n', campaignId: 'camp1', leadIds: ['L1', 'L2', 'L3'], createdBy: 'u1',
    });
    expect(batch._id).toBe('batch1');
    expect(asMock(BatchCall.create)).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest src/services/__tests__/batchCallService.test.ts`
Expected: FAIL (`runBatch`/`resumeInterruptedBatches` not exported; BullMQ constructor still runs).

- [ ] **Step 3: Rewrite `batchCallService.ts`**

Replace the entire file with:

```typescript
// server/src/services/batchCallService.ts
import BatchCall from '../models/BatchCall';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import { getTelephonyService } from './realTelephonyService';
import { runWithConcurrency } from '../utils/concurrencyPool';
import { FinancialService } from '../utils/financialService';
import logger from '../utils/logger';
import mongoose from 'mongoose';
import * as Sentry from '@sentry/node';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class BatchCallService {
  /** Create a batch and start processing it (non-blocking). */
  async createBatch(params: {
    name: string;
    campaignId: string;
    leadIds: string[];
    createdBy: string;
    config?: any;
  }) {
    const batch = await BatchCall.create({
      name: params.name,
      campaignId: params.campaignId,
      leadIds: params.leadIds,
      createdBy: params.createdBy,
      status: 'processing',
      startedAt: new Date(),
      processedLeadIds: [],
      stats: {
        total: params.leadIds.length,
        queued: params.leadIds.length,
        processed: 0,
        successful: 0,
        failed: 0,
      },
      config: params.config || { maxConcurrency: 10, retryCount: 1, delayBetweenCalls: 2000 },
    });

    logger.info(`Starting batch ${batch._id} with ${params.leadIds.length} leads`);
    // Fire-and-forget; MongoDB is the source of truth so a crash is recoverable.
    void this.runBatch(batch._id.toString());
    return batch;
  }

  /** Process every pending lead of a batch with bounded concurrency. */
  async runBatch(batchId: string): Promise<void> {
    try {
      const batch = await BatchCall.findById(batchId);
      if (!batch || batch.status === 'completed') return;

      const processed = new Set(batch.processedLeadIds.map((id: any) => id.toString()));
      const pending = batch.leadIds
        .map((id: any) => id.toString())
        .filter((id: string) => !processed.has(id));

      if (pending.length === 0) {
        await this.finalizeIfDone(batchId);
        return;
      }

      const envCap = parseInt(process.env.LUMINA_BATCH_CONCURRENCY || '2', 10);
      const limit = Math.min(batch.config.maxConcurrency || 2, envCap);
      const delay = batch.config.delayBetweenCalls || 0;
      const retries = batch.config.retryCount || 1;
      const campaignId = batch.campaignId.toString();

      let budgetDepleted = false;

      await runWithConcurrency(pending, limit, async (leadId) => {
        if (budgetDepleted) return;

        if (!(await FinancialService.isCampaignBudgetAvailable(campaignId))) {
          budgetDepleted = true;
          logger.warn(`Batch ${batchId}: campaign ${campaignId} budget depleted, stopping`);
          return;
        }

        if (delay > 0) await sleep(delay);

        let ok = false;
        for (let attempt = 0; attempt < retries && !ok; attempt++) {
          try {
            await this.processSingleCall({ batchId, leadId, campaignId });
            ok = true;
          } catch (err: any) {
            logger.error(`Batch ${batchId} lead ${leadId} attempt ${attempt + 1} failed: ${err.message}`);
            if (process.env.SENTRY_DSN) Sentry.captureException(err);
          }
        }

        await BatchCall.updateOne({ _id: batchId }, { $addToSet: { processedLeadIds: leadId } });
        await this.updateBatchStats(batchId, ok ? 'successful' : 'failed');
      });

      if (budgetDepleted) {
        await BatchCall.updateOne({ _id: batchId }, { $set: { status: 'paused' } });
        return;
      }
      await this.finalizeIfDone(batchId);
    } catch (err: any) {
      logger.error(`runBatch ${batchId} crashed: ${err.message}`);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    }
  }

  /** Re-run any batch left in `processing` after a restart (idempotent). */
  async resumeInterruptedBatches(): Promise<void> {
    const stuck = await BatchCall.find({ status: 'processing' }).select('_id');
    if (stuck.length === 0) return;
    logger.info(`Resuming ${stuck.length} interrupted batch(es)`);
    for (const b of stuck) void this.runBatch(b._id.toString());
  }

  private async processSingleCall(data: { batchId: string; leadId: string; campaignId: string }) {
    const { leadId, campaignId } = data;

    const campaign = await Campaign.findById(campaignId);
    if (campaign?.telephonyProvider === 'livekit') {
      const { initiateLiveKitCall } = await import('../integrations/livekit/dispatchService');
      await initiateLiveKitCall({ leadId, campaignId });
      return;
    }

    const lead = await Lead.findById(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);
    const telephonyService = getTelephonyService();
    const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8000';
    const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';
    const conversationId = new mongoose.Types.ObjectId().toString();
    const callbackUrl = `${WEBHOOK_BASE_URL}/api/calls/twiml/${campaignId}/${conversationId}`;
    await telephonyService.makeCall(lead.phoneNumber, TWILIO_PHONE_NUMBER, callbackUrl);
  }

  private async updateBatchStats(batchId: string, status: 'successful' | 'failed') {
    try {
      const updateDoc = status === 'successful'
        ? { $inc: { 'stats.processed': 1, 'stats.successful': 1, 'stats.queued': -1 } }
        : { $inc: { 'stats.processed': 1, 'stats.failed': 1, 'stats.queued': -1 } };
      await BatchCall.findByIdAndUpdate(batchId, updateDoc, { new: true });
      await this.finalizeIfDone(batchId);
    } catch (err: any) {
      logger.error(`Failed to update batch stats for ${batchId}: ${err.message}`);
    }
  }

  private async finalizeIfDone(batchId: string) {
    const batch = await BatchCall.findById(batchId);
    if (batch && batch.stats.queued <= 0 && batch.status !== 'completed') {
      batch.status = 'completed';
      batch.completedAt = new Date();
      await batch.save();
      logger.info(`Batch ${batchId} completed.`);
    }
  }

  async getBatchStatus(batchId: string) {
    return await BatchCall.findById(batchId).populate('campaignId', 'name');
  }

  async listBatches(limit: number = 20) {
    return await BatchCall.find().sort({ createdAt: -1 }).limit(limit).populate('campaignId', 'name');
  }
}

export const batchCallService = new BatchCallService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest src/services/__tests__/batchCallService.test.ts`
Expected: PASS (all cases). If the concurrency test is flaky, re-run once; the assertion is `maxInFlight === 1` for limit 1.

- [ ] **Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: no errors referencing `batchCallService.ts`.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/batchCallService.ts server/src/services/__tests__/batchCallService.test.ts
git commit -m "feat(batch): replace BullMQ with in-process Mongo+LiveKit orchestrator"
```

---

## Task 4: Boot-time resume of interrupted batches

**Files:**
- Modify: `server/src/index.ts` (after the Mongo connection is established)
- Test: covered by Task 3's `resumeInterruptedBatches` unit test; add one focused test below.

**Interfaces:**
- Consumes: `batchCallService.resumeInterruptedBatches()` (Task 3).

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/__tests__/batchCallService.test.ts`:

```typescript
describe('batchCallService.resumeInterruptedBatches', () => {
  it('re-runs each processing batch and skips already-processed leads', async () => {
    asMock(BatchCall.find).mockReturnValue({ select: () => Promise.resolve([{ _id: 'batch1' }]) } as any);
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch({ processedLeadIds: ['L1', 'L2'] }));
    await batchCallService.resumeInterruptedBatches();
    await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget runBatch settle
    expect(asMock(initiateLiveKitCall).mock.calls.map((c) => c[0].leadId)).toEqual(['L3']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx jest src/services/__tests__/batchCallService.test.ts -t resumeInterruptedBatches`
Expected: FAIL if `BatchCall.find(...).select` isn't handled — adjust the mock/impl until it passes (the impl in Task 3 already calls `.find({status:'processing'}).select('_id')`).

- [ ] **Step 3: Wire resume into server startup**

In `server/src/index.ts`, locate where the app has connected to MongoDB and finished registering routes (search for the `mongoose.connect` success path / "server listening" log). After a successful DB connection, add:

```typescript
import { batchCallService } from './services/batchCallService';
// ...after Mongo connection is established and before/after the HTTP listen:
batchCallService.resumeInterruptedBatches().catch((e) =>
  logger.error(`batch resume on boot failed: ${e.message}`)
);
```

Place the import with the other service imports at the top; place the call in the post-connect startup sequence. Do not block startup on it (fire-and-forget with a `.catch`).

- [ ] **Step 4: Run tests + typecheck**

Run: `cd server && npx jest src/services/__tests__/batchCallService.test.ts && npx tsc --noEmit`
Expected: all batch tests PASS; no new tsc errors from `index.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/src/services/__tests__/batchCallService.test.ts
git commit -m "feat(batch): resume interrupted batches on server boot"
```

---

## Task 5: Remove the `bullmq` dependency and verify Redis-free boot

**Files:**
- Modify: `server/package.json`, `server/package-lock.json`
- No test file; this is a build + runtime verification task.

**Interfaces:** none (dependency + runtime verification).

- [ ] **Step 1: Confirm nothing else imports bullmq**

Run: `cd server && grep -rn "bullmq" src --include='*.ts'`
Expected: no matches (Task 3 removed the only import). If any remain, stop and report — they must be handled before removing the dep.

- [ ] **Step 2: Uninstall bullmq**

Run: `cd server && npm uninstall bullmq`
Expected: `bullmq` removed from `package.json` dependencies; `package-lock.json` updated.

- [ ] **Step 3: Typecheck + full test suite**

Run: `cd server && npx tsc --noEmit && npx jest`
Expected: tsc clean; all existing suites plus the new batch/model/util tests pass.

- [ ] **Step 4: Verify the server boots with Redis stopped**

Ensure no Redis is running (`redis-cli ping` should fail / connection refused). Then:

Run: `cd server && (npm run dev &) ; sleep 12 ; curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:8000/api/health ; pkill -f "npm run dev"`
Expected: `health:200` (or the server's actual health route), and the boot logs contain **no** repeated `ECONNREFUSED 127.0.0.1:6379` from the batch path. If `redisService` still logs a single fallback warning and continues (NodeCache fallback), that is acceptable; a crash or an unhandled connection flood is not — if found, make that specific startup connection lazy/optional (minimal change) and note it, but do not touch legacy voice-pipeline files.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore(batch): drop bullmq dependency (Redis no longer required)"
```

---

## Task 18 (LiveKit plan): Batch calling end-to-end verification, Redis-free

**Files:** none new — runtime verification of Tasks 1–5 under the real app. Reference: original LiveKit plan `docs/superpowers/plans/2026-07-06-Livekit-integration.md` Task 18.

**Interfaces:** Consumes the orchestrator (Tasks 1–5) + `initiateLiveKitCall` + LiveKit webhooks.

- [ ] **Step 1: Prerequisites** — Redis NOT running; Fastify up (Task 5 verified boot); LiveKit agent worker registered; ngrok tunnel to `:8000` set as the LiveKit Cloud webhook `<ngrok-url>/webhooks/livekit`; a LiveKit campaign (`telephonyProvider: 'livekit'`) with ≥5 leads.

- [ ] **Step 2: Trigger a 5-lead batch** via the existing batch UI or `POST /api/batch-calls`. Watch server logs: `Starting batch <id> with 5 leads`, dispatches capped at `LUMINA_BATCH_CONCURRENCY` (2), `processedLeadIds` growing, `stats.queued` decrementing, budget guard consulted.

- [ ] **Step 3: Restart-resume check** — mid-batch, restart the server; confirm on boot `Resuming N interrupted batch(es)` and that already-dialed leads are NOT re-called (compare `processedLeadIds` before/after). This exercises durable resume.

- [ ] **Step 4: Lifecycle (Task 14 gate)** — confirm all 5 `Call` records complete their webhook lifecycle (queued → dialing → in-progress → completed) and `BatchCall.status` becomes `completed`. Record the result in `docs/superpowers/specs/2026-07-06-livekit-integration-design.md` (batch + gate results table). **Gate: 5/5 lifecycle-correct.**

- [ ] **Step 5: Commit** (spec results only):

```bash
git add docs/superpowers/specs/2026-07-06-livekit-integration-design.md
git commit -m "test(livekit): verified Redis-free batch calling + 5-call lifecycle gate"
```

---

## Task 19 (LiveKit plan): Deploy agent to LiveKit Cloud

**Files:** Create `livekit-agent/livekit.toml` (generated by the CLI). Reference: original LiveKit plan Task 19. **This is an infra task run by the operator (LiveKit Cloud auth required); the plan documents the exact steps.**

- [ ] **Step 1: Register + deploy**

```bash
cd livekit-agent
lk agent create   # generates livekit.toml, registers + deploys the agent
```

- [ ] **Step 2: Set Cloud agent secrets** (dashboard or `lk agent secrets set`): `DEEPGRAM_API_KEY`, `OPENAI_API_KEY` (the agent uses OpenAI, not Gemini — the original plan's `GOOGLE_API_KEY` is superseded), `ELEVEN_API_KEY`, `ELEVEN_DEFAULT_VOICE_ID`, `SIP_OUTBOUND_TRUNK_ID`, `LUMINA_SERVICE_API_KEY`, and `LUMINA_API_URL` = a **public HTTPS** URL of the Fastify server (the Cloud agent cannot reach `localhost`). Verify secret names against current docs: `mcp__livekit-docs__docs_search "agent deployment secrets livekit.toml"`.

- [ ] **Step 3: Route a call to the deployed agent** — stop the local `dev` worker so dispatch routes to the Cloud agent, then place one gate call; confirm the Cloud agent answers and the pipeline works.

- [ ] **Step 4: Commit**

```bash
git add livekit-agent/livekit.toml
git commit -m "feat(livekit): deploy agent to LiveKit Cloud"
```

---

## Task 20 (LiveKit plan): Campaign migration Twilio → LiveKit

**Files:** `server/scripts/migrate-campaigns-to-livekit.js` — **already written and committed (commit `6ab8ae4e`).** This task is the A/B gate + running it. Reference: original LiveKit plan Task 20.

- [ ] **Step 1: A/B period** — run ≥1 real campaign on each pipeline for a comparable window; compare connection rate, avg duration, conversion, cost/call, complaint rate in the existing analytics. Record in `docs/superpowers/specs/2026-07-06-livekit-integration-design.md`. **Gate: LiveKit ≥ parity before migrating all.**

- [ ] **Step 2: Dry-run the migration**

```bash
cd server && node scripts/migrate-campaigns-to-livekit.js --dry-run
```
Expected: prints `campaigns total=… on-legacy=…`, writes nothing.

- [ ] **Step 3: Run the real migration** (only after the A/B gate passes)

```bash
cd server && node scripts/migrate-campaigns-to-livekit.js
```
Expected: `migrated N`, then `verify: 0 still on legacy`.

- [ ] **Step 4: Commit** (spec A/B results):

```bash
git add docs/superpowers/specs/2026-07-06-livekit-integration-design.md
git commit -m "test(livekit): A/B parity results + campaign migration executed"
```

---

## Task 21 (LiveKit plan): Remove legacy Twilio voice pipeline + Dialogflow

**Files (delete):** the full list is in the original LiveKit plan `docs/superpowers/plans/2026-07-06-Livekit-integration.md` Task 21 (≈30 services + routes + Dialogflow CX + the 2 AM retraining cron). **Gated on Task 20 completing AND a verified LiveKit path (Tasks 18–19 green).**

> **Warning (from the 2026-07-08 reference sweep):** this is NOT a clean leaf deletion. `enhancedVoiceAIService` has 9 external refs incl. `models/Campaign.ts` and `configurationController.ts`; `realTelephonyService` is referenced by `batchCallService.ts` (this plan's file) and `webhookHandlers.ts`; `conversationEngineService` by `aiOrchestrationService`. Shared deps `googleapis` (Google Sheets = keep) and `twilio` (`callService`/recordings/auth = keep) must NOT be blindly uninstalled. Deleting the legacy files requires refactoring their surviving consumers in the same commits.

- [ ] **Step 1: Reference sweep per file** — for each file on the delete list: `grep -rn "<basename>" server/src client/src --include='*.ts' --include='*.tsx' | grep -v "<its own path>"`. A file is deletable only when its remaining references are also on the delete list or in `index.ts` registration lines removed in the same commit. Update `batchCallService.processSingleCall` to drop the Twilio branch (LiveKit-only) BEFORE deleting `realTelephonyService`, since this plan's orchestrator references it.

- [ ] **Step 2: Delete in dependency order** (leaf services → routes → `index.ts` registrations). After each batch: `cd server && npx tsc --noEmit && npx jest`. Never delete a file with a live surviving reference until that consumer is refactored/removed in the same commit.

- [ ] **Step 3: Dialogflow retirement** — delete Dialogflow CX services + the 2 AM retraining cron registration; drop `@google-cloud/dialogflow-cx`/unused `googleapis` usage only if Google Sheets does not share it (grep first).

- [ ] **Step 4: Dependency prune** — `npm uninstall` now-unused packages (`@deepgram/sdk`, `elevenlabs-node`, `socket.io` if only the audio path used it — grep first; keep `twilio` if recordings/SMS still use it).

- [ ] **Step 5: Full verification** — `cd server && npx tsc --noEmit && npx jest && npm run build`; boot the server (Redis-free); place one LiveKit call end-to-end.

- [ ] **Step 6: Docs + commit** — update `README.md` architecture section + `LAUNCH_TODO.md`, commit in reviewable batches:

```bash
git add server/src client/src README.md LAUNCH_TODO.md server/package.json server/package-lock.json
git commit -m "refactor(livekit): remove legacy Twilio voice pipeline and Dialogflow CX"
```

---

## Self-Review

- **Spec coverage:** §1 architecture → Tasks 3–5; §2 data model → Task 1; §3 orchestrator → Tasks 2–3; §4 boot resume → Task 4; §5 Redis-removal scope → Task 5; §6 error handling → Task 3 (try/catch, retries, budget); §7 testing → Tasks 1–4 tests. Sequencing §(18–21) → Tasks 18–21. ✅
- **Type consistency:** `runWithConcurrency` signature identical in Tasks 2 and 3; `runBatch`/`resumeInterruptedBatches`/`processedLeadIds` consistent across Tasks 1, 3, 4; `initiateLiveKitCall({ leadId, campaignId })` matches dispatchService. ✅
- **Placeholder scan:** no TBD/TODO; all code steps carry full code. Tasks 18–21 reference the original LiveKit plan for the exhaustive delete list (already specced there) rather than duplicating ~300 lines — deliberate, with the current-state deltas inline. ✅
- **Note:** legacy Twilio branch retained in `processSingleCall` until Task 21 Step 1 removes it before `realTelephonyService` deletion.
