import * as WebSocket from "ws";
import * as http from "http";
import * as url from "url";
import logger from "../utils/logger";
import { handleOptimizedVoiceStream } from "../controllers/optimizedStreamController";
import { Request } from "express";

/**
 * Dedicated WebSocket server for Twilio Media Streams
 * Uses native 'ws' library for robust WebSocket framing
 */
export class TwilioWebSocketServer {
  private wss: WebSocket.Server;
  private activeConnections: Map<string, WebSocket> = new Map();
  // Voice Agent patterns
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();
  private connectionHealthTimers: Map<string, NodeJS.Timeout> = new Map();
  private audioChunkBuffers: Map<string, Buffer[]> = new Map();
  private readonly KEEP_ALIVE_INTERVAL = 15000; // 15 seconds (like Deepgram Voice Agent)
  private readonly CONNECTION_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly AUDIO_CHUNK_SIZE = 8192; // 8KB chunks

  constructor(server: http.Server) {
    logger.info("Initializing TwilioWebSocketServer with HTTP server");

    // Create WebSocket server with noServer option to handle upgrades manually
    this.wss = new WebSocket.Server({
      noServer: true,
      perMessageDeflate: false, // Disable compression for real-time audio
      maxPayload: 1024 * 1024, // 1MB max payload
      clientTracking: true,
      handleProtocols: (protocols) => {
        // Accept any protocol for Twilio compatibility
        return protocols.size > 0 ? Array.from(protocols)[0] : false;
      }
    });

    // Handle upgrade events manually to prevent Express interference
    server.on('upgrade', (request, socket, head) => {
      const pathname = url.parse(request.url || "").pathname || "";

      // Normalize pathname by removing any .websocket suffix
      const normalizedPathname = pathname.replace(/\/\.websocket$/, "");

      // Simplify path validation to avoid duplication issues and Twilio error 31924
      const isValidPath =
        normalizedPathname.startsWith("/voice/optimized-stream") ||
        normalizedPathname.startsWith("/voice/low-latency") ||
        normalizedPathname === "/stream" || // Exact match to avoid conflicts
        pathname.includes("project-call-stream"); // Only check for our specific stream name

      // Verify WebSocket upgrade headers
      const hasValidHeaders =
        request.headers.upgrade === "websocket" &&
        request.headers.connection &&
        request.headers.connection.toLowerCase().includes("upgrade");

      logger.info("WebSocket upgrade request intercepted", {
        url: request.url,
        pathname,
        normalizedPathname,
        isValidPath,
        hasValidHeaders,
        userAgent: request.headers["user-agent"],
        upgradeHeader: request.headers.upgrade,
        connectionHeader: request.headers.connection
      });

      if (isValidPath && hasValidHeaders) {
        // Handle the upgrade for Twilio WebSocket connections
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        // Reject non-Twilio WebSocket connections
        logger.warn("Rejecting WebSocket upgrade for invalid path", {
          pathname,
          isValidPath,
          hasValidHeaders
        });
        socket.destroy();
      }
    });

    this.setupEventHandlers();
    logger.info("Twilio WebSocket server initialized", {
      serverCreated: !!this.wss,
      mode: 'noServer'
    });
  }

  private sendTwilioStartEvent(ws: WebSocket, callId: string, conversationId: string) {
    // Twilio expects a start event as the first message
    const startEvent = {
      event: "start",
      start: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        streamSid: `MZ${callId.substring(0, 32)}`, // Generate a stream SID
        callSid: callId,
        tracks: ["inbound"]
      }
    };

