# Conversation Review Design

**Date:** 2026-07-12
**Status:** Deferred to post-MVP
**Replaces:** Legacy Dialogflow-era “AI Training & Feedback” surface

## MVP Decision

Do not build Conversation Review in the MVP. Reliable calling, BYOK setup,
campaign execution, persisted outcomes, and basic analytics come first.

MVP scope is retirement only:

- Hide and remove the misleading AI Training client surface.
- Unregister and remove the dead feedback/retraining API code.
- Remove active Dialogflow and automatic-retraining claims from product docs.
- Preserve existing `Call` transcripts, outcomes, conversation logs, and
  recordings. These are the future review system's source data.
- Leave the historical MongoDB `callfeedbacks` collection untouched.

Do not add `CallReview`, review APIs, `Call.aiContext`, review metrics, or a new
page during MVP cleanup.

Revisit this design after either threshold is met:

- At least 100 completed calls exist in a representative production dataset; or
- Managers repeatedly review calls manually and can name the decisions the
  current Call History page does not support.

Everything below describes the approved post-MVP direction, not current MVP
implementation scope.

## Decision

Keep human review as a product capability, but remove the claim that Lumina
“retrains” the agent. Replace the existing intent-correction page with a
tenant-scoped **Conversation Review** workspace backed by real LiveKit call
records.

LiveKit orchestrates calls. OpenAI, Anthropic, or Google provide the LLM through
each user’s BYO credentials. A provider-neutral “Retrain Agent” button cannot
truthfully train those systems. The portable improvement loop is:

```text
LiveKit call
  -> transcript, outcome, recording, call context
  -> manager review
  -> labeled quality dataset
  -> campaign script / prompt / knowledge changes
  -> regression evaluation
  -> versioned rollout
```

## Current Problems

- The LiveKit path never creates `CallFeedback` rows. `aiService.collectTrainingData`
  has no callers.
- `/api/feedback/retrain` returns HTTP 410 because Dialogflow retraining was removed.
- Approving or correcting a row only edits MongoDB; no agent consumes the result.
- The page shows hardcoded `92.4%`, `+2.1%`, and `42` metrics.
- Copy still promises a deleted 2:00 AM retraining job.
- `detectedIntent` and `detectedConfidence` belong to the retired Dialogflow NLU
  model, not the current LLM-agent architecture.
- The sidebar exposes the page broadly while the API is manager/admin-only.

Shipping this unchanged would misrepresent product behavior.

## Users and Job

Primary user: campaign manager reviewing outbound calls.

Single job: find calls needing attention, understand what happened, record a
quality judgment, and identify the concrete campaign change that should follow.

## Scope

### 1. Navigation and routes

- Sidebar label: **Conversation Review**.
- Canonical client route: `/conversation-review`.
- `/ai-training` redirects to `/conversation-review` for bookmarked links.
- Navigation and page access are restricted to manager/admin roles.
- Replace `/api/feedback/*` with `/api/conversation-reviews/*`.

### 2. Review queue

Source the queue from real `Call` documents. Eligible calls are terminal calls
with at least one reviewable artifact: transcript, conversation log, recording,
or outcome.

Filters:

- Unreviewed / reviewed / all
- Campaign
- Outcome
- Date range
- Search by lead, phone number, transcript text, or reviewer notes

Default ordering: newest unreviewed calls first.

Managers can access only calls belonging to campaigns they own. Admins may
access all calls. Server authorization is authoritative; UI hiding is only a
convenience.

### 3. Review workspace

Desktop uses a two-column “review desk”:

```text
+-------------------------+--------------------------------------+
| Review queue            | Call evidence                        |
| campaign / outcome      | lead, campaign, provider, duration   |
| short transcript sample | transcript timeline / recording      |
| reviewed state          |                                      |
|                         | Sticky review ledger                 |
|                         | scores, issue tags, notes, verdict   |
+-------------------------+--------------------------------------+
```

Mobile stacks queue, evidence, then review form.

Evidence shown:

- Lead and campaign
- Call status, outcome, duration, timestamp
- Provider/model and campaign script version used for the call
- Transcript and conversation turns
- Recording player when `recordingUrl` exists
- Agent notes and callback state

Review fields:

- Overall rating: 1–5
- Outcome correct: yes / no / uncertain
- Script adherence: 1–5
- Objection handling: 1–5 / not applicable
- Compliance: pass / fail / not applicable
- Hallucination observed: yes / no
- Transfer or voicemail handling: pass / fail / not applicable
- Issue tags
- Reviewer notes
- Ideal response or recommended campaign change
- Verdict: pass / needs improvement

Saving a review never edits a campaign automatically. The page links to the
campaign editor so a human can make and approve the script change.

