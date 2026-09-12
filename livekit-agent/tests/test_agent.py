import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from livekit.agents import AgentSession, AMDCategory, AMDPredictionEvent
from livekit.agents.llm import tool_context
from livekit.agents.testing import fake_job_context
from livekit.plugins import openai

from agent import (
    SalesAgent,
    _resolve_amd_outcome,
    build_lead_context,
    classify_with_amd,
    enforce_max_duration,
    fetch_lead_context,
    hangup_call,
    run_inactivity_checkins,
    stt_keyterms,
)

# Behavioral tests exercise a real LLM end-to-end and are skipped without credentials.
# The unit tests below don't call an LLM (they mock session/lumina/ctx directly),
# so they run unconditionally.
needs_openai_key = pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"), reason="behavioral tests need OPENAI_API_KEY"
)

SCRIPT = """You are calling on behalf of Lumina Industrial to offer a demo of our
conversational AI platform. Qualify the lead, then propose a 30-minute demo."""


def make_agent(
    *,
    transfer_to: str = "",
    sip_identity: str = "",
    lumina_api=None,
    lead_context: str = "",
) -> SalesAgent:
    agent = SalesAgent(
        call_id="test-call",
        lead_name="Ravi",
        script=SCRIPT,
        opening_message="",
        transfer_to=transfer_to,
        lumina_api=lumina_api,  # tools degrade gracefully without API
        lead_context=lead_context,
    )
    agent.sip_identity = sip_identity
    return agent


def make_lumina() -> MagicMock:
    lumina = MagicMock()
    lumina.post_outcome = AsyncMock(return_value=True)
    lumina.schedule_callback = AsyncMock(return_value=True)
    return lumina


def tool_names(agent: SalesAgent) -> list[str]:
    return [tool_context.get_function_info(t).name for t in agent.tools]


# ── Tool registration ────────────────────────────────────────────────────────


def test_agent_exposes_the_full_tool_surface():
    # end_call comes from the prebuilt EndCallTool, which is what actually
    # terminates the SIP leg. If it stops being registered the agent can talk
    # but can never hang up.
    assert set(tool_names(make_agent())) == {
        "end_call",
        "record_outcome",
        "schedule_callback",
        "transfer_call",
        "detected_answering_machine",
    }


def test_every_registered_tool_is_documented_in_the_instructions():
    # A tool the model is never told about is a tool the model never calls.
    # detected_answering_machine shipped registered but undocumented, so the
    # voicemail backstop never fired on the calls where AMD failed to classify -
    # exactly the calls it exists for.
    agent = make_agent()
    instructions = agent.instructions
    undocumented = [name for name in tool_names(agent) if name not in instructions]
    assert not undocumented, f"registered but missing from the prompt: {undocumented}"


def test_instructions_demand_the_closing_sequence():
    instructions = make_agent().instructions
    assert "record_outcome" in instructions
    assert "end_call" in instructions
    # The prompt must state that talking is not hanging up.
    assert "Saying goodbye does not end the call" in instructions
    # ...and give an explicit order to close in.
    assert "1. Call record_outcome" in instructions
    assert "2. Call end_call." in instructions


def test_instructions_forbid_narrating_tool_use():
    # Live call AJ_GyJnG6PRAXdq spoke "I'll go ahead and record that." out loud,
    # and said goodbye twice: once itself, then again via end_call's reply.
    instructions = make_agent().instructions
    assert "Never narrate what you are doing behind the scenes" in instructions
    assert "do not say goodbye yourself first" in instructions


def test_instructions_include_lead_context_when_available():
    agent = make_agent(lead_context="Company: Acme Steel")
    assert "Acme Steel" in agent.instructions


# ── Outcome recording ────────────────────────────────────────────────────────


async def test_record_outcome_posts_and_marks_call_as_recorded():
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)
    ctx = MagicMock()

    result = await agent.record_outcome(ctx, "interested", "wants the demo")

    assert result == "outcome recorded"
    assert agent.outcome_recorded is True
    lumina.post_outcome.assert_awaited_once_with("test-call", "interested", "wants the demo")
    # Writing CRM state must survive a barge-in.
    ctx.disallow_interruptions.assert_called_once()


async def test_ensure_outcome_does_not_overwrite_what_the_llm_recorded():
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)
    await agent.record_outcome(MagicMock(), "do-not-call", "asked to be removed")
    lumina.post_outcome.reset_mock()

    recorded = await agent.ensure_outcome("completed", "fallback")

    assert recorded is False
    lumina.post_outcome.assert_not_awaited()


async def test_ensure_outcome_records_once_when_the_llm_recorded_nothing():
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)

    assert await agent.ensure_outcome("completed", "fallback") is True
    assert await agent.ensure_outcome("completed", "fallback again") is False
    lumina.post_outcome.assert_awaited_once_with("test-call", "completed", "fallback")


