## Quick orientation for AI coding agents

This repo (Project-Call / Lumina Outreach) is a React + TypeScript frontend (client/) and a Fastify + TypeScript backend (server/) that integrate with telephony and speech services (Twilio, ElevenLabs, Deepgram, OpenAI, etc.). The server is highly dynamic: many API keys and provider selections are read from the database Configuration model at startup rather than only from env files.

Keep guidance concise and actionable. Prefer small, well-scoped changes and reference the concrete files below when making edits.

---

### High-level architecture (what to know first)
- Frontend: `client/` — Vite + React + TypeScript. Entry: `client/src/main.tsx`, pages in `client/src/pages/`.
- Backend: `server/` — Fastify server entry is `server/src/index.ts`. Routes live under `server/src/routes/`, controllers in `server/src/controllers/`, business logic in `server/src/services/`, models in `server/src/models/`.
- Websockets & realtime: Socket.IO is attached to the same HTTP server (see `server/src/index.ts`). The Socket.IO path is `/socket.io/`. There are also Fastify websocket endpoints like `/voice/stream/:callId/:conversationId` handled in `server/src/index.ts`.
- Dynamic provider config: many API keys/config are loaded from the `Configuration` model in the DB. Do not assume env variables are the only source—`server/src/index.ts` initializes services from DB configuration when present.

### Developer workflows & commands (concrete)
- Install (root): `npm install` (or install per package: `cd server && npm install` and `cd client && npm install`).
- Start backend (dev): `cd server && npm run dev` (uses `ts-node-dev`).
- Start frontend (dev): `cd client && npm run dev` (Vite dev server).
- Build frontend: `cd client && npm run build` (runs `tsc` then `vite build`).
- Build backend: `cd server && npm run build` (tsc).
- Tests (server): `cd server && npm test`.
- Helpful Makefile targets exist: `make install`, `make server`, `make client`, `make test` (root `Makefile`).

If you need Twilio webhooks locally, start ngrok and set `WEBHOOK_BASE_URL` (server `.env`) to the ngrok URL before testing.

### Project-specific conventions & patterns
- Route → Controller → Service: follow this separation. Add new endpoints under `server/src/routes/` pointing to controllers in `server/src/controllers/` and move real work into `server/src/services/`.
- DB-driven configuration: `server/src/index.ts` looks up `Configuration.findOne()` and then initializes external services (Deepgram, ElevenLabs, LLMs). When implementing features that depend on API keys, prefer reading config via the same pattern (or add compatibility to use env vars only for local dev).
- Socket.IO and Fastify coexist on the same server. Socket.IO is configured with path `/socket.io/` and many realtime flows use rooms like `dashboard-<userId>` or `campaign-<id>`; search for `socket.join` in code.
- Rate limiting and middleware: rate limiting is registered selectively (global: false) — authentication routes get stricter limits. Avoid adding heavy middleware to webhook or websocket handlers.

### Integration points to watch (examples)
- Twilio/webhooks: public URL required. Code references: `server/src/services/realTelephonyService.ts` (initialization) and Twilio stream handler `server/src/services/twilioStreamHandler.ts`.
- TTS / STT providers: `server/src/services/elevenLabsConversationalService.ts`, `server/src/services/deepgramService.ts`, `server/src/services/deepgramTTSService.ts` and the TTS factory helper `server/src/utils/ttsServiceFactory.ts`.
- Batch calling UI expects `POST /api/calls/batch`. Frontend component: `client/src/components/leads/BatchCallSheet.tsx` contains the TODO/API call placeholder — implement server endpoint accordingly.

### What to check before editing
1. Does the change require provider credentials? If so, either set them in `server/.env` for dev or ensure the DB `Configuration` entry provides them.
2. Will the change affect websockets or webhooks? Keep handlers lightweight and avoid adding blocking work on the socket request/connection path.
3. Is there a route prefix? API routes are registered under `/api` in `server/src/index.ts` — create routes with the correct prefix.

### Small contract for new endpoints/features
- Inputs: JSON body and URL params; authenticated endpoints use the `authenticate` Fastify decorator (see `server/src/middleware/auth`).
- Outputs: JSON with `{ error?: boolean, message?: string, ... }`. Follow existing error handler behavior set in `server/src/index.ts` (uses `reply.status(...).send(...)`).
- Errors: use Boom-style status codes (reply.status(code)) and include an `errorId` when logging; do not leak stack traces in production.

### Quick debugging & common traps
- If services depending on API keys don't start, check the DB `Configuration` record — the server silently continues with degraded mode if keys are missing.
- Port defaults: frontend 3000, backend 8000. Socket.IO path: `/socket.io/` (ensure client uses same path). Vite proxy is not used — client calls the API via `VITE_API_URL`.
- Helmet CSP disabled for performance (API server) — do not re-enable CSP globally unless you know the impact.

### Files to reference when in doubt
- Server entry and registration: `server/src/index.ts` (major source of truth for routing, websockets, service initialization)
- Routes → `server/src/routes/` (see naming pattern: e.g., `callRoutes.ts`, `campaignRoutes.ts`)
- Controllers → `server/src/controllers/`
- Services → `server/src/services/` (e.g., `campaignService.ts`, `speechAnalysisService.ts`, `elevenLabsConversationalService.ts`)
- Frontend batch UI: `client/src/components/leads/BatchCallSheet.tsx` (implements UX that requires backend `POST /api/calls/batch`)

---

If anything here is unclear or you'd like more detail in any area (for example: a short checklist for adding a new realtime flow, or a template for adding provider initialization that reads DB config), tell me which section to expand and I will iterate.
