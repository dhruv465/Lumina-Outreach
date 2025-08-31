import express from 'express';
import expressWs from 'express-ws';
import { handleVoiceStream, handleConversationalAIStream } from '../controllers/streamController';
import { handleOptimizedVoiceStream } from '../controllers/optimizedStreamController';
import { handleTwilioStreamWebhook } from '../services/webhookHandlers';

const router = express.Router();

// Enable WebSocket support on this router
const wsRouter = expressWs(router as any).app;

// WebSocket streaming endpoint - not authenticated
wsRouter.ws('/voice/stream', handleVoiceStream);

// WebSocket streaming endpoint for ElevenLabs Conversational AI
wsRouter.ws('/voice/conversational-ai', handleConversationalAIStream);

// Note: Twilio optimized streaming endpoints are handled by TwilioWebSocketServer
// to avoid duplicate WebSocket handlers that cause connection conflicts
// The following routes are commented out to prevent duplicate handlers:
// wsRouter.ws('/voice/optimized-stream', handleOptimizedVoiceStream);
// wsRouter.ws('/voice/optimized-stream/:callId/:conversationId', handleOptimizedVoiceStream);

// Handle Twilio stream webhook (keep this for backward compatibility)
// Legacy route - consider migrating to dedicated TwilioWebSocketServer
wsRouter.ws('/stream', handleTwilioStreamWebhook);

export default router;
