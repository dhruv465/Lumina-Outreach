import os
from unittest.mock import AsyncMock, MagicMock

import pytest

from livekit.agents import AgentSession, AMDCategory, AMDPredictionEvent
from livekit.plugins import openai

from agent import SalesAgent, _resolve_amd_outcome

# Behavioral tests exercise a real LLM end-to-end and are skipped without credentials.
# The AMD unit tests below don't call an LLM (they mock session/lumina/ctx directly),
# so they run unconditionally.
needs_openai_key = pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"), reason="behavioral tests need OPENAI_API_KEY"
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


@needs_openai_key
async def test_agent_greets_and_stays_on_script():
    async with (
        openai.responses.LLM(model="gpt-4.1") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(make_agent())
        result = await session.run(user_input="Hello, who is this?")
        await result.expect.next_event().is_message(role="assistant").judge(
            llm,
            intent="Introduces themselves professionally as calling from Lumina Industrial and moves toward qualifying the lead or offering a demo.",
        )
        result.expect.no_more_events()


@needs_openai_key
async def test_agent_handles_not_interested_politely():
    async with (
        openai.responses.LLM(model="gpt-4.1") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(make_agent())
        result = await session.run(user_input="I'm not interested, please don't call again.")
        await result.expect.next_event().is_message(role="assistant").judge(
            llm,
            intent="Politely acknowledges the refusal without being pushy, and moves to end the call respectfully.",
        )


def make_amd_result(category: AMDCategory) -> AMDPredictionEvent:
    return AMDPredictionEvent(
        speech_duration=1.2,
        category=category,
        reason="test",
        transcript="hello, you've reached voicemail, please leave a message",
        delay=0.5,
    )


async def test_amd_machine_vm_leaves_message_and_records_voicemail_outcome():
    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    session = MagicMock()
    session.generate_reply = MagicMock(return_value=speech)

    lumina = MagicMock()
    lumina.post_outcome = AsyncMock(return_value=True)

    ctx = MagicMock()

    ended = await _resolve_amd_outcome(
        make_amd_result(AMDCategory.MACHINE_VM),
        session=session,
        lumina=lumina,
        call_id="call-1",
        ctx=ctx,
    )

    assert ended is True
    session.generate_reply.assert_called_once()
    assert "voicemail" in session.generate_reply.call_args.kwargs["instructions"].lower()
    speech.wait_for_playout.assert_awaited_once()
    lumina.post_outcome.assert_awaited_once_with("call-1", "voicemail", "left voicemail message")
    ctx.shutdown.assert_called_once_with("voicemail")


async def test_amd_machine_unavailable_records_outcome_without_leaving_message():
    session = MagicMock()
    lumina = MagicMock()
    lumina.post_outcome = AsyncMock(return_value=True)
    ctx = MagicMock()

    ended = await _resolve_amd_outcome(
        make_amd_result(AMDCategory.MACHINE_UNAVAILABLE),
        session=session,
        lumina=lumina,
        call_id="call-2",
        ctx=ctx,
    )

    assert ended is True
    session.generate_reply.assert_not_called()
    lumina.post_outcome.assert_awaited_once_with("call-2", "voicemail", "mailbox unavailable")
    ctx.shutdown.assert_called_once_with("mailbox unavailable")


@pytest.mark.parametrize(
    "category", [AMDCategory.HUMAN, AMDCategory.UNCERTAIN, AMDCategory.MACHINE_IVR]
)
async def test_amd_human_like_result_defers_to_normal_conversation(category):
    session = MagicMock()
    lumina = MagicMock()
    lumina.post_outcome = AsyncMock()
    ctx = MagicMock()

    ended = await _resolve_amd_outcome(
        make_amd_result(category),
        session=session,
        lumina=lumina,
        call_id="call-3",
        ctx=ctx,
    )

    assert ended is False
    session.generate_reply.assert_not_called()
    lumina.post_outcome.assert_not_called()
    ctx.shutdown.assert_not_called()
