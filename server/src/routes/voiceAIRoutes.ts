import { FastifyInstance } from 'fastify';
import {
  getVoicePersonalities,
  synthesizeVoice,
  adaptConversation,
  trainVoicePersonality,
  testVoiceAI,
  startConversationalAI,
  interruptConversationalAI
} from '../controllers/voiceAIController';

const voiceAIRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Voice Personalities
  fastify.get('/personalities', getVoicePersonalities);
  fastify.post('/train-personality', trainVoicePersonality);

  // Voice Synthesis
  fastify.post('/synthesize', synthesizeVoice);

  // Conversation Adaptation
  fastify.post('/adapt-conversation', adaptConversation);

  // ElevenLabs Conversational AI
  fastify.post('/conversational-ai/start', startConversationalAI);
  fastify.post('/conversational-ai/interrupt', interruptConversationalAI);

  // Testing and Development
  fastify.post('/test', testVoiceAI);
};

export default voiceAIRoutes;