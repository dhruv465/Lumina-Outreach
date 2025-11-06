import { FastifyInstance } from 'fastify';

const telephonyRoutes = async (fastify, opts: Record<string, any>) => {
  // Webhook routes (public, no authentication needed for Twilio)

  // Protected routes
  fastify.addHook('onRequest', fastify.authenticate);

  // Call management
};

export default telephonyRoutes;