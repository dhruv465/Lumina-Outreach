import { FastifyInstance } from 'fastify';
import {
  queueCall,
  handleVoiceWebhook,
  handleStatusWebhook,
  handleRecordingWebhook,
  getCallQueue,
  getTelephonyMetrics,
  pauseCall,
  bulkQueueCalls
} from '../controllers/telephonyController';

const telephonyRoutes = async (fastify, opts: Record<string, any>) => {
  // Webhook routes (public, no authentication needed for Twilio)
  fastify.post('/voice-webhook', handleVoiceWebhook);
  fastify.post('/status-webhook', handleStatusWebhook);
  fastify.post('/recording-webhook', handleRecordingWebhook);

  // Protected routes
  fastify.addHook('onRequest', fastify.authenticate);

  // Call management
  fastify.post('/queue-call', queueCall);
  fastify.post('/bulk-queue', bulkQueueCalls);
  fastify.get('/queue', getCallQueue);
  fastify.get('/metrics', getTelephonyMetrics);
  fastify.put('/calls/:callId/pause', pauseCall);
};

export default telephonyRoutes;