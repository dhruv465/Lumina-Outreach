# Defer Conversation Review Beyond MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the non-functional Dialogflow-era AI Training surface from the MVP while preserving real LiveKit call evidence and the approved post-MVP Conversation Review design.

**Architecture:** Retire the client route/navigation and unregister the dead feedback API. Delete unreachable feedback code, but do not drop or mutate the historical MongoDB collection. Replace active Dialogflow/retraining documentation with the current LiveKit + BYOK architecture and mark Conversation Review as deferred.

**Tech Stack:** React 18, React Router, TypeScript, Fastify, Jest, Node.js built-in test runner, Markdown.

## Global Constraints

- Do not implement `CallReview`, review APIs, `Call.aiContext`, review metrics, or a replacement page.
- Preserve `Call.transcript`, `Call.conversationLog`, `Call.outcome`, and `Call.recordingUrl` unchanged.
- Do not drop or modify the MongoDB `callfeedbacks` collection.
- Do not touch or stage user-owned changes in `AGENTS.md` or `client/src/pages/Configuration.tsx`.
- Stage only exact paths named in each task.
- No provider requests, LiveKit calls, migrations, deploys, or vault writes.

---

### Task 1: Retire the server feedback API and dead collector

**Files:**
- Create: `server/src/config/__tests__/retiredFeedbackSurface.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/services/aiService.ts`
- Delete: `server/src/routes/callFeedbackRoutes.ts`
- Delete: `server/src/controllers/callFeedbackController.ts`
- Delete: `server/src/models/CallFeedback.ts`

**Interfaces:**
- Consumes: current Fastify route registration and `AIService` implementation.
- Produces: server with no `/api/feedback` registration and no runtime dependency on `CallFeedback`.

- [ ] **Step 1: Write the failing architectural retirement test**

Create `server/src/config/__tests__/retiredFeedbackSurface.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const srcRoot = path.resolve(__dirname, '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

describe('retired Dialogflow feedback surface', () => {
  it('does not register the legacy feedback API', () => {
    const indexSource = read('index.ts');
    expect(indexSource).not.toContain('callFeedbackRoutes');
    expect(indexSource).not.toContain('prefix: "/feedback"');
  });

  it('does not retain the unreachable training-data collector', () => {
    const serviceSource = read('services/aiService.ts');
    expect(serviceSource).not.toContain("models/CallFeedback");
    expect(serviceSource).not.toContain('collectTrainingData');
  });

  it.each([
    'routes/callFeedbackRoutes.ts',
    'controllers/callFeedbackController.ts',
    'models/CallFeedback.ts',
  ])('removes %s from the runtime codebase', (relativePath) => {
    expect(fs.existsSync(path.join(srcRoot, relativePath))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd server
npx jest src/config/__tests__/retiredFeedbackSurface.test.ts --runInBand
```

Expected: FAIL because `index.ts` registers `callFeedbackRoutes`, `aiService.ts`
contains `collectTrainingData`, and all three legacy files exist.

- [ ] **Step 3: Remove runtime registration and dead code**

In `server/src/index.ts`, remove:

```ts
import callFeedbackRoutes from "./routes/callFeedbackRoutes";
```

and:

```ts
apiRouter.register(callFeedbackRoutes, { prefix: "/feedback" });
```

In `server/src/services/aiService.ts`, remove:

```ts
import CallFeedback from '../models/CallFeedback';
```

and delete the complete `collectTrainingData` method. Delete the three legacy
route/controller/model files listed above. Do not issue any MongoDB collection
drop or data migration.

- [ ] **Step 4: Verify GREEN and server health**

Run:

```bash
cd server
npx jest src/config/__tests__/retiredFeedbackSurface.test.ts --runInBand
npx tsc --noEmit
npx jest --runInBand
```

Expected: focused test PASS, TypeScript clean, full Jest suite green.

- [ ] **Step 5: Commit exact Task 1 paths**

```bash
git add \
  server/src/config/__tests__/retiredFeedbackSurface.test.ts \
  server/src/index.ts \
  server/src/services/aiService.ts \
  server/src/routes/callFeedbackRoutes.ts \
  server/src/controllers/callFeedbackController.ts \
  server/src/models/CallFeedback.ts
git commit -m "refactor(mvp): retire legacy feedback API"
```

---

### Task 2: Remove the AI Training client surface

**Files:**
- Create: `client/tests/retired-ai-training.test.mjs`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/layout/Sidebar.tsx`
- Delete: `client/src/pages/AITraining.tsx`
- Delete: `client/src/services/feedbackApi.ts`

**Interfaces:**
- Consumes: React route table and sidebar navigation.
- Produces: MVP client with no discoverable or directly routed AI Training page.

- [ ] **Step 1: Write the failing client retirement test**

Create `client/tests/retired-ai-training.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('MVP does not expose the deferred AI Training route', () => {
  const app = read('src/App.tsx');
  const sidebar = read('src/components/layout/Sidebar.tsx');

  assert.doesNotMatch(app, /AITraining|ai-training/);
  assert.doesNotMatch(sidebar, /AI Training|ai-training/);
});

