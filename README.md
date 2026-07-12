# Lumina Outreach

Lumina is an outbound AI calling and lead-management platform. A React dashboard
manages leads and campaigns, a Fastify API controls call state, and a LiveKit
Agent handles real-time voice over SIP.

These are code-level capabilities; production deployment and live acceptance
remain gated by `LAUNCH_TODO.md`.

## MVP capabilities

- LiveKit-only outbound calls with E.164 normalization
- Per-user BYO Deepgram and LLM credentials, encrypted at rest
- Deepgram STT and Aura TTS with OpenAI, Anthropic, or Google LLMs
- Campaign scripts, lead management, single calls, and MongoDB-backed batches
- Barge-in, voicemail handling, callbacks, transfer tools, transcripts, outcomes,
  optional GCS recordings, and dashboard analytics
- Redis-free batch recovery using MongoDB `processedLeadIds`

## Deferred beyond MVP

- Conversation Review and human quality scoring
- Automatic prompt evaluation and provider-specific fine-tuning
- Per-turn annotations and automatic campaign-script changes

## Project structure

```text
Project Lumina/
├── client/          # React and TypeScript dashboard
├── server/          # Fastify API and MongoDB control plane
└── livekit-agent/   # Python LiveKit voice agent
```

## Quick Start

Before starting the app, configure:

- MongoDB for application data and batch recovery
- a LiveKit project and its server/agent credentials
- an outbound SIP trunk and `SIP_OUTBOUND_TRUNK_ID`
- a strong `CONFIG_ENCRYPTION_KEY` for encrypting stored provider credentials
- each user's Deepgram and LLM keys in the app's Configuration page

Install dependencies in `client/`, `server/`, and `livekit-agent/`, then run the
three processes locally:

```bash
(cd server && npm run dev)
(cd client && npm run dev)
(cd livekit-agent && uv run python agent.py dev)
```

## Core technologies

- Frontend: React 18, TypeScript, Vite, TanStack Query, and shadcn/ui
- API: Node.js, Fastify, MongoDB/Mongoose, and LiveKit Server SDK
- Voice agent: LiveKit Agents, Deepgram STT/Aura TTS, and a user-selected LLM
- Operations: Docker, Sentry, Winston logging, and optional GCS recording storage

## License

MIT
