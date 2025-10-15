import { FastifyInstance } from 'fastify';
import {
  handleStreamingVoiceWebhook,
  handleWebSocketStreaming,
  getStreamingStatistics,
  cleanupStreamingResources,
  testStreamingTTS
} from '../services/streamingWebhookHandlers';

export default async function streamingTTSRoutes(fastify: FastifyInstance<any, any, any, any, any>) {
  // Test streaming TTS
  fastify.post('/test', {
    schema: {
      body: {
        type: 'object',
        properties: {
          text: { type: 'string', default: 'Hello, this is a test of streaming TTS' },
          voiceId: { type: 'string', default: 'aura-asteria-en' }
        }
      }
    }
  }, testStreamingTTS);

  // Get streaming statistics
  fastify.get('/stats', getStreamingStatistics);

  // Clean up streaming resources
  fastify.post('/cleanup', cleanupStreamingResources);

  // Streaming voice webhook
  fastify.post('/voice/:callId/:conversationId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
          conversationId: { type: 'string' }
        },
        required: ['callId', 'conversationId']
      },
      body: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          voiceId: { type: 'string' },
          language: { type: 'string' },
          campaignId: { type: 'string' }
        },
        required: ['text']
      }
    }
  }, async (req, res) => {
    const { callId, conversationId } = req.params as { callId: string; conversationId: string };
    const { text, voiceId, language, campaignId } = req.body as {
      text: string;
      voiceId?: string;
      language?: string;
      campaignId?: string;
    };

    await handleStreamingVoiceWebhook(req, res, callId, conversationId, text, voiceId, language, campaignId);
  });

  // WebSocket streaming endpoint
  fastify.register(async function (fastify) {
    fastify.get('/ws/:callId/:conversationId', { websocket: true }, async (connection, req) => {
      const { callId, conversationId } = req.params as { callId: string; conversationId: string };
      
      // Parse query parameters for text and options
      const { text, voiceId, language, campaignId } = req.query as {
        text?: string;
        voiceId?: string;
        language?: string;
        campaignId?: string;
      };

      if (!text) {
        (connection as any).socket.close(1000, 'Text parameter is required');
        return;
      }

      await handleWebSocketStreaming(
        (connection as any).socket,
        req,
        callId,
        conversationId,
        text,
        voiceId,
        language,
        campaignId
      );
    });
  });
}