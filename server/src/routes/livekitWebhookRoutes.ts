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
    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret);
      const event = await receiver.receive(
        request.body as string,
        request.headers.authorization
      );
      await handleLiveKitEvent(event as any);
      return reply.code(200).send({ ok: true });
    } catch (error) {
      logger.error(`LiveKit webhook rejected: ${getErrorMessage(error)}`);
      return reply.code(401).send({ error: 'invalid webhook' });
    }
  });
}
