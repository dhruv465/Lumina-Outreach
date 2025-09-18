import { FastifyInstance } from 'fastify';
import { getDeepgramTTSService } from '../services/deepgramTTSService';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

const deepgramTTSRoutes = async (fastify, opts: Record<string, any>) => {
  /**
   * POST /api/deepgram-tts/synthesize
   * Synthesize speech using Deepgram TTS
   */
  fastify.post('/synthesize', async (request, reply) => {
    try {
      const { text, model, encoding, outputFormat } = request.body as any;

      if (!text) {
        return reply.code(400).send({
          success: false,
          error: 'Text is required'
        });
      }

      const deepgramTTS = getDeepgramTTSService();
      if (!deepgramTTS) {
        return reply.code(503).send({
          success: false,
          error: 'Deepgram TTS service not available'
        });
      }

      logger.info('Synthesizing speech with Deepgram TTS', {
        textLength: text.length,
        model: model || 'default',
        encoding: encoding || 'default'
      });

      const options = {
        model: model || 'aura-2-thalia-en',
        encoding: encoding || 'mp3',
        ...((request.body as any).sample_rate && { sample_rate: (request.body as any).sample_rate }),
        ...((request.body as any).container && { container: (request.body as any).container })
      };

      const audioBuffer = await deepgramTTS.synthesizeSpeechWithStream(text, options);

      // Set appropriate headers
      const contentType = encoding === 'mp3' ? 'audio/mpeg' : 
                         encoding === 'wav' ? 'audio/wav' : 
                         'audio/mpeg';

      reply.header('Content-Type', contentType);
      reply.header('Content-Length', audioBuffer.length.toString());
      reply.header('Content-Disposition', `attachment; filename="speech.${encoding || 'mp3'}"`);

      logger.info('Deepgram TTS synthesis completed', {
        textLength: text.length,
        audioSize: audioBuffer.length,
        model: options.model
      });

      reply.send(audioBuffer);

    } catch (error) {
      logger.error('Deepgram TTS synthesis failed', {
        error: getErrorMessage(error),
        body: request.body
      });

      reply.code(500).send({
        success: false,
        error: 'Speech synthesis failed',
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * GET /api/deepgram-tts/models
   * Get available Deepgram TTS models
   */
  fastify.get('/models', async (request, reply) => {
    try {
      const deepgramTTS = getDeepgramTTSService();
      if (!deepgramTTS) {
        return reply.code(503).send({
          success: false,
          error: 'Deepgram TTS service not available'
        });
      }

      const models = deepgramTTS.getAvailableModels();

      reply.send({
        success: true,
        models,
        count: models.length
      });

    } catch (error) {
      logger.error('Failed to get Deepgram TTS models', {
        error: getErrorMessage(error)
      });

      reply.code(500).send({
        success: false,
        error: 'Failed to get available models',
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * GET /api/deepgram-tts/status
   * Check Deepgram TTS service status
   */
  fastify.get('/status', async (request, reply) => {
    try {
      const deepgramTTS = getDeepgramTTSService();
      
      if (!deepgramTTS) {
        return reply.send({
          success: false,
          available: false,
          message: 'Deepgram TTS service not initialized'
        });
      }

      const isAvailable = await deepgramTTS.isAvailable();

      reply.send({
        success: true,
        available: isAvailable,
        message: isAvailable ? 'Deepgram TTS service is available' : 'Deepgram TTS service is not responding',
        models: deepgramTTS.getAvailableModels()
      });

    } catch (error) {
      logger.error('Deepgram TTS status check failed', {
        error: getErrorMessage(error)
      });

      reply.code(500).send({
        success: false,
        available: false,
        error: 'Status check failed',
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * POST /api/deepgram-tts/quick-speak
   * Quick speech synthesis using the speak method (like your example)
   */
  fastify.post('/quick-speak', async (request, reply) => {
    try {
      const { text } = request.body as any;

      if (!text) {
        return reply.code(400).send({
          success: false,
          error: 'Text is required'
        });
      }

      const deepgramTTS = getDeepgramTTSService();
      if (!deepgramTTS) {
        return reply.code(503).send({
          success: false,
          error: 'Deepgram TTS service not available'
        });
      }

      logger.info('Quick speak with Deepgram TTS', {
        textLength: text.length
      });

      // Use the speak method (similar to your example)
      const audioBuffer = await deepgramTTS.speak(text);

      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Content-Length', audioBuffer.length.toString());
      reply.header('Content-Disposition', 'attachment; filename="speech.mp3"');

      logger.info('Quick speak completed', {
        textLength: text.length,
        audioSize: audioBuffer.length
      });

      reply.send(audioBuffer);

    } catch (error) {
      logger.error('Quick speak failed', {
        error: getErrorMessage(error),
        body: request.body
      });

      reply.code(500).send({
        success: false,
        error: 'Quick speak failed',
        details: getErrorMessage(error)
      });
    }
  });
};

export default deepgramTTSRoutes;