import express from 'express';
import expressWs from 'express-ws';
import { authenticate } from '../middleware/auth';
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
// Handle Twilio's .websocket suffix format - this is required for Twilio
wsRouter.ws('/voice/optimized-stream/.websocket', handleOptimizedVoiceStream);
// Handle parameterized routes with callId and conversationId
wsRouter.ws('/voice/optimized-stream/:callId/:conversationId', handleOptimizedVoiceStream);
wsRouter.ws('/voice/optimized-stream/:callId/:conversationId/.websocket', handleOptimizedVoiceStream);
// Make sure we also handle the double .websocket suffix that Twilio sometimes sends
wsRouter.ws('/voice/optimized-stream/:callId/:conversationId/.websocket/.websocket', handleOptimizedVoiceStream);

// Handle Twilio stream webhook
wsRouter.ws('/stream', handleTwilioStreamWebhook);

export default router;
