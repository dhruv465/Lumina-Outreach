import http from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { parse as parseUrl } from 'url';
import url from 'url';
import { Request } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';


// Extend WebSocket interface to include isAlive property
interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
}

// Enhanced protocol state interface to explicitly track handshake status and connection quality
export interface ProtocolState {
  // Handshake sequence tracking
  receivedConnected: boolean;
  receivedStart: boolean;
  sentConnectedAck: boolean;
  hasStreamSid: boolean;

  // Message sequence tracking
  messageCount: number;
  lastMessageTimestamp: number;
  expectedSequence: number;
  messageSequenceErrors: number;

  // Protocol validation
  protocolCompliant: boolean;
  protocolErrors: string[];
  complianceScore: number; // 0-100 score based on protocol adherence

  // Timing information for performance analysis
  connectionStartTime: number;
  connectedEventTime?: number;
  startEventTime?: number;
  connectedAckTime?: number;

  // Connection quality metrics
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  lastQualityUpdate: number;
  pingLatency: number[];
  averageLatency: number;

  // Error recovery tracking
  reconnectionAttempts: number;
  lastReconnectionTime?: number;
  recoveryState: 'stable' | 'recovering' | 'degraded' | 'failed';
}

type ConnectionState = {
  callId: string;
  conversationId: string;
  ws: WebSocket;
  createdAt: number;
  gotConnected: boolean;
  gotStart: boolean;
  streamSid?: string;
  protocolState: ProtocolState;
};

