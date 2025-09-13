import express from 'express';
import { handleRealTimeMediaStream } from '../controllers/enhancedRealTimeController';

import { handleTwilioStreamWebhook } from '../services/webhookHandlers';

const router = express.Router();

// Note: All WebSocket streaming endpoints are now handled by TwilioWebSocketServer
// to avoid conflicts with express-ws and ensure proper Twilio Media Streams protocol compliance
// 
// The following routes have been moved to the native WebSocket server:
// - /voice/stream/* - Twilio Media Streams (handled by TwilioWebSocketServer)
// - /voice/conversational-ai - ElevenLabs Conversational AI
// - /voice/optimized-stream - Optimized streaming endpoints
//
// Legacy route - kept for backward compatibility with existing integrations
// but consider migrating to dedicated TwilioWebSocketServer for better reliability
// wsRouter.ws('/stream', handleTwilioStreamWebhook);

export default router;
