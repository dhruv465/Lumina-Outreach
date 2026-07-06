# LiveKit Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lumina's custom Twilio-media-streams voice pipeline with LiveKit Agents (Python agent + Node dispatch), behind a per-campaign feature flag, keeping the Fastify/Mongo/BullMQ business layer unchanged.

**Architecture:** A new Python agent service (`livekit-agent/`) joins a LiveKit room per call, dials the lead via a Twilio Elastic SIP trunk, and runs the Deepgram→Gemini→ElevenLabs pipeline. The existing Fastify server dispatches calls via `livekit-server-sdk`, receives LiveKit webhooks to drive Call record lifecycle, and exposes internal API endpoints that agent tools call mid-conversation. Legacy Twilio pipeline stays untouched until Phase 4 cleanup.

**Tech Stack:** Python ≥3.10 + uv + `livekit-agents[deepgram,google,elevenlabs,silero,turn_detector]~=1.5` + httpx + pytest/respx; Node/TypeScript + Fastify 5 + `livekit-server-sdk` + jest/ts-jest; MongoDB/Mongoose; BullMQ/Redis; LiveKit Cloud; Twilio Elastic SIP Trunking.

**Spec:** `docs/superpowers/specs/2026-07-06-livekit-integration-design.md`

## Global Constraints

- **Never trust memory for LiveKit APIs.** Before writing/altering any LiveKit call, verify against live docs: `mcp__livekit-docs__*` tools or `lk docs`. Code in this plan was verified against docs rendered 2026-07-06; re-verify anything that fails.
- Python agent: `livekit-agents[deepgram,google,elevenlabs,silero,turn_detector]~=1.5`, Python ≥ 3.10, `uv` package manager.
- Agent name (dispatch identifier): `lumina-outbound`. Room naming: `call-<mongo Call _id>`.
- Dispatch metadata JSON keys are snake_case: `call_id`, `lead_id`, `campaign_id`, `phone_number`, `script`, `opening_message`, `voice_id`, `lead_name`, `transfer_to`.
- Secrets live in `.env` / `.env.local` only. Never commit keys. Repo has prior credential-leak history — check `git status` before every commit; `git add` specific paths only (repo has many unrelated uncommitted changes).
- Legacy Twilio voice pipeline files must NOT be modified or deleted until Task 21.
- Providers are BYO-key plugins (NOT LiveKit Inference) — required for later self-host portability.
- Env vars — server `.env`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME=lumina-outbound`, `LUMINA_SERVICE_API_KEY`. Agent `.env.local`: same LiveKit trio + `SIP_OUTBOUND_TRUNK_ID`, `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`, `ELEVEN_API_KEY`, `LUMINA_API_URL`, `LUMINA_SERVICE_API_KEY`.
- Commit style: conventional commits (`feat(livekit): …`, `test(livekit): …`), one commit per green test cycle.

---

## Phase 1 — Spike (validate before building)

### Task 1: LiveKit Cloud project + CLI + credentials

**Files:**
- Modify: `server/.env.example` (add LiveKit block)
- No code. Console + CLI work.

**Interfaces:**
- Produces: working `lk` CLI auth; `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` values used by every later task.

- [ ] **Step 1: Install LiveKit CLI**

```bash
brew install livekit-cli
lk --version
```
Expected: version prints.

- [ ] **Step 2: Create LiveKit Cloud project + link CLI**

Sign up / sign in at https://cloud.livekit.io (free Build tier). Create project `lumina`. Then:

```bash
lk cloud auth
```
Browser opens; authenticate and link the project.

- [ ] **Step 3: Verify credentials work**

```bash
lk room list
```
Expected: empty list (no error). Copy `LIVEKIT_URL` (wss://…livekit.cloud), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from project settings.

- [ ] **Step 4: Add env template entries**

Append to `server/.env.example`:

```bash
# LiveKit (real-time voice layer)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_AGENT_NAME=lumina-outbound
# Static bearer token the Python agent uses to call the Fastify internal API
LUMINA_SERVICE_API_KEY=
```

Put real values in `server/.env` (NOT committed).

- [ ] **Step 5: Commit**

```bash
git add server/.env.example
git commit -m "chore(livekit): add LiveKit env template entries"
```

### Task 2: Twilio Elastic SIP trunk + LiveKit outbound trunk

**Files:** none (console + CLI). Record trunk ID in `server/.env.example` comment.

**Interfaces:**
- Produces: `SIP_OUTBOUND_TRUNK_ID` (format `ST_xxxx`) consumed by the agent in Tasks 3, 6.

- [ ] **Step 1: Create Twilio Elastic SIP trunk (Twilio side)**

Follow the official guide (fetch current steps — Twilio console changes): docs page `/telephony/start/providers/twilio` via `lk docs get-page` or MCP. Summary of what you configure:
1. Twilio Console → Elastic SIP Trunking → Trunks → Create new trunk (name: `lumina-livekit`).
2. Trunk domain: `lumina-livekit.pstn.twilio.com` (must end `.pstn.twilio.com`).
3. Create a Credential List (username + strong password) and attach it to the trunk's **Termination** settings (outbound = termination from Twilio's perspective).
4. Associate your existing Twilio phone number with the trunk.

- [ ] **Step 2: Create the LiveKit outbound trunk**

Create `outbound-trunk.json` (scratch dir, not repo):

```json
{
  "trunk": {
    "name": "Lumina Twilio outbound",
    "address": "lumina-livekit.pstn.twilio.com",
    "numbers": ["+1XXXXXXXXXX"]
  }
}
```

Use your real trunk domain and phone number. Then:

```bash
lk sip outbound create outbound-trunk.json \
  --auth-user "$SIP_AUTH_USERNAME" \
  --auth-pass "$SIP_AUTH_PASSWORD"
