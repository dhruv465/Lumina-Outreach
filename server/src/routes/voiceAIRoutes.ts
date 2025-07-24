import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  getVoicePersonalities,
  synthesizeVoice,
  adaptConversation,
  trainVoicePersonality,
  testVoiceAI,
  startConversationalAI,
  interruptConversationalAI
} from '../controllers/voiceAIController';

const router = express.Router();

// All routes are protected
router.use(authenticate);

// Voice Personalities
router.get('/personalities', getVoicePersonalities);
router.post('/train-personality', trainVoicePersonality);

// Voice Synthesis
router.post('/synthesize', synthesizeVoice);

// Conversation Adaptation
router.post('/adapt-conversation', adaptConversation);

// ElevenLabs Conversational AI
router.post('/conversational-ai/start', startConversationalAI);
router.post('/conversational-ai/interrupt', interruptConversationalAI);

// Testing and Development
router.post('/test', testVoiceAI);

export default router;