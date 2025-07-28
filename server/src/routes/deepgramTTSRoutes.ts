import express from 'express';
import { getDeepgramTTSService } from '../services/deepgramTTSService';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

const router = express.Router();

/**
 * POST /api/deepgram-tts/synthesize
 * Synthesize speech using Deepgram TTS
 */
router.post('/synthesize', async (req, res) => {
  try {
    const { text, model, encoding, outputFormat } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    const deepgramTTS = getDeepgramTTSService();
    if (!deepgramTTS) {
      return res.status(503).json({
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
      ...(req.body.sample_rate && { sample_rate: req.body.sample_rate }),
      ...(req.body.container && { container: req.body.container })
    };

    const audioBuffer = await deepgramTTS.synthesizeSpeechWithStream(text, options);

    // Set appropriate headers
    const contentType = encoding === 'mp3' ? 'audio/mpeg' : 
                       encoding === 'wav' ? 'audio/wav' : 
                       'audio/mpeg';

    res.set({
      'Content-Type': contentType,
      'Content-Length': audioBuffer.length.toString(),
      'Content-Disposition': `attachment; filename="speech.${encoding || 'mp3'}"`
    });

    logger.info('Deepgram TTS synthesis completed', {
      textLength: text.length,
      audioSize: audioBuffer.length,
      model: options.model
    });

    res.send(audioBuffer);

  } catch (error) {
    logger.error('Deepgram TTS synthesis failed', {
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
 * GET /api/deepgram-tts/models
 * Get available Deepgram TTS models
 */
router.get('/models', async (req, res) => {
  try {
    const deepgramTTS = getDeepgramTTSService();
    if (!deepgramTTS) {
      return res.status(503).json({
        success: false,
        error: 'Deepgram TTS service not available'
      });
    }

    const models = deepgramTTS.getAvailableModels();

    res.json({
      success: true,
      models,
      count: models.length
    });

  } catch (error) {
    logger.error('Failed to get Deepgram TTS models', {
      error: getErrorMessage(error)
    });

    res.status(500).json({
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
router.get('/status', async (req, res) => {
  try {
    const deepgramTTS = getDeepgramTTSService();
    
    if (!deepgramTTS) {
      return res.json({
        success: false,
        available: false,
        message: 'Deepgram TTS service not initialized'
      });
    }

    const isAvailable = await deepgramTTS.isAvailable();

    res.json({
      success: true,
      available: isAvailable,
      message: isAvailable ? 'Deepgram TTS service is available' : 'Deepgram TTS service is not responding',
      models: deepgramTTS.getAvailableModels()
    });

  } catch (error) {
    logger.error('Deepgram TTS status check failed', {
      error: getErrorMessage(error)
    });

    res.status(500).json({
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
router.post('/quick-speak', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    const deepgramTTS = getDeepgramTTSService();
    if (!deepgramTTS) {
      return res.status(503).json({
        success: false,
        error: 'Deepgram TTS service not available'
      });
    }

    logger.info('Quick speak with Deepgram TTS', {
      textLength: text.length
    });

    // Use the speak method (similar to your example)
    const audioBuffer = await deepgramTTS.speak(text);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
      'Content-Disposition': 'attachment; filename="speech.mp3"'
    });

    logger.info('Quick speak completed', {
      textLength: text.length,
      audioSize: audioBuffer.length
    });

    res.send(audioBuffer);

  } catch (error) {
    logger.error('Quick speak failed', {
      error: getErrorMessage(error),
      body: req.body
    });

    res.status(500).json({
      success: false,
      error: 'Quick speak failed',
      details: getErrorMessage(error)
    });
  }
});

export default router;