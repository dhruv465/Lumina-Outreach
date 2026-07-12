import {
  getSystemConfiguration,
  updateSystemConfiguration,
  verifyDeepgram,
  verifyLlm,
  getLLMOptions,
  getVoiceOptions,
} from '../controllers/configurationController';

const configurationRoutes = async (fastify: any, _opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', getSystemConfiguration);
  fastify.put('/', updateSystemConfiguration);
  fastify.post('/verify-deepgram', verifyDeepgram);
  fastify.post('/verify-llm', verifyLlm);
  fastify.get('/llm-options', getLLMOptions);
  fastify.get('/voice-options', getVoiceOptions);
};

export default configurationRoutes;
