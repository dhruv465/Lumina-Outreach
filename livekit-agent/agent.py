from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Literal

from dotenv import load_dotenv

from livekit import api
from livekit.agents import (
    Agent,
    AgentFalseInterruptionEvent,
    AgentServer,
    AgentSession,
    AgentStateChangedEvent,
    ErrorEvent,
    JobContext,
    RunContext,
    TurnHandlingOptions,
    UserStateChangedEvent,
    cli,
    function_tool,
    get_job_context,
    inference,
    room_io,
)
from livekit.agents.beta.tools import EndCallTool
from livekit.plugins import noise_cancellation

from prompts import build_instructions, build_lead_context
from providers import build_llm, build_stt, build_tts, parse_provider_config
from tools.lumina_api import LuminaAPI

if TYPE_CHECKING:
    from livekit.agents import AMDPredictionEvent

load_dotenv(".env.local")
logger = logging.getLogger("lumina-outbound")
logger.setLevel(logging.INFO)

# Overridable so a canary worker can register under its own name and run beside
# the stable one; the server dispatches to "lumina-outbound".
AGENT_NAME = os.getenv("LUMINA_AGENT_NAME", "lumina-outbound")
SIP_OUTBOUND_TRUNK_ID = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
# Krisp BVCTelephony is a LiveKit-Cloud-only model. Set LIVEKIT_BVC_ENABLED=false
# on self-hosted deploys where the Cloud noise-cancellation models are unavailable.
BVC_ENABLED = os.getenv("LIVEKIT_BVC_ENABLED", "true").strip().lower() not in ("0", "false", "no")

# ── Hang-up guards ───────────────────────────────────────────────────────────
# An LLM that forgets to call end_call leaves the SIP leg open, and the callee
# hears silence until they hang up themselves (docs.livekit.io/telephony/
# making-calls/outbound-calls/ "Hang up"). Every path out of a conversation is
# therefore backed by a deterministic timer.
#
# Seconds of two-way silence before the session marks the user "away"
# (AgentSession user_away_timeout, default 15s - tightened for telephony where
# dead air reads as a dropped call).
USER_AWAY_TIMEOUT = float(os.getenv("USER_AWAY_TIMEOUT", "10"))
# How many times the agent asks "are you still there?" before hanging up.
INACTIVITY_CHECKINS = int(os.getenv("INACTIVITY_CHECKINS", "2"))
# Seconds to wait for a reply after each check-in.
INACTIVITY_CHECKIN_INTERVAL = float(os.getenv("INACTIVITY_CHECKIN_INTERVAL", "8"))
# Hard ceiling on a single conversation, counted from callee pickup.
MAX_CALL_SECONDS = float(os.getenv("MAX_CALL_SECONDS", "600"))

# Values the client's Dashboard/Analytics pages bucket on (client/src/pages/
# Analytics.tsx). Constraining the tool arg to this Literal puts the enum in the
# function schema, so the LLM cannot invent an outcome the CRM won't chart.
CallOutcome = Literal[
    "interested",
    "not-interested",
    "callback-requested",
    "voicemail",
    "wrong-number",
    "do-not-call",
]


def _canceller(task: asyncio.Task) -> Callable[[], Awaitable[None]]:
    """Shutdown callback that cancels a background timer task."""

    async def _cancel() -> None:
        task.cancel()

    return _cancel


async def hangup_call() -> None:
    """Delete the room, which disconnects the SIP leg for everyone.

    Per docs.livekit.io/telephony/making-calls/outbound-calls/ ("Hang up"):
    ending the session alone is not enough - without deleting the room the
    caller keeps hearing silence.
    """
    ctx = get_job_context(required=False)
    if ctx is None:
        return
    try:
        await ctx.delete_room()
    except Exception as e:
        # Several paths can race to hang up (end_call, the watchdogs, the callee
        # dropping the line). Deleting an already-deleted room is a success as
        # far as this function is concerned.
        logger.info("delete_room during hangup was a no-op: %s", e)


