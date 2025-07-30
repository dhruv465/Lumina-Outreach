// Fixed version of webCallController.ts
import { Socket } from 'socket.io';
import { createLogger } from '../utils/logger';
import webCallService from '../services/webCallService';
import { CampaignService } from '../services/campaignService';
import { CircuitBreakerFactory } from '../utils/circuitBreaker';

// Create logger instance
const logger = createLogger('WebCallController');

// Service instances
const campaignService = new CampaignService();

// Circuit breaker instances
const speechToTextCircuitBreaker = CircuitBreakerFactory.create('SPEECH_TO_TEXT');
const llmCircuitBreaker = CircuitBreakerFactory.create('LLM');
const textToSpeechCircuitBreaker = CircuitBreakerFactory.create('TEXT_TO_SPEECH');

/**
 * Initialize a web call testing session
 */
export const initializeWebCall = async (req, res) => {
  try {
    const { campaignId, userId } = req.body;
    
    // Get campaign details
    const campaign = await campaignService.getCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Create a new session
    const session = await webCallService.createSession({
      campaignId,
      userId,
      campaignSettings: campaign.settings
    });
    
    return res.status(200).json({ 
      sessionId: session.id,
      message: 'Web call session initialized'
    });
  } catch (error) {
    logger.error('Error initializing web call session', error);
    return res.status(500).json({ error: 'Failed to initialize web call session' });
  }
};

/**
 * End a web call testing session
 */
export const endWebCall = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    await webCallService.endSession(sessionId);
    
    return res.status(200).json({ message: 'Web call session ended' });
  } catch (error) {
    logger.error(`Error ending web call session ${req.params.sessionId}`, error);
    return res.status(500).json({ error: 'Failed to end web call session' });
  }
};

/**
 * Handle WebSocket events for web calls
 * This function sets up all the WebSocket event handlers for web call testing
 */
