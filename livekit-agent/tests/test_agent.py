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
