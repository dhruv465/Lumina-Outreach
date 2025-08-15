import express from 'express';
import { authenticate } from '../middleware/auth';
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
import { testLLMChat, testLLMConnection, getAllLLMModels, getProviderLLMModels, getDynamicProviderModels } from '../controllers/llmControllers';
import { 
  testModelCompatibility,
  getAvailableModels,
  batchTestModels,
  getModelRegistry,
  updateModelConfiguration,
  suggestOptimalConfiguration
} from '../controllers/modelManagementController';
import { logger } from '../index';

const router = express.Router();

// Log middleware for configuration routes
router.use((req, res, next) => {
  logger.info(`Configuration route: ${req.method} ${req.originalUrl}`);
  next();
});

// All routes are protected
router.use(authenticate);

// Configuration routes
router.get('/', getSystemConfiguration);
router.put('/', updateSystemConfiguration);
router.get('/llm-options', getLLMOptions);
router.get('/voice-options', getVoiceOptions);

// LLM model listing routes
router.get('/llm-models', getAllLLMModels);
router.get('/llm-models/:provider', getProviderLLMModels);
router.post('/llm-models/dynamic', getDynamicProviderModels);

// API key management
router.delete('/api-key/:provider/:name?', deleteApiKey);

// Connection tests
router.post('/test-llm', testLLMConnection);
router.post('/test-llm-chat', testLLMChat);
router.post('/test-twilio', testTwilioConnection);
router.post('/test-elevenlabs', testElevenLabsConnection);
router.post('/test-deepgram-tts', testDeepgramTTSConnection);
router.post('/test-voice', testVoiceSynthesis);
router.post('/test-call', makeTestCall);
router.post('/verify/elevenlabs', verifyElevenLabsApiKey);
router.post('/verify/deepgram-tts', verifyDeepgramTTSApiKey);

// Deepgram auto-configuration routes
router.post('/deepgram/auto-configure', autoConfigureDeepgramModel);
router.post('/deepgram/validate', validateDeepgramConfiguration);
router.get('/deepgram/status', getDeepgramValidationStatus);
router.post('/deepgram/test-model', testDeepgramModelCompatibility);

// Enhanced Deepgram configuration routes
router.get('/deepgram/suggested-models', getSuggestedDeepgramModels);
router.post('/deepgram/validate-config', validateCompleteDeepgramConfiguration);
router.post('/deepgram/batch-test-models', batchTestDeepgramModels);

// Model management API endpoints
router.post('/models/test', testModelCompatibility);
router.get('/models/available', getAvailableModels);
router.post('/models/batch-test', batchTestModels);
router.get('/models/registry', getModelRegistry);
router.put('/models/update', updateModelConfiguration);
router.post('/models/suggest-optimal', suggestOptimalConfiguration);

export default router;
