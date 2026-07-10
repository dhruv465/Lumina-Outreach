import { FastifyInstance } from 'fastify';
import { callFeedbackController } from '../controllers/callFeedbackController';

export default async function callFeedbackRoutes(fastify: FastifyInstance) {
  // All routes are protected by the authenticate hook
  fastify.addHook('onRequest', (fastify as any).authenticate);

  fastify.get('/pending', callFeedbackController.getPendingFeedback);
  fastify.put('/review/:id', callFeedbackController.reviewFeedback);
  fastify.post('/retrain', callFeedbackController.triggerRetraining);
}
