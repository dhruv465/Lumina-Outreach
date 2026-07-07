import { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';
import { handleLiveKitEvent } from '../integrations/livekit/webhookHandler';
import logger, { getErrorMessage } from '../utils/logger';

export default async function livekitWebhookRoutes(fastify: FastifyInstance) {
  // LiveKit signs the raw body; we must receive it unparsed.
  fastify.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body)
  );

  fastify.post('/livekit', async (request, reply) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return reply.code(500).send({ error: 'LiveKit credentials not configured' });
    }
    // Signature verification failure -> 401 (bad caller). Processing failure
    // -> 500 (our fault) so LiveKit's non-2xx retry redelivers the event.
    let event: unknown;
    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret);
      event = await receiver.receive(
        request.body as string,
        request.headers.authorization
      );
    } catch (error) {
      logger.warn(`LiveKit webhook signature rejected: ${getErrorMessage(error)}`);
      return reply.code(401).send({ error: 'invalid webhook signature' });
    }

    try {
      await handleLiveKitEvent(event as any);
    } catch (error) {
      logger.error(`LiveKit webhook processing failed: ${getErrorMessage(error)}`);
      return reply.code(500).send({ error: 'webhook processing failed' });
    }
    return reply.code(200).send({ ok: true });
  });
}