### 4. Real metrics

Replace fake training cards with values computed from stored calls and reviews:

- Unreviewed calls
- Reviewed in the last seven days
- Average overall rating
- Needs-improvement rate

No “accuracy”, “learning velocity”, or improvement claim appears without a
defined denominator and persisted source data.

### 5. Data model

Add `CallReview` with one current review per call:

```ts
{
  callId: ObjectId,          // unique, ref Call
  campaignId: ObjectId,      // indexed, ref Campaign
  reviewerId: ObjectId,      // ref User
  verdict: 'pass' | 'needs-improvement',
  overallRating: 1 | 2 | 3 | 4 | 5,
  outcomeCorrect: 'yes' | 'no' | 'uncertain',
  scriptAdherence: 1 | 2 | 3 | 4 | 5,
  objectionHandling: 1 | 2 | 3 | 4 | 5 | null,
  compliance: 'pass' | 'fail' | 'not-applicable',
  hallucinationObserved: boolean,
  specialHandling: 'pass' | 'fail' | 'not-applicable',
  issueTags: string[],
  notes: string,
  idealResponse: string,
  createdAt: Date,
  updatedAt: Date
}
```

Add non-secret `aiContext` to `Call` at dispatch time:

```ts
{
  llmProvider: 'openai' | 'anthropic' | 'google',
  llmModel: string,
  sttModel: string,
  ttsVoice: string,
  scriptVersionName?: string
}
```

Never persist provider API keys in `Call` or `CallReview`.

### 6. Server API

Authenticated manager/admin endpoints:

- `GET /api/conversation-reviews/calls` — tenant-scoped queue plus pagination
- `GET /api/conversation-reviews/calls/:callId` — evidence plus current review
- `PUT /api/conversation-reviews/calls/:callId` — validate and upsert review
- `GET /api/conversation-reviews/summary` — real aggregate metrics

Errors:

- `400` invalid score, enum, filter, or payload
- `403` call belongs to another tenant
- `404` call not found
- `409` optional optimistic-concurrency conflict when stale updates are detected

### 7. Legacy cleanup

- Remove the retrain button, hardcoded metrics, and Dialogflow copy.
- Remove registered `/api/feedback` routes and unused feedback client.
- Remove the unreachable `aiService.collectTrainingData` method.
- Retire the `CallFeedback` model from code.
- Do not drop the existing MongoDB collection automatically. Leave historical
  documents untouched for manual export or later deletion.
- Update README and launch checklist claims that still say Dialogflow retraining
  is active.

## Visual Direction

Stay inside Lumina’s existing dashboard system. No unrelated rebrand.

- **Palette:** existing semantic tokens, with signal colors used only for review
  evidence: pass green, attention amber, fail red, neutral slate.
- **Typography:** existing application type, with tabular numerals for duration,
  rating, and timestamps.
- **Layout:** quiet evidence surface plus one distinctive sticky **review ledger**.
- **Signature:** the ledger reads like a call-quality scorecard, not another row
  of generic gradient metric cards.
- **Motion:** one restrained queue-to-detail transition; honor reduced motion.
- **Accessibility:** keyboard-operable queue and form, visible focus, text labels
  alongside color, and transcript/recording controls with accessible names.

## Testing

### Server

- Tenant isolation for queue, detail, summary, and upsert
- Manager/admin role enforcement
- Validation boundaries for every score and enum
- One-review-per-call upsert behavior
- Aggregate metrics computed from fixtures, never constants
- `aiContext` persists provider/model/voice metadata and never API keys

### Client

- Route redirect and role-aware navigation
- Loading, empty, error, and populated queue states
- Filter behavior
- Review validation and save behavior
- Recording absent/present states
- Responsive keyboard-accessible interaction

### Integration and browser QA

- Complete LiveKit test call appears in queue with transcript and outcome
- Manager reviews call; reload preserves review
- Different tenant cannot fetch or mutate review
- Real summary counts change after review
- Existing calls without `aiContext` render as “Unknown”, not an error

## Non-goals

- Automatic fine-tuning of OpenAI, Anthropic, or Google models
- Automatic campaign-script edits
- LLM-as-judge scoring in the first release
- Per-turn annotation in the first release
- Replacing LiveKit observability
- Changing the LiveKit agent’s conversation behavior in this task

## Rollout

1. Land model, owner-scoped API, dispatch metadata, and tests.
2. Land Conversation Review UI and redirect old route.
3. Remove legacy feedback registrations and misleading documentation.
4. Run browser QA with two tenants.
5. Run one real LiveKit call and verify transcript-to-review persistence.

No destructive database migration is required.
