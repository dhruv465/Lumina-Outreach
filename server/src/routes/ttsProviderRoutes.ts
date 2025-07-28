import express from 'express';
import { authenticate } from '../middleware/auth';
import { getTTSProviderService } from '../services/ttsProviderService';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

const router = express.Router();

// All routes are protected
router.use(authenticate);

/**
 * GET /api/tts-provider/config
 * Get current TTS provider configuration
 */
router.get('/config', async (req, res) => {
  try {
    const ttsService = getTTSProviderService();
    const config = await ttsService.getTTSConfig();

    res.json({
      success: true,
      config
    });
  } catch (error) {
    logger.error('Failed to get TTS provider config', {
      error: getErrorMessage(error)
    });

    res.status(500).json({
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
router.post('/config', async (req, res) => {
  try {
    const { provider, primaryProvider, fallbackProviders, autoFallback, deepgramTTS } = req.body;

    if (!provider && !primaryProvider) {
      return res.status(400).json({
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
      ...(deepgramTTS && { deepgramTTS })
    };

    await ttsService.updateTTSConfig(newConfig);

    logger.info('TTS provider configuration updated', {
      provider: newConfig.provider,
      primaryProvider: newConfig.primaryProvider,
      fallbackProviders: newConfig.fallbackProviders
    });

    res.json({
      success: true,
      message: 'TTS provider configuration updated successfully',
      config: newConfig
    });
  } catch (error) {
    logger.error('Failed to update TTS provider config', {
      error: getErrorMessage(error),
      body: req.body
    });

    res.status(500).json({
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
router.post('/synthesize', async (req, res) => {
  try {
    const { text, voiceId, model, language, encoding, sampleRate } = req.body;

    if (!text) {
      return res.status(400).json({
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
      sampleRate
    });

    // Set appropriate headers
    const contentType = result.metadata.encoding === 'mp3' ? 'audio/mpeg' : 
                       result.metadata.encoding === 'wav' ? 'audio/wav' : 
                       'audio/mpeg';

    res.set({
      'Content-Type': contentType,
      'Content-Length': result.audioContent.length.toString(),
      'Content-Disposition': `attachment; filename="speech.${result.metadata.encoding || 'mp3'}"`
    });

    logger.info('TTS provider synthesis completed', {
      provider: result.metadata.provider,
      textLength: text.length,
      audioSize: result.audioContent.length,
      fallbackUsed: result.metadata.fallbackUsed
    });

    res.send(result.audioContent);

  } catch (error) {
    logger.error('TTS provider synthesis failed', {
      error: getErrorMessage(error),
      body: req.body
    });

    res.status(500).json({
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
router.get('/voices', async (req, res) => {
  try {
    const { provider } = req.query;
    const ttsService = getTTSProviderService();
    const voices = await ttsService.getAvailableVoices(provider as any);

    res.json({
      success: true,
      voices,
      count: voices.length,
      provider: provider || 'current'
    });
  } catch (error) {
    logger.error('Failed to get available voices', {
      error: getErrorMessage(error),
      provider: req.query.provider
    });

    res.status(500).json({
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
router.post('/test', async (req, res) => {
  try {
    const { provider, text } = req.body;

    if (!provider) {
      return res.status(400).json({
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

    res.json({
      success: true,
      message: `TTS provider ${provider} test successful`,
      provider: result.metadata.provider,
      audioSize: result.audioContent.length,
      metadata: result.metadata
    });

  } catch (error) {
    logger.error('TTS provider test failed', {
      error: getErrorMessage(error),
      provider: req.body.provider
    });

    res.status(500).json({
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
router.get('/status', async (req, res) => {
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

    res.json({
      success: true,
      config,
      providers: status
    });

  } catch (error) {
    logger.error('Failed to get TTS provider status', {
      error: getErrorMessage(error)
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get TTS provider status',
      details: getErrorMessage(error)
    });
  }
});

export default router;