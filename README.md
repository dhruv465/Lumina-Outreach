# Lumina Outreach

Developer README — concise guide to run, develop and contribute to Lumina Outreach (Project-Call).

Lumina Outreach is an AI-powered intelligent communication platform and CRM focused on outbound voice outreach, lead management, campaign orchestration, and analytics. The system pairs a React + TypeScript dashboard (client/) with a Node.js + TypeScript backend (server/) and supports multi-provider TTS, telephony integrations, and real-time websocket flows.

## Quick start (developer)

Prereqs: Node.js 18+, Yarn or npm, MongoDB local or remote, API keys for Twilio and one TTS provider (ElevenLabs and/or Deepgram).

1) Clone repo

```bash
git clone https://github.com/dhruv465/Project-Call.git
cd Project-Call
```

2) Copy env templates and edit values

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
# edit server/.env and client/.env with your keys and DB URL
```

3) Install dependencies

```bash
# from project root
npm install

# or, install per workspace if preferred
cd server && npm install && cd ../client && npm install
```

4) Start servers (dev)

```bash
# Start backend
cd server
npm run dev

# In another terminal: start frontend
cd client
npm run dev
```

If the repo provides helper scripts (e.g. `./run.sh` or `npm run start:dev`), they may combine the above steps.

## What this repo contains (high level)

- client/: React + TypeScript front-end (Vite). Key folders:
   - src/components, pages, layouts, hooks, services
- server/: Node.js + TypeScript backend API and services
   - src/controllers, services, routes, config, models
- uploads/: storage for recordings/attachments
- scripts/: dev & maintenance scripts

See the full project layout in the repository root for more details.

## Important configuration notes

- Environment variables: edit `server/.env` and `client/.env` before running. Do not commit .env files.
- TTS providers: the system supports multiple TTS providers (ElevenLabs, Deepgram). The code contains a multi-provider layer with automatic fallback — configure API keys and preferred provider in `server/.env` or admin UI.
- Telephony: Twilio integration is the default telephony provider; set Twilio keys in `server/.env`.

## Developer workflows

- Local development: run the backend and frontend in dev mode to get live reloads.
- Testing: backend tests are under `server/tests`. Run with the repo's configured test script (example):

```bash
cd server
npm test
```

- Lint & typecheck: run TypeScript and lint scripts defined in package.json (root or per-package). Example:

```bash
npm run build # or npm run lint / npm run typecheck if available
```

## Architecture & data flow (short)

- Frontend (client) connects to backend via REST and WebSocket for real-time updates.
- Backend orchestrates campaigns, connects to telephony (Twilio), synthesizes audio via TTS providers, records calls, and logs events.
- Conversation engine uses LLM/Speech-to-Text integrations to manage call dialog and intent handling.

## Troubleshooting & common checks

- Server fails to start: check `server/.env` for missing keys and MongoDB connection string.
- Client dev server port conflicts: change Vite port in `client/vite.config.ts` or in `client/package.json` dev script.
- TTS failures: confirm provider API key, region, and that fallback provider is configured.

Logs:
- Backend logs appear under `server/logs/` and `server/combined.log` for recent activity.

## Security

- Sensitive keys must be stored in `.env` and never committed.
- Ensure access control and rate limiting are enabled in production deployments.

## Contributing

- Branching: create feature branches off `main` (e.g., `feat/<short-desc>`).
- Tests: add unit tests for new server-side logic under `server/tests` and for client components where relevant.
- PR checklist: add description, link to any related ticket, include tests or screenshots for UI changes.

## Notes for new developers

- Start by running the backend and client locally and exploring the UI pages under `client/src/pages`.
- Inspect `server/src/controllers` and `server/src/services` to follow request flows (calls, campaigns, leads ingestion).
- Look for TTS integration code in `server/services` (ElevenLabs/Deepgram adapters) and telephony hooks near `server/services/twilio` or similar.

## Useful commands (zsh)

```bash
# install deps (root)
npm install

# start backend (dev)
cd server && npm run dev

# start frontend (dev)
cd client && npm run dev

# run server tests
cd server && npm test
```

## License

MIT

---
Additional docs

- Contributing guide: `CONTRIBUTING.md`
- Troubleshooting: `TROUBLESHOOTING.md`
- Quick dev commands: `Makefile` (run `make install`, `make server`, `make client`, `make test`)
