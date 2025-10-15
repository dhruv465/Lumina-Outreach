import { FastifyInstance } from 'fastify';
import {
  getSystemConfiguration,
  updateSystemConfiguration,
  getLLMOptions,
  getVoiceOptions,
  testTwilioConnection,
  testElevenLabsConnection,
  testDeepgramTTSConnection,
  testVoiceSynthesis,
  makeTestCall,
  deleteApiKey,
  verifyElevenLabsApiKey,
  verifyDeepgramTTSApiKey,
  autoConfigureDeepgramModel,
  validateDeepgramConfiguration,
  getDeepgramValidationStatus,
  testDeepgramModelCompatibility,
  getSuggestedDeepgramModels,
  validateCompleteDeepgramConfiguration,
  batchTestDeepgramModels
} from '../controllers/configurationController';
import { testDeepgramASRConnection } from '../controllers/testDeepgramASRConnection';
// llmControllers removed (file deleted)
import { 
  testModelCompatibility,
  getAvailableModels,
  batchTestModels,
  getModelRegistry,
  updateModelConfiguration,
  suggestOptimalConfiguration
} from '../controllers/modelManagementController';

const configurationRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Configuration routes
  fastify.get('/', getSystemConfiguration);
  fastify.put('/', updateSystemConfiguration);
  fastify.get('/llm-options', getLLMOptions);
  fastify.get('/voice-options', getVoiceOptions);

  // LLM model listing routes (controllers removed)
  // fastify.get('/llm-models', getAllLLMModels);
  // fastify.get('/llm-models/:provider', getProviderLLMModels);
  // fastify.post('/llm-models/dynamic', getDynamicProviderModels);

  // API key management
  fastify.delete('/api-key/:provider/:name?', deleteApiKey);

  // Connection tests (LLM controllers removed)
  // fastify.post('/test-llm', testLLMConnection);
  // fastify.post('/test-llm-chat', testLLMChat);
  fastify.post('/test-twilio', testTwilioConnection);
  fastify.post('/test-elevenlabs', testElevenLabsConnection);
  fastify.post('/test-deepgram-tts', testDeepgramTTSConnection);
  fastify.post('/test-deepgram', testDeepgramASRConnection);
  fastify.post('/test-voice', testVoiceSynthesis);
  fastify.post('/test-call', makeTestCall);
  fastify.post('/verify/elevenlabs', verifyElevenLabsApiKey);
  fastify.post('/verify/deepgram-tts', verifyDeepgramTTSApiKey);

  // Deepgram auto-configuration routes
  fastify.post('/deepgram/auto-configure', autoConfigureDeepgramModel);
  fastify.post('/deepgram/validate', validateDeepgramConfiguration);
  fastify.get('/deepgram/status', getDeepgramValidationStatus);
  fastify.post('/deepgram/test-model', testDeepgramModelCompatibility);

  // Enhanced Deepgram configuration routes
  fastify.get('/deepgram/suggested-models', getSuggestedDeepgramModels);
  fastify.post('/deepgram/validate-config', validateCompleteDeepgramConfiguration);
  fastify.post('/deepgram/batch-test-models', batchTestDeepgramModels);

  // Model management API endpoints
  fastify.post('/models/test', testModelCompatibility);
  fastify.get('/models/available', getAvailableModels);
  fastify.post('/models/batch-test', batchTestModels);
  fastify.get('/models/registry', getModelRegistry);
  fastify.put('/models/update', updateModelConfiguration);
  fastify.post('/models/suggest-optimal', suggestOptimalConfiguration);
};

export default configurationRoutes;