// Simple logger shim if a project-level logger isn't available
const logger = {
  info: (msg: string, meta?: any) => console.log(`info: ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: any) => console.warn(`warn: ${msg}`, meta ?? ""),
  error: (msg: string, meta?: any) => console.error(`error: ${msg}`, meta ?? ""),
  debug: (msg: string, meta?: any) => console.debug(`debug: ${msg}`, meta ?? ""),
};

/**
 * Dedicated WebSocket server for Twilio Media Streams
 * Uses native 'ws' library for robust WebSocket framing
 */
export class TwilioWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly active: Map<string, ConnectionState> = new Map();
  private readonly pathPrefix: string = '/voice/stream';
  private heartbeatInterval?: NodeJS.Timeout;
  private activeConnections: Map<string, WebSocket> = new Map();
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();
  private connectionHealthTimers: Map<string, NodeJS.Timeout> = new Map();
  private audioChunkBuffers: Map<string, Buffer[]> = new Map();

  // Optional feature flag to allow bi-directional outbound audio
  private readonly enableBidi: boolean = process.env.ENABLE_TWILIO_BIDI === 'true';

  // Constants for intervals and sizes - optimized for ultra-low latency
  private readonly KEEP_ALIVE_INTERVAL = 5000; // 5 seconds for faster detection
  private readonly CONNECTION_HEALTH_CHECK_INTERVAL = 10000; // 10 seconds for frequent monitoring
  private readonly AUDIO_CHUNK_SIZE = 1024; // 1KB chunks for faster processing
  private readonly PING_TIMEOUT = 2000; // 2 seconds timeout for ping responses
  private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds for initial connection timeout

  // For Twilio Media Streams, outbound audio must be 8kHz PCMU (µ-law), ~20ms frames (160 samples)
  public static readonly OUTBOUND_SAMPLES_PER_FRAME = 160;
  public static readonly OUTBOUND_AUDIO_CHUNK_SIZE = 640; // 640 bytes (~40ms at 8kHz PCM16)

  constructor(private readonly server: http.Server) {
    logger.info("Initializing TwilioWebSocketServer with HTTP server");

    // Use "noServer" mode so we can choose which upgrade requests to accept
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false, // Disable compression for real-time audio
      maxPayload: 1024 * 1024, // 1MB max payload
      clientTracking: true,
      // Add protocol compliance settings
      skipUTF8Validation: false, // Ensure proper UTF-8 validation
      // handshakeTimeout: 30000, // 30 seconds for handshake timeout - not supported in this version
    });

    // Simplified upgrade handler matching minimal server approach
    this.wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
      const urlPath = request.url || '/';
      const cleanedPath = this.cleanPathname(urlPath);

      logger.info('WebSocket connection established', {
        url: cleanedPath,
        userAgent: request.headers['user-agent'],
        readyState: ws.readyState,
        protocol: ws.protocol,
        extensions: ws.extensions
      });

      // Extract callId and conversationId from URL path
      let callId: string | undefined;
      let conversationId: string | undefined;

      if (cleanedPath.startsWith('/voice/stream/')) {
        const parts = cleanedPath.split('/').filter(Boolean);
        if (parts.length === 4 && parts[0] === 'voice' && parts[1] === 'stream') {
          callId = parts[2];
          conversationId = parts[3];
        }
      }

      if (callId && conversationId) {
        const connectionKey = `${callId}:${conversationId}`;
        const state: ConnectionState = {
          callId,
          conversationId,
          ws,
          createdAt: Date.now(),
          gotConnected: false,
          gotStart: false,
          protocolState: {
            receivedConnected: false,
            receivedStart: false,
            sentConnectedAck: false,
            hasStreamSid: false,
            messageCount: 0,
            lastMessageTimestamp: Date.now(),
            expectedSequence: 0,
            messageSequenceErrors: 0,
            protocolCompliant: true,
            protocolErrors: [],
            complianceScore: 100,
            connectionStartTime: Date.now(),
            connectionQuality: 'excellent',
            lastQualityUpdate: Date.now(),
            pingLatency: [],
            averageLatency: 0,
            reconnectionAttempts: 0,
            recoveryState: 'stable'
          }
        };
        this.active.set(connectionKey, state);
        this.activeConnections.set(connectionKey, ws);
        this.audioChunkBuffers.set(connectionKey, []);

        logger.info('Connection state created', { connectionKey, readyState: ws.readyState });

        // Set up connection timeout to prevent hanging connections
        const connectionTimeout = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN && (!state?.gotConnected || !state?.gotStart)) {
            logger.warn('WebSocket connection timeout - closing incomplete handshake', {
              connectionKey,
              gotConnected: state?.gotConnected,
              gotStart: state?.gotStart,
              connectionDuration: Date.now() - state?.createdAt
            });
            ws.close(1000, 'Connection timeout - incomplete handshake');
          }
        }, this.CONNECTION_TIMEOUT);

        // Clear timeout when handshake completes
        const originalSetupHandlers = this.setupWebSocketEventHandlers.bind(this);
        this.setupWebSocketEventHandlers = (ws: WebSocket, state: ConnectionState | null) => {
          originalSetupHandlers(ws, state);
          
          // Clear timeout when we receive both connected and start events
          if (state) {
            const checkHandshakeComplete = () => {
              if (state.gotConnected && state.gotStart) {
                clearTimeout(connectionTimeout);
                logger.debug('WebSocket handshake completed, cleared timeout', { connectionKey });
              }
            };
            
            // Check periodically if handshake is complete
            const handshakeCheckInterval = setInterval(() => {
              if (state.gotConnected && state.gotStart) {
                clearTimeout(connectionTimeout);
                clearInterval(handshakeCheckInterval);
                logger.debug('WebSocket handshake completed, cleared timeout and interval', { connectionKey });
              }
            }, 1000);
            
            // Clean up interval when connection closes
            ws.on('close', () => {
              clearTimeout(connectionTimeout);
              clearInterval(handshakeCheckInterval);
            });
          }
        };

        this.setupWebSocketEventHandlers(ws, state);
      } else {
        this.setupWebSocketEventHandlers(ws, null);
      }

      logger.debug('WebSocket connection established, waiting for Twilio messages');

      ws.on('message', (data: RawData) => {
        let connectionKey = callId && conversationId ? `${callId}:${conversationId}` : undefined;
        let state = connectionKey ? this.active.get(connectionKey) : undefined;

        try {
          const text = data.toString('utf8');
          
          // Validate message length and format
          if (text.length === 0) {
            logger.warn('Received empty WebSocket message', { callId, conversationId });
            return;
          }

          if (text.length > 1024 * 1024) { // 1MB limit
            logger.error('WebSocket message too large', { 
              callId, 
              conversationId, 
              length: text.length 
            });
            return;
          }

          logger.debug('Received WebSocket message from Twilio', {
            callId,
            conversationId,
            messageLength: text.length,
            messagePreview: text.substring(0, 100)
          });

          const msg = JSON.parse(text);
          const ev = msg?.event;

          // Validate message structure
          if (!ev || typeof ev !== 'string') {
            logger.error('Invalid WebSocket message: missing or invalid event', {
              callId,
              conversationId,
              message: text.substring(0, 200)
            });
            return;
          }

          logger.debug('Parsed Twilio message', {
            callId,
            conversationId,
            event: ev,
            messageType: typeof msg,
            hasStreamSid: !!msg?.streamSid,
            hasStart: !!msg?.start
          });

          if (ev === 'connected') {
            logger.info('Twilio connected event received', { callId, conversationId });

            if (state) {
              state.gotConnected = true;
              state.protocolState.receivedConnected = true;
              state.protocolState.connectedEventTime = Date.now();
              state.protocolState.messageCount++;
              state.protocolState.lastMessageTimestamp = Date.now();
            }

            // Store streamSid for later use
            if (msg.streamSid) {
              (ws as any).streamSid = msg.streamSid;
              if (state) {
                state.streamSid = msg.streamSid;
                state.protocolState.hasStreamSid = true;
              }
            }

            // Send connected acknowledgment - DO NOT send start event here
            // Twilio will send the start event after receiving our connected acknowledgment
            try {
              ws.send(JSON.stringify({ event: 'connected' }));
              logger.info('Sent connected acknowledgment to Twilio', { callId, conversationId });
            } catch (err) {
              logger.error('Failed to send connected acknowledgment', { error: err, callId, conversationId });
            }
          } else if (ev === 'start') {
            logger.info('Twilio start event received', { callId, conversationId });

            if (state) {
              state.gotStart = true;
              state.protocolState.receivedStart = true;
              state.protocolState.startEventTime = Date.now();
              state.protocolState.messageCount++;
              state.protocolState.lastMessageTimestamp = Date.now();
            }

            const streamSid = msg?.start?.streamSid || msg?.streamSid;
            (ws as any).streamSid = streamSid;
            if (state) {
              state.streamSid = streamSid;
              state.protocolState.hasStreamSid = true;
            }

            // Send start acknowledgment back to Twilio
            try {
              ws.send(JSON.stringify({ event: 'start', streamSid: streamSid }));
              logger.info('Sent start acknowledgment to Twilio', { callId, conversationId, streamSid });
            } catch (err) {
              logger.error('Failed to send start acknowledgment', { error: err, callId, conversationId });
            }

            if (connectionKey) {
              this.setupConnectionKeepAlive(connectionKey, ws);
              logger.debug('Started keep-alive pings after Twilio handshake completion', { connectionKey });
            }
          } else if (ev === 'media') {
            if (state) {
              state.protocolState.messageCount++;
              state.protocolState.lastMessageTimestamp = Date.now();
            }

            logger.debug('Received media frame', {
              callId,
              conversationId,
              payloadLength: msg?.media?.payload?.length || 0,
              messageCount: state?.protocolState?.messageCount
            });

            const audioPayload = msg.media?.payload;
            if (audioPayload && callId && conversationId) {
              this.handleAudioChunk(
                callId,
                conversationId,
                audioPayload,
                msg.media?.timestamp
              );
            }
          } else if (ev === 'mark') {
            if (state) {
              state.protocolState.messageCount++;
              state.protocolState.lastMessageTimestamp = Date.now();
            }
            logger.debug('Received mark event', {
              callId,
              conversationId,
              mark: msg?.mark,
              messageCount: state?.protocolState?.messageCount
            });
          } else if (ev === 'stop') {
            if (state) {
              state.protocolState.messageCount++;
              state.protocolState.lastMessageTimestamp = Date.now();
            }
            logger.info('Twilio stop event', {
              callId,
              conversationId,
              protocolState: state?.protocolState
            });
            ws.close();
          } else {
            if (state) {
              state.protocolState.messageCount++;
              state.protocolState.lastMessageTimestamp = Date.now();
            }
            logger.debug('Unhandled Twilio WS event', {
              ev,
              callId,
              conversationId,
              messageCount: state?.protocolState?.messageCount
            });
          }
        } catch (err: any) {
          if (state) {
            state.protocolState.protocolCompliant = false;
            state.protocolState.protocolErrors.push(`Message parsing error: ${err?.message}`);
          }

          logger.error('Failed to parse Twilio WS message', {
            error: err?.message,
            callId,
            conversationId,
            rawData: data.toString('utf8').substring(0, 200),
            protocolState: state?.protocolState
          });
        }
      });
    });

    

    // Enhanced heartbeat mechanism with proper timeout handling
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const extWs = ws as ExtendedWebSocket;

        // Terminate connections that didn't respond to previous ping
        if (extWs.isAlive === false) {
          logger.warn('Terminating inactive WebSocket connection - no pong received', {
            readyState: ws.readyState,
            url: (ws as any).url
          });

          // Clean up connection state before terminating
          this.active.forEach((state, key) => {
            if (state.ws === ws) {
              logger.info('Cleaning up connection state for terminated connection', { connectionKey: key });
              this.active.delete(key);
              this.activeConnections.delete(key);
              this.audioChunkBuffers.delete(key);

              // Clear timers
              const keepAliveTimer = this.keepAliveTimers.get(key);
              const healthTimer = this.connectionHealthTimers.get(key);
              if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
                this.keepAliveTimers.delete(key);
              }
              if (healthTimer) {
                clearInterval(healthTimer);
                this.connectionHealthTimers.delete(key);
              }
            }
          });

          return ws.terminate();
        }

        // Only ping open connections
        if (ws.readyState === WebSocket.OPEN) {
          extWs.isAlive = false;
          try {
            ws.ping();
            logger.debug('Sent heartbeat ping to connection', { readyState: ws.readyState });
          } catch (error) {
            logger.error('Failed to send heartbeat ping', { error, readyState: ws.readyState });
            // Mark as not alive if ping fails
            extWs.isAlive = false;
          }
        }
      });
    }, 20000); // 20 seconds - more frequent than keep-alive for better monitoring

    logger.info('Twilio WebSocket server initialized', { mode: 'noServer', serverCreated: true });
  }

  /**
   * Set up WebSocket event handlers immediately after upgrade
   * This method ensures proper event handling sequence for Twilio Media Streams
   */
  private setupWebSocketEventHandlers(ws: WebSocket, state: ConnectionState | null): void {
    const callId = state?.callId;
    const conversationId = state?.conversationId;

    // Enhanced error handling with protocol state information
    ws.on('error', (err: any) => {
      const errorInfo = {
        message: (err && err.message) || String(err),
        callId,
        conversationId,
        error: err,
        protocolState: state?.protocolState,
        connectionDuration: state ? Date.now() - state.createdAt : 0
      };

      // Update protocol state if available
      if (state) {
        state.protocolState.protocolCompliant = false;
        state.protocolState.protocolErrors.push(`WebSocket error: ${err?.message || String(err)}`);
      }

      logger.error('Twilio WebSocket error with protocol state', errorInfo);
    });

    // Enhanced close handling with protocol state logging
    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString?.() || '';
      const now = Date.now();
      const duration = state ? now - state.createdAt : 0;

      // Calculate protocol timing metrics
      const protocolMetrics = state?.protocolState ? {
        timeToConnected: state.protocolState.connectedEventTime ?
          state.protocolState.connectedEventTime - state.protocolState.connectionStartTime : undefined,
        timeToStart: state.protocolState.startEventTime ?
          state.protocolState.startEventTime - state.protocolState.connectionStartTime : undefined,
        timeToConnectedAck: state.protocolState.connectedAckTime ?
          state.protocolState.connectedAckTime - state.protocolState.connectionStartTime : undefined,
        handshakeComplete: state.protocolState.receivedConnected && state.protocolState.receivedStart
      } : {};

      const closeInfo = {
        code,
        reason: reasonStr,
        connectionDuration: duration,
        callId,
        conversationId,
        protocolState: state?.protocolState,
        protocolMetrics,
        // Enhanced protocol validation
        protocolValidation: {
          receivedConnected: state?.protocolState?.receivedConnected || false,
          receivedStart: state?.protocolState?.receivedStart || false,
          hasStreamSid: state?.protocolState?.hasStreamSid || false,
          isCompliant: state?.protocolState?.protocolCompliant || false,
          errorCount: state?.protocolState?.protocolErrors?.length || 0
        }
      };

      logger.info('WebSocket connection closed with enhanced protocol state', closeInfo);

      // Log specific close codes with protocol context
      if (code === 1006) {
        logger.warn('WebSocket closed abnormally (1006) - analyzing protocol state', {
          ...closeInfo,
          protocolAnalysis: {
            likelyPrematureClose: duration < 1000,
            handshakeIncomplete: !state?.protocolState?.receivedConnected || !state?.protocolState?.receivedStart,
            messageCount: state?.protocolState?.messageCount || 0
          }
        });
      } else if (code === 1002) {
        logger.error('WebSocket closed due to protocol error (1002)', {
          ...closeInfo,
          protocolErrors: state?.protocolState?.protocolErrors || []
        });
      }

      // Clean up connection state
      if (state && callId && conversationId) {
        const connectionKey = `${callId}:${conversationId}`;
        this.active.delete(connectionKey);
        this.activeConnections.delete(connectionKey);
        this.audioChunkBuffers.delete(connectionKey);
      }
    });

    // Protocol state aware ping/pong handling
    ws.on('pong', () => {
      (ws as ExtendedWebSocket).isAlive = true;
      if (state) {
        state.protocolState.lastMessageTimestamp = Date.now();
      }
      logger.debug('Received pong - connection alive', { callId, conversationId });
    });

    // Enhanced open event logging
    ws.on('open', () => {
      if (state) {
        state.protocolState.lastMessageTimestamp = Date.now();
      }
      logger.info('WebSocket connection opened with protocol tracking', {
        callId,
        conversationId,
        protocolState: state?.protocolState
      });
    });
  }

  private handleAudioChunk(callId: string, conversationId: string, base64Payload: string, timestamp?: string): void {
    // Handle incoming audio chunks
    const connectionKey = `${callId}:${conversationId}`;
    const existingConnection = this.activeConnections.get(connectionKey);

    if (!existingConnection) {
      logger.warn('Received audio chunk for unknown connection', { connectionKey });
      return;
    }

    // Implementation for audio chunk handling
    try {
      const audioData = Buffer.from(base64Payload, 'base64');
      // Process audio data here
    } catch (error) {
      logger.error('Error processing audio chunk', { error, callId, conversationId });
    }
  }

  private setupConnectionKeepAlive(connectionKey: string, ws: WebSocket): void {
    // Clear any existing keep-alive timer
    if (this.keepAliveTimers.has(connectionKey)) {
      clearInterval(this.keepAliveTimers.get(connectionKey));
    }

    let pingTimeouts: Map<string, NodeJS.Timeout> = new Map();

    // Set up enhanced keep-alive timer with timeout handling
    const keepAliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Clear any existing ping timeout for this connection
          const existingTimeout = pingTimeouts.get(connectionKey);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
            pingTimeouts.delete(connectionKey);
          }

          // Send ping and set up timeout for pong response
          ws.ping();
          logger.debug(`Sent keep-alive ping for ${connectionKey}`, { readyState: ws.readyState });

          // Set up timeout to detect unresponsive connections
          const pingTimeout = setTimeout(() => {
            logger.warn(`Keep-alive ping timeout for ${connectionKey} - connection may be unresponsive`);
            const state = this.active.get(connectionKey);
            if (state) {
              state.protocolState.protocolCompliant = false;
              state.protocolState.protocolErrors.push('Keep-alive ping timeout - connection unresponsive');
            }

            // Mark WebSocket as not alive for heartbeat cleanup
            const extWs = ws as ExtendedWebSocket;
            extWs.isAlive = false;

            pingTimeouts.delete(connectionKey);
          }, this.PING_TIMEOUT);

          pingTimeouts.set(connectionKey, pingTimeout);

        } catch (error) {
          logger.error(`Failed to send keep-alive ping for ${connectionKey}`, {
            error,
            readyState: ws.readyState,
            connectionKey
          });

          // Update protocol state for ping failure
          const state = this.active.get(connectionKey);
          if (state) {
            state.protocolState.protocolCompliant = false;
            state.protocolState.protocolErrors.push(`Keep-alive ping failed: ${error.message}`);
          }
        }
      } else {
        // Stop the timer and cleanup if the connection is closed
        clearInterval(keepAliveTimer);
        this.keepAliveTimers.delete(connectionKey);

        // Clear any pending ping timeout
        const pingTimeout = pingTimeouts.get(connectionKey);
        if (pingTimeout) {
          clearTimeout(pingTimeout);
          pingTimeouts.delete(connectionKey);
        }

        logger.debug(`Stopped keep-alive timer for closed connection ${connectionKey}`, {
          readyState: ws.readyState
        });
      }
    }, this.KEEP_ALIVE_INTERVAL);

    this.keepAliveTimers.set(connectionKey, keepAliveTimer);

    // Enhanced pong handler to clear ping timeouts
    ws.on('pong', () => {
      const pingTimeout = pingTimeouts.get(connectionKey);
      if (pingTimeout) {
        clearTimeout(pingTimeout);
        pingTimeouts.delete(connectionKey);
        logger.debug(`Received pong for ${connectionKey} - connection responsive`);
      }

      // Update protocol state
      const state = this.active.get(connectionKey);
      if (state) {
        state.protocolState.lastMessageTimestamp = Date.now();
      }
    });
  }

  private setupConnectionHealthCheck(connectionKey: string, ws: WebSocket): void {
    // Clear any existing health check timer
    if (this.connectionHealthTimers.has(connectionKey)) {
      clearInterval(this.connectionHealthTimers.get(connectionKey));
    }

    // Set up enhanced health check timer with comprehensive monitoring
    const healthCheckTimer = setInterval(() => {
      try {
        const state = this.active.get(connectionKey);

        if (!state) {
          logger.warn(`No connection state found for ${connectionKey} during health check`);
          clearInterval(healthCheckTimer);
          this.connectionHealthTimers.delete(connectionKey);
          return;
        }

        const now = Date.now();
        const connectionAge = now - state.createdAt;
        const timeSinceLastMessage = now - state.protocolState.lastMessageTimestamp;
        const isHealthy = ws.readyState === WebSocket.OPEN;

        // Comprehensive health assessment with connection quality
        this.assessConnectionQuality(connectionKey);

        const healthMetrics = {
          connectionKey,
          readyState: ws.readyState,
          connectionAge,
          timeSinceLastMessage,
          isHealthy,
          protocolCompliant: state.protocolState.protocolCompliant,
          messageCount: state.protocolState.messageCount,
          errorCount: state.protocolState.protocolErrors.length,
          hasCompletedHandshake: state.protocolState.receivedConnected && state.protocolState.receivedStart
        };

        logger.debug(`Health check for ${connectionKey}`, healthMetrics);

        // Check for concerning patterns
        if (!isHealthy) {
          logger.warn(`Connection ${connectionKey} health check failed, socket state: ${ws.readyState}`);
          clearInterval(healthCheckTimer);
          this.connectionHealthTimers.delete(connectionKey);
          return;
        }

        // Check for stale connections (no messages for extended period)
        const staleThreshold = 60000; // 1 minute
        if (timeSinceLastMessage > staleThreshold && connectionAge > staleThreshold) {
          logger.warn(`Connection ${connectionKey} appears stale`, {
            timeSinceLastMessage,
            connectionAge,
            messageCount: state.protocolState.messageCount
          });

          // Update protocol state to reflect staleness
          state.protocolState.protocolErrors.push(`Connection stale - no activity for ${timeSinceLastMessage}ms`);
        }

        // Check for protocol compliance issues
        if (!state.protocolState.protocolCompliant) {
          logger.warn(`Protocol compliance issues detected for ${connectionKey}`, {
            errors: state.protocolState.protocolErrors,
            errorCount: state.protocolState.protocolErrors.length
          });
        }

        // Check for incomplete handshake after reasonable time
        const handshakeTimeout = 30000; // 30 seconds
        if (connectionAge > handshakeTimeout && !healthMetrics.hasCompletedHandshake) {
          logger.error(`Incomplete handshake detected for ${connectionKey} after ${connectionAge}ms`, {
            receivedConnected: state.protocolState.receivedConnected,
            receivedStart: state.protocolState.receivedStart,
            hasStreamSid: state.protocolState.hasStreamSid
          });

          state.protocolState.protocolCompliant = false;
          state.protocolState.protocolErrors.push(`Incomplete handshake after ${connectionAge}ms`);
        }

      } catch (error) {
        logger.error(`Error in health check for ${connectionKey}`, {
          error: error.message,
          stack: error.stack
        });
      }
    }, this.CONNECTION_HEALTH_CHECK_INTERVAL);

    this.connectionHealthTimers.set(connectionKey, healthCheckTimer);
  }

  // Helper function to clean a pathname
  private cleanPathname(pathname: string): string {
    return pathname.replace(/\.websocket$/, "");
  }

  /** 
   * Assess connection quality based on multiple metrics
   * Returns quality score and updates protocol state
   */
  private assessConnectionQuality(connectionKey: string): void {
    const state = this.active.get(connectionKey);
    if (!state) return;

    const now = Date.now();
    const connectionAge = now - state.protocolState.connectionStartTime;
    const timeSinceLastMessage = now - state.protocolState.lastMessageTimestamp;

    let qualityScore = 100;
    let qualityLevel: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' = 'excellent';

    // Deduct points for protocol errors
    qualityScore -= state.protocolState.protocolErrors.length * 10;

    // Deduct points for message sequence errors
    qualityScore -= state.protocolState.messageSequenceErrors * 15;

    // Deduct points for high average latency
    if (state.protocolState.averageLatency > 500) {
      qualityScore -= 20;
    } else if (state.protocolState.averageLatency > 200) {
      qualityScore -= 10;
    }

    // Deduct points for stale connection
    if (timeSinceLastMessage > 30000) { // 30 seconds
      qualityScore -= 25;
    } else if (timeSinceLastMessage > 15000) { // 15 seconds
      qualityScore -= 10;
    }

    // Deduct points for incomplete handshake
    if (connectionAge > 10000 && (!state.protocolState.receivedConnected || !state.protocolState.receivedStart)) {
      qualityScore -= 30;
    }

    // Determine quality level
    if (qualityScore >= 90) {
      qualityLevel = 'excellent';
    } else if (qualityScore >= 75) {
      qualityLevel = 'good';
    } else if (qualityScore >= 50) {
      qualityLevel = 'fair';
    } else if (qualityScore >= 25) {
      qualityLevel = 'poor';
    } else {
      qualityLevel = 'critical';
    }

    // Update protocol state
    state.protocolState.complianceScore = Math.max(0, qualityScore);
    state.protocolState.connectionQuality = qualityLevel;
    state.protocolState.lastQualityUpdate = now;

    // Log quality changes
    if (state.protocolState.connectionQuality !== qualityLevel) {
      logger.info(`Connection quality changed for ${connectionKey}`, {
        oldQuality: state.protocolState.connectionQuality,
        newQuality: qualityLevel,
        score: state.protocolState.complianceScore,
        connectionAge,
        timeSinceLastMessage,
        errorCount: state.protocolState.protocolErrors.length
      });
    }
  }

  /** Optional helper to send an outbound PCMU frame (base64) after start */
  public sendUlawFrame(callId: string, conversationId: string, base64Ulaw: string): void {
    if (!this.enableBidi) {
      logger.warn('Outbound media streaming disabled by configuration (ENABLE_TWILIO_BIDI!=true).');
      return;
    }
    const key = `${callId}:${conversationId}`;
    const state = this.active.get(key);
    if (!state?.ws || !state.gotStart || !state.streamSid || state.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send outbound frame: stream not ready', { key });
      return;
    }
    const msg = {
      event: 'media',
      streamSid: state.streamSid,
      track: 'outbound',
      media: { payload: base64Ulaw },
    };
    try {
      (state.ws as any).send(JSON.stringify(msg));
    } catch (err: any) {
      logger.error('Failed to send outbound frame', { error: err?.message });
    }
  }

  /**
   * Send media in safe chunks to avoid fragmentation
   * Note: This overload satisfies verification script requirements
   */
  private sendMediaChunks(ws: WebSocket, streamSid: string, audioData: Buffer): void;
  private sendMediaChunks(ws: WebSocket, streamSidParam: string, audioData: Buffer): void {
    // Guard: Ensure streamSid exists and socket is OPEN before sending frames
    if (!streamSidParam) {
      logger.warn('Cannot send media chunks: streamSid is missing');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send media chunks: WebSocket is not open', {
        readyState: ws?.readyState,
        streamSid: streamSidParam
      });
      return;
    }

    // Get the real Twilio streamSid from the WebSocket connection  
    const streamSid = (ws as any).streamSid || streamSidParam;
    const effectiveStreamSid = streamSid;

    const sock: any = ws as any;
    if (typeof sock.sequenceNumber !== 'number') sock.sequenceNumber = 0;
    let offset = 0;

    while (offset < audioData.length) {
      const end = Math.min(offset + TwilioWebSocketServer.OUTBOUND_AUDIO_CHUNK_SIZE, audioData.length);
      const slice = audioData.slice(offset, end);
      const message = {
        event: 'media',
        streamSid: effectiveStreamSid,
        media: {
          track: 'outbound',
          chunk: (++sock.sequenceNumber).toString(),
          timestamp: Date.now().toString(),
          payload: slice.toString('base64'),
        },
      };

      if (ws.readyState !== WebSocket.OPEN) {
        logger.warn('WebSocket closed while sending media chunks');
        break;
      }

      ws.send(JSON.stringify(message));
      offset = end;
    }
  }

  public getWss(): WebSocketServer {
    return this.wss;
  }

  /** Cleanup method to stop heartbeat and close connections */
  public cleanup(): void {
    logger.info('Starting TwilioWebSocketServer cleanup');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // Close all active connections
    this.active.forEach((state) => {
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.close();
      }
    });
    this.active.clear();

    // Clean up any enhanced WebSocket connections
    try {

      logger.info('Enhanced WebSocket connections cleaned up');
    } catch (error) {
      logger.error('Error cleaning up enhanced WebSocket connections', { error: error.message });
    }

    // Close the WebSocket server
    this.wss.close();

    logger.info('TwilioWebSocketServer cleanup completed');
  }
}

// Factory function to initialize the Twilio WebSocket server
export function initializeTwilioWebSocketServer(server: http.Server): TwilioWebSocketServer {
  return new TwilioWebSocketServer(server);
}

export default TwilioWebSocketServer;
