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

Behavioral tests (`test_agent_greets_*`, `test_agent_records_outcome_*`,
`test_agent_schedules_*`) drive a real LLM and are skipped unless
`OPENAI_API_KEY` is set. Everything else runs offline.

## How a call ends

The agent is never trusted to hang up on its own. Four paths close a call, and
each one records a CRM outcome exactly once:

| Path | Trigger |
| --- | --- |
| `end_call` tool | The LLM decides the conversation is done. Prebuilt `EndCallTool`: plays the goodbye, closes the session, deletes the room. |
| Silence watchdog | `USER_AWAY_TIMEOUT` of dead air, then `INACTIVITY_CHECKINS` unanswered check-ins. |
| Duration cap | `MAX_CALL_SECONDS` from pickup. |
| AMD | Voicemail or unavailable mailbox. |

Deleting the room is what actually drops the SIP leg. Closing the session alone
leaves the callee listening to silence.

## Dispatch a manual test call
    lk dispatch create --new-room --agent-name lumina-outbound \
      --metadata '{"call_id":"<mongo-call-id>","lead_name":"Test","phone_number":"+91...","script":"...","voice_id":""}'

Metadata contract: `server/src/integrations/livekit/types.ts` (snake_case on the wire).
