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
  getCallRecordingDetails
} from '../controllers/callController';
import { updateCallStatus } from '../controllers/updateCallStatusController';

const callRoutes = async (fastify, opts: Record<string, any>) => {
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
};

export default callRoutes;