async def test_end_call_hook_backfills_a_missing_outcome():
    # The EndCallTool on_tool_called hook is the safety net for the common
    # failure: the model says goodbye and hangs up without recording anything.
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)

    await agent._on_end_call(MagicMock())

    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "completed", "call ended without a recorded outcome"
    )


# ── Callbacks ────────────────────────────────────────────────────────────────


async def test_schedule_callback_also_records_the_outcome():
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)

    result = await agent.schedule_callback(
        MagicMock(), "2026-08-04T15:00:00+05:30", "wants pricing"
    )

    assert result == "callback scheduled"
    lumina.schedule_callback.assert_awaited_once_with(
        "test-call", "2026-08-04T15:00:00+05:30", "wants pricing"
    )
    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "callback-requested", "wants pricing"
    )


async def test_failed_callback_does_not_record_an_outcome():
    lumina = make_lumina()
    lumina.schedule_callback = AsyncMock(return_value=False)
    agent = make_agent(lumina_api=lumina)

    result = await agent.schedule_callback(MagicMock(), "2026-08-04T15:00:00+05:30")

    assert result == "could not schedule callback, apologize and offer to try again"
    assert agent.outcome_recorded is False
    lumina.post_outcome.assert_not_awaited()


# ── Hang-up paths ────────────────────────────────────────────────────────────


async def test_hangup_call_deletes_the_room():
    # Deleting the room is what actually drops the SIP leg. Ending the session
    # alone leaves the callee listening to silence.
    with fake_job_context() as job_ctx:
        with patch.object(type(job_ctx), "delete_room", new=AsyncMock()) as delete_room:
            await hangup_call()

    delete_room.assert_awaited_once()


async def test_hangup_call_is_a_noop_outside_a_job():
    await hangup_call()  # must not raise when there is no job context


async def test_detected_answering_machine_records_voicemail_and_hangs_up():
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)

    with patch("agent.hangup_call", new=AsyncMock()) as hangup:
        result = await agent.detected_answering_machine(MagicMock())

    assert result == "hung up on voicemail"
    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "voicemail", "answering machine detected"
    )
    hangup.assert_awaited_once()


async def test_inactivity_checkins_hang_up_when_nobody_answers():
    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    session = MagicMock()
    session.generate_reply = MagicMock(return_value=speech)

    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)

    with patch("agent.hangup_call", new=AsyncMock()) as hangup:
        await run_inactivity_checkins(session=session, agent=agent, checkins=2, interval=0)

    assert session.generate_reply.call_count == 2
    assert "still there" in session.generate_reply.call_args.kwargs["instructions"]
    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "no-answer", "caller went silent mid-call"
    )
    hangup.assert_awaited_once()


async def test_max_duration_wraps_up_and_hangs_up():
    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    session = MagicMock()
    session.generate_reply = MagicMock(return_value=speech)

    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)

    with patch("agent.hangup_call", new=AsyncMock()) as hangup:
        await enforce_max_duration(session=session, agent=agent, seconds=0)

    speech.wait_for_playout.assert_awaited_once()
    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "completed", "call reached the maximum duration"
    )
    hangup.assert_awaited_once()


async def test_max_duration_does_not_overwrite_a_recorded_outcome():
    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    session = MagicMock()
    session.generate_reply = MagicMock(return_value=speech)

    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)
    await agent.record_outcome(MagicMock(), "interested", "booked a demo")
    lumina.post_outcome.reset_mock()

    with patch("agent.hangup_call", new=AsyncMock()) as hangup:
        await enforce_max_duration(session=session, agent=agent, seconds=0)

    lumina.post_outcome.assert_not_awaited()
    hangup.assert_awaited_once()


# ── AMD ──────────────────────────────────────────────────────────────────────


def make_amd_result(category: AMDCategory) -> AMDPredictionEvent:
    return AMDPredictionEvent(
        speech_duration=1.2,
        category=category,
        reason="test",
        transcript="hello, you've reached voicemail, please leave a message",
        delay=0.5,
    )


async def test_classify_with_amd_returns_the_result():
    detector = MagicMock()
    expected = make_amd_result(AMDCategory.HUMAN)
    detector.execute = AsyncMock(return_value=expected)

    assert await classify_with_amd(detector) is expected


async def test_classify_with_amd_survives_the_call_ending_first():
    # Live call AJ_GyJnG6PRAXdq: the conversation ran to a clean end_call while
    # AMD was still waiting to classify. The detector then raised, the exception
    # escaped entrypoint, and the SDK logged `job crashed` after a successful
    # hangup. A call that outlives AMD is a normal ending.
    detector = MagicMock()
    detector.execute = AsyncMock(
        side_effect=RuntimeError("amd closed before a result was available")
    )

    assert await classify_with_amd(detector) is None


