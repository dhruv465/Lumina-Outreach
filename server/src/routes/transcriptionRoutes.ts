import { FastifyInstance } from 'fastify';
import {
  startTranscription,
  stopTranscription,
  processAudio,
  transcribeAudioFile,
  getCircuitStatus,
  resetCircuit
} from '../controllers/deepgramController';

const transcriptionRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Circuit breaker controls for operational staff
  fastify.get('/circuit-status', getCircuitStatus);
  fastify.post('/reset-circuit', resetCircuit);

  // Transcription stream management
  fastify.post('/transcription/:callId/start', startTranscription);
  fastify.post('/transcription/:callId/stop', stopTranscription);

  // Real-time audio processing
  fastify.post('/audio/:connectionId', processAudio);

  // File-based transcription
  fastify.post('/transcribe-file', transcribeAudioFile);
};

export default transcriptionRoutes;