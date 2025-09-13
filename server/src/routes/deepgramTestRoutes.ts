/**
 * Deepgram Test Routes
 * 
 * Routes for testing Deepgram transcription in the browser
 */

import express from 'express';
import multer from 'multer';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { getDeepgramService } from '../services/deepgramService';
import logger from '../utils/logger';
import { createRawTranscriptionStream, transcribeBuffer } from '../services/deepgramTranscriptionHelper';

const router = express.Router();

// Set up multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Keeps track of active WebSocket connections
const activeConnections = new Map();

/**
 * POST /api/deepgram/transcribe-file
 * 
 * Transcribe an uploaded audio file using Deepgram
 */
router.post('/transcribe-file', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file provided' });
    }

    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      return res.status(500).json({ success: false, error: 'Deepgram service not initialized' });
    }

    // Get parameters from the request
    const language = req.body.language || 'en';
    const model = req.body.model || 'nova-3';

    logger.info(`Transcribing file ${req.file.originalname} with language=${language}, model=${model}`);
    
    const result = await transcribeBuffer(req.file.buffer, {
      language,
      model,
      punctuate: true,
      diarize: false
    });

    // Create a mock agent response for testing
    let agentResponse = '';
    try {
      if (result.transcript) {
        agentResponse = `Mock response to: "${result.transcript}"`;
      }
    } catch (agentError) {
      logger.error(`Error getting agent response: ${agentError}`);
    }

    res.json({ 
      success: true, 
      transcript: result.transcript || '',
      confidence: result.confidence || 0,
      agentResponse
    });
  } catch (error) {
    logger.error(`Error transcribing file: ${error}`);
    res.status(500).json({ success: false, error: 'Failed to transcribe audio' });
  }
});

/**
 * GET /api/deepgram/status
 * 
 * Get the status of the Deepgram service
 */
router.get('/status', async (req, res) => {
  try {
    const deepgramService = getDeepgramService();
    if (!deepgramService) {
      return res.status(500).json({ success: false, error: 'Deepgram service not initialized' });
    }

    // Get Deepgram service status
    const status = {
      initialized: !!deepgramService,
      apiKeyConfigured: deepgramService ? true : false,
      models: {
        defaultModel: 'nova-3',
        availableModels: ['nova-3', 'nova-2', 'nova', 'enhanced']
      }
    };

    res.json({ success: true, status });
  } catch (error) {
    logger.error(`Error getting Deepgram status: ${error}`);
    res.status(500).json({ success: false, error: 'Failed to get Deepgram status' });
  }
});

/**
 * Set up WebSocket server for real-time transcription
 * Uses noServer mode to avoid conflicts with Twilio WebSocket server
 */
export function setupDeepgramWebSocketServer(server: any): WebSocket.Server {
  const wss = new WebSocket.Server({ 
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024, // 1MB max payload
  });

  wss.on('connection', (ws) => {
    const connectionId = uuidv4();
    const deepgramService = getDeepgramService();
    
    // Initialize connection state
    activeConnections.set(connectionId, {
      ws,
      deepgramStream: null,
      language: 'en',
      model: 'nova-3',
      isConfigured: false
    });

    logger.info(`New Deepgram WebSocket connection established: ${connectionId}`);

    // Send welcome message
    ws.send(JSON.stringify({ 
      type: 'connected', 
      connectionId,
      message: 'Connected to Deepgram test WebSocket server'
    }));

    // Handle messages from client
    ws.on('message', async (message) => {
      try {
        const connectionState = activeConnections.get(connectionId);
        
        // If it's a text message, it's likely configuration
        if (typeof message === 'string' || message instanceof Buffer && message.toString().startsWith('{')) {
          try {
            const textMessage = typeof message === 'string' ? message : message.toString();
            const data = JSON.parse(textMessage);
            
            if (data.type === 'config') {
              // Store configuration
              connectionState.language = data.language || 'en';
              connectionState.model = data.model || 'nova-3';
              connectionState.isConfigured = true;
              
              logger.info(`Configured connection ${connectionId}: language=${connectionState.language}, model=${connectionState.model}`);
              
              // Initialize Deepgram stream
              if (deepgramService) {
                const options = {
                  language: connectionState.language,
                  model: connectionState.model,
                  punctuate: true,
                  interim_results: true,
                  endpointing: 150
                };
                
                // Create the transcription stream
                const deepgramStream = await createRawTranscriptionStream('web-test', options);
                
                // Store the stream
                connectionState.deepgramStream = deepgramStream;
                activeConnections.set(connectionId, connectionState);
                
                // Handle transcription results
                deepgramStream.on('transcription', (result) => {
                  const transcript = result.text || '';
                  
                  ws.send(JSON.stringify({
                    type: 'transcription',
                    text: transcript,
                    isFinal: result.isFinal || false,
                    confidence: result.confidence || 0
                  }));
                  
                  // If this is a final result with content, get agent response
                  if (result.isFinal && transcript.trim() !== '') {
                    try {
                      // Create a mock agent response for testing
                      const agentResponse = `Mock response to: "${transcript}"`;
                      
                      // Send response to client
                      ws.send(JSON.stringify({
                        type: 'agent-response',
                        text: agentResponse
                      }));
                    } catch (agentError) {
                      logger.error(`Error processing agent response: ${agentError}`);
                    }
                  }
                });
                
                // Handle transcription errors
                deepgramStream.on('error', (error) => {
                  logger.error(`Deepgram stream error for connection ${connectionId}: ${error}`);
                  ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Transcription error'
                  }));
                });
                
                ws.send(JSON.stringify({
                  type: 'ready',
                  message: 'Deepgram stream initialized and ready for audio'
                }));
              } else {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Deepgram service not available'
                }));
              }
            }
          } catch (jsonError) {
            logger.error(`Error parsing JSON message: ${jsonError}`);
          }
        } 
        // If it's binary data, it's likely audio
        else if (connectionState.isConfigured && connectionState.deepgramStream) {
          // Send the audio chunk to Deepgram
          connectionState.deepgramStream.send(message);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Connection not configured for audio'
          }));
        }
      } catch (error) {
        logger.error(`Error processing WebSocket message: ${error}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Error processing message'
        }));
      }
    });

    // Handle connection close
    ws.on('close', () => {
      const connectionState = activeConnections.get(connectionId);
      if (connectionState && connectionState.deepgramStream) {
        try {
          connectionState.deepgramStream.close();
        } catch (error) {
          logger.error(`Error closing Deepgram stream: ${error}`);
        }
      }
      
      activeConnections.delete(connectionId);
      logger.info(`WebSocket connection closed: ${connectionId}`);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error for connection ${connectionId}: ${error}`);
    });
  });

  logger.info('Deepgram WebSocket server set up successfully');
  return wss;
}

export default router;