async def test_amd_machine_vm_leaves_message_records_voicemail_and_hangs_up():
    speech = MagicMock()
    speech.wait_for_playout = AsyncMock()
    session = MagicMock()
    session.generate_reply = MagicMock(return_value=speech)

    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)
    ctx = MagicMock()

    with patch("agent.hangup_call", new=AsyncMock()) as hangup:
        ended = await _resolve_amd_outcome(
            make_amd_result(AMDCategory.MACHINE_VM), session=session, agent=agent, ctx=ctx
        )

    assert ended is True
    session.generate_reply.assert_called_once()
    assert "voicemail" in session.generate_reply.call_args.kwargs["instructions"].lower()
    speech.wait_for_playout.assert_awaited_once()
    lumina.post_outcome.assert_awaited_once_with(
        "test-call", "voicemail", "left voicemail message"
    )
    # Shutting the job down is not enough on its own: the room has to go too.
    hangup.assert_awaited_once()
    ctx.shutdown.assert_called_once_with("voicemail")


async def test_amd_machine_unavailable_records_outcome_without_leaving_message():
    session = MagicMock()
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)
    ctx = MagicMock()

    with patch("agent.hangup_call", new=AsyncMock()) as hangup:
        ended = await _resolve_amd_outcome(
            make_amd_result(AMDCategory.MACHINE_UNAVAILABLE),
            session=session,
            agent=agent,
            ctx=ctx,
        )

    assert ended is True
    session.generate_reply.assert_not_called()
    lumina.post_outcome.assert_awaited_once_with("test-call", "voicemail", "mailbox unavailable")
    hangup.assert_awaited_once()
    ctx.shutdown.assert_called_once_with("mailbox unavailable")


@pytest.mark.parametrize(
    "category", [AMDCategory.HUMAN, AMDCategory.UNCERTAIN, AMDCategory.MACHINE_IVR]
)
async def test_amd_human_like_result_defers_to_normal_conversation(category):
    session = MagicMock()
    lumina = make_lumina()
    agent = make_agent(lumina_api=lumina)
    ctx = MagicMock()

    ended = await _resolve_amd_outcome(
        make_amd_result(category), session=session, agent=agent, ctx=ctx
    )

    assert ended is False
    session.generate_reply.assert_not_called()
    lumina.post_outcome.assert_not_called()
    ctx.shutdown.assert_not_called()


# ── Transfer ─────────────────────────────────────────────────────────────────


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
    lumina = make_lumina()
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


# ── Lead context and STT tuning ──────────────────────────────────────────────


def test_build_lead_context_renders_known_fields():
    context = build_lead_context(
        {"company": "Acme Steel", "title": "Head of Ops", "notes": "asked about pricing"}
    )
    assert "Acme Steel" in context
    assert "Head of Ops" in context
    assert "asked about pricing" in context


@pytest.mark.parametrize("lead", [None, {}, {"company": "", "title": "", "notes": ""}])
def test_build_lead_context_is_empty_without_useful_fields(lead):
    assert build_lead_context(lead) == ""


async def test_fetch_lead_context_returns_empty_without_a_lead_id():
    lumina = MagicMock()
    lumina.get_lead = AsyncMock()

    assert await fetch_lead_context(lumina, "") == {}
    lumina.get_lead.assert_not_awaited()


async def test_fetch_lead_context_never_blocks_a_call_on_crm_failure():
    lumina = MagicMock()
    lumina.get_lead = AsyncMock(side_effect=RuntimeError("CRM down"))

    assert await fetch_lead_context(lumina, "lead-1") == {}


def test_stt_keyterms_include_the_brand_lead_and_company():
    assert stt_keyterms("Ravi", {"company": "Acme Steel"}) == ["Lumina", "Ravi", "Acme Steel"]


def test_stt_keyterms_drop_blanks_and_duplicates():
    assert stt_keyterms("", None) == ["Lumina"]
    assert stt_keyterms("Lumina", {"company": ""}) == ["Lumina"]


# ── Behavioral (real LLM) ────────────────────────────────────────────────────


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
async def test_agent_records_outcome_and_ends_call_when_told_to_stop():
    # The original complaint: the agent would say goodbye and then keep the line
    # open. Both tools must fire on a hard refusal.
    lumina = make_lumina()
    async with (
        openai.responses.LLM(model="gpt-4.1") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(make_agent(lumina_api=lumina))
        # EndCallTool reaches for the job context on session close; there is no
        # job in a unit-test session.
        with patch("livekit.agents.beta.tools.end_call.get_job_context", MagicMock()):
            result = await session.run(
                user_input="I'm not interested. Take me off your list and don't call again."
            )
            result.expect.contains_function_call(name="record_outcome")
            result.expect.contains_function_call(name="end_call")


@needs_openai_key
async def test_agent_schedules_a_callback_when_the_lead_names_a_time():
    lumina = make_lumina()
    async with (
        openai.responses.LLM(model="gpt-4.1") as llm,
        AgentSession(llm=llm) as session,
    ):
        await session.start(make_agent(lumina_api=lumina))
        result = await session.run(
            user_input="I'm driving right now. Call me back tomorrow at 3pm."
        )
        result.expect.contains_function_call(name="schedule_callback")
