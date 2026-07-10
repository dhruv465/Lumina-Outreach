import { FastifyInstance } from 'fastify';

const rootWebhookRoutes = async (fastify: FastifyInstance) => {
  fastify.post('/', async (_request, reply) => {
    return reply.code(410).send({
      error: 'Legacy root webhook removed',
      message: 'Use /webhooks/livekit for call lifecycle events.',
    });
  });
};

export default rootWebhookRoutes;
