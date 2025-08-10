import { Router } from 'express';
import { 
  getHealthStatus, 
  getCallMetrics, 
  triggerStateTransition 
} from '../controllers/enhancedRealTimeController';
import { requireAuth } from '../middleware/auth';

const router = Router();

/**
 * Routes for enhanced real-time call functionality
 * Provides monitoring and control endpoints for the real-time AI voice agent system
 */

// Health check endpoint for real-time services
router.get('/health', getHealthStatus);

// Get comprehensive metrics for a specific call
router.get('/calls/:callId/metrics', requireAuth, getCallMetrics);

// Manual state transition endpoint (for testing/debugging)
router.post('/calls/:callId/transition', requireAuth, triggerStateTransition);

// Get all active call sessions
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const { realTimeCallStateMachine } = await import('../services/realTimeCallStateMachine');
    const { optimizedRealTimeAudioPipeline } = await import('../services/optimizedRealTimeAudioPipeline');
    const { enhancedBargeInDetectionService } = await import('../services/enhancedBargeInDetectionService');

    const activeSessions = realTimeCallStateMachine.getActiveSessions();
    const sessionDetails = activeSessions.map(session => ({
      ...session,
      audioPipelineMetrics: optimizedRealTimeAudioPipeline.getSessionMetrics(session.callId),
      bargeInMetrics: enhancedBargeInDetectionService.getCallMetrics(session.callId)
    }));

    res.json({
      totalSessions: activeSessions.length,
      sessions: sessionDetails,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get system-wide performance metrics
router.get('/performance', requireAuth, async (req, res) => {
  try {
    const { realTimeCallStateMachine } = await import('../services/realTimeCallStateMachine');
    const { enhancedBargeInDetectionService } = await import('../services/enhancedBargeInDetectionService');

    const activeSessions = realTimeCallStateMachine.getActiveSessions();
    
    // Calculate aggregate metrics
    let totalResponseLatency = 0;
    let totalBargeIns = 0;
    let responseCount = 0;

    const performanceData = activeSessions.map(session => {
      const metrics = realTimeCallStateMachine.getSessionMetrics(session.callId);
      if (metrics) {
        totalResponseLatency += metrics.averageResponseTime || 0;
        totalBargeIns += metrics.bargeInCount || 0;
        if (metrics.averageResponseTime > 0) responseCount++;
      }
      return metrics;
    }).filter(Boolean);

    const averageResponseTime = responseCount > 0 ? totalResponseLatency / responseCount : 0;

    res.json({
      timestamp: new Date().toISOString(),
      summary: {
        activeCalls: activeSessions.length,
        averageResponseTime: Math.round(averageResponseTime),
        totalBargeIns,
        systemHealth: activeSessions.length < 50 ? 'healthy' : 'high_load'
      },
      details: performanceData
    });

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get configuration status for real-time services
router.get('/config', requireAuth, async (req, res) => {
  try {
    const Configuration = require('../models/Configuration').default;
    const config = await Configuration.findOne();

    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    const configStatus = {
      sttProviders: {
        deepgram: {
          enabled: config.deepgramConfig?.isEnabled || false,
          hasApiKey: !!(config.deepgramConfig?.apiKey),
          models: config.deepgramConfig?.availableModels || []
        }
      },
      ttsProviders: {
        elevenlabs: {
          enabled: config.elevenLabsConfig?.isEnabled || false,
          hasApiKey: !!(config.elevenLabsConfig?.apiKey),
          voices: config.elevenLabsConfig?.availableVoices?.length || 0
        },
        deepgram: {
          enabled: config.ttsConfig?.deepgramTTS?.isEnabled || false,
          hasApiKey: !!(config.ttsConfig?.deepgramTTS?.apiKey),
          models: config.ttsConfig?.deepgramTTS?.availableModels || []
        }
      },
      llmProviders: config.llmConfig?.providers?.map(p => ({
        name: p.name,
        enabled: p.isEnabled,
        hasApiKey: !!p.apiKey,
        model: p.defaultModel
      })) || [],
      features: {
        bargeInDetection: true,
        streamingSTT: config.deepgramConfig?.isEnabled || false,
        streamingTTS: (config.elevenLabsConfig?.isEnabled || config.ttsConfig?.deepgramTTS?.isEnabled) || false,
        realTimeStateMachine: true,
        providerFallback: true
      }
    };

    res.json(configStatus);

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Manual barge-in trigger (for testing)
router.post('/calls/:callId/barge-in', requireAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const { energyLevel = 0.5, confidence = 0.8 } = req.body;

    const { enhancedBargeInDetectionService } = await import('../services/enhancedBargeInDetectionService');
    const { realTimeCallStateMachine } = await import('../services/realTimeCallStateMachine');

    // Check if call session exists
    const session = realTimeCallStateMachine.getSession(callId);
    if (!session) {
      return res.status(404).json({ error: 'Call session not found' });
    }

    // Manually trigger barge-in event
    realTimeCallStateMachine.handleEvent(callId, 'barge_in_detected' as any, {
      energyLevel,
      confidence,
      manual: true
    });

    res.json({
      success: true,
      callId,
      message: 'Barge-in triggered manually',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Update barge-in configuration for a call
router.put('/calls/:callId/barge-in/config', requireAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const config = req.body;

    const { enhancedBargeInDetectionService } = await import('../services/enhancedBargeInDetectionService');

    enhancedBargeInDetectionService.updateConfig(callId, config);

    res.json({
      success: true,
      callId,
      message: 'Barge-in configuration updated',
      config: enhancedBargeInDetectionService.getConfig(callId)
    });

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get state transition history for a call
router.get('/calls/:callId/state-history', requireAuth, async (req, res) => {
  try {
    const { callId } = req.params;

    const { realTimeCallStateMachine } = await import('../services/realTimeCallStateMachine');
    
    const session = realTimeCallStateMachine.getSession(callId);
    if (!session) {
      return res.status(404).json({ error: 'Call session not found' });
    }

    const stateHistory = realTimeCallStateMachine.getStateHistory(callId);

    res.json({
      callId,
      currentState: session.currentState,
      stateHistory,
      totalTransitions: stateHistory.length,
      sessionStartTime: session.sessionStartTime
    });

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Test endpoint for audio processing pipeline
router.post('/test/audio-pipeline', requireAuth, async (req, res) => {
  try {
    const { callId, testAudioBase64 } = req.body;

    if (!callId || !testAudioBase64) {
      return res.status(400).json({ 
        error: 'Call ID and test audio data are required' 
      });
    }

    const { optimizedRealTimeAudioPipeline } = await import('../services/optimizedRealTimeAudioPipeline');

    // Simulate processing test audio
    await optimizedRealTimeAudioPipeline.processIncomingAudio(
      callId,
      testAudioBase64,
      Date.now().toString()
    );

    res.json({
      success: true,
      message: 'Test audio processed',
      callId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;