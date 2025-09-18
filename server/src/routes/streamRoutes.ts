import { FastifyInstance } from 'fastify';

const streamRoutes = async (fastify, opts: Record<string, any>) => {
  // This file is largely deprecated as WebSocket streaming is now handled directly in index.ts
  // via fastify-websocket and dedicated WebSocket servers (Twilio, Deepgram).
  // Keeping this file as a placeholder to avoid breaking imports.
};

export default streamRoutes;