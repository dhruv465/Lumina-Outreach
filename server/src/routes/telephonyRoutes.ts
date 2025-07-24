import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  queueCall,
  handleVoiceWebhook,
  handleStatusWebhook,
  handleRecordingWebhook,
  getCallQueue,
  getTelephonyMetrics,
  pauseCall,
  bulkQueueCalls
} from '../controllers/telephonyController';

const router = express.Router();

// Webhook routes (public, no authentication needed for Twilio)
router.post('/voice-webhook', handleVoiceWebhook);
router.post('/status-webhook', handleStatusWebhook);
router.post('/recording-webhook', handleRecordingWebhook);

// Protected routes
router.use(authenticate);

// Call management
router.post('/queue-call', queueCall);
router.post('/bulk-queue', bulkQueueCalls);
router.get('/queue', getCallQueue);
router.get('/metrics', getTelephonyMetrics);
router.put('/calls/:callId/pause', pauseCall);

export default router;
