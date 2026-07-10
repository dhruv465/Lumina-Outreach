import { FastifyInstance } from 'fastify';
import { callFeedbackController } from '../controllers/callFeedbackController';
import { isManager, isAdmin } from '../middleware/auth';

export default async function callFeedbackRoutes(fastify: FastifyInstance) {
  // Authenticated AND restricted to manager/admin: reviewing AI-training feedback
  // is a privileged moderation operation, not a general-user action.
  fastify.addHook('onRequest', (fastify as any).authenticate);
  fastify.addHook('preHandler', isManager);

  fastify.get('/pending', callFeedbackController.getPendingFeedback);
  fastify.put('/review/:id', callFeedbackController.reviewFeedback);
  fastify.post('/retrain', { preHandler: isAdmin }, callFeedbackController.triggerRetraining);
}