test('MVP removes the dead AI Training page and feedback client', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/pages/AITraining.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/services/feedbackApi.ts')), false);
});
```

- [ ] **Step 2: Run the client test and verify RED**

Run:

```bash
cd client
node --test tests/retired-ai-training.test.mjs
```

Expected: FAIL because route/navigation and both files still exist.

- [ ] **Step 3: Remove the client surface**

In `client/src/App.tsx`, remove the `AITraining` import and the
`<Route path="ai-training" ... />` entry.

In `client/src/components/layout/Sidebar.tsx`, remove `Brain` from the Lucide
import and remove the full sidebar item whose `href` is `/ai-training`.

Delete `client/src/pages/AITraining.tsx` and
`client/src/services/feedbackApi.ts`.

- [ ] **Step 4: Verify GREEN and client build**

Run:

```bash
cd client
node --test tests/retired-ai-training.test.mjs
npm run build
```

Expected: 2 tests PASS; TypeScript and Vite build pass. Existing Browserslist
age and chunk-size warnings may remain.

- [ ] **Step 5: Commit exact Task 2 paths**

```bash
git add \
  client/tests/retired-ai-training.test.mjs \
  client/src/App.tsx \
  client/src/components/layout/Sidebar.tsx \
  client/src/pages/AITraining.tsx \
  client/src/services/feedbackApi.ts
git commit -m "refactor(mvp): hide deferred conversation review"
```

---

### Task 3: Make product documentation truthful

**Files:**
- Modify: `README.md`
- Modify: `LAUNCH_TODO.md`
- Modify: `server/src/utils/googleSheetsService.ts`

**Interfaces:**
- Consumes: current LiveKit-only, Redis-free, BYOK architecture.
- Produces: MVP docs with no claim that Dialogflow training or HITL retraining is active.

- [ ] **Step 1: Prove stale claims are present**

Run:

```bash
rg -n "Dialogflow CX|Auto-Retraining|AI Training Dashboard|automated retraining|BullMQ|Managed Redis|REDIS_URL" \
  README.md LAUNCH_TODO.md server/src/utils/googleSheetsService.ts
```

Expected: matches in all three scoped files.

- [ ] **Step 2: Rewrite README around the current MVP**

Replace the feature and stack descriptions with truthful current claims:

```markdown
# Lumina Outreach

Lumina is an outbound AI calling and lead-management platform. A React dashboard
manages leads and campaigns, a Fastify API controls call state, and a LiveKit
Agent handles real-time voice over SIP.

## MVP capabilities

- LiveKit-only outbound calls with E.164 normalization
- Per-user BYO Deepgram and LLM credentials, encrypted at rest
- Deepgram STT and Aura TTS with OpenAI, Anthropic, or Google LLMs
- Campaign scripts, lead management, single calls, and MongoDB-backed batches
- Barge-in, voicemail handling, callbacks, transfer tools, transcripts, outcomes,
  optional GCS recordings, and dashboard analytics
- Redis-free batch recovery using MongoDB `processedLeadIds`

## Deferred beyond MVP

- Conversation Review and human quality scoring
- Automatic prompt evaluation and provider-specific fine-tuning
- Per-turn annotations and automatic campaign-script changes
```

Keep Quick Start concise and list the current required groups: MongoDB, LiveKit,
SIP trunk, `CONFIG_ENCRYPTION_KEY`, and per-user provider keys configured in the
app. Remove Dialogflow, BullMQ/Redis, ElevenLabs, and global provider-key setup
claims.

- [ ] **Step 3: Update launch checklist and Google Sheets comment**

In `LAUNCH_TODO.md`:

- Remove the completed “Self-Learning Loop” claim.
- Replace Dialogflow optimization with LiveKit/BYOK production gates.
- Replace HITL calibration with a post-MVP Conversation Review backlog item.
- Remove managed Redis requirements and public feedback API rollout.

In `server/src/utils/googleSheetsService.ts`, replace:

```ts
// Use the same credentials as Dialogflow
```

with:

```ts
// Google Sheets uses the service account referenced by GOOGLE_APPLICATION_CREDENTIALS.
```

- [ ] **Step 4: Verify stale active claims are gone**

Run:

```bash
if rg -n "Dialogflow CX|Auto-Retraining|AI Training Dashboard|automated retraining|BullMQ|Managed Redis|REDIS_URL" \
  README.md LAUNCH_TODO.md server/src/utils/googleSheetsService.ts; then
  exit 1
fi
```

Expected: exit 0 with no output.

- [ ] **Step 5: Commit exact Task 3 paths**

```bash
git add README.md LAUNCH_TODO.md server/src/utils/googleSheetsService.ts
git commit -m "docs(mvp): defer conversation review"
```

---

### Task 4: Final verification

**Files:** No production changes expected.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence that MVP cleanup is complete and unrelated work remains untouched.

- [ ] **Step 1: Run complete checks**

```bash
cd server && npx tsc --noEmit && npx jest --runInBand
cd ../client && node --test tests/retired-ai-training.test.mjs && npm run build
cd .. && git diff --check main..HEAD
```

Expected: server clean, all Jest tests green, 2 client retirement tests green,
client build green, and no diff whitespace errors.

- [ ] **Step 2: Verify reachability is gone and data sources remain**

```bash
if rg -n "AITraining|ai-training|feedbackApi|callFeedbackRoutes|collectTrainingData" \
  client/src server/src -g '!**/__tests__/**'; then
  exit 1
fi
rg -n "transcript|conversationLog|outcome|recordingUrl" server/src/models/Call.ts
```

Expected: first scan has no matches; second scan confirms all four future review
data fields still exist.

- [ ] **Step 3: Verify surgical worktree state**

```bash
git status --short
```

Expected: only pre-existing user changes remain in `AGENTS.md` and
`client/src/pages/Configuration.tsx`; no uncommitted task files.