    // Send the start event immediately
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(startEvent));
      logger.info("Sent Twilio start event", {
        callId,
        conversationId,
        event: startEvent
      });
    }
  }

  private setupTwilioMessageHandler(ws: WebSocket, callId: string, conversationId: string) {
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.event === 'connected') {
          logger.info('Twilio Media Stream connected', {
            callId,
            conversationId,
            streamSid: message.streamSid
          });
          // Store stream metadata on WebSocket for later use
          (ws as any).streamSid = message.streamSid;
          (ws as any).sequenceNumber = 0;
        } else if (message.event === 'start') {
          const streamSid = message.start?.streamSid || message.streamSid;
          logger.info('Twilio Media Stream started', {
            callId,
            conversationId,
            streamSid: streamSid
          });
          // Store stream metadata on WebSocket for later use
          (ws as any).streamSid = streamSid;
          (ws as any).sequenceNumber = 0;
        } else if (message.event === 'media') {
          // Handle incoming audio data with chunking (inspired by Deepgram Voice Agent)
          const audioPayload = message.media?.payload;
          if (audioPayload) {
            this.handleAudioChunk(callId, conversationId, audioPayload, message.media?.timestamp);
          }
          
          logger.debug('Received audio data from Twilio', {
            callId,
            payloadSize: audioPayload?.length || 0,
            timestamp: message.media?.timestamp
          });
        } else if (message.event === 'stop') {
          logger.info('Twilio Media Stream stopped', {
            callId,
            conversationId
          });
        } else {
          logger.debug('Received unknown Twilio event', {
            callId,
            event: message.event,
            message: message
          });
        }
      } catch (error) {
        logger.error('Error parsing Twilio message', {
          error: error instanceof Error ? error.message : String(error),
          data: data.toString().substring(0, 100),
          callId
        });
      }
    });
  }

  private setupEventHandlers() {
    this.wss.on("connection", async (ws: WebSocket, req: http.IncomingMessage) => {
      logger.info("New Twilio WebSocket connection established", {
        url: req.url,
        userAgent: req.headers["user-agent"],
        origin: req.headers.origin,
        clientCount: this.wss.clients.size,
      });

      // Set up proper WebSocket options for Twilio
      ws.binaryType = "arraybuffer";

      // Configure WebSocket for optimal performance
      if ((ws as any)._socket) {
        (ws as any)._socket.setNoDelay(true); // Disable Nagle's algorithm for low latency
        (ws as any)._socket.setKeepAlive(true, 30000); // Keep connection alive
      }

      // Add connection metadata
      (ws as any).isAlive = true;
      (ws as any).connectionTime = Date.now();

      // Parse URL to extract parameters
      const parsedUrl = url.parse(req.url || "", true);
      // Remove .websocket suffix if present
      const cleanPathname =
        parsedUrl.pathname?.replace(/\/\.websocket$/, "") || "";
      const pathParts = cleanPathname.split("/").filter(Boolean) || [];

      // Extract callId and conversationId from URL path
      let callId: string | undefined;
      let conversationId: string | undefined;

      if (pathParts.length >= 4) {
        // Format: /voice/optimized-stream/callId/conversationId or /voice/low-latency/callId/conversationId
        if (
          pathParts[0] === "voice" &&
          (pathParts[1] === "optimized-stream" ||
            pathParts[1] === "low-latency")
        ) {
          callId = pathParts[2];
          conversationId = pathParts[3];
        } else {
          // Legacy format support
          callId = pathParts[2];
          conversationId = pathParts[3];
        }

        // Log the URL parsing for debugging
        logger.debug(`WebSocket URL parsing: ${parsedUrl.pathname}`, {
          callId,
          conversationId,
          pathParts,
          originalPath: parsedUrl.pathname,
          cleanedPath: cleanPathname,
        });
      }

      // Also check query parameters
      if (!callId) callId = parsedUrl.query?.callId as string;
      if (!conversationId)
        conversationId = parsedUrl.query?.conversationId as string;

      // Create a mock Express request object for compatibility
      const mockReq: Partial<Request> = {
        url: req.url,
        headers: req.headers,
        params: {
          callId: callId || "",
          conversationId: conversationId || "",
        },
        query: parsedUrl.query || {},
      };

      // Handle the connection using our existing controller
      try {
        // Verify connection parameters before proceeding
        if (!callId || !conversationId) {
          logger.error("Missing required parameters for WebSocket connection", {
            callId,
            conversationId,
            url: req.url,
            pathname: parsedUrl.pathname,
          });
          ws.close(1002, "Missing required parameters");
          return;
        }

        // Check for duplicate connections to the same endpoint
        const connectionKey = `${callId}:${conversationId}`;
        const existingConnection = this.activeConnections.get(connectionKey);

        if (
          existingConnection &&
          existingConnection.readyState === WebSocket.OPEN
        ) {
          logger.warn(
            "Duplicate WebSocket connection attempt detected, closing existing connection",
            {
              callId,
              conversationId,
              connectionKey,
            }
          );
          existingConnection.close(1000, "Replaced by new connection");
          this.activeConnections.delete(connectionKey);
        }

        // Store the new connection
        this.activeConnections.set(connectionKey, ws);

        // Initialize audio chunk buffer for this connection
        this.audioChunkBuffers.set(connectionKey, []);

        // Set up keep-alive and connection health monitoring (inspired by Deepgram Voice Agent)
        this.setupConnectionKeepAlive(connectionKey, ws);
        this.setupConnectionHealthCheck(connectionKey, ws);

        // Log successful connection establishment
        logger.info(
          "Establishing WebSocket connection for Twilio Media Stream",
          {
            callId,
            conversationId,
            url: req.url,
            userAgent: req.headers["user-agent"],
            connectionKey,
            activeConnections: this.activeConnections.size,
          }
        );

        // Handle the enhanced real-time media stream with new services
        const { handleRealTimeMediaStream } = await import('../controllers/enhancedRealTimeController');
        handleRealTimeMediaStream(ws, mockReq as Request);

        // CRITICAL: Send required Twilio start event immediately after connection
        this.sendTwilioStartEvent(ws, callId, conversationId);

        // Set up Twilio-specific message handler
        this.setupTwilioMessageHandler(ws, callId, conversationId);

        // Set up ping/pong to keep connection alive for Twilio
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            logger.debug(
              `Ping sent to keep WebSocket connection alive for call ${callId}`
            );
          } else {
            clearInterval(pingInterval);
          }
        }, 15000); // Send ping every 15 seconds

        // Store the interval for cleanup
        (ws as any).pingInterval = pingInterval;

        // Clean up interval when connection closes
        ws.on("close", (code, reason) => {
          if (pingInterval) {
            clearInterval(pingInterval);
          }
          // Clean up voice agent timers and buffers
          const connectionKey = `${callId}:${conversationId}`;
          this.clearConnectionKeepAlive(connectionKey);
          this.clearConnectionHealthCheck(connectionKey);
          this.audioChunkBuffers.delete(connectionKey);
          
          // Remove from active connections
          this.activeConnections.delete(connectionKey);
          logger.info(`WebSocket connection closed for call ${callId}`, {
            code,
            reason: reason.toString(),
            connectionKey,
            remainingConnections: this.activeConnections.size,
            connectionDuration: Date.now() - ((ws as any).connectionTime || Date.now()),
          });
        });

      } catch (error) {
        logger.error("Error handling WebSocket connection:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          callId,
          conversationId,
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1011, "Internal server error");
        }
      }

      // Set up ping/pong for connection health
      ws.on("pong", () => {
        (ws as any).isAlive = true;
      });

      ws.on("error", (error) => {
        logger.error("WebSocket error:", {
          error: error.message,
          code: (error as any).code,
          callId,
          conversationId,
          connectionTime: (ws as any).connectionTime,
          readyState: ws.readyState,
          stack: error.stack,
        });

        // Clean up ping interval on error
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
        }

        // Handle specific WebSocket errors that might cause Twilio issues
        if (
          (error as any).code === "ECONNRESET" ||
          (error as any).code === "EPIPE" ||
          (error as any).code === "ENOTFOUND" ||
          error.message.includes("WebSocket") ||
          error.message.includes("connection")
        ) {
          logger.warn("WebSocket connection error detected, cleaning up", {
            errorCode: (error as any).code,
            callId,
            conversationId,
          });

          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, "Connection error");
          }
        }
      });
    });

    // Set up connection health monitoring
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!(ws as any).isAlive) {
          logger.warn("Terminating unresponsive WebSocket connection", {
            connectionTime: (ws as any).connectionTime,
            readyState: ws.readyState,
          });

          // Clean up ping interval if it exists
          if ((ws as any).pingInterval) {
            clearInterval((ws as any).pingInterval);
          }

          return ws.terminate();
        }

        (ws as any).isAlive = false;

        // Only ping if connection is open
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, 30000); // Check every 30 seconds

    this.wss.on("close", () => {
      clearInterval(interval);
    });

    // Log server statistics periodically
    setInterval(() => {
      const clientCount = this.wss.clients.size;
      if (clientCount > 0) {
        logger.debug(`Active WebSocket connections: ${clientCount}`);
      }
    }, 60000); // Log every minute
  }

  public close() {
    // Close all active connections
    this.activeConnections.forEach((ws, connectionKey) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, "Server shutting down");
      }
    });
    this.activeConnections.clear();

    this.wss.close();
  }

  public getClientCount(): number {
    return this.wss.clients.size;
  }

  public getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }

  public getActiveConnections(): string[] {
    return Array.from(this.activeConnections.keys());
  }

  /**
   * Set up keep-alive mechanism for a connection (inspired by Deepgram Voice Agent)
   * @param connectionKey Connection key
   * @param ws WebSocket connection
   */
  private setupConnectionKeepAlive(connectionKey: string, ws: WebSocket): void {
    // Clear any existing timer
    this.clearConnectionKeepAlive(connectionKey);

    // Set up keep-alive timer
    const timer = setInterval(() => {
      this.sendConnectionKeepAlive(connectionKey, ws);
    }, this.KEEP_ALIVE_INTERVAL);

    this.keepAliveTimers.set(connectionKey, timer);
    logger.debug(`Keep-alive setup for connection ${connectionKey}`);
  }

  /**
   * Send keep-alive signal for a connection
   * @param connectionKey Connection key
   * @param ws WebSocket connection
   */
  private sendConnectionKeepAlive(connectionKey: string, ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) {
      this.clearConnectionKeepAlive(connectionKey);
      return;
    }

    // Send keep-alive message (Twilio-compatible format)
    const keepAliveMessage = {
      event: 'keepAlive',
      timestamp: Date.now(),
      connectionKey
    };

    try {
      ws.send(JSON.stringify(keepAliveMessage));
      logger.debug(`Keep-alive sent for connection ${connectionKey}`);
    } catch (error) {
      logger.error(`Failed to send keep-alive for connection ${connectionKey}:`, error);
      this.clearConnectionKeepAlive(connectionKey);
    }
  }

  /**
   * Clear keep-alive timer for a connection
   * @param connectionKey Connection key
   */
  private clearConnectionKeepAlive(connectionKey: string): void {
    const timer = this.keepAliveTimers.get(connectionKey);
    if (timer) {
      clearInterval(timer);
      this.keepAliveTimers.delete(connectionKey);
      logger.debug(`Keep-alive cleared for connection ${connectionKey}`);
    }
  }

  /**
   * Set up connection health monitoring
   * @param connectionKey Connection key
   * @param ws WebSocket connection
   */
  private setupConnectionHealthCheck(connectionKey: string, ws: WebSocket): void {
    // Clear any existing timer
    this.clearConnectionHealthCheck(connectionKey);

    // Set up health check timer
    const timer = setInterval(() => {
      this.checkConnectionHealth(connectionKey, ws);
    }, this.CONNECTION_HEALTH_CHECK_INTERVAL);

    this.connectionHealthTimers.set(connectionKey, timer);
    logger.debug(`Connection health check setup for connection ${connectionKey}`);
  }

  /**
   * Check connection health
   * @param connectionKey Connection key
   * @param ws WebSocket connection
   */
  private checkConnectionHealth(connectionKey: string, ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn(`Connection ${connectionKey} is not open, cleaning up`);
      this.clearConnectionHealthCheck(connectionKey);
      this.clearConnectionKeepAlive(connectionKey);
      this.activeConnections.delete(connectionKey);
      this.audioChunkBuffers.delete(connectionKey);
      return;
    }

    // Send health check ping
    try {
      ws.ping();
      logger.debug(`Health check ping sent for connection ${connectionKey}`);
    } catch (error) {
      logger.error(`Health check failed for connection ${connectionKey}:`, error);
      this.clearConnectionHealthCheck(connectionKey);
      this.clearConnectionKeepAlive(connectionKey);
    }
  }

  /**
   * Clear connection health check timer
   * @param connectionKey Connection key
   */
  private clearConnectionHealthCheck(connectionKey: string): void {
    const timer = this.connectionHealthTimers.get(connectionKey);
    if (timer) {
      clearInterval(timer);
      this.connectionHealthTimers.delete(connectionKey);
      logger.debug(`Connection health check cleared for connection ${connectionKey}`);
    }
  }

  /**
   * Handle audio chunk processing (inspired by Deepgram Voice Agent streaming)
   * @param callId Call ID
   * @param conversationId Conversation ID
   * @param audioPayload Base64 encoded audio payload
   * @param timestamp Audio timestamp
   */
  private handleAudioChunk(callId: string, conversationId: string, audioPayload: string, timestamp?: string): void {
    const connectionKey = `${callId}:${conversationId}`;
    
    try {
      // Decode audio payload
      const audioBuffer = Buffer.from(audioPayload, 'base64');
      
      // Get or create chunk buffer for this connection
      let chunkBuffer = this.audioChunkBuffers.get(connectionKey) || [];
      chunkBuffer.push(audioBuffer);

      // Check if we have enough data to process
      const totalBufferSize = chunkBuffer.reduce((total, chunk) => total + chunk.length, 0);

      if (totalBufferSize >= this.AUDIO_CHUNK_SIZE) {
        // Combine chunks and process
        const combinedBuffer = Buffer.concat(chunkBuffer);
        chunkBuffer = []; // Clear buffer
        this.audioChunkBuffers.set(connectionKey, chunkBuffer);

        // Emit audio chunk event for processing
        this.emitAudioEvent(callId, conversationId, 'audioChunkReceived', {
          audioBuffer: combinedBuffer,
          size: combinedBuffer.length,
          timestamp: timestamp || Date.now().toString()
        });

        logger.debug(`Processed audio chunk for call ${callId}`, {
          chunkSize: combinedBuffer.length,
          timestamp
        });
      } else {
        // Update buffer
        this.audioChunkBuffers.set(connectionKey, chunkBuffer);
      }

    } catch (error) {
      logger.error(`Error processing audio chunk for call ${callId}:`, error);
    }
  }

  /**
   * Emit audio events (like Deepgram Voice Agent)
   * @param callId Call ID
   * @param conversationId Conversation ID
   * @param event Event type
   * @param data Event data
   */
  private emitAudioEvent(callId: string, conversationId: string, event: string, data: any): void {
    logger.debug(`Audio event for call ${callId}:`, {
      event,
      conversationId,
      dataSize: data.audioBuffer?.length || 0,
      timestamp: data.timestamp
    });

    // Process audio chunks when received
    if (event === 'audioChunkReceived' && data.audioBuffer) {
      // Process audio asynchronously to avoid blocking the WebSocket
      setImmediate(async () => {
        try {
          await this.processReceivedAudio(callId, conversationId, data.audioBuffer);
        } catch (error) {
          logger.error(`Error processing received audio for call ${callId}:`, error);
        }
      });
    }
  }

  /**
   * Process received audio chunk and generate AI response
   */
  private async processReceivedAudio(callId: string, conversationId: string, audioBuffer: Buffer): Promise<void> {
    try {
      logger.info(`Processing audio chunk for call ${callId}, size: ${audioBuffer.length} bytes`);
      
      // Get configuration for speech services
      const Configuration = require('../models/Configuration').default;
      const config = await Configuration.findOne();
      if (!config) {
        logger.error('No configuration found for audio processing');
        return;
      }
      
      // Get conversation session from the conversation engine
      const { conversationEngine } = await import('./index');
      let session = conversationEngine.getSession(conversationId);
      if (!session) {
        logger.warn(`No session found for conversation ${conversationId}, creating new one`);
        const Call = require('../models/Call').default;
        const call = await Call.findById(callId);
        if (!call) {
          logger.error(`No call found with ID ${callId}`);
          return;
        }
        
        const newConversationId = await conversationEngine.startConversation(
          callId,
          call.leadId.toString(),
          call.campaignId.toString(),
          call.personalityId
        );
        session = conversationEngine.getSession(newConversationId);
        if (!session) {
          logger.error('Failed to create conversation session');
          return;
        }
      }
      
      // Transcribe audio using available speech recognition service
      let transcribedText = '';
      
      // Try to use Deepgram if configured
      if (config.deepgramConfig?.isEnabled && config.deepgramConfig?.apiKey) {
        try {
          const speechAnalysisService = conversationEngine.getSpeechAnalysisService();
          const transcriptionResult = await speechAnalysisService.transcribeAudio(audioBuffer);
          transcribedText = transcriptionResult.transcript || '';
          
          logger.info(`Deepgram transcription for call ${callId}: "${transcribedText.substring(0, 100)}..."`);
        } catch (deepgramError) {
          logger.error(`Deepgram transcription failed for call ${callId}:`, deepgramError);
        }
      }
      
      // Skip processing if no meaningful speech detected
      if (!transcribedText || transcribedText.trim().length < 3) {
        logger.debug(`No meaningful speech detected for call ${callId}`);
        return;
      }
      
      // Process the transcribed text with conversation engine
      const aiResponse = await conversationEngine.processUserInput(conversationId, transcribedText);
      
      logger.info(`AI response for call ${callId}: "${aiResponse.text.substring(0, 100)}..."`);
      
      // Generate speech from AI response
      await this.generateAndSendAudioResponse(aiResponse.text, callId, session, config);
      
    } catch (error) {
      logger.error(`Error in processReceivedAudio for call ${callId}:`, error);
    }
  }

  /**
   * Generate audio from AI response and send to Twilio
   */
  private async generateAndSendAudioResponse(
    responseText: string,
    callId: string,
    session: any,
    config: any
  ): Promise<void> {
    try {
      // Get voice configuration
      const Call = require('../models/Call').default;
      const Campaign = require('../models/Campaign').default;
      const call = await Call.findById(callId);
      const campaign = call ? await Campaign.findById(call.campaignId) : null;
      
      // Determine voice ID
      const voiceId = call?.personalityId || 
                    session.currentPersonality?.voiceId ||
                    campaign?.voiceConfiguration?.voiceId ||
                    config?.voiceAIConfig?.conversationalAI?.defaultVoiceId ||
                    'default';
      
      // Get TTS provider configuration
      const selectedTTSProvider = config.ttsConfig?.provider || 'elevenlabs';
      
      if (selectedTTSProvider === 'elevenlabs' && config.elevenLabsConfig?.isEnabled) {
        // Use ElevenLabs for synthesis
        const { EnhancedVoiceAIService } = await import('./enhancedVoiceAIService');
        const voiceAI = new EnhancedVoiceAIService(config.elevenLabsConfig.apiKey);
        const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
          text: responseText,
          personalityId: voiceId,
          language: session.language === 'Hindi' ? 'hi' : 'en'
        });
        
        if (speechResponse?.audioContent) {
          this.sendAudioToCall(callId, speechResponse.audioContent);
          logger.info(`Sent ElevenLabs audio response for call ${callId}`);
        }
      } else if (selectedTTSProvider === 'deepgram' && config.ttsConfig?.deepgramTTS?.isEnabled) {
        // Use Deepgram TTS
        const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
        
        // Determine appropriate Deepgram model to use
        let deepgramModel = voiceId;
        const deepgramModels = [
          'aura-2-thalia-en', 'aura-asteria-en', 'aura-luna-en', 'aura-stella-en',
          'aura-athena-en', 'aura-hera-en', 'aura-orion-en', 'aura-arcas-en',
          'aura-perseus-en', 'aura-angus-en', 'aura-orpheus-en', 'aura-helios-en', 'aura-zeus-en'
        ];
        
        // If voiceId is not a valid Deepgram model, use configured default or safe fallback
        if (!deepgramModels.includes(voiceId)) {
          deepgramModel = config.ttsConfig.deepgramTTS.defaultModel || 'aura-2-thalia-en';
          logger.info(`Voice ID ${voiceId} is not a Deepgram model, using ${deepgramModel} instead`);
        }
        
        const speechResponse = await synthesizeSpeechWithProvider(
          config,
          responseText,
          deepgramModel,
          session.language === 'Hindi' ? 'hi' : 'en',
          { encoding: 'linear16', sampleRate: 8000, model: deepgramModel }
        );
        
        if (speechResponse?.audioContent) {
          this.sendAudioToCall(callId, speechResponse.audioContent);
          logger.info(`Sent Deepgram audio response for call ${callId}`, {
            model: deepgramModel,
            encoding: 'linear16',
            sampleRate: 8000,
            audioSize: speechResponse.audioContent.length
          });
        }
      } else {
        logger.warn(`TTS provider ${selectedTTSProvider} not configured or available for call ${callId}`);
      }
      
    } catch (error) {
      logger.error(`Error generating audio response for call ${callId}:`, error);
    }
  }

  /**
   * Send audio data to a specific call via WebSocket
   */
  private sendAudioToCall(callId: string, audioData: Buffer): void {
    // Find the WebSocket connection for this call
    const connection = this.findConnectionByCallId(callId);
    if (connection) {
      const message = {
        event: 'media',
        streamSid: connection.streamSid,
        media: {
          track: 'outbound',
          chunk: (++connection.sequenceNumber).toString(),
          timestamp: Date.now().toString(),
          payload: audioData.toString('base64')
        }
      };
      
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(JSON.stringify(message));
        logger.debug(`Sent audio to call ${callId}, size: ${audioData.length} bytes`);
      } else {
        logger.warn(`WebSocket not open for call ${callId}, state: ${connection.ws.readyState}`);
      }
    } else {
      logger.warn(`No WebSocket connection found for call ${callId}`);
    }
  }

  /**
   * Find WebSocket connection by call ID
   */
  private findConnectionByCallId(callId: string): { ws: WebSocket, streamSid: string, sequenceNumber: number } | null {
    for (const [connectionKey, ws] of this.activeConnections.entries()) {
      if (connectionKey.startsWith(callId + ':')) {
        // Get stream metadata stored on the WebSocket
        const streamSid = (ws as any).streamSid;
        const sequenceNumber = (ws as any).sequenceNumber || 0;
        (ws as any).sequenceNumber = sequenceNumber + 1;
        
        return { ws, streamSid, sequenceNumber };
      }
    }
    return null;
  }

  /**
   * Handle user started speaking event (like Deepgram Voice Agent)
   * @param callId Call ID
   * @param conversationId Conversation ID
   */
  public handleUserStartedSpeaking(callId: string, conversationId: string): void {
    this.emitAudioEvent(callId, conversationId, 'userStartedSpeaking', {
      timestamp: Date.now().toString()
    });
    
    logger.debug(`User started speaking in call ${callId}`);
  }

  /**
   * Handle agent started speaking event (like Deepgram Voice Agent)
   * @param callId Call ID
   * @param conversationId Conversation ID
   * @param responseLatency Response latency in milliseconds
   */
  public handleAgentStartedSpeaking(callId: string, conversationId: string, responseLatency: number): void {
    this.emitAudioEvent(callId, conversationId, 'agentStartedSpeaking', {
      responseLatency,
      timestamp: Date.now().toString()
    });
    
    logger.debug(`Agent started speaking in call ${callId} with ${responseLatency}ms latency`);
  }

  /**
   * Handle agent audio done event (like Deepgram Voice Agent)
   * @param callId Call ID
   * @param conversationId Conversation ID
   */
  public handleAgentAudioDone(callId: string, conversationId: string): void {
    this.emitAudioEvent(callId, conversationId, 'agentAudioDone', {
      timestamp: Date.now().toString()
    });
    
    logger.debug(`Agent audio completed for call ${callId}`);
  }

  /**
   * Send audio response to Twilio (like Deepgram Voice Agent audio streaming)
   * @param callId Call ID
   * @param conversationId Conversation ID
   * @param audioBuffer Audio buffer to send
   */
  public sendAudioResponse(callId: string, conversationId: string, audioBuffer: Buffer): void {
    const connectionKey = `${callId}:${conversationId}`;
    const ws = this.activeConnections.get(connectionKey);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot send audio response - connection not available for call ${callId}`);
      return;
    }

    try {
      // Convert audio buffer to base64 for Twilio
      const audioPayload = audioBuffer.toString('base64');
      
      // Create Twilio media message
      const mediaMessage = {
        event: 'media',
        streamSid: `MZ${callId.substring(0, 32)}`,
        media: {
          track: 'outbound',
          chunk: Date.now().toString(),
          timestamp: Date.now().toString(),
          payload: audioPayload
        }
      };

      ws.send(JSON.stringify(mediaMessage));
      logger.debug(`Audio response sent to call ${callId}`, {
        audioSize: audioBuffer.length,
        payloadSize: audioPayload.length
      });

    } catch (error) {
      logger.error(`Error sending audio response to call ${callId}:`, error);
    }
  }
}

// Export singleton instance
let twilioWSServer: TwilioWebSocketServer | null = null;

export function initializeTwilioWebSocketServer(
  server: http.Server
): TwilioWebSocketServer {
  if (twilioWSServer) {
    twilioWSServer.close();
  }

  twilioWSServer = new TwilioWebSocketServer(server);
  return twilioWSServer;
}

export function getTwilioWebSocketServer(): TwilioWebSocketServer | null {
  return twilioWSServer;
}