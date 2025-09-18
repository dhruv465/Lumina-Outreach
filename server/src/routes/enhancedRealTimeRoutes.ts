import { FastifyInstance } from 'fastify';
import { 
  getHealthStatus, 
  getCallMetrics, 
  triggerStateTransition 
} from '../controllers/enhancedRealTimeController';

const enhancedRealTimeRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * Routes for enhanced real-time call functionality
   * Provides monitoring and control endpoints for the real-time AI voice agent system
   */

  // Health check endpoint for real-time services
  fastify.get('/health', getHealthStatus);

  // Get comprehensive metrics for a specific call
  fastify.get('/calls/:callId/metrics', getCallMetrics);

  // Manual state transition endpoint (for testing/debugging)
  fastify.post('/calls/:callId/transition', triggerStateTransition);

  // Get all active call sessions
  fastify.get('/sessions', async (request, reply) => {
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

      reply.send({
        totalSessions: activeSessions.length,
        sessions: sessionDetails,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get system-wide performance metrics
  fastify.get('/performance', async (request, reply) => {
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

      reply.send({
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
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get configuration status for real-time services
  fastify.get('/config', async (request, reply) => {
    try {
      const Configuration = require('../models/Configuration').default;
      const config = await Configuration.findOne();

      if (!config) {
        return reply.code(404).send({ error: 'Configuration not found' });
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

      reply.send(configStatus);

    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Manual barge-in trigger (for testing)
  fastify.post('/calls/:callId/barge-in', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      const { energyLevel = 0.5, confidence = 0.8 } = request.body as any;

      const { enhancedBargeInDetectionService } = await import('../services/enhancedBargeInDetectionService');
      const { realTimeCallStateMachine } = await import('../services/realTimeCallStateMachine');

      // Check if call session exists
      const session = realTimeCallStateMachine.getSession(callId);
      if (!session) {
        return reply.code(404).send({ error: 'Call session not found' });
      }

      // Manually trigger barge-in event
      realTimeCallStateMachine.handleEvent(callId, 'barge_in_detected' as any, {
        energyLevel,
        confidence,
        manual: true
      });

      reply.send({
        success: true,
        callId,
        message: 'Barge-in triggered manually',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Update barge-in configuration for a call
  fastify.put('/calls/:callId/barge-in/config', async (request, reply) => {
    try {
      const { callId } = request.params as any;
      const config = request.body;

      const { enhancedBargeInDetectionService } = await import('../services/enhancedBargeInDetectionService');

      enhancedBargeInDetectionService.updateConfig(callId, config);

      reply.send({
        success: true,
        callId,
        message: 'Barge-in configuration updated',
        config: enhancedBargeInDetectionService.getConfig(callId)
      });

    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get state transition history for a call
  fastify.get('/calls/:callId/state-history', async (request, reply) => {
    try {
      const { callId } = request.params as any;

      const { realTimeCallStateMachine } = await import('../services/realTimeCallStateMachine');
      
      const session = realTimeCallStateMachine.getSession(callId);
      if (!session) {
        return reply.code(404).send({ error: 'Call session not found' });
      }

      const stateHistory = realTimeCallStateMachine.getStateHistory(callId);

      reply.send({
        callId,
        currentState: session.currentState,
        stateHistory,
        totalTransitions: stateHistory.length,
        sessionStartTime: session.sessionStartTime
      });

    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Test endpoint for audio processing pipeline
  fastify.post('/test/audio-pipeline', async (request, reply) => {
    try {
      const { callId, testAudioBase64 } = request.body as any;

      if (!callId || !testAudioBase64) {
        return reply.code(400).send({ 
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

      reply.send({
        success: true,
        message: 'Test audio processed',
        callId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      reply.code(500).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
};

export default enhancedRealTimeRoutes;