```
Expected output: `SIPTrunkID: ST_xxxx` — save as `SIP_OUTBOUND_TRUNK_ID`.

- [ ] **Step 3: Verify trunk exists**

```bash
lk sip outbound list
```
Expected: trunk listed with your number.

- [ ] **Step 4: Regional check (India calling)**

If leads are Indian numbers: confirm with Twilio account that international/India termination is enabled and caller-ID/DLT rules are satisfied for your number. Document findings in `docs/superpowers/specs/2026-07-06-livekit-integration-design.md` under Risks (edit the row). This is a Phase-1 kill-criterion input.

### Task 3: Spike — one real outbound call + latency gate

**Files:**
- Create: `livekit-agent-spike/` (throwaway clone, NOT committed — add to `.gitignore`)

**Interfaces:**
- Produces: go/no-go decision recorded in spec; validated trunk + credentials.

- [ ] **Step 1: Clone the canonical outbound example**

```bash
git clone https://github.com/livekit-examples/outbound-caller-python "livekit-agent-spike"
cd livekit-agent-spike
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python agent.py download-files
```

- [ ] **Step 2: Configure env**

`cp .env.example .env.local`, fill: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SIP_OUTBOUND_TRUNK_ID` (from Task 2), `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` (spike uses example's default providers — fine for validation; our providers come in Task 6).

- [ ] **Step 3: Run agent + place a real call to your own phone**

Terminal 1:
```bash
python agent.py dev
```
Terminal 2:
```bash
lk dispatch create \
  --new-room \
  --agent-name outbound-caller \
  --metadata '{"phone_number": "+91XXXXXXXXXX", "transfer_to": ""}'
```
Expected: your phone rings; answer; hold a short conversation with the agent.

- [ ] **Step 4: Measure + record the gate**

Measure perceived response latency (speak → agent reply) over ≥5 turns; note audio quality, barge-in behavior. Compare against current Twilio pipeline (place one legacy call). Append results to the spec's Risks section. **Gate: if latency/quality is clearly worse than legacy pipeline, STOP and re-evaluate before Phase 2.**

- [ ] **Step 5: Gitignore the spike dir + commit**

Append `livekit-agent-spike/` to root `.gitignore`.

```bash
git add .gitignore docs/superpowers/specs/2026-07-06-livekit-integration-design.md
git commit -m "docs(livekit): record spike results and latency gate"
```

---

## Phase 2 — Bridge (production agent + Fastify integration)

### Task 4: Scaffold `livekit-agent/` project

**Files:**
- Create: `livekit-agent/pyproject.toml`, `livekit-agent/.env.example`, `livekit-agent/.gitignore`, `livekit-agent/README.md`, `livekit-agent/tools/__init__.py`, `livekit-agent/tests/__init__.py`

**Interfaces:**
- Produces: installable project; `uv run pytest` green (0 tests); env contract for Tasks 5–6.

- [ ] **Step 1: Init project**

```bash
mkdir -p "livekit-agent/tools" "livekit-agent/tests"
cd livekit-agent
uv init --name lumina-livekit-agent --python ">=3.10"
uv add "livekit-agents[deepgram,google,elevenlabs,silero,turn_detector]~=1.5" "httpx~=0.27" "python-dotenv~=1.0"
uv add --dev "pytest~=8.0" "pytest-asyncio~=0.24" "respx~=0.21"
touch tools/__init__.py tests/__init__.py
```

- [ ] **Step 2: Configure pytest-asyncio**

Append to `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: Write `.env.example`**

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
SIP_OUTBOUND_TRUNK_ID=ST_xxxx
DEEPGRAM_API_KEY=
GOOGLE_API_KEY=
ELEVEN_API_KEY=
LUMINA_API_URL=http://localhost:8000/api
LUMINA_SERVICE_API_KEY=
```

- [ ] **Step 4: Write `livekit-agent/.gitignore`**

```
.env
.env.local
.venv/
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 5: Verify + commit**

```bash
uv run pytest
```
Expected: `no tests ran` (exit 5 is fine).

```bash
git add livekit-agent/pyproject.toml livekit-agent/uv.lock livekit-agent/.env.example livekit-agent/.gitignore livekit-agent/tools/__init__.py livekit-agent/tests/__init__.py
git commit -m "feat(livekit): scaffold Python agent project"
```

### Task 5: `tools/lumina_api.py` — HTTP client to Fastify (TDD)

**Files:**
- Create: `livekit-agent/tools/lumina_api.py`
- Test: `livekit-agent/tests/test_lumina_api.py`

**Interfaces:**
- Produces (consumed by Task 6):
  - `class LuminaAPI(base_url: str, api_key: str)`
  - `async get_lead(lead_id: str) -> dict` — GET `/internal/livekit/leads/{lead_id}`
  - `async post_outcome(call_id: str, outcome: str, notes: str = "") -> bool` — POST `/internal/livekit/calls/{call_id}/outcome`
  - `async post_transcript(call_id: str, transcript: str, conversation_log: list[dict]) -> bool` — POST `/internal/livekit/calls/{call_id}/transcript`
  - `async schedule_callback(call_id: str, datetime_iso: str, notes: str = "") -> bool` — POST `/internal/livekit/calls/{call_id}/callback`
- Consumes: Fastify internal routes (Task 7 implements the server side; contract is fixed here).

- [ ] **Step 1: Write failing tests**

`tests/test_lumina_api.py`:

```python
import respx
import httpx
from tools.lumina_api import LuminaAPI

BASE = "http://testserver/api"
API = LuminaAPI(base_url=BASE, api_key="test-key")


@respx.mock
async def test_get_lead_returns_dict_and_sends_bearer():
    route = respx.get(f"{BASE}/internal/livekit/leads/abc123").mock(
        return_value=httpx.Response(200, json={"name": "Ravi", "company": "Acme"})
    )
    lead = await API.get_lead("abc123")
    assert lead["name"] == "Ravi"
    assert route.calls[0].request.headers["authorization"] == "Bearer test-key"


@respx.mock
async def test_get_lead_returns_empty_dict_on_404():
    respx.get(f"{BASE}/internal/livekit/leads/missing").mock(
        return_value=httpx.Response(404)
    )
    assert await API.get_lead("missing") == {}


@respx.mock
async def test_post_outcome_true_on_200():
    respx.post(f"{BASE}/internal/livekit/calls/c1/outcome").mock(
        return_value=httpx.Response(200, json={"success": True})
    )
    assert await API.post_outcome("c1", "interested", "wants demo") is True


@respx.mock
async def test_post_outcome_false_on_500_no_raise():
    respx.post(f"{BASE}/internal/livekit/calls/c1/outcome").mock(
        return_value=httpx.Response(500)
    )
    assert await API.post_outcome("c1", "interested") is False


@respx.mock
async def test_post_transcript_sends_payload():
    route = respx.post(f"{BASE}/internal/livekit/calls/c1/transcript").mock(
        return_value=httpx.Response(200)
    )
    ok = await API.post_transcript("c1", "hello world", [{"role": "assistant", "content": "hi"}])
    assert ok is True
    import json
    body = json.loads(route.calls[0].request.content)
    assert body["transcript"] == "hello world"
    assert body["conversation_log"][0]["role"] == "assistant"


@respx.mock
async def test_schedule_callback_true_on_200():
    respx.post(f"{BASE}/internal/livekit/calls/c1/callback").mock(
        return_value=httpx.Response(200)
    )
    assert await API.schedule_callback("c1", "2026-07-10T15:00:00+05:30", "call back") is True
```

- [ ] **Step 2: Run tests — verify fail**

```bash
cd livekit-agent && uv run pytest tests/test_lumina_api.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'tools.lumina_api'`.

- [ ] **Step 3: Implement `tools/lumina_api.py`**

```python
"""HTTP client for the Lumina Fastify internal API.

Tools must never raise into the LLM loop: failures return falsy values so the
agent can respond gracefully mid-call.
"""
import logging

import httpx

logger = logging.getLogger("lumina-api")


class LuminaAPI:
    def __init__(self, base_url: str, api_key: str, timeout: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._timeout = timeout

    async def _request(self, method: str, path: str, json: dict | None = None) -> httpx.Response | None:
        url = f"{self._base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.request(method, url, headers=self._headers, json=json)
                return resp
        except httpx.HTTPError as e:
            logger.error("Lumina API %s %s failed: %s", method, path, e)
            return None

    async def get_lead(self, lead_id: str) -> dict:
        resp = await self._request("GET", f"/internal/livekit/leads/{lead_id}")
        if resp is not None and resp.status_code == 200:
            return resp.json()
        return {}

    async def post_outcome(self, call_id: str, outcome: str, notes: str = "") -> bool:
        resp = await self._request(
            "POST",
            f"/internal/livekit/calls/{call_id}/outcome",
            json={"outcome": outcome, "notes": notes},
        )
        return resp is not None and resp.status_code == 200

    async def post_transcript(self, call_id: str, transcript: str, conversation_log: list[dict]) -> bool:
        resp = await self._request(
            "POST",
            f"/internal/livekit/calls/{call_id}/transcript",
            json={"transcript": transcript, "conversation_log": conversation_log},
        )
        return resp is not None and resp.status_code == 200

    async def schedule_callback(self, call_id: str, datetime_iso: str, notes: str = "") -> bool:
        resp = await self._request(
            "POST",
            f"/internal/livekit/calls/{call_id}/callback",
            json={"date_time": datetime_iso, "notes": notes},
        )
        return resp is not None and resp.status_code == 200
```

- [ ] **Step 4: Run tests — verify pass**

```bash
uv run pytest tests/test_lumina_api.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add livekit-agent/tools/lumina_api.py livekit-agent/tests/test_lumina_api.py
git commit -m "feat(livekit): Lumina internal API client for agent tools"
```

### Task 6: `agent.py` — SalesAgent + entrypoint + behavioral tests

**Files:**
- Create: `livekit-agent/agent.py`
- Test: `livekit-agent/tests/test_agent.py`

**Interfaces:**
- Consumes: `LuminaAPI` (Task 5); dispatch metadata contract (Global Constraints); `SIP_OUTBOUND_TRUNK_ID`.
- Produces: agent registered as `lumina-outbound`; posts transcript + outcome to Fastify at session end (endpoints from Task 7).

- [ ] **Step 1: Verify current LiveKit APIs (mandatory)**

Fetch and skim before coding — APIs below were verified 2026-07-06, re-verify:
- `mcp__livekit-docs__get_pages ["/agents/start/voice-ai?agents-sdk=python", "/telephony/making-calls/outbound-calls", "/agents/start/testing?agents-sdk=python"]`
- Confirm: `AgentServer` / `@server.rtc_session(agent_name=…)`, `AgentSession(stt=…, llm=…, tts=…, vad=…, turn_handling=TurnHandlingOptions(…))`, `ctx.api.sip.create_sip_participant`, `ctx.wait_for_participant`, `session.history` shape, `ctx.add_shutdown_callback`.

- [ ] **Step 2: Write failing behavioral test**

`tests/test_agent.py`:

```python
import os

import pytest

from livekit.agents import AgentSession
from livekit.plugins import google

from agent import SalesAgent

pytestmark = pytest.mark.skipif(
    not os.getenv("GOOGLE_API_KEY"), reason="behavioral tests need GOOGLE_API_KEY"
)

SCRIPT = """You are calling on behalf of Lumina Industrial to offer a demo of our
conversational AI platform. Qualify the lead, then propose a 30-minute demo."""


def make_agent() -> SalesAgent:
    return SalesAgent(
        call_id="test-call",
        lead_name="Ravi",
        script=SCRIPT,
        opening_message="",
        lumina_api=None,  # tools degrade gracefully without API
    )


async def test_agent_greets_and_stays_on_script():
    async with (
        google.LLM(model="gemini-2.5-flash") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(make_agent())
        result = await session.run(user_input="Hello, who is this?")
        await result.expect.next_event().is_message(role="assistant").judge(
            llm,
            intent="Introduces themselves professionally as calling from Lumina Industrial and moves toward qualifying the lead or offering a demo.",
        )
        result.expect.no_more_events()


async def test_agent_handles_not_interested_politely():
    async with (
        google.LLM(model="gemini-2.5-flash") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(make_agent())
        result = await session.run(user_input="I'm not interested, please don't call again.")
        await result.expect.next_event().is_message(role="assistant").judge(
            llm,
            intent="Politely acknowledges the refusal without being pushy, and moves to end the call respectfully.",
        )
```

- [ ] **Step 3: Run test — verify fail**

```bash
uv run pytest tests/test_agent.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'agent'` (or skip if no GOOGLE_API_KEY — set the key; behavioral tests are required).

- [ ] **Step 4: Implement `agent.py`**

```python
from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv

from livekit import api
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    TurnHandlingOptions,
    cli,
    function_tool,
    get_job_context,
)
from livekit.plugins import deepgram, elevenlabs, google, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from tools.lumina_api import LuminaAPI

load_dotenv(".env.local")
logger = logging.getLogger("lumina-outbound")
logger.setLevel(logging.INFO)

AGENT_NAME = "lumina-outbound"
SIP_OUTBOUND_TRUNK_ID = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
DEFAULT_VOICE_ID = os.getenv("ELEVEN_DEFAULT_VOICE_ID", "ODq5zmih8GrVes37Dizd")


def build_instructions(lead_name: str, script: str, opening_message: str) -> str:
    return f"""You are a professional sales representative for Lumina on a live phone call.
The person you are calling is named {lead_name or "unknown"}.

Campaign script (follow it, adapt naturally):
{script}

{f"Open with: {opening_message}" if opening_message else ""}

Rules:
- Voice conversation: be concise, warm, professional. No emojis, asterisks, or markdown.
- Listen more than you talk. One question at a time.
- Handle objections with empathy; never argue.
- If they ask to stop or are clearly uninterested, wrap up politely and use end_call.
- Record the outcome with record_outcome before ending every call.
- To schedule a follow-up, use schedule_callback with an ISO datetime.
"""


class SalesAgent(Agent):
    def __init__(
        self,
        *,
        call_id: str,
        lead_name: str,
        script: str,
        opening_message: str = "",
        lumina_api: LuminaAPI | None = None,
    ) -> None:
        super().__init__(instructions=build_instructions(lead_name, script, opening_message))
        self.call_id = call_id
        self.lumina = lumina_api

    async def _hangup(self) -> None:
        ctx = get_job_context()
        if ctx is None:
            return
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))

    @function_tool()
    async def record_outcome(self, ctx: RunContext, outcome: str, notes: str = "") -> str:
        """Record the call outcome in the CRM. Call this before ending every call.

        Args:
            outcome: One of: interested, not-interested, callback-requested, voicemail, wrong-number, do-not-call
            notes: Short summary of the conversation result
        """
        if self.lumina is None:
            return "outcome noted"
        ok = await self.lumina.post_outcome(self.call_id, outcome, notes)
        return "outcome recorded" if ok else "could not record outcome, continue anyway"

    @function_tool()
    async def schedule_callback(self, ctx: RunContext, datetime_iso: str, notes: str = "") -> str:
        """Schedule a follow-up call at the time the lead requested.

        Args:
            datetime_iso: ISO-8601 datetime for the callback, e.g. 2026-07-10T15:00:00+05:30
            notes: What to discuss on the follow-up
        """
        if self.lumina is None:
            return "callback noted"
        ok = await self.lumina.schedule_callback(self.call_id, datetime_iso, notes)
        return "callback scheduled" if ok else "could not schedule callback, apologize and offer to try again"

    @function_tool()
    async def end_call(self, ctx: RunContext) -> str:
        """End the phone call. Use after saying goodbye, or when the user asks to stop."""
        current_speech = ctx.session.current_speech
        if current_speech:
            await current_speech.wait_for_playout()
        await self._hangup()
        return "call ended"

    @function_tool()
    async def detected_answering_machine(self, ctx: RunContext) -> str:
        """Call this AFTER you hear a voicemail greeting or beep instead of a live person."""
        if self.lumina is not None:
            await self.lumina.post_outcome(self.call_id, "voicemail", "answering machine detected")
        await self._hangup()
        return "hung up on voicemail"


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    meta = json.loads(ctx.job.metadata or "{}")
    call_id = meta.get("call_id", "")
    phone_number = meta.get("phone_number")
    logger.info("job started room=%s call_id=%s", ctx.room.name, call_id)

    lumina = LuminaAPI(
        base_url=os.getenv("LUMINA_API_URL", "http://localhost:8000/api"),
        api_key=os.getenv("LUMINA_SERVICE_API_KEY", ""),
    )

    agent = SalesAgent(
        call_id=call_id,
        lead_name=meta.get("lead_name", ""),
        script=meta.get("script", ""),
        opening_message=meta.get("opening_message", ""),
        lumina_api=lumina,
    )

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=google.LLM(model="gemini-2.5-flash"),
        tts=elevenlabs.TTS(
            voice_id=meta.get("voice_id") or DEFAULT_VOICE_ID,
            model="eleven_flash_v2_5",
        ),
        turn_handling=TurnHandlingOptions(turn_detection=MultilingualModel()),
    )

    async def persist_transcript() -> None:
        if not call_id:
            return
        items = []
        for item in session.history.items:
            role = getattr(item, "role", None)
            content = getattr(item, "text_content", None)
            if role and content:
                items.append({"role": role, "content": content})
        transcript = "\n".join(f"{i['role']}: {i['content']}" for i in items)
        await lumina.post_transcript(call_id, transcript, items)

    ctx.add_shutdown_callback(persist_transcript)

    # Start the session before dialing so no audio is missed at pickup.
    import asyncio

    session_started = asyncio.create_task(session.start(agent=agent, room=ctx.room))

    if phone_number:
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=SIP_OUTBOUND_TRUNK_ID,
                    sip_call_to=phone_number,
                    participant_identity=phone_number,
                    wait_until_answered=True,
                )
            )
        except api.TwirpError as e:
            logger.error(
                "dial failed: %s SIP %s %s",
                e.message,
                e.metadata.get("sip_status_code"),
                e.metadata.get("sip_status"),
            )
            await lumina.post_outcome(call_id, "no-answer", f"SIP {e.metadata.get('sip_status_code')}")
            ctx.shutdown()
            return

        await session_started
        await ctx.wait_for_participant(identity=phone_number)
        logger.info("callee answered call_id=%s", call_id)
        # Outbound etiquette: let the callee speak first; agent responds after their turn.
    else:
        await session_started
        await session.generate_reply(instructions="Greet the caller and offer your assistance.")


