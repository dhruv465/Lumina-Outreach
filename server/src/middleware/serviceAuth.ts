import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';

/**
 * Auth for machine-to-machine calls from the LiveKit agent.
 * Static bearer token, timing-safe comparison.
 */
export async function serviceAuth(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.LUMINA_SERVICE_API_KEY;
  if (!expected) {
    return reply.code(500).send({ error: 'LUMINA_SERVICE_API_KEY not configured' });
  }
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
