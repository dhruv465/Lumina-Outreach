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

// Optimized streaming endpoint with lower latency
wsRouter.ws('/voice/optimized-stream', handleOptimizedVoiceStream);
// Handle parameterized routes with callId and conversationId
wsRouter.ws('/voice/optimized-stream/:callId/:conversationId', handleOptimizedVoiceStream);
// Handle Twilio stream webhook
wsRouter.ws('/stream', handleTwilioStreamWebhook);

export default router;
