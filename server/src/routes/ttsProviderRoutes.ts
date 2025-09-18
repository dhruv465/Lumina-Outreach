import { FastifyInstance } from 'fastify';
import { getTTSProviderService } from '../services/ttsProviderService';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

const ttsProviderRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * GET /api/tts-provider/config
   * Get current TTS provider configuration
   */
  fastify.get('/config', async (request, reply) => {
    try {
      const ttsService = getTTSProviderService();
      const config = await ttsService.getTTSConfig();

      reply.send({
        success: true,
        config
      });
    } catch (error) {
      logger.error('Failed to get TTS provider config', {
        error: getErrorMessage(error)
      });

      reply.code(500).send({
        success: false,
        error: 'Failed to get TTS provider configuration',
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * POST /api/tts-provider/config
   * Update TTS provider configuration
   */
  fastify.post('/config', async (request, reply) => {
    try {
      const { 
        provider, 
        primaryProvider, 
        fallbackProviders, 
        autoFallback, 
        deepgramTTS, 
        selectedVoicesByProvider, 
        useSelectedFallbackVoice 
      } = request.body as any;

      if (!provider && !primaryProvider) {
        return reply.code(400).send({
          success: false,
          error: 'Provider or primaryProvider is required'
        });
      }

      const ttsService = getTTSProviderService();
      const newConfig = {
        provider: provider || primaryProvider,
        primaryProvider: primaryProvider || provider,
        fallbackProviders: fallbackProviders || ['deepgram'],
        autoFallback: autoFallback !== undefined ? autoFallback : true,
        ...(deepgramTTS && { deepgramTTS }),
        ...(selectedVoicesByProvider && { selectedVoicesByProvider }),
        ...(useSelectedFallbackVoice !== undefined && { useSelectedFallbackVoice })
      };

      await ttsService.updateTTSConfig(newConfig);

      logger.info('TTS provider configuration updated', {
        provider: newConfig.provider,
        primaryProvider: newConfig.primaryProvider,
        fallbackProviders: newConfig.fallbackProviders,
        selectedVoicesByProvider: newConfig.selectedVoicesByProvider,
        useSelectedFallbackVoice: newConfig.useSelectedFallbackVoice
      });

      reply.send({
        success: true,
        message: 'TTS provider configuration updated successfully',
        config: newConfig
      });
    } catch (error) {
      logger.error('Failed to update TTS provider config', {
        error: getErrorMessage(error),
        body: request.body
      });

      reply.code(500).send({
        success: false,
        error: 'Failed to update TTS provider configuration',
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * POST /api/tts-provider/synthesize
   * Synthesize speech using the configured TTS provider
   */
  fastify.post('/synthesize', async (request, reply) => {
    try {
      const { text, voiceId, model, language, encoding, sampleRate, provider } = request.body as any;

      if (!text) {
        return reply.code(400).send({
          success: false,
          error: 'Text is required'
        });
      }

      const ttsService = getTTSProviderService();
      const result = await ttsService.synthesizeSpeech({
        text,
        voiceId,
        model,
        language,
        encoding,
        sampleRate,
        provider
      });

      // Set appropriate headers
      const contentType = result.metadata.encoding === 'mp3' ? 'audio/mpeg' : 
                         result.metadata.encoding === 'wav' ? 'audio/wav' : 
                         'audio/mpeg';

      reply.header('Content-Type', contentType);
      reply.header('Content-Length', result.audioContent.length.toString());
      reply.header('Content-Disposition', `attachment; filename="speech.${result.metadata.encoding || 'mp3'}"`);

      logger.info('TTS provider synthesis completed', {
        provider: result.metadata.provider,
        textLength: text.length,
        audioSize: result.audioContent.length,
        fallbackUsed: result.metadata.fallbackUsed
      });

      reply.send(result.audioContent);

    } catch (error) {
      logger.error('TTS provider synthesis failed', {
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
   * GET /api/tts-provider/voices
   * Get available voices for the current or specified provider
   */
  fastify.get('/voices', async (request, reply) => {
    try {
      const { provider } = request.query as any;
      const ttsService = getTTSProviderService();
      const voices = await ttsService.getAvailableVoices(provider as any);

      reply.send({
        success: true,
        voices,
        count: voices.length,
        provider: provider || 'current'
      });
    } catch (error) {
      logger.error('Failed to get available voices', {
        error: getErrorMessage(error),
        provider: request.query.provider
      });

      reply.code(500).send({
        success: false,
        error: 'Failed to get available voices',
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * POST /api/tts-provider/test
   * Test a specific TTS provider
   */
  fastify.post('/test', async (request, reply) => {
    try {
      const { provider, text } = request.body as any;

      if (!provider) {
        return reply.code(400).send({
          success: false,
          error: 'Provider is required'
        });
      }

      const ttsService = getTTSProviderService();
      const testText = text || 'This is a test of the TTS provider.';

      logger.info(`Testing TTS provider: ${provider}`);

      const result = await ttsService.synthesizeSpeech({
        text: testText,
        voiceId: 'test'
      });

      reply.send({
        success: true,
        message: `TTS provider ${provider} test successful`,
        provider: result.metadata.provider,
        audioSize: result.audioContent.length,
        metadata: result.metadata
      });

    } catch (error) {
      logger.error('TTS provider test failed', {
        error: getErrorMessage(error),
        provider: (request.body as any).provider
      });

      reply.code(500).send({
        success: false,
        error: `TTS provider test failed`,
        details: getErrorMessage(error)
      });
    }
  });

  /**
   * GET /api/tts-provider/status
   * Get status of all TTS providers
   */
  fastify.get('/status', async (request, reply) => {
    try {
      const ttsService = getTTSProviderService();
      const config = await ttsService.getTTSConfig();
      
      const providers = ['elevenlabs', 'deepgram'];
      const status = {};

      for (const provider of providers) {
        try {
          const isAvailable = await ttsService.testProvider(provider as any);
          status[provider] = {
            available: isAvailable,
            isPrimary: provider === config.primaryProvider,
            isFallback: config.fallbackProviders?.includes(provider)
          };
        } catch (error) {
          status[provider] = {
            available: false,
            error: getErrorMessage(error),
            isPrimary: provider === config.primaryProvider,
            isFallback: config.fallbackProviders?.includes(provider)
          };
        }
      }

      reply.send({
        success: true,
        config,
        providers: status
      });

    } catch (error) {
      logger.error('Failed to get TTS provider status', {
        error: getErrorMessage(error)
      });

      reply.code(500).send({
        success: false,
        error: 'Failed to get TTS provider status',
        details: getErrorMessage(error)
      });
    }
  });
};

export default ttsProviderRoutes;