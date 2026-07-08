from __future__ import annotations

import asyncio
import json
import logging
import os

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
from livekit.plugins import deepgram, elevenlabs, noise_cancellation, openai

from tools.lumina_api import LuminaAPI

load_dotenv(".env.local")
logger = logging.getLogger("lumina-outbound")
logger.setLevel(logging.INFO)

AGENT_NAME = "lumina-outbound"
SIP_OUTBOUND_TRUNK_ID = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
DEFAULT_VOICE_ID = os.getenv("ELEVEN_DEFAULT_VOICE_ID", "ODq5zmih8GrVes37Dizd")
# Krisp BVCTelephony is a LiveKit-Cloud-only model. Set LIVEKIT_BVC_ENABLED=false
# on self-hosted deploys where the Cloud noise-cancellation models are unavailable.
BVC_ENABLED = os.getenv("LIVEKIT_BVC_ENABLED", "true").strip().lower() not in ("0", "false", "no")


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
        ctx = get_job_context(required=False)
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
        # English-only deployment. nova-3 "multi" adds cross-language decoding
        # overhead and is measurably slower/less accurate on 8kHz PSTN audio,
        # especially on speech that overlaps the agent's own TTS. A single-language
        # "en" model emits interim words faster and more reliably during overlap,
        # which is what the min_words interruption gate below now depends on.
        stt=deepgram.STT(model="nova-3", language="en"),
        llm=openai.responses.LLM(model="gpt-4.1"),
        tts=elevenlabs.TTS(
            voice_id=meta.get("voice_id") or DEFAULT_VOICE_ID,
            model="eleven_flash_v2_5",
        ),
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

    @session.on("user_state_changed")
    def _on_user_state(ev: UserStateChangedEvent) -> None:
        logger.info(
            "user state %s -> %s (agent_state=%s)",
            ev.old_state,
            ev.new_state,
            session.agent_state,
        )

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