export const handleWebCallEvent = (socket: Socket): void => {
  logger.info(`New web call socket connection: ${socket.id}`);
  
  // Session tracking
  let currentSessionId: string | null = null;
  
  // Set up ping interval to keep connection alive (inspired by Deepgram Voice Agent keep-alive)
  const pingInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('webcall:ping', { timestamp: Date.now() });
      logger.debug(`Sent ping to client: ${socket.id}`);
    } else {
      logger.warn(`Socket ${socket.id} disconnected, clearing ping interval`);
      clearInterval(pingInterval);
    }
  }, 15000); // Send a ping every 15 seconds (matching Deepgram Voice Agent pattern)
  
  // Listen for pong responses
  socket.on('webcall:pong', (data: { timestamp: number }) => {
    // Connection is still alive - calculate latency
    const latency = Date.now() - (data.timestamp || 0);
    logger.debug(`Received pong from client: ${socket.id}, latency: ${latency}ms`);
  });
  
  // Set up event handlers
  socket.on('webcall:initialize', async (data: { sessionId: string, campaignId: string, userId: string, testId?: string }) => {
    try {
      const { sessionId, campaignId, userId, testId } = data;
      currentSessionId = sessionId;
      
      // Get campaign details
      const campaign = await campaignService.getCampaign(campaignId);
      if (!campaign) {
        socket.emit('webcall:error', { message: 'Campaign not found' });
        return;
      }
      
      // Initialize or retrieve session
      const session = sessionId 
        ? await webCallService.getSession(sessionId)
        : await webCallService.createSession({
            campaignId,
            userId,
            testId,
            campaignSettings: campaign.settings
          });
      
      if (!session) {
        socket.emit('webcall:error', { message: 'Failed to create session' });
        return;
      }
      
      // Update session ID if new
      if (!sessionId) {
        currentSessionId = session.id;
      }
      
      // Join socket room for this session
      socket.join(`session:${currentSessionId}`);
      
      socket.emit('webcall:state', { 
        status: 'ready',
        sessionId: currentSessionId,
        message: 'Web call session ready'
      });
      
      // Set up session event listeners (inspired by Deepgram Voice Agent event handling)
      webCallService.on('session:keepAlive', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:keepAlive', data);
        }
      });

      webCallService.on('session:healthChanged', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:healthChanged', data);
        }
      });

      webCallService.on('session:recoveryAttempt', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:recoveryAttempt', data);
        }
      });

      webCallService.on('audio:chunkReceived', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:audioChunkReceived', data);
        }
      });

      webCallService.on('speech:userStarted', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:userStartedSpeaking', data);
        }
      });

      webCallService.on('speech:agentStarted', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:agentStartedSpeaking', data);
        }
      });

      webCallService.on('audio:agentDone', (data) => {
        if (data.sessionId === currentSessionId) {
          socket.emit('webcall:agentAudioDone', data);
        }
      });

      logger.info(`WebCall initialized for session: ${currentSessionId}`);
    } catch (error) {
      logger.error('Error in webcall:initialize', error);
      socket.emit('webcall:error', { message: 'Failed to initialize web call' });
    }
  });

  // Handle chunked audio data (inspired by Deepgram Voice Agent streaming)
  socket.on('webcall:audioChunk', async (data: { chunk: string, isLast?: boolean }) => {
    try {
      if (!currentSessionId) {
        socket.emit('webcall:error', { message: 'No active session' });
        return;
      }

      const audioChunk = Buffer.from(data.chunk, 'base64');
      await webCallService.processAudioChunk(currentSessionId, audioChunk);

      // If this is the last chunk, trigger processing
      if (data.isLast) {
        socket.emit('webcall:state', { 
          status: 'processing',
          message: 'Processing complete audio input'
        });
      }

    } catch (error) {
      logger.error(`Error in webcall:audioChunk for session: ${currentSessionId}`, error);
      socket.emit('webcall:error', { message: 'Failed to process audio chunk' });
    }
  });

  socket.on('webcall:audio', async (data: { audio: string }) => {
    try {
      if (!currentSessionId) {
        socket.emit('webcall:error', { message: 'No active session' });
        return;
      }
      
      const { audio } = data;
      const session = await webCallService.getSession(currentSessionId);
      
      if (!session) {
        socket.emit('webcall:error', { message: 'Session not found' });
        return;
      }
      
      socket.emit('webcall:state', { 
        status: 'processing',
        message: 'Processing audio input'
      });
      
      // Process audio through STT
      const sttStartTime = Date.now();
      const transcriptResult = await speechToTextCircuitBreaker.execute(
        async () => webCallService.processUserAudio(currentSessionId, audio)
      );
      const sttLatency = Date.now() - sttStartTime;
      
      if (!transcriptResult) {
        socket.emit('webcall:error', { message: 'Failed to process audio' });
        return;
      }
      
      socket.emit('webcall:transcript', {
        transcript: transcriptResult.text,
        isFinal: true,
        latency: sttLatency
      });
      
      // Process through LLM
      const llmStartTime = Date.now();
      const llmResponse = await llmCircuitBreaker.execute(
        async () => webCallService.processTranscript(currentSessionId, transcriptResult.text)
      );
      const llmLatency = Date.now() - llmStartTime;
      
      if (!llmResponse) {
        socket.emit('webcall:error', { message: 'Failed to process transcript' });
        return;
      }
      
      socket.emit('webcall:response', {
        text: llmResponse.text,
        latency: llmLatency
      });
      
      // Process through TTS
      const ttsStartTime = Date.now();
      const audioResponse = await textToSpeechCircuitBreaker.execute(
        async () => webCallService.processResponse(currentSessionId, llmResponse.text)
      );
      const ttsLatency = Date.now() - ttsStartTime;
      
      if (!audioResponse) {
        socket.emit('webcall:error', { message: 'Failed to generate audio response' });
        return;
      }
      
      socket.emit('webcall:audio_response', {
        audio: audioResponse.audio,
        latency: ttsLatency,
        totalLatency: sttLatency + llmLatency + ttsLatency
      });
      
      logger.info(`WebCall processing complete for session: ${currentSessionId}`);
    } catch (error) {
      logger.error(`Error in webcall:audio for session: ${currentSessionId}`, error);
      socket.emit('webcall:error', { message: 'Failed to process audio request' });
    }
  });
  
  socket.on('webcall:end', async () => {
    try {
      if (!currentSessionId) {
        socket.emit('webcall:error', { message: 'No active session' });
        return;
      }
      
      await webCallService.endSession(currentSessionId);
      
      socket.emit('webcall:state', { 
        status: 'ended',
        message: 'Call ended'
      });
      
      // Leave session room
      socket.leave(`session:${currentSessionId}`);
      currentSessionId = null;
      
      logger.info('WebCall session ended');
    } catch (error) {
      logger.error(`Error ending web call session: ${currentSessionId}`, error);
      socket.emit('webcall:error', { message: 'Failed to end web call session' });
    }
  });
  
  socket.on('disconnect', async () => {
    try {
      // Clear ping interval
      clearInterval(pingInterval);
      
      if (currentSessionId) {
        await webCallService.endSession(currentSessionId);
        logger.info(`WebCall session ${currentSessionId} ended due to disconnect`);
      }
    } catch (error) {
      logger.error(`Error handling disconnect for session: ${currentSessionId}`, error);
    }
    
    logger.info(`Web call socket disconnected: ${socket.id}`);
  });
};
