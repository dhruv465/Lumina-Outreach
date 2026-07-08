import os
from unittest.mock import AsyncMock, MagicMock, patch

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


def make_agent(*, transfer_to: str = "", sip_identity: str = "", lumina_api=None) -> SalesAgent:
    agent = SalesAgent(
        call_id="test-call",
        lead_name="Ravi",
        script=SCRIPT,
        opening_message="",
        transfer_to=transfer_to,
        lumina_api=lumina_api,  # tools degrade gracefully without API
    )
    agent.sip_identity = sip_identity
    return agent


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


async def test_transfer_call_without_transfer_to_is_graceful():
    agent = make_agent(sip_identity="+15551234567")  # no transfer_to configured
    ctx = MagicMock()

    result = await agent.transfer_call(ctx)

    assert result == "no human representative is available right now"
    ctx.session.generate_reply.assert_not_called()


async def test_transfer_call_without_sip_identity_is_graceful():
    # transfer_to is configured but the SIP callee hasn't been identified yet
    # (e.g. transfer requested before wait_for_participant resolved).
    agent = make_agent(transfer_to="+15559876543")
    ctx = MagicMock()

    result = await agent.transfer_call(ctx)

    assert result == "no human representative is available right now"
    ctx.session.generate_reply.assert_not_called()


async def test_transfer_call_success_initiates_sip_refer_and_records_outcome():
    lumina = MagicMock()
    lumina.post_outcome = AsyncMock(return_value=True)
    agent = make_agent(
        transfer_to="+15559876543", sip_identity="+15551234567", lumina_api=lumina
    )

    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    ctx = MagicMock()
    ctx.session.generate_reply = MagicMock(return_value=speech)

    job_ctx = MagicMock()
    job_ctx.room.name = "call-abc123"
    job_ctx.api.sip.transfer_sip_participant = AsyncMock()

    with patch("agent.get_job_context", return_value=job_ctx):
        result = await agent.transfer_call(ctx)

    assert result == "transfer initiated"
    speech.wait_for_playout.assert_awaited_once()
    job_ctx.api.sip.transfer_sip_participant.assert_awaited_once()
    request = job_ctx.api.sip.transfer_sip_participant.call_args.args[0]
    assert request.room_name == "call-abc123"
    assert request.participant_identity == "+15551234567"
    assert request.transfer_to == "tel:+15559876543"
    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "interested", "transferred to human"
    )


async def test_transfer_call_failure_returns_apology_and_offers_callback():
    agent = make_agent(transfer_to="+15559876543", sip_identity="+15551234567")

    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    ctx = MagicMock()
    ctx.session.generate_reply = MagicMock(return_value=speech)

    job_ctx = MagicMock()
    job_ctx.room.name = "call-abc123"
    job_ctx.api.sip.transfer_sip_participant = AsyncMock(
        side_effect=RuntimeError("trunk rejected REFER")
    )

    with patch("agent.get_job_context", return_value=job_ctx):
        result = await agent.transfer_call(ctx)

    assert result == "transfer failed, apologize and offer a callback instead"