if __name__ == "__main__":
    cli.run_app(server)
```

- [ ] **Step 5: Run behavioral tests — verify pass**

```bash
uv run pytest tests/ -v
```
Expected: all pass (lumina_api 6 + agent 2). If `session.history.items` / item attribute names differ from docs, fix per the reference: `mcp__livekit-docs__get_pages ["/reference/python/livekit/agents/llm"]`.

- [ ] **Step 6: Smoke-run against LiveKit Cloud + one real call**

```bash
uv run python agent.py download-files
uv run python agent.py dev
```
In another terminal:
```bash
lk dispatch create --new-room --agent-name lumina-outbound \
  --metadata '{"call_id":"smoke1","lead_name":"Test","phone_number":"+91XXXXXXXXXX","script":"Offer a demo of Lumina.","voice_id":""}'
```
Expected: phone rings; conversation works with Deepgram/Gemini/ElevenLabs voices. (Transcript POST will fail until Task 7 — log line is expected, not a crash.)

- [ ] **Step 7: Commit**

```bash
git add livekit-agent/agent.py livekit-agent/tests/test_agent.py
git commit -m "feat(livekit): lumina-outbound sales agent with CRM tools"
```

### Task 7: Fastify internal API for agent tools + service auth (TDD)

**Files:**
- Create: `server/src/middleware/serviceAuth.ts`
- Create: `server/src/routes/livekitInternalRoutes.ts`
- Modify: `server/src/index.ts` (register route in the `apiRouter` block, after line ~272 `apiRouter.register(ragRoutes, { prefix: "/rag" });`)
- Test: `server/src/middleware/__tests__/serviceAuth.test.ts`

**Interfaces:**
- Consumes: `Call`, `Lead` mongoose models; `callService.scheduleCallback(id, dateTime, notes)` (exists, `server/src/services/callService.ts:120`).
- Produces HTTP contract consumed by Task 5 client:
  - `GET /api/internal/livekit/leads/:leadId` → 200 `{name, company, title, notes}` | 404
  - `POST /api/internal/livekit/calls/:callId/outcome` `{outcome, notes}` → 200 `{success:true}`
  - `POST /api/internal/livekit/calls/:callId/transcript` `{transcript, conversation_log}` → 200
  - `POST /api/internal/livekit/calls/:callId/callback` `{date_time, notes}` → 200
  - All require `Authorization: Bearer <LUMINA_SERVICE_API_KEY>`; else 401.

- [ ] **Step 1: Write failing middleware test**

`server/src/middleware/__tests__/serviceAuth.test.ts`:

```typescript
import { serviceAuth } from '../serviceAuth';