class SalesAgent(Agent):
    def __init__(
        self,
        *,
        call_id: str,
        lead_name: str,
        script: str,
        opening_message: str = "",
        transfer_to: str = "",
        lumina_api: LuminaAPI | None = None,
        lead_context: str = "",
    ) -> None:
        # The prebuilt EndCallTool is what actually terminates the call: it waits
        # for the goodbye to play out, shuts the session down, deletes the room
        # (disconnecting the SIP leg), and then shuts the job process down.
        # docs.livekit.io/agents/prebuilt/tools/end-call-tool/. The previous
        # hand-rolled end_call only deleted the room and left the closing
        # behaviour entirely to prompt wording, which the model routinely skipped.
        end_call_tool = EndCallTool(
            delete_room=True,
            extra_description=(
                "Also call this when the person declines, asks to be removed from the list, "
                "says they are busy or not interested, reaches a natural end of the "
                "conversation, or says goodbye. Call record_outcome first. Saying goodbye "
                "without calling this tool leaves the person listening to silence."
            ),
            end_instructions=(
                "Say one short, warm goodbye line. Do not ask another question and do not "
                "restate anything you already said."
            ),
            on_tool_called=self._on_end_call,
        )
        super().__init__(
            instructions=build_instructions(lead_name, script, opening_message, lead_context),
            tools=end_call_tool.tools,
        )
        self.call_id = call_id
        self.lumina = lumina_api
        self.transfer_to = transfer_to
        self.sip_identity: str = ""
        self.outcome_recorded = False

    async def ensure_outcome(self, outcome: str, notes: str = "") -> bool:
        """Record `outcome` only if nothing has been recorded for this call yet."""
        if self.outcome_recorded or self.lumina is None:
            return False
        self.outcome_recorded = True
        ok = await self.lumina.post_outcome(self.call_id, outcome, notes)
        if not ok:
            logger.warning("failed to record fallback outcome=%s call_id=%s", outcome, self.call_id)
        return ok

    async def _on_end_call(self, ev) -> None:
        """EndCallTool hook: never let a call end with a blank CRM row."""
        await self.ensure_outcome("completed", "call ended without a recorded outcome")

    async def _hangup(self) -> None:
        await hangup_call()

    @function_tool()
    async def record_outcome(self, ctx: RunContext, outcome: CallOutcome, notes: str = "") -> str:
        """Record what happened on this call in the CRM.

        Required on every call, exactly once, before end_call.

        Args:
            outcome: What actually happened. interested = they want to proceed or hear more.
                not-interested = they declined. callback-requested = they asked to be called
                back later. voicemail = you reached a machine. wrong-number = not the person
                or number you wanted. do-not-call = they asked to be removed from the list.
            notes: One or two sentences summarising the conversation and any commitment made.
        """
        # Writes CRM state, so it must not be discarded by a barge-in
        # (docs.livekit.io/agents/logic/tools/definition/ "Best practices").
        ctx.disallow_interruptions()
        self.outcome_recorded = True
        if self.lumina is None:
            return "outcome recorded"
        ok = await self.lumina.post_outcome(self.call_id, outcome, notes)
        return "outcome recorded" if ok else "could not record outcome, continue anyway"

    @function_tool()
    async def schedule_callback(self, ctx: RunContext, datetime_iso: str, notes: str = "") -> str:
        """Schedule a follow-up call at the time the person asked to be called back.

        Args:
            datetime_iso: ISO-8601 datetime for the callback, e.g. 2026-07-10T15:00:00+05:30.
                Resolve vague answers ("tomorrow afternoon", "next Tuesday") into a real
                date and time before calling this.
            notes: What to discuss on the follow-up.
        """
        ctx.disallow_interruptions()
        if self.lumina is None:
            return "callback scheduled"
        ok = await self.lumina.schedule_callback(self.call_id, datetime_iso, notes)
        if not ok:
            return "could not schedule callback, apologize and offer to try again"
        # A booked callback is itself the outcome; recording it here means the
        # CRM is correct even if the model skips record_outcome on the way out.
        await self.ensure_outcome("callback-requested", notes or "callback scheduled")
        return "callback scheduled"

    @function_tool()
    async def detected_answering_machine(self, ctx: RunContext) -> str:
        """Call this AFTER you hear a voicemail greeting or beep instead of a live person."""
        await self.ensure_outcome("voicemail", "answering machine detected")
        await self._hangup()
        return "hung up on voicemail"

    @function_tool()
    async def transfer_call(self, ctx: RunContext) -> str:
        """Transfer the call to a human sales representative. Confirm with the user first."""
        if not self.transfer_to or not self.sip_identity:
            return "no human representative is available right now"

        job_ctx = get_job_context()
        speech = ctx.session.generate_reply(
            instructions="Tell the user you are transferring them to a colleague now."
        )
        await speech.wait_for_playout()
        try:
            await job_ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=job_ctx.room.name,
                    participant_identity=self.sip_identity,
                    transfer_to=f"tel:{self.transfer_to}",
                )
            )
            await self.ensure_outcome("interested", "transferred to human")
            return "transfer initiated"
        except Exception as e:
            logger.error("transfer failed: %s", e)
            return "transfer failed, apologize and offer a callback instead"


