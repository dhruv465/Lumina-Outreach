import { FastifyInstance } from 'fastify';
import {
  getCallMetrics,
  getHealthStatus,
  triggerStateTransition,
} from '../controllers/enhancedRealTimeController';

const enhancedRealTimeRoutes = async (fastify: FastifyInstance) => {
  fastify.addHook('onRequest', (fastify as any).authenticate);

  fastify.get('/health', getHealthStatus);
  fastify.get('/calls/:callId/metrics', getCallMetrics);
  fastify.post('/calls/:callId/transition', triggerStateTransition);
};

export default enhancedRealTimeRoutes;