describe('serviceAuth', () => {
  const reply = () => {
    const r: any = { statusCode: 0, sent: undefined };
    r.code = (c: number) => { r.statusCode = c; return r; };
    r.send = (b: any) => { r.sent = b; return r; };
    return r;
  };

  beforeEach(() => { process.env.LUMINA_SERVICE_API_KEY = 'secret-key'; });

  it('passes with correct bearer token', async () => {
    const req: any = { headers: { authorization: 'Bearer secret-key' } };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(0); // untouched
  });

  it('rejects missing header with 401', async () => {
    const req: any = { headers: {} };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(401);
  });

  it('rejects wrong token with 401', async () => {
    const req: any = { headers: { authorization: 'Bearer nope' } };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(401);
  });

  it('rejects when env key unset with 500', async () => {
    delete process.env.LUMINA_SERVICE_API_KEY;
    const req: any = { headers: { authorization: 'Bearer secret-key' } };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(500);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd server && npx jest src/middleware/__tests__/serviceAuth.test.ts
```
Expected: FAIL — cannot find module `../serviceAuth`. (If jest testMatch misses the path, fix `jest.config.js` testMatch to include `**/__tests__/**/*.test.ts` first.)

- [ ] **Step 3: Implement `server/src/middleware/serviceAuth.ts`**

```typescript
import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';

/**
 * Auth for machine-to-machine calls from the LiveKit agent.
 * Static bearer token, timing-safe comparison.
 */
export async function serviceAuth(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.LUMINA_SERVICE_API_KEY;
  if (!expected) {
    return reply.code(500).send({ error: 'LUMINA_SERVICE_API_KEY not configured' });
  }
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx jest src/middleware/__tests__/serviceAuth.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Implement `server/src/routes/livekitInternalRoutes.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import Call from '../models/Call';
import Lead from '../models/Lead';
import callService from '../services/callService';
import { serviceAuth } from '../middleware/serviceAuth';
import logger, { getErrorMessage } from '../utils/logger';

export default async function livekitInternalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', serviceAuth);

  fastify.get<{ Params: { leadId: string } }>('/leads/:leadId', async (request, reply) => {
    const lead = await Lead.findById(request.params.leadId).select('name company title notes phoneNumber');
    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    return {
      name: lead.name,
      company: (lead as any).company || '',
      title: (lead as any).title || '',
      notes: (lead as any).notes || '',
    };
  });

  fastify.post<{ Params: { callId: string }; Body: { outcome: string; notes?: string } }>(
    '/calls/:callId/outcome',
    async (request, reply) => {
      const { outcome, notes } = request.body || ({} as any);
      if (!outcome) return reply.code(400).send({ error: 'outcome is required' });
      const call = await Call.findByIdAndUpdate(
        request.params.callId,
        { outcome, ...(notes ? { notes } : {}) },
        { new: true }
      );
      if (!call) return reply.code(404).send({ error: 'Call not found' });
      return { success: true };
    }
  );

  fastify.post<{
    Params: { callId: string };
    Body: { transcript: string; conversation_log: Array<{ role: string; content: string }> };
  }>('/calls/:callId/transcript', async (request, reply) => {
    const { transcript, conversation_log } = request.body || ({} as any);
    const call = await Call.findByIdAndUpdate(
      request.params.callId,
      {
        transcript: transcript || '',
        conversationLog: (conversation_log || []).map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(),
        })),
      },
      { new: true }
    );
    if (!call) return reply.code(404).send({ error: 'Call not found' });
    return { success: true };
  });

  fastify.post<{ Params: { callId: string }; Body: { date_time: string; notes?: string } }>(
    '/calls/:callId/callback',
    async (request, reply) => {
      const { date_time, notes } = request.body || ({} as any);
      const when = new Date(date_time);
      if (!date_time || isNaN(when.getTime())) {
        return reply.code(400).send({ error: 'date_time must be a valid ISO datetime' });
      }
      try {
        await callService.scheduleCallback(request.params.callId, when, notes || '');
        return { success: true };
      } catch (error) {
        logger.error(`callback scheduling failed: ${getErrorMessage(error)}`);
        return reply.code(404).send({ error: 'Call not found' });
      }
    }
  );
}
```

- [ ] **Step 6: Register route in `server/src/index.ts`**

Inside the `apiRouter` block (after the `ragRoutes` registration around line 272), add:

```typescript
  const livekitInternalRoutes = require('./routes/livekitInternalRoutes').default;
  apiRouter.register(livekitInternalRoutes, { prefix: '/internal/livekit' });
```

Match the import style used by neighboring registrations in the file (top-of-file `import` if that's the pattern — check lines 1–80 and follow it).

- [ ] **Step 7: Typecheck + manual verify**

```bash
cd server && npx tsc --noEmit
npm run dev
```
In another terminal:
```bash
curl -s -H "Authorization: Bearer $LUMINA_SERVICE_API_KEY" http://localhost:8000/api/internal/livekit/leads/000000000000000000000000
```
Expected: `{"error":"Lead not found"}` with 404 (auth passed). Without header: 401.

- [ ] **Step 8: Commit**

```bash
git add server/src/middleware/serviceAuth.ts server/src/middleware/__tests__/serviceAuth.test.ts server/src/routes/livekitInternalRoutes.ts server/src/index.ts
git commit -m "feat(livekit): internal API for agent tools with service auth"
```

### Task 8: Campaign + Call model changes

**Files:**
- Modify: `server/src/models/Campaign.ts` (interface + schema)
- Modify: `server/src/models/Call.ts:34-39` (interface) and `server/src/models/Call.ts:199-206` (schema)

**Interfaces:**
- Produces: `campaign.telephonyProvider: 'twilio' | 'livekit'` (default `'twilio'`); `call.providerData.provider` accepts `'livekit'` (with `callId` = LiveKit room name). Consumed by Tasks 9–11.

- [ ] **Step 1: Campaign interface — add after `voiceConfiguration` block (line ~49)**

```typescript
  telephonyProvider: 'twilio' | 'livekit';
```

- [ ] **Step 2: Campaign schema — add after the `voiceConfiguration` schema block (line ~231)**

```typescript
    telephonyProvider: {
      type: String,
      enum: ['twilio', 'livekit'],
      default: 'twilio',
    },
```

- [ ] **Step 3: Call interface (`Call.ts:35`) — extend union**

```typescript
    provider: 'twilio' | 'nexmo' | 'plivo' | 'livekit';
```

- [ ] **Step 4: Call schema (`Call.ts:202`) — extend enum**

```typescript
      enum: ['twilio', 'nexmo', 'plivo', 'livekit']
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd server && npx tsc --noEmit
git add server/src/models/Campaign.ts server/src/models/Call.ts
git commit -m "feat(livekit): telephonyProvider campaign flag and livekit call provider"
```

### Task 9: `integrations/livekit` — types + dispatch service (TDD)

**Files:**
- Create: `server/src/integrations/livekit/types.ts`
- Create: `server/src/integrations/livekit/dispatchService.ts`
- Test: `server/src/integrations/livekit/__tests__/dispatchService.test.ts`

**Interfaces:**
- Consumes: `livekit-server-sdk` `AgentDispatchClient`; models from Task 8.
- Produces (consumed by Task 10):
  - `roomNameForCall(callId: string): string` → `` `call-${callId}` ``
  - `callIdFromRoomName(roomName: string): string | null`
  - `dispatchOutboundCall(meta: LiveKitDispatchMetadata): Promise<string>` → returns room name
  - `initiateLiveKitCall(params: { leadId: string; campaignId: string; scheduleTime?: Date; notes?: string }): Promise<ICall>`

- [ ] **Step 1: Install SDK (pinned)**

```bash
cd server && npm install livekit-server-sdk
```
Record installed version in package.json (npm pins with `^` — acceptable; note the tested version in `types.ts` header comment).

- [ ] **Step 2: Write `types.ts`**

```typescript
/**
 * Metadata contract between Lumina dispatch (this file) and the Python agent
 * (livekit-agent/agent.py). Keys are snake_case on the wire.
 * Tested against livekit-server-sdk <version> + livekit-agents ~=1.5.
 */
export interface LiveKitDispatchMetadata {
  call_id: string;
  lead_id: string;
  campaign_id: string;
  phone_number: string;
  script: string;
  opening_message: string;
  voice_id: string;
  lead_name: string;
  transfer_to?: string;
}

export const LIVEKIT_ROOM_PREFIX = 'call-';

export function roomNameForCall(callId: string): string {
  return `${LIVEKIT_ROOM_PREFIX}${callId}`;
}

export function callIdFromRoomName(roomName: string): string | null {
  if (!roomName.startsWith(LIVEKIT_ROOM_PREFIX)) return null;
  const id = roomName.slice(LIVEKIT_ROOM_PREFIX.length);
  return /^[a-f0-9]{24}$/.test(id) ? id : null;
}
```

- [ ] **Step 3: Write failing tests**

`server/src/integrations/livekit/__tests__/dispatchService.test.ts`:

```typescript
import { roomNameForCall, callIdFromRoomName } from '../types';

const mockCreateDispatch = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  AgentDispatchClient: jest.fn().mockImplementation(() => ({
    createDispatch: mockCreateDispatch,
  })),
}));

import { dispatchOutboundCall } from '../dispatchService';

describe('room name mapping', () => {
  it('builds and parses round-trip', () => {
    const id = '64b0c0ffee0ddeadbeef1234';
    expect(callIdFromRoomName(roomNameForCall(id))).toBe(id);
  });
  it('rejects foreign room names', () => {
    expect(callIdFromRoomName('random-room')).toBeNull();
    expect(callIdFromRoomName('call-notahexid')).toBeNull();
  });
});

describe('dispatchOutboundCall', () => {
  beforeEach(() => {
    mockCreateDispatch.mockReset();
    process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'key';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_AGENT_NAME = 'lumina-outbound';
  });

  it('creates dispatch on call room with serialized metadata', async () => {
    mockCreateDispatch.mockResolvedValue({});
    const meta = {
      call_id: '64b0c0ffee0ddeadbeef1234',
      lead_id: 'l1',
      campaign_id: 'c1',
      phone_number: '+911234567890',
      script: 'sell',
      opening_message: '',
      voice_id: 'v1',
      lead_name: 'Ravi',
    };
    const room = await dispatchOutboundCall(meta);
    expect(room).toBe('call-64b0c0ffee0ddeadbeef1234');
    expect(mockCreateDispatch).toHaveBeenCalledWith(
      'call-64b0c0ffee0ddeadbeef1234',
      'lumina-outbound',
      { metadata: JSON.stringify(meta) },
    );
  });

  it('throws when LIVEKIT_URL missing', async () => {
    delete process.env.LIVEKIT_URL;
    await expect(
      dispatchOutboundCall({
        call_id: 'x', lead_id: '', campaign_id: '', phone_number: '',
        script: '', opening_message: '', voice_id: '', lead_name: '',
      }),
    ).rejects.toThrow('LIVEKIT_URL');
  });
});
```

- [ ] **Step 4: Run — verify fail**

```bash
npx jest src/integrations/livekit/__tests__/dispatchService.test.ts
```
Expected: FAIL — `../dispatchService` not found.

- [ ] **Step 5: Implement `dispatchService.ts`**

```typescript
import { AgentDispatchClient } from 'livekit-server-sdk';
import mongoose from 'mongoose';
import Call, { ICall } from '../../models/Call';
import Lead from '../../models/Lead';
import Campaign from '../../models/Campaign';
import logger, { getErrorMessage } from '../../utils/logger';
import { LiveKitDispatchMetadata, roomNameForCall } from './types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

export async function dispatchOutboundCall(meta: LiveKitDispatchMetadata): Promise<string> {
  const url = requireEnv('LIVEKIT_URL');
  const apiKey = requireEnv('LIVEKIT_API_KEY');
  const apiSecret = requireEnv('LIVEKIT_API_SECRET');
  const agentName = process.env.LIVEKIT_AGENT_NAME || 'lumina-outbound';

  const client = new AgentDispatchClient(url, apiKey, apiSecret);
  const roomName = roomNameForCall(meta.call_id);
  await client.createDispatch(roomName, agentName, { metadata: JSON.stringify(meta) });
  logger.info(`LiveKit dispatch created room=${roomName} agent=${agentName}`);
  return roomName;
}

export async function initiateLiveKitCall(params: {
  leadId: string;
  campaignId: string;
  scheduleTime?: Date;
  notes?: string;
}): Promise<ICall> {
  const { leadId, campaignId, scheduleTime, notes } = params;

  const lead = await Lead.findById(leadId);
  if (!lead) throw new Error('Lead not found');
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const activeScript = campaign.script.versions.find((v) => v.isActive);
  if (!activeScript) throw new Error('No active script found for this campaign');

  const newCall = new Call({
    leadId: new mongoose.Types.ObjectId(leadId),
    campaignId: new mongoose.Types.ObjectId(campaignId),
    phoneNumber: lead.phoneNumber,
    status: scheduleTime ? 'scheduled' : 'queued',
    scheduledAt: scheduleTime || new Date(),
    notes: notes || '',
    maxRetries: 0,
    retryCount: 0,
    recordCall: false,
    priority: 'medium',
    personalityId: campaign.voiceConfiguration?.voiceId,
    voiceProvider: 'livekit',
    conversationLog: [],
  });

  if (scheduleTime) {
    await newCall.save();
    return newCall;
  }

  await newCall.save();
  const roomName = await dispatchOutboundCall({
    call_id: newCall._id.toString(),
    lead_id: leadId,
    campaign_id: campaignId,
    phone_number: lead.phoneNumber,
    script: activeScript.content,
    opening_message: campaign.openingMessage || '',
    voice_id: campaign.voiceConfiguration?.voiceId || '',
    lead_name: lead.name || '',
  });

  newCall.status = 'dialing';
  newCall.startTime = new Date();
  newCall.providerData = { provider: 'livekit', callId: roomName };
  await newCall.save();

  lead.lastContacted = new Date();
  lead.callCount = (lead.callCount || 0) + 1;
  await lead.save();

  return newCall;
}
```

- [ ] **Step 6: Run — verify pass**

```bash
npx jest src/integrations/livekit/__tests__/dispatchService.test.ts
```
Expected: 4 passed. (`initiateLiveKitCall` needs Mongo — covered by E2E Task 14, not unit-mocked here.)

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/src/integrations/livekit/types.ts server/src/integrations/livekit/dispatchService.ts server/src/integrations/livekit/__tests__/dispatchService.test.ts
git commit -m "feat(livekit): dispatch service and metadata contract"
```

### Task 10: Feature-flag branch in `callService` + `batchCallService`

**Files:**
- Modify: `server/src/services/callService.ts:12-26` (top of `initiateCall`)
- Modify: `server/src/services/batchCallService.ts:65-90` (`processSingleCall`)

**Interfaces:**
- Consumes: `initiateLiveKitCall` (Task 9), `campaign.telephonyProvider` (Task 8).
- Produces: both single and batch calls route to LiveKit when campaign flag set; legacy path byte-identical otherwise.

- [ ] **Step 1: Branch in `callService.initiateCall`**

In `server/src/services/callService.ts`, after the campaign lookup (line 18-21) and BEFORE the `Configuration`/Twilio check (line 23), insert:

```typescript
    if (campaign.telephonyProvider === 'livekit') {
      const { initiateLiveKitCall } = await import('../integrations/livekit/dispatchService');
      return initiateLiveKitCall({ leadId, campaignId, scheduleTime, notes });
    }
```

(Dynamic import keeps legacy startup unaffected if LiveKit env is absent.)

- [ ] **Step 2: Branch in `batchCallService.processSingleCall`**

In `server/src/services/batchCallService.ts`, inside `processSingleCall` after the budget check (line ~73) and before the `Lead.findById` line, insert:

```typescript
    const campaign = await Campaign.findById(campaignId);
    if (campaign?.telephonyProvider === 'livekit') {
      const { initiateLiveKitCall } = await import('../integrations/livekit/dispatchService');
      await initiateLiveKitCall({ leadId, campaignId });
      return;
    }
```

Add `import Campaign from '../models/Campaign';` at the top if not already imported.

- [ ] **Step 3: Typecheck + existing tests still green**

```bash
cd server && npx tsc --noEmit && npx jest
```
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/callService.ts server/src/services/batchCallService.ts
git commit -m "feat(livekit): route calls to LiveKit when campaign telephonyProvider=livekit"
```

### Task 11: LiveKit webhook route + Call lifecycle (TDD)

**Files:**
- Create: `server/src/integrations/livekit/webhookHandler.ts`
- Create: `server/src/routes/livekitWebhookRoutes.ts`
- Modify: `server/src/index.ts` (register at root level, near line 236 `app.register(rootWebhookRoutes, { prefix: "/" });`)
- Test: `server/src/integrations/livekit/__tests__/webhookHandler.test.ts`

**Interfaces:**
- Consumes: `callIdFromRoomName` (Task 9), `Call` model.
- Produces: `handleLiveKitEvent(event: { event: string; room?: { name: string }; participant?: { identity: string } }): Promise<void>`; HTTP endpoint `POST /webhooks/livekit` (signature-verified). Configure this URL in LiveKit Cloud dashboard.

- [ ] **Step 1: Write failing tests (mock Call model)**

`server/src/integrations/livekit/__tests__/webhookHandler.test.ts`:

```typescript
jest.mock('../../../models/Call', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));
import Call from '../../../models/Call';
import { handleLiveKitEvent } from '../webhookHandler';

const mockFindById = Call.findById as jest.Mock;

function fakeCall(overrides: Partial<any> = {}) {
  return {
    _id: '64b0c0ffee0ddeadbeef1234',
    status: 'dialing',
    phoneNumber: '+911234567890',
    startTime: undefined,
    endTime: undefined,
    duration: undefined,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ROOM = { name: 'call-64b0c0ffee0ddeadbeef1234' };

describe('handleLiveKitEvent', () => {
  beforeEach(() => mockFindById.mockReset());

  it('ignores rooms that are not lumina calls', async () => {
    await handleLiveKitEvent({ event: 'room_finished', room: { name: 'other-room' } });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('marks call in-progress when SIP participant joins', async () => {
    const call = fakeCall();
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({
      event: 'participant_joined',
      room: ROOM,
      participant: { identity: '+911234567890' },
    });
    expect(call.status).toBe('in-progress');
    expect(call.startTime).toBeInstanceOf(Date);
    expect(call.save).toHaveBeenCalled();
  });

  it('does not change status when agent participant joins', async () => {
    const call = fakeCall();
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({
      event: 'participant_joined',
      room: ROOM,
      participant: { identity: 'agent-AJ_123' },
    });
    expect(call.status).toBe('dialing');
  });

  it('completes an in-progress call on room_finished with duration', async () => {
    const started = new Date(Date.now() - 65_000);
    const call = fakeCall({ status: 'in-progress', startTime: started });
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
    expect(call.status).toBe('completed');
    expect(call.endTime).toBeInstanceOf(Date);
    expect(call.duration).toBeGreaterThanOrEqual(60);
    expect(call.save).toHaveBeenCalled();
  });

  it('fails a still-dialing call on room_finished', async () => {
    const call = fakeCall({ status: 'dialing' });
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
    expect(call.status).toBe('failed');
  });

  it('leaves terminal calls untouched', async () => {
    const call = fakeCall({ status: 'completed' });
    mockFindById.mockResolvedValue(call);
    await handleLiveKitEvent({ event: 'room_finished', room: ROOM });
    expect(call.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx jest src/integrations/livekit/__tests__/webhookHandler.test.ts
```
Expected: FAIL — `../webhookHandler` not found.

- [ ] **Step 3: Implement `webhookHandler.ts`**

```typescript
import Call from '../../models/Call';
import logger from '../../utils/logger';
import { callIdFromRoomName } from './types';

interface LiveKitWebhookEvent {
  event: string;
  room?: { name: string };
  participant?: { identity: string };
}

const TERMINAL_STATUSES = ['completed', 'failed', 'no-answer', 'busy', 'voicemail'];

export async function handleLiveKitEvent(event: LiveKitWebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  if (!roomName) return;
  const callId = callIdFromRoomName(roomName);
  if (!callId) return;

  const call = await Call.findById(callId);
  if (!call) {
    logger.warn(`LiveKit webhook for unknown call ${callId} (${event.event})`);
    return;
  }
  if (TERMINAL_STATUSES.includes(call.status)) return;

  switch (event.event) {
    case 'participant_joined': {
      // The SIP participant's identity is the dialed phone number (set by the agent).
      if (event.participant?.identity === call.phoneNumber) {
        call.status = 'in-progress';
        call.startTime = call.startTime || new Date();
        await call.save();
      }
      break;
    }
    case 'room_finished': {
      call.endTime = new Date();
      if (call.status === 'in-progress') {
        call.status = 'completed';
        if (call.startTime) {
          call.duration = Math.round((call.endTime.getTime() - call.startTime.getTime()) / 1000);
        }
      } else {
        call.status = 'failed';
      }
      await call.save();
      logger.info(`LiveKit call ${callId} finalized as ${call.status}`);
      break;
    }
    default:
      break;
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx jest src/integrations/livekit/__tests__/webhookHandler.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: Implement `server/src/routes/livekitWebhookRoutes.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';
import { handleLiveKitEvent } from '../integrations/livekit/webhookHandler';
import logger, { getErrorMessage } from '../utils/logger';

export default async function livekitWebhookRoutes(fastify: FastifyInstance) {
  // LiveKit signs the raw body; we must receive it unparsed.
  fastify.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body)
  );

  fastify.post('/livekit', async (request, reply) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return reply.code(500).send({ error: 'LiveKit credentials not configured' });
    }
    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret);
      const event = await receiver.receive(
        request.body as string,
        request.headers.authorization
      );
      await handleLiveKitEvent(event as any);
      return reply.code(200).send({ ok: true });
    } catch (error) {
      logger.error(`LiveKit webhook rejected: ${getErrorMessage(error)}`);
      return reply.code(401).send({ error: 'invalid webhook' });
    }
  });
}
```

- [ ] **Step 6: Register in `server/src/index.ts`**

Near line 236 (`app.register(rootWebhookRoutes, { prefix: "/" });`), add:

```typescript
const livekitWebhookRoutes = require('./routes/livekitWebhookRoutes').default;
app.register(livekitWebhookRoutes, { prefix: '/webhooks' });
```

(Outside the `/api` auth scope — webhook is signature-authenticated, not JWT.)

- [ ] **Step 7: Configure webhook in LiveKit Cloud**

LiveKit Cloud dashboard → Settings → Webhooks → Create: URL `https://<WEBHOOK_BASE_URL>/webhooks/livekit`, signing key = your project API key. For local dev use the ngrok URL already in `WEBHOOK_BASE_URL`. Send a test event from the dashboard; expect server log line (401 for unknown room is fine — signature verified is the point).

