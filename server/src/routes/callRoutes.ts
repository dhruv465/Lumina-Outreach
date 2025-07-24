import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  initiateCall,
  getCallHistory,
  getCallById,
  getCallRecording,
  getCallTranscript,
  scheduleCallback,
  getCallAnalytics,
  exportCalls,
  syncTwilioRecordings,
  getCallRecordingDetails
} from '../controllers/callController';
import { updateCallStatus } from '../controllers/updateCallStatusController';
import {
  handleTwilioVoiceWebhook,
  handleTwilioStatusWebhook,
  handleTwilioGatherWebhook,
  handleTwilioStreamWebhook
} from '../services/webhookHandlers';
import { handleRecordingWebhook } from '../controllers/telephonyController';

const router = express.Router();

// Webhook routes - MUST BE FIRST and not authenticated (for Twilio callbacks)
// These routes need to match exactly what's being called in callController.ts
router.post('/voice-webhook', handleTwilioVoiceWebhook);
router.post('/status-webhook', handleTwilioStatusWebhook);
router.post('/gather', handleTwilioGatherWebhook);
router.post('/stream', handleTwilioStreamWebhook);
router.post('/recording-webhook', handleRecordingWebhook); // Use proper recording webhook handler

// Call management routes (protected)
router.post('/initiate', authenticate, initiateCall);
router.get('/', authenticate, getCallHistory);
router.get('/analytics', authenticate, getCallAnalytics);
router.get('/export', authenticate, exportCalls);
router.get('/:id', authenticate, getCallById);
router.get('/:id/recording', authenticate, getCallRecording);
router.get('/:id/recording-details', authenticate, getCallRecordingDetails);
router.get('/:id/transcript', authenticate, getCallTranscript);
router.put('/:id/status', authenticate, updateCallStatus);
router.post('/:id/schedule-callback', authenticate, scheduleCallback);
router.post('/sync-recordings', authenticate, syncTwilioRecordings);

export default router;