server = AgentServer()


async def fetch_lead_context(lumina: LuminaAPI, lead_id: str) -> dict:
    """Best-effort CRM lookup for the person being called."""
    if not lead_id:
        return {}
    try:
        return await lumina.get_lead(lead_id)
    except Exception as e:  # never block a call on CRM context
        logger.warning("lead context fetch failed lead_id=%s: %s", lead_id, e)
        return {}


def stt_keyterms(lead_name: str, lead: dict | None) -> list[str]:
    """Names Deepgram nova-3 should bias towards on this specific call.

    Proper nouns are what 8kHz PSTN audio gets wrong most often, and getting the
    callee's own name or company back as garbage is what makes an agent sound
    like it isn't listening. Keyterm prompting is nova-3 only.
    """
    terms = ["Lumina"]
    if lead_name:
        terms.append(lead_name)
    if lead and lead.get("company"):
        terms.append(lead["company"])
    # De-duplicate while preserving order.
    return list(dict.fromkeys(t.strip() for t in terms if t and t.strip()))


async def run_inactivity_checkins(
    *,
    session: AgentSession,
    agent: SalesAgent,
    checkins: int = INACTIVITY_CHECKINS,
    interval: float = INACTIVITY_CHECKIN_INTERVAL,
) -> None:
    """Ask whether the caller is still there, then hang up if they never answer.

    Started when the session marks the user `away` and cancelled the moment they
    speak again, per docs.livekit.io/agents/logic/sessions/ ("Handling inactive
    users"). Without this, a caller who puts the phone down keeps the SIP leg -
    and the per-minute billing - open indefinitely.
    """
    for _ in range(checkins):
        speech = session.generate_reply(
            instructions=(
                "The line has gone quiet. In one short sentence, ask if they are still there."
            )
        )
        await speech.wait_for_playout()
        await asyncio.sleep(interval)

    logger.info("no response after %d check-ins, hanging up", checkins)
    await agent.ensure_outcome("no-answer", "caller went silent mid-call")
    await hangup_call()


async def enforce_max_duration(
    *,
    session: AgentSession,
    agent: SalesAgent,
    seconds: float = MAX_CALL_SECONDS,
) -> None:
    """Wrap up and hang up once a single call has run past its ceiling."""
    await asyncio.sleep(seconds)

    logger.info("max call duration %.0fs reached, wrapping up", seconds)
    speech = session.generate_reply(
        instructions=(
            "You are out of time on this call. In one sentence, thank them and say you will "
            "follow up. Do not ask a question."
        )
    )
    await speech.wait_for_playout()
    await agent.ensure_outcome("completed", "call reached the maximum duration")
    await hangup_call()


async def classify_with_amd(detector) -> AMDPredictionEvent | None:
    """Await an AMD classification, or None if the call ended before one arrived.

    AMD frequently never classifies on these calls, so this await outlives the
    whole conversation and is still pending when the session closes (end_call,
    the callee hanging up, or a watchdog firing). The detector then raises
    "amd closed before a result was available", and because that propagates out
    of `entrypoint` the SDK reports the job as `crashed` — after a perfectly
    clean hangup. Live call `AJ_GyJnG6PRAXdq` deleted its room and persisted its
    transcript and was still logged as crashed. A conversation that outlived AMD
    is a normal ending, not a failure.
    """
    try:
        return await detector.execute()
    except RuntimeError as e:
        logger.info("AMD closed without a classification: %s", e)
        return None


