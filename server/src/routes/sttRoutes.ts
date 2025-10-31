/**
 * STT Routes
 * Speech-to-Text testing routes with file upload support
 */
import { FastifyInstance } from 'fastify';
import { testSTT, transcribeStreamChunk, getAvailableModels } from '../controllers/sttTestController';
import logger from '../utils/logger';

const sttRoutes = async (fastify, opts: Record<string, any>) => {
  // Log middleware for STT routes
  fastify.addHook('onRequest', (request, reply, done) => {
    logger.info(`STT route: ${request.raw.method} ${request.raw.url}`);
    done();
  });

  /**
   * GET /api/stt/models
   * Fetch available Deepgram STT models based on the configured API key
   */
  fastify.get('/models', getAvailableModels);

  /**
   * POST /api/stt/test
   * Single-shot STT test endpoint
   * Accepts either multipart/form-data with field "audio" or JSON with { audioBase64, language?, model? }
   */
  fastify.post('/test', testSTT);

  /**
   * POST /api/stt/stream-chunk
   * Chunked near real-time STT endpoint
   * Accepts multipart/form-data with field "audio" (short chunks from MediaRecorder)
   */
  fastify.post('/stream-chunk', transcribeStreamChunk);
};

export default sttRoutes;