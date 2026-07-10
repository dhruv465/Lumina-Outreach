import { FastifyInstance } from 'fastify';
import { batchCallController } from '../controllers/batchCallController';

export default async function batchCallRoutes(fastify: FastifyInstance) {
  // All routes are protected by the authenticate hook
  fastify.addHook('onRequest', (fastify as any).authenticate);

  fastify.post('/create', batchCallController.createBatch);
  fastify.get('/list', batchCallController.listBatches);
  fastify.get('/:id', batchCallController.getBatchStatus);
}
