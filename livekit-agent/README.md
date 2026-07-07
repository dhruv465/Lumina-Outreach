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