- [ ] **Step 8: Typecheck, full tests, commit**

```bash
npx tsc --noEmit && npx jest
git add server/src/integrations/livekit/webhookHandler.ts server/src/integrations/livekit/__tests__/webhookHandler.test.ts server/src/routes/livekitWebhookRoutes.ts server/src/index.ts
git commit -m "feat(livekit): webhook receiver drives call lifecycle"
```

### Task 12: Reconciliation job for missed webhooks (TDD)

**Files:**
- Create: `server/src/integrations/livekit/reconciliationJob.ts`
- Modify: `server/src/index.ts` (start job after server boot, same place as Step 6 registration)
- Test: `server/src/integrations/livekit/__tests__/reconciliationJob.test.ts`

**Interfaces:**
- Consumes: `RoomServiceClient.listRooms` (`livekit-server-sdk`), `Call` model, `roomNameForCall`.
- Produces: `reconcileStaleCalls(): Promise<number>` (returns count fixed) + `startLiveKitReconciliation(): void` (15-min `setInterval`).

- [ ] **Step 1: Verify `listRooms` signature**

`mcp__livekit-docs__docs_search "RoomServiceClient listRooms node"` — confirm `listRooms(names?: string[])` returns `Room[]` for currently active rooms. Adjust code below if the API differs.

