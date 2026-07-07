from __future__ import annotations

import asyncio
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
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=openai.responses.LLM(model="gpt-4.1"),
        tts=elevenlabs.TTS(
            voice_id=meta.get("voice_id") or DEFAULT_VOICE_ID,
            model="eleven_flash_v2_5",
        ),
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
            # Explicit barge-in config for telephony, per
            # docs.livekit.io/agents/logic/turns/ (Interruptions) and
            # docs.livekit.io/agents/logic/turns/tuning/ (recommended starting config).
            interruption={
                # Master switch: user speech pauses agent playout (SDK default, made explicit).
                "enabled": True,
                # Force the adaptive barge-in model. Without an explicit mode the SDK
                # silently disables it outside LiveKit Cloud / dev mode ("adaptive
                # interruption is disabled by default in production mode") and falls
                # back to raw VAD; when the model is unavailable it still degrades to
                # VAD gracefully. See docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
                "mode": "adaptive",
                # Speech length that registers as an interruption (docs default 0.5s).
                "min_duration": 0.5,
                # Interrupt on audio alone; don't wait for STT words (slow on 8kHz PSTN audio).
                "min_words": 0,
                # If an interruption yields no transcript within 2s, treat it as false
                # and resume speech (docs.livekit.io/agents/logic/turns/ False interruptions).
                "false_interruption_timeout": 2.0,
                "resume_false_interruption": True,
            },
        ),
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