async def _resolve_amd_outcome(
    result: AMDPredictionEvent,
    *,
    session: AgentSession,
    agent: SalesAgent,
    ctx: JobContext,
) -> bool:
    """Act on an AMD classification result.

    Returns True if the call is over and `entrypoint` should return without
    starting the normal conversation (voicemail message left, or mailbox
    unavailable).
    """
    logger.info("AMD result=%s call_id=%s", result.category.value, agent.call_id)

    if result.category in ("human", "uncertain", "machine-ivr"):
        # Outbound etiquette: let the callee speak first; agent responds after their turn.
        return False
    elif result.category == "machine-vm":
        speech = session.generate_reply(
            instructions=(
                "You reached voicemail. Leave a brief, professional message: "
                "who you are, why you called, and a callback number if provided "
                "in the script. Under 20 seconds."
            )
        )
        await speech.wait_for_playout()
        await agent.ensure_outcome("voicemail", "left voicemail message")
        # Shutting the job down does not hang the phone up on its own; the room
        # has to go too or the machine keeps recording silence.
        await hangup_call()
        ctx.shutdown("voicemail")
        return True
    elif result.category == "machine-unavailable":
        await agent.ensure_outcome("voicemail", "mailbox unavailable")
        await hangup_call()
        ctx.shutdown("mailbox unavailable")
        return True

    return False


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

    provider_cfg = parse_provider_config(meta)
    if provider_cfg is None:
        logger.error("no provider_config in job metadata; aborting call_id=%s", call_id)
        if call_id:
            await lumina.post_outcome(call_id, "failed", "provider config missing")
        ctx.shutdown("provider config missing")
        return

    lead_name = meta.get("lead_name", "")
    # Pull the CRM record so the agent knows who it is talking to (company, role,
    # prior notes) instead of guessing from the script alone. This runs before the
    # SIP dial, so nobody is waiting on the line for it, and a failure degrades to
    # an empty context block rather than blocking the call.
    lead = await fetch_lead_context(lumina, meta.get("lead_id", ""))
    lead_context = build_lead_context(lead)

    agent = SalesAgent(
        call_id=call_id,
        lead_name=lead_name,
        script=meta.get("script", ""),
        opening_message=meta.get("opening_message", ""),
        transfer_to=meta.get("transfer_to", ""),
        lumina_api=lumina,
        lead_context=lead_context,
    )

    session = AgentSession(
        # English-only deployment. nova-3 "multi" adds cross-language decoding
        # overhead and is measurably slower/less accurate on 8kHz PSTN audio,
        # especially on speech that overlaps the agent's own TTS. A single-language
        # "en" model emits interim words faster and more reliably during overlap,
        # which is what the min_words interruption gate below now depends on.
        stt=build_stt(provider_cfg, keyterms=stt_keyterms(lead_name, lead)),
        llm=build_llm(provider_cfg),
        tts=build_tts(provider_cfg),
        # Silence on a phone line reads as a dropped call, not as thinking time.
        # Marking the user "away" this early is what arms the check-in watchdog
        # below (docs.livekit.io/agents/logic/sessions/ "Handling inactive users").
        user_away_timeout=USER_AWAY_TIMEOUT,
        # Put a breath between back-to-back utterances - notably a tool-driven
        # generate_reply landing straight on top of the previous line, which is
        # the documented cause of the agent sounding like it is running sentences
        # together (docs.livekit.io/agents/logic/turns/tuning/ troubleshooting).
        min_consecutive_speech_delay=0.3,
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
            # Explicit barge-in config for telephony, per
            # docs.livekit.io/agents/logic/turns/ (Interruptions) and
            # docs.livekit.io/reference/agents/turn-handling-options/ (InterruptionOptions).
            interruption={
                # Master switch: user speech pauses agent playout (SDK default, made explicit).
                "enabled": True,
                # Local, deterministic VAD-triggered barge-in: "'vad' triggers on any
                # detected speech" (turn-handling-options reference). We previously
                # forced "adaptive" (f2b4081b); in adaptive mode the SDK disables the
                # local VAD/STT interruption path 1.0s after each agent utterance
                # starts (backchannel_boundary start cooldown, see
                # docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
                # "Turn boundary cooldown") and delegates the barge-in decision
                # exclusively to the remote model at agent-gateway.livekit.cloud.
                # On live call AJ_b4xDtHFbb4jV that model never emitted
                # bargein_detected during ~15s of overlapping speech and never
                # errored (no VAD fallback was ever triggered), so no interruption
                # path remained. Its decision threshold (server default 0.656) and
                # 0.7s inference timeout are not client-tunable in agents 1.6.4
                # (AgentActivity constructs AdaptiveInterruptionDetector() with no
                # arguments), and the same gateway logged "turn detection transport
                # latency is too high: 523ms" from this region. VAD mode is also the
                # SDK's own documented fallback wherever the adaptive model is
                # unavailable ("a session in a region without the model automatically
                # falls back to VAD-based interruption detection").
                "mode": "vad",
                # Speech length that registers as an interruption (docs default 0.5s).
                "min_duration": 0.5,
                # ROOT-CAUSE FIX (bargein-fix3). Previously 0 = interrupt on raw VAD
                # energy with no word confirmation. On live call AJ_4QVYL4TZyxtH that
                # made the agent's own TTS echo / PSTN line noise fire the interrupt
                # path: agent_activity.on_vad_inference_done -> _interrupt_by_audio_activity
                # paused playout, on_end_of_speech armed the 2s false-interruption timer,
                # and because that "speech" carried no words Deepgram emitted no
                # transcript (not even interim), so it auto-resumed at exactly +2.000s.
                # The agent flapped speaking<->listening 3x and took 25.7s to deliver
                # its opening (call-gate-smoke-4.log lines 29-50). Meanwhile a REAL
                # interruption ("Tell me.") transcribed in ~0.5s and interrupted cleanly
                # (lines 61-67), proving the pipeline works once words are present.
                #
                # min_words=1 gates the interrupt on STT confirmation:
                # _interrupt_by_audio_activity returns early until current_transcript
                # (fed by Deepgram interims) has >=1 word (agent_activity.py L1802-1812).
                # Wordless echo/noise therefore never pauses the agent, while any real
                # single word ("stop", "wait", "no") still interrupts within ~0.5s.
                # This is LiveKit's documented remedy for "agent interrupted by
                # false positives" (docs.livekit.io/agents/logic/turns/tuning/
                # troubleshooting table: "Raise interruption.min_words (requires STT)").
                "min_words": 1,
                # Safety net for the rare case echo transcribes into a stray word and
                # pauses playout: if no committed user turn follows within 2s, resume
                # (docs.livekit.io/agents/logic/turns/ False interruptions).
                "false_interruption_timeout": 2.0,
                "resume_false_interruption": True,
            },
        ),
    )

    # ── Barge-in diagnostics ─────────────────────────────────────────────────
    # The SDK emits no INFO-level line when an interruption fires, and the Krisp
    # FFI filter is silent on success (it only WARNs on failure: "failed to
    # initialize the audio filter" / "audio filter cannot be enabled: ensure you
    # are connecting to LiveKit Cloud"), which made call AJ_b4xDtHFbb4jV
    # undiagnosable from logs. Log every link of the barge-in chain so the next
    # live call is diagnostic:
    #   user speaking while agent_state=speaking  -> VAD sees the overlap
    #   agent speaking -> listening mid-overlap   -> barge-in actually fired
    #   agent_false_interruption                  -> paused, then auto-resumed
    logger.info(
        "noise cancellation: %s",
        "BVCTelephony (Krisp telephony voice isolation)"
        if BVC_ENABLED
        else "DISABLED via LIVEKIT_BVC_ENABLED",
    )

    # ── Silence watchdog ─────────────────────────────────────────────────────
    # Armed when the session marks the user "away" (USER_AWAY_TIMEOUT of two-way
    # silence), cancelled the instant they speak again.
    inactivity_task: asyncio.Task[None] | None = None

    @session.on("user_state_changed")
    def _on_user_state(ev: UserStateChangedEvent) -> None:
        nonlocal inactivity_task
        logger.info(
            "user state %s -> %s (agent_state=%s)",
            ev.old_state,
            ev.new_state,
            session.agent_state,
        )
        if ev.new_state == "away":
            if inactivity_task is None or inactivity_task.done():
                logger.info("user went away, starting inactivity check-ins")
                inactivity_task = asyncio.create_task(
                    run_inactivity_checkins(session=session, agent=agent)
                )
            return

        if inactivity_task is not None:
            inactivity_task.cancel()
            inactivity_task = None

    @session.on("agent_state_changed")
    def _on_agent_state(ev: AgentStateChangedEvent) -> None:
        logger.info("agent state %s -> %s", ev.old_state, ev.new_state)

    @session.on("agent_false_interruption")
    def _on_false_interruption(ev: AgentFalseInterruptionEvent) -> None:
        logger.info("false interruption detected (auto-resumed=%s)", ev.resumed)

    @session.on("overlapping_speech")
    def _on_overlapping_speech(ev: inference.OverlappingSpeechEvent) -> None:
        # Only fires in adaptive mode; kept so re-enabling "adaptive" stays diagnosable.
        logger.info(
            "overlapping speech: is_interruption=%s probability=%.3f detection_delay=%.3fs requests=%d",
            ev.is_interruption,
            ev.probability,
            ev.detection_delay,
            ev.num_requests,
        )

    @session.on("error")
    def _on_session_error(ev: ErrorEvent) -> None:
        logger.warning("session error from %s: %s", type(ev.source).__name__, ev.error)

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
        # Last line of defence: a call that ends any other way (callee hangs up,
        # worker restarts) still leaves a row the CRM can report on.
        await agent.ensure_outcome("completed", "call ended without a recorded outcome")

    ctx.add_shutdown_callback(persist_transcript)

    # Start the session before dialing so no audio is missed at pickup.
    session_started = asyncio.create_task(
        session.start(
            agent=agent,
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=room_io.AudioInputOptions(
                    # Krisp BVCTelephony: telephony-tuned voice isolation for SIP
                    # participants. Strips line noise, background voices, and the echo
                    # of the agent's own TTS from PSTN input BEFORE VAD/STT/barge-in
                    # detection run, so user speech during agent speech is reliably
                    # detected as an interruption. See
                    # docs.livekit.io/agents/logic/turns/tuning/ ("For SIP participants,
                    # swap voice isolation for the telephony-tuned Krisp model") and
                    # docs.livekit.io/transport/media/noise-cancellation/ (Voice isolation).
                    noise_cancellation=noise_cancellation.BVCTelephony() if BVC_ENABLED else None,
                ),
            ),
        )
    )

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
                agent.sip_identity = phone_number
                logger.info("callee answered call_id=%s", call_id)
                # Outbound etiquette: let the callee speak first; agent responds after their turn.

                # Ceiling starts at pickup, not at dispatch, so time spent
                # ringing doesn't eat into the conversation.
                duration_task = asyncio.create_task(
                    enforce_max_duration(session=session, agent=agent)
                )
                ctx.add_shutdown_callback(_canceller(duration_task))

                result = await classify_with_amd(detector)
                if result is None:
                    return
                if await _resolve_amd_outcome(result, session=session, agent=agent, ctx=ctx):
                    return
        except api.TwirpError as e:
            logger.error(
                "dial failed: %s SIP %s %s",
                e.message,
                e.metadata.get("sip_status_code"),
                e.metadata.get("sip_status"),
            )
            agent.outcome_recorded = True
            await lumina.post_outcome(call_id, "no-answer", f"SIP {e.metadata.get('sip_status_code')}")
            ctx.shutdown()
            return
    else:
        await session_started
        await session.generate_reply(instructions="Greet the caller and offer your assistance.")


if __name__ == "__main__":
    cli.run_app(server)