- [ ] **Step 2: Write failing tests**

`server/src/integrations/livekit/__tests__/reconciliationJob.test.ts`:

```typescript
const mockListRooms = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn().mockImplementation(() => ({ listRooms: mockListRooms })),
}));
jest.mock('../../../models/Call', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
import Call from '../../../models/Call';
import { reconcileStaleCalls } from '../reconciliationJob';

const mockFind = Call.find as jest.Mock;

function staleCall(status: string) {
  return {
    _id: { toString: () => '64b0c0ffee0ddeadbeef1234' },
    status,
    startTime: new Date(Date.now() - 30 * 60_000),
    endTime: undefined,
    duration: undefined,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

describe('reconcileStaleCalls', () => {
  beforeEach(() => {
    mockListRooms.mockReset();
    mockFind.mockReset();
    process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'k';
    process.env.LIVEKIT_API_SECRET = 's';
  });

  it('marks stale dialing call failed when room is gone', async () => {
    const call = staleCall('dialing');
    mockFind.mockResolvedValue([call]);
    mockListRooms.mockResolvedValue([]); // room no longer active
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(1);
    expect(call.status).toBe('failed');
    expect(call.save).toHaveBeenCalled();
  });

  it('completes stale in-progress call when room is gone', async () => {
    const call = staleCall('in-progress');
    mockFind.mockResolvedValue([call]);
    mockListRooms.mockResolvedValue([]);
    await reconcileStaleCalls();
    expect(call.status).toBe('completed');
    expect(call.duration).toBeGreaterThan(0);
  });

  it('leaves call alone while room still active', async () => {
    const call = staleCall('in-progress');
    mockFind.mockResolvedValue([call]);
    mockListRooms.mockResolvedValue([{ name: 'call-64b0c0ffee0ddeadbeef1234' }]);
    const fixed = await reconcileStaleCalls();
    expect(fixed).toBe(0);
    expect(call.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — verify fail**

```bash
npx jest src/integrations/livekit/__tests__/reconciliationJob.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `reconciliationJob.ts`**

```typescript
import { RoomServiceClient } from 'livekit-server-sdk';
import Call from '../../models/Call';
import logger, { getErrorMessage } from '../../utils/logger';
import { roomNameForCall } from './types';

const STALE_AFTER_MS = 10 * 60 * 1000;
const INTERVAL_MS = 15 * 60 * 1000;

export async function reconcileStaleCalls(): Promise<number> {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return 0;

  const staleSince = new Date(Date.now() - STALE_AFTER_MS);
  const staleCalls = await Call.find({
    'providerData.provider': 'livekit',
    status: { $in: ['dialing', 'in-progress'] },
    updatedAt: { $lt: staleSince },
  });
  if (!staleCalls.length) return 0;

  const client = new RoomServiceClient(url, apiKey, apiSecret);
  let fixed = 0;
  for (const call of staleCalls) {
    const roomName = roomNameForCall(call._id.toString());
    try {
      const rooms = await client.listRooms([roomName]);
      if (rooms.length > 0) continue; // call genuinely still running
      call.endTime = new Date();
      if (call.status === 'in-progress') {
        call.status = 'completed';
        if (call.startTime) {
          call.duration = Math.round((call.endTime.getTime() - call.startTime.getTime()) / 1000);
        }
      } else {
        call.status = 'failed';
      }
      await call.save();
      fixed += 1;
      logger.info(`Reconciled orphaned LiveKit call ${call._id} -> ${call.status}`);
    } catch (error) {
      logger.error(`Reconciliation failed for ${call._id}: ${getErrorMessage(error)}`);
    }
  }
  return fixed;
}

export function startLiveKitReconciliation(): void {
  if (!process.env.LIVEKIT_URL) {
    logger.info('LiveKit not configured; reconciliation job not started');
    return;
  }
  setInterval(() => {
    reconcileStaleCalls().catch((e) => logger.error(`reconcile tick failed: ${getErrorMessage(e)}`));
  }, INTERVAL_MS);
  logger.info('LiveKit reconciliation job started (15m interval)');
}
```

- [ ] **Step 5: Run — verify pass; wire into `index.ts`**

```bash
npx jest src/integrations/livekit/__tests__/reconciliationJob.test.ts
```
Expected: 3 passed. Then in `server/src/index.ts`, after the webhook route registration added in Task 11:

