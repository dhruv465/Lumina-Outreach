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
)
from livekit.plugins import deepgram, elevenlabs, openai

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
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector()),
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
