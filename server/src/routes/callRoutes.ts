import { FastifyInstance } from 'fastify';
import {
  initiateCall,
  getCallHistory,
  getCallById,
  getCallRecording,
  getCallTranscript,
  scheduleCallback,
  getCallAnalytics,
  exportCalls,
  syncTwilioRecordings,
  getCallRecordingDetails
} from '../controllers/callController';
import { updateCallStatus } from '../controllers/updateCallStatusController';
import {
  handleTwilioVoiceWebhook,
  handleTwilioStatusWebhook,
  handleTwilioGatherWebhook,
  handleTwilioStreamWebhook
} from '../services/webhookHandlers';

const callRoutes = async (fastify, opts: Record<string, any>) => {
  // Webhook routes - MUST BE FIRST and not authenticated (for Twilio callbacks)
  // These routes need to match exactly what's being called in callController.ts
  fastify.post('/voice-webhook', handleTwilioVoiceWebhook);
  fastify.post('/status-webhook', handleTwilioStatusWebhook);
  fastify.post('/gather', handleTwilioGatherWebhook);
  fastify.post('/stream', handleTwilioStreamWebhook);
  fastify.post('/recording-webhook', handleTwilioStatusWebhook); // Reuse status webhook for recording

  // Call management routes (protected)
  fastify.post('/initiate', { onRequest: [fastify.authenticate] }, initiateCall);
  fastify.get('/', { onRequest: [fastify.authenticate] }, getCallHistory);
  fastify.get('/analytics', { onRequest: [fastify.authenticate] }, getCallAnalytics);
  fastify.get('/export', { onRequest: [fastify.authenticate] }, exportCalls);
  fastify.get('/:id', { onRequest: [fastify.authenticate] }, getCallById);
  fastify.get('/:id/recording', { onRequest: [fastify.authenticate] }, getCallRecording);
  fastify.get('/:id/recording-details', { onRequest: [fastify.authenticate] }, getCallRecordingDetails);
  fastify.get('/:id/transcript', { onRequest: [fastify.authenticate] }, getCallTranscript);
  fastify.put('/:id/status', { onRequest: [fastify.authenticate] }, updateCallStatus);
  fastify.post('/:id/schedule-callback', { onRequest: [fastify.authenticate] }, scheduleCallback);
  fastify.post('/sync-recordings', { onRequest: [fastify.authenticate] }, syncTwilioRecordings);
};

export default callRoutes;