```typescript
const { startLiveKitReconciliation } = require('./integrations/livekit/reconciliationJob');
startLiveKitReconciliation();
```

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add server/src/integrations/livekit/reconciliationJob.ts server/src/integrations/livekit/__tests__/reconciliationJob.test.ts server/src/index.ts
git commit -m "feat(livekit): reconciliation job finalizes orphaned calls"
```

### Task 13: Agent Dockerfile + run docs

**Files:**
- Create: `livekit-agent/Dockerfile`
- Create: `livekit-agent/README.md`

**Interfaces:**
- Produces: container image used for LiveKit Cloud deploy (Task 19) / self-host later.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM python:3.12-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
# Pre-download VAD/turn-detector model weights into the image
RUN uv run python agent.py download-files
CMD ["uv", "run", "python", "agent.py", "start"]
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Lumina LiveKit Agent

Outbound sales voice agent (`lumina-outbound`). Dispatched by the Lumina Fastify
server per call; dials leads through the Twilio SIP trunk.

## Run locally
    cp .env.example .env.local   # fill values
    uv sync
    uv run python agent.py download-files
    uv run python agent.py dev

## Test
    uv run pytest

## Dispatch a manual test call
    lk dispatch create --new-room --agent-name lumina-outbound \
      --metadata '{"call_id":"<mongo-call-id>","lead_name":"Test","phone_number":"+91...","script":"...","voice_id":""}'

Metadata contract: `server/src/integrations/livekit/types.ts` (snake_case on the wire).
```

- [ ] **Step 3: Verify image builds, commit**

```bash
cd livekit-agent && docker build -t lumina-livekit-agent .
git add livekit-agent/Dockerfile livekit-agent/README.md
git commit -m "feat(livekit): agent Dockerfile and run docs"
```

### Task 14: Phase 2 exit — end-to-end verification (5 real calls)

**Files:** none. Manual checklist; record results in spec.

- [ ] **Step 1: Start everything**

```bash
# Terminal 1: Fastify (with LIVEKIT_* + LUMINA_SERVICE_API_KEY in server/.env)
cd server && npm run dev
# Terminal 2: agent
cd livekit-agent && uv run python agent.py dev
# ngrok/webhook URL configured in LiveKit Cloud dashboard (Task 11 Step 7)
```

- [ ] **Step 2: Flip one test campaign to LiveKit**

In mongosh (or a dashboard config UI if present):

```javascript
db.campaigns.updateOne({ name: "<your test campaign>" }, { $set: { telephonyProvider: "livekit" } })
```

- [ ] **Step 3: Place 5 real calls via existing API** (same endpoint the dashboard uses)

For each: trigger a call to a test phone through the normal Lumina UI/API path (`POST /api/calls` route that invokes `callService.initiateCall`).

- [ ] **Step 4: Verify per call, all must hold**

1. Call record created with `providerData.provider = 'livekit'`, status `dialing` → `in-progress` (on answer) → `completed` (after hangup) with sane `duration`.
2. `transcript` + `conversationLog` populated after hangup (agent shutdown callback).
3. `outcome` set when agent used `record_outcome`.
4. Unanswered call → `failed`/`no-answer` (TwirpError path), no orphaned `dialing` record after reconciliation window.
5. No errors in Fastify log for webhook signature.

- [ ] **Step 5: Record results + gate**

Append results table to the spec. **Gate: 5/5 lifecycle-correct before Phase 3.**

```bash
git add docs/superpowers/specs/2026-07-06-livekit-integration-design.md
git commit -m "docs(livekit): phase 2 exit verification results"
```

---

## Phase 3 — Feature parity

### Task 15: Answering machine detection (AMD)

**Files:**
- Modify: `livekit-agent/agent.py` (entrypoint dial section)
- Test: extend `livekit-agent/tests/test_agent.py`

**Interfaces:**
- Consumes: `livekit.agents.AMD` (verified 2026-07-06: `async with AMD(session, participant_identity=…) as detector` → `result = await detector.execute()` → `result.category` in `human | machine-ivr | machine-vm | machine-unavailable | uncertain`).
- Produces: voicemail calls get outcome `voicemail` + a short message left; Call status set via existing outcome endpoint.

- [ ] **Step 1: Re-verify AMD API**

`mcp__livekit-docs__get_pages ["/telephony/features/answering-machine-detection"]` — confirm import path and context-manager usage.

- [ ] **Step 2: Replace the dial block in `entrypoint` with AMD-wrapped version**

Replace the `if phone_number:` block from Task 6 with:

```python
    if phone_number:
        from livekit.agents import AMD

        try:
            async with AMD(session, participant_identity=phone_number) as detector:
                await ctx.api.sip.create_sip_participant(
                    api.CreateSIPParticipantRequest(
                        room_name=ctx.room.name,
                        sip_trunk_id=SIP_OUTBOUND_TRUNK_ID,
                        sip_call_to=phone_number,
                        participant_identity=phone_number,
                        wait_until_answered=True,
                    )
                )
                await session_started
                await ctx.wait_for_participant(identity=phone_number)

                result = await detector.execute()
                logger.info("AMD result=%s call_id=%s", result.category, call_id)

                if result.category in ("human", "uncertain", "machine-ivr"):
                    pass  # proceed with normal conversation; callee speaks first
                elif result.category == "machine-vm":
                    speech = session.generate_reply(
                        instructions=(
                            "You reached voicemail. Leave a brief, professional message: "
                            "who you are, why you called, and a callback number if provided "
                            "in the script. Under 20 seconds."
                        )
                    )
                    await speech.wait_for_playout()
                    await lumina.post_outcome(call_id, "voicemail", "left voicemail message")
                    ctx.shutdown("voicemail")
                    return
                elif result.category == "machine-unavailable":
                    await lumina.post_outcome(call_id, "voicemail", "mailbox unavailable")
                    ctx.shutdown("mailbox unavailable")
                    return
        except api.TwirpError as e:
            logger.error(
                "dial failed: %s SIP %s %s",
                e.message,
                e.metadata.get("sip_status_code"),
                e.metadata.get("sip_status"),
            )
            await lumina.post_outcome(call_id, "no-answer", f"SIP {e.metadata.get('sip_status_code')}")
            ctx.shutdown()
            return
```

Keep the `detected_answering_machine` function tool as LLM-level fallback.

- [ ] **Step 3: Tests still green + real-call verification**

```bash
uv run pytest
```
Then place one real call to a phone you let ring to voicemail. Expected: agent leaves message, Call outcome = `voicemail`.

- [ ] **Step 4: Commit**

```bash
git add livekit-agent/agent.py livekit-agent/tests/test_agent.py
git commit -m "feat(livekit): answering machine detection with voicemail message"
```

### Task 16: Transfer to human (SIP REFER)

**Files:**
- Modify: `livekit-agent/agent.py` (add tool to `SalesAgent`)
- Modify: `server/src/models/Campaign.ts` (add `transferPhoneNumber?: string`)
- Modify: `server/src/integrations/livekit/dispatchService.ts` + `types.ts` (pass `transfer_to`)

**Interfaces:**
- Consumes: `TransferSIPParticipantRequest` (verified: `job_ctx.api.sip.transfer_sip_participant(api.TransferSIPParticipantRequest(room_name, participant_identity, transfer_to="tel:+91…"))`).
- Produces: `transfer_call` tool; `transfer_to` metadata key populated from `campaign.transferPhoneNumber`.

- [ ] **Step 1: Campaign model — add field**

Interface (after `telephonyProvider`): `transferPhoneNumber?: string;`
Schema (after the `telephonyProvider` block):

```typescript
    transferPhoneNumber: {
      type: String,
      default: '',
    },
```

- [ ] **Step 2: Pass through dispatch**

In `dispatchService.initiateLiveKitCall`, add to the metadata object: `transfer_to: campaign.transferPhoneNumber || '',` (the `types.ts` interface already declares `transfer_to?`; make it required `transfer_to: string`).

- [ ] **Step 3: Agent tool**

`SalesAgent.__init__` gains `transfer_to: str = ""` param stored as `self.transfer_to`; entrypoint passes `meta.get("transfer_to", "")`. Add tool:

```python
    @function_tool()
    async def transfer_call(self, ctx: RunContext) -> str:
        """Transfer the call to a human sales representative. Confirm with the user first."""
        if not self.transfer_to:
            return "no human representative is available right now"
        job_ctx = get_job_context()
        participant_identity = None
        for p in job_ctx.room.remote_participants.values():
            if p.identity != "":
                participant_identity = p.identity
                break
        if participant_identity is None:
            return "cannot transfer right now"
        speech = ctx.session.generate_reply(
            instructions="Tell the user you are transferring them to a colleague now."
        )
        await speech.wait_for_playout()
        try:
            await job_ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=job_ctx.room.name,
                    participant_identity=participant_identity,
                    transfer_to=f"tel:{self.transfer_to}",
                )
            )
            if self.lumina is not None:
                await self.lumina.post_outcome(self.call_id, "interested", "transferred to human")
            return "transfer initiated"
        except Exception as e:
            logging.getLogger("lumina-outbound").error("transfer failed: %s", e)
            return "transfer failed, apologize and offer a callback instead"
```

Simpler participant lookup: store the SIP participant identity (the phone number) on the agent when the entrypoint's `wait_for_participant` returns — preferred; use `self.sip_identity = phone_number` set from entrypoint and use it directly instead of scanning `remote_participants`.

- [ ] **Step 4: Verify Twilio trunk supports REFER**

Real test: campaign with `transferPhoneNumber` = your second phone; ask agent to transfer. If Twilio rejects REFER, enable it in trunk settings (Twilio: SIP REFER must be enabled on the trunk — check console; docs `/telephony/features/` transfers page for provider caveats). Record result in spec Risks.

- [ ] **Step 5: Tests + typecheck + commit**

```bash
cd livekit-agent && uv run pytest
cd ../server && npx tsc --noEmit && npx jest
git add livekit-agent/agent.py server/src/models/Campaign.ts server/src/integrations/livekit/types.ts server/src/integrations/livekit/dispatchService.ts
git commit -m "feat(livekit): warm-path transfer to human via SIP REFER"
```

### Task 17: Call recording via Egress

**Files:**
- Modify: `server/src/integrations/livekit/dispatchService.ts` (or agent — decided by Step 1)
- Modify: `server/src/integrations/livekit/webhookHandler.ts` (`egress_ended` → `recordingUrl`)

**Interfaces:**
- Consumes: LiveKit Egress API (NOT yet verified — Step 1 is mandatory), existing `call.recordingUrl` field, `recordCall` config (`configuration.complianceSettings.recordCalls`).
- Produces: `call.recordingUrl` populated for recorded LiveKit calls.

- [ ] **Step 1: Verify Egress API against docs (mandatory — no code below this line is pre-verified)**

`mcp__livekit-docs__docs_search "room composite egress audio only record call"` then `get_pages` on the egress guide. Determine:
1. Audio-only room composite egress request shape (Node `EgressClient` or room `egress` auto-config on dispatch).
2. Storage target: start with LiveKit Cloud-hosted output or S3/GCS bucket — pick per docs; note Cloud-only aspects in the spec (self-host portability row).
3. `egress_ended` webhook payload field carrying the file URL/location.

- [ ] **Step 2: Implement per verified docs**

- Start egress after dispatch when recording enabled (respect `configuration.complianceSettings.recordCalls` — same gate the Twilio path uses at `callService.ts:72`).
- In `webhookHandler.ts`, handle `egress_ended`: resolve call via room name, set `call.recordingUrl` from the payload's file result.
- Extend webhook tests with an `egress_ended` case following the Task 11 test pattern.

- [ ] **Step 3: Real-call verification**

One recorded call → `recordingUrl` set and playable. Existing client `AudioPlayer` should play it (it takes a URL).

- [ ] **Step 4: Commit**

```bash
git add server/src/integrations/livekit/
git commit -m "feat(livekit): call recording via egress"
```

### Task 18: Batch calling through LiveKit at low concurrency

**Files:** none new — validation of Task 10 wiring under BullMQ.

- [ ] **Step 1: Confirm BullMQ worker concurrency**

Check `batchCallService.ts` Worker options (line ~24). If concurrency > 3, cap it for the pilot (LiveKit free tier + single dev agent worker): set `concurrency: 2` in the Worker options for now (revert decision at Phase 4 scale-up).

- [ ] **Step 2: Run a 5-lead batch against the LiveKit test campaign**

Use existing batch UI/API (`POST /api/batch-calls`). Watch: BullMQ processes jobs → `initiateLiveKitCall` → 5 Call records complete lifecycle; budget guard still consulted (log line when budget depleted).

- [ ] **Step 3: Record results in spec; commit**

```bash
git add docs/superpowers/specs/2026-07-06-livekit-integration-design.md server/src/services/batchCallService.ts
git commit -m "feat(livekit): validated batch calling through LiveKit"
```

---

## Phase 4 — Rollout + cleanup

### Task 19: Deploy agent to LiveKit Cloud

**Files:**
- Create: `livekit-agent/livekit.toml` (generated)

- [ ] **Step 1: Register + deploy**

```bash
cd livekit-agent
lk agent create   # generates livekit.toml, registers agent, deploys
```
Set agent secrets in LiveKit Cloud (dashboard or `lk agent secrets`): `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`, `ELEVEN_API_KEY`, `SIP_OUTBOUND_TRUNK_ID`, `LUMINA_API_URL` (public HTTPS URL of Fastify), `LUMINA_SERVICE_API_KEY`. Verify per current docs: `mcp__livekit-docs__docs_search "agent deployment secrets livekit.toml"`.

- [ ] **Step 2: Verify cloud-hosted agent handles a dispatched call** (stop local `dev` agent first so dispatch routes to the deployed one).

- [ ] **Step 3: Commit**

```bash
git add livekit-agent/livekit.toml
git commit -m "feat(livekit): deploy agent to LiveKit Cloud"
```

### Task 20: A/B rollout + campaign migration

**Files:**
- Create: `server/scripts/migrate-campaigns-to-livekit.js`

- [ ] **Step 1: A/B period**

Run ≥1 real campaign on each pipeline for a comparable window. Compare in existing analytics: connection rate, avg duration, conversion, cost/call, complaint rate. Record in spec. **Gate: LiveKit ≥ parity before migrating all.**

- [ ] **Step 2: Migration script**

```javascript
// server/scripts/migrate-campaigns-to-livekit.js
// Usage: node scripts/migrate-campaigns-to-livekit.js [--dry-run]
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGODB_URI);
  const campaigns = mongoose.connection.collection('campaigns');
  const filter = { telephonyProvider: { $ne: 'livekit' } };
  const count = await campaigns.countDocuments(filter);
  console.log(`${count} campaigns on legacy pipeline`);
  if (!dryRun && count > 0) {
    const res = await campaigns.updateMany(filter, { $set: { telephonyProvider: 'livekit' } });
    console.log(`migrated ${res.modifiedCount}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Check the env var name for the Mongo connection string in `server/.env.example` (adjust `MONGODB_URI` if the repo uses a different name).

- [ ] **Step 3: Run `--dry-run`, then real; verify all campaigns flipped; commit**

```bash
git add server/scripts/migrate-campaigns-to-livekit.js
git commit -m "feat(livekit): campaign migration script"
```

### Task 21: Legacy pipeline + Dialogflow removal

**Files (delete):**
- `server/src/services/twilioStreamHandler.ts`, `conversationEngineService.ts`, `conversationStateMachine.ts`, `deepgramService.ts`, `deepgramTTSService.ts`, `deepgramUtils.ts`, `deepgramAutoConfigService.ts`, `deepgramConfigValidator.ts`, `deepgramErrorHandler.ts`, `elevenlabsSDKService.ts`, `elevenlabsSDKExtension.ts`, `elevenLabsConversationalService.ts`, `enhancedVoiceAIService.ts`, `streamingAudioPipeline.ts`, `optimizedRealTimeAudioPipeline.ts`, `audioStreamManager.ts`, `audioStreamingService.ts`, `streamingTTSService.ts`, `streamingWebhookHandlers.ts`, `enhancedBargeInDetectionService.ts`, `realTelephonyService.ts`, `realSpeechService.ts`, `textToSpeechService.ts`, `ttsProviderService.ts`, `fallbackTTSService.ts`, `websocketConnectionPool.ts`, `connectionPreWarmingService.ts`, `retrainingService.ts` (Dialogflow), plus Dialogflow CX service files and the 2 AM retraining cron
- Routes: `audioStreamingRoutes.ts`, `deepgramTTSRoutes.ts`, `streamingTTSRoutes.ts`, `sttRoutes.ts`, `ttsProviderRoutes.ts`, `connectionPreWarmingRoutes.ts`, `transcriptionRoutes.ts` (verify each is voice-pipeline-only before deleting)

This task is deliberately last and gated on Task 20 completing.

- [ ] **Step 1: Reference sweep per file** — for each file above: `grep -rn "<basename>" server/src client/src --include="*.ts" --include="*.tsx" | grep -v "<its own path>"`. A file is deletable only when remaining references are also on the delete list or in `index.ts` registration lines you remove in the same commit. Files with live references (e.g. `twilioRecordingsService` used by `callService.syncTwilioRecordings`) stay until their consumers are cleaned.

- [ ] **Step 2: Delete in dependency order** (leaf services first, then routes, then `index.ts` registrations). After each batch: `npx tsc --noEmit && npx jest`.

- [ ] **Step 3: Dialogflow retirement** — delete Dialogflow CX services, retraining cron registration, and their `googleapis`/`@google-cloud/dialogflow-cx` deps if unused elsewhere (Google Sheets service may share `googleapis` — check first).

- [ ] **Step 4: Dependency prune** — `npm uninstall` for now-unused packages (`@deepgram/sdk`, `elevenlabs-node`, `socket.io` if only the audio path used it — grep first; keep `twilio` only if recordings sync or SMS still uses it).

- [ ] **Step 5: Full verification** — `npx tsc --noEmit && npx jest && npm run build`; boot server; place one LiveKit call end-to-end.

- [ ] **Step 6: Update docs + commit**

Update `README.md` architecture section + `LAUNCH_TODO.md`. Commit in reviewable batches:

```bash
git add -A server/src client/src README.md LAUNCH_TODO.md server/package.json server/package-lock.json
git commit -m "refactor(livekit): remove legacy Twilio voice pipeline and Dialogflow CX"
```

---

## Self-Review Notes

- Spec coverage: §4.1 agent → Tasks 4–6, 13; §4.2 Fastify integration → Tasks 7, 9–12; §4.3 flag → Tasks 8, 10; §5 call flow → Task 14 gate; §7 phases → Tasks 1–3 / 4–14 / 15–18 / 19–21; §8 error handling → Tasks 6 (TwirpError), 11 (webhook), 12 (reconciliation); §9 testing → TDD throughout; §10 risks → Tasks 2.4, 3.4, 16.4, 17.1.
- Deviation from spec noted: flag named `telephonyProvider` (not `voiceProvider`) to avoid clashing with existing `voiceConfiguration.provider`; SIP dial happens in the agent (official LiveKit pattern), not in `dispatchService` — Fastify only dispatches.
- Egress (Task 17) and deployment (Task 19) intentionally start with mandatory doc-verification steps instead of pre-written code: those APIs were not verified during planning.
