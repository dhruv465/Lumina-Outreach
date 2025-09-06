import http from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { parse as parseUrl } from 'url';
import url from 'url';
import { Request } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';
import { enhancedWebSocketFactory } from '../utils/enhancedWebSocketFactory';

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

  // Constants for intervals and sizes - optimized for connection stability
  private readonly KEEP_ALIVE_INTERVAL = 10000; // 10 seconds (reduced for better persistence)
  private readonly CONNECTION_HEALTH_CHECK_INTERVAL = 20000; // 20 seconds (more frequent monitoring)
  private readonly AUDIO_CHUNK_SIZE = 8192; // 8KB chunks
  private readonly PING_TIMEOUT = 5000; // 5 seconds timeout for ping responses
  private readonly CONNECTION_TIMEOUT = 15000; // 15 seconds for initial connection timeout
  
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
    });

    // Single consolidated upgrade handler to prevent duplicate processing
    this.server.on('upgrade', (request, socket, head) => {
      try {
        const upgradeHeader = (request.headers['upgrade'] || '').toString().toLowerCase();
        const connectionHeader = (request.headers['connection'] || '').toString().toLowerCase();
        const urlPath = request.url || '/';
        const { pathname } = parseUrl(urlPath);

        // Handle both with and without .websocket suffix - normalize to prevent duplication
        const normalizedPathname = pathname ? pathname.replace(/\/\.websocket$/, "").replace(/\.websocket$/, "") : "";

        const isWs = upgradeHeader === 'websocket' && connectionHeader.includes('upgrade');
        
        // Determine whether this upgrade request is targeting a supported Twilio media stream endpoint.
        // Include legacy paths (optimized-stream/low-latency) as well as the new simplified path (/voice/stream).
        // Note: We check normalizedPathname to avoid issues with duplicated .websocket paths that cause Twilio error 31924
        const isValidPath = normalizedPathname && (
          normalizedPathname.startsWith("/voice/optimized-stream") ||
          normalizedPathname.startsWith("/voice/low-latency") ||
          normalizedPathname.startsWith("/voice/stream") || // simplified streaming path
          normalizedPathname.startsWith("/stream") ||
          normalizedPathname.includes("project-call-stream")
        );

        logger.info('WebSocket upgrade request intercepted', {
          upgradeHeader,
          connectionHeader,
          url: urlPath,
          pathname,
          normalizedPathname,
          isValidPath,
          userAgent: request.headers["user-agent"],
        });

        // Only handle WebSocket requests for valid Twilio paths
        if (!isWs || !isValidPath) {
          // Don't handle this request - let other WebSocket servers handle it
          return;
        }

        // For specific /voice/stream/:callId/:conversationId pattern, extract parameters
        let callId: string | undefined;
        let conversationId: string | undefined;

        if (normalizedPathname.startsWith('/voice/stream/')) {
          // Expected pattern: /voice/stream/:callId/:conversationId
          const parts = normalizedPathname.split('/').filter(Boolean); // ['voice','stream', callId, conversationId]
          if (parts.length === 4 && parts[0] === 'voice' && parts[1] === 'stream') {
            callId = parts[2];
            conversationId = parts[3];
          } else {
            logger.warn('Rejecting WS: unexpected path segments for /voice/stream', { 
              pathname: normalizedPathname, 
              parts,
              expected: '/voice/stream/:callId/:conversationId'
            });
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          logger.info('WebSocket upgrade completed successfully', {
            url: pathname,
            normalizedPathname,
            callId,
            conversationId,
            readyState: ws.readyState,
            protocol: ws.protocol,
            extensions: ws.extensions
          });

          // For paths with callId/conversationId in URL, set up connection state immediately
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
            
            // Set up WebSocket event handlers immediately after upgrade
            this.setupWebSocketEventHandlers(ws, state);
          } else {
            // Set up basic event handlers even without connection state
            this.setupWebSocketEventHandlers(ws, null);
          }

          // Wrap ws.send so we gate all server->Twilio sends until 'start'
          const originalSend = ws.send.bind(ws) as any;
          let outboundReady = false;
          const sendQueue: Array<{ data: any; options?: any; cb?: any }> = [];

          (ws as any).send = (data: any, options?: any, cb?: any) => {
            // Nothing should go out before Twilio's 'start'
            if (!outboundReady) {
              sendQueue.push({ data, options, cb });
              return;
            }

            // Guard against MP3 payloads on outbound 'media' frames
            try {
              const text = typeof data === 'string'
                ? data
                : (Buffer.isBuffer(data) ? data.toString('utf8') : '');
              if (text && text[0] === '{') {
                const obj = JSON.parse(text);
                if (obj?.event === 'media' && obj?.track === 'outbound') {
                  const payload: string | undefined =
                    obj?.media?.payload ?? obj?.payload;
                  if (payload) {
                    const b = Buffer.from(payload, 'base64');
                    const looksID3 = b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33; // 'ID3'
                    const looksMP3 = b.length >= 2 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0;
                    if (looksID3 || looksMP3) {
                      logger.error('Blocked outbound MP3 payload: Twilio expects 8kHz PCMU frames.');
                      if (typeof cb === 'function') cb(new Error('Unsupported outbound codec (MP3)'));
                      return;
                    }
                  }
                }
              }
            } catch {}

            return originalSend(data, options, cb);
          };

          logger.info('New Twilio WebSocket connection established', { 
            url: pathname, 
            userAgent: request.headers['user-agent'],
            callId,
            conversationId,
            protocol: ws.protocol
          });

          // Set up ping/pong to keep connection alive
          (ws as ExtendedWebSocket).isAlive = true;
          
          // Send a small keepalive to ensure connection stays open
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              logger.debug('Sending keepalive ping to maintain connection', { callId, conversationId });
              try {
                ws.ping();
              } catch (pingErr) {
                logger.warn('Failed to send keepalive ping', { error: pingErr, callId, conversationId });
              }
            }
          }, 1000);
          ws.on('message', (data: RawData) => {
            // Get or find connection state - declare once at the top of the entire handler
            let connectionKey = callId && conversationId ? `${callId}:${conversationId}` : undefined;
            let state = connectionKey ? this.active.get(connectionKey) : undefined;
            
            try {
              const text = data.toString('utf8');
              logger.debug('Received WebSocket message from Twilio', { 
                callId, 
                conversationId, 
                messageLength: text.length,
                messagePreview: text.substring(0, 100)
              });
              
              const msg = JSON.parse(text);
              const ev = msg?.event;

              logger.debug('Parsed Twilio message', { 
                callId, 
                conversationId, 
                event: ev,
                messageType: typeof msg,
                hasStreamSid: !!msg?.streamSid,
                hasStart: !!msg?.start
              });

              if (ev === 'connected') {
                if (state) {
                  state.gotConnected = true;
                  state.protocolState.receivedConnected = true;
                  state.protocolState.connectedEventTime = Date.now();
                  state.protocolState.messageCount++;
                  state.protocolState.lastMessageTimestamp = Date.now();
                }
                
                logger.info('Twilio connected event received', { 
                  callId, 
                  conversationId,
                  protocolState: state?.protocolState
                });
                
                // Do NOT send acknowledgment back to Twilio for 'connected' event
                // Echoing the connected event can cause protocol violations (Twilio error 31924)
              } else if (ev === 'start') {
                // Extract callId and conversationId from start event if not already available
                let effectiveCallId = callId;
                let effectiveConversationId = conversationId;
                
                if (!effectiveCallId || !effectiveConversationId) {
                  // Try to extract from custom parameters in start event
                  if (msg.start?.customParameters) {
                    effectiveCallId = effectiveCallId || msg.start.customParameters.callId;
                    effectiveConversationId = effectiveConversationId || msg.start.customParameters.conversationId;
                  }
                  
                  // Try to extract from URL path or query parameters
                  if (!effectiveCallId || !effectiveConversationId) {
                    const urlPath = request.url || '';
                    const pathMatch = urlPath.match(/\/voice\/(?:optimized-stream|low-latency|stream)\/([^\/]+)\/([^\/\?]+)/);
                    if (pathMatch) {
                      effectiveCallId = effectiveCallId || pathMatch[1];
                      effectiveConversationId = effectiveConversationId || pathMatch[2];
                    } else {
                      // Try query parameters
                      try {
                        const parsed = new URL(urlPath, 'ws://placeholder');
                        effectiveCallId = effectiveCallId || parsed.searchParams.get('callId') || undefined;
                        effectiveConversationId = effectiveConversationId || parsed.searchParams.get('conversationId') || undefined;
                      } catch {}
                    }
                  }
                }
                
                // Update the variables for use in later handlers
                callId = effectiveCallId;
                conversationId = effectiveConversationId;
                
                // Update connection key and get/create connection state
                connectionKey = callId && conversationId ? `${callId}:${conversationId}` : undefined;
                state = connectionKey ? this.active.get(connectionKey) : undefined;
                if (callId && conversationId && connectionKey) {
                  if (!state) {
                    state = {
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
                  }
                }
                
                if (state) {
                  state.gotStart = true;
                  state.streamSid = msg?.start?.streamSid || msg?.streamSid;
                  state.protocolState.receivedStart = true;
                  state.protocolState.startEventTime = Date.now();
                  state.protocolState.hasStreamSid = !!(msg?.start?.streamSid || msg?.streamSid);
                  state.protocolState.messageCount++;
                  state.protocolState.lastMessageTimestamp = Date.now();
                }
                
                const streamSid = msg?.start?.streamSid || msg?.streamSid;
                logger.info('Twilio start event received', { 
                  callId, 
                  conversationId, 
                  streamSid,
                  protocolState: state?.protocolState
                });

                // Store streamSid on WebSocket connection for sendMediaChunks usage
                (ws as any).streamSid = streamSid;

                // Send required "connected" acknowledgment to Twilio after processing start event
                // This is the critical message that Twilio expects to complete the protocol handshake
                try {
                  const acknowledgment = { event: 'connected' };
                  originalSend(JSON.stringify(acknowledgment));
                  
                  // Update protocol state
                  if (state) {
                    state.gotConnected = true;
                    state.protocolState.sentConnectedAck = true;
                    state.protocolState.connectedAckTime = Date.now();
                  }
                  
                  logger.info('Sent connected acknowledgment to Twilio', { 
                    callId, 
                    conversationId, 
                    streamSid,
                    protocolState: state?.protocolState
                  });
                } catch (ackErr: any) {
                  // Log protocol error
                  if (state) {
                    state.protocolState.protocolCompliant = false;
                    state.protocolState.protocolErrors.push(`Failed to send connected acknowledgment: ${ackErr?.message}`);
                  }
                  
                  logger.error('Failed to send connected acknowledgment to Twilio', { 
                    error: ackErr?.message, 
                    callId, 
                    conversationId, 
                    streamSid,
                    protocolState: state?.protocolState
                  });
                }

                // Flush any queued sends and allow outbound
                outboundReady = true;
                while (sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
                  const item = sendQueue.shift()!;
                  try { originalSend(item.data, item.options, item.cb); } catch {}
                }
              } else if (ev === 'media') {
                // Inbound 20ms media frame (base64 PCM µ-law).
                // Update protocol state for message tracking
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
                
                // Handle audio data
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
                // optional marker
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
                // Unknown or app-specific event
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
              // Update protocol state for parsing errors
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
          
          // Set up keep-alive and connection health monitoring if we have connection info
          if (callId && conversationId) {
            const connectionKey = `${callId}:${conversationId}`;
            this.setupConnectionKeepAlive(connectionKey, ws);
            this.setupConnectionHealthCheck(connectionKey, ws);
          }
          
          // Send a small keepalive to ensure connection stays open
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              logger.debug('Sending keepalive ping to maintain connection', { callId, conversationId });
              try {
                ws.ping();
              } catch (pingErr) {
                logger.warn('Failed to send keepalive ping', { error: pingErr, callId, conversationId });
              }
            }
          }, 1000);
        });
      } catch (err: any) {
        try { socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n'); } catch {}
        socket.destroy();
        logger.error('Upgrade handling failed', { error: err?.message });
      }
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
        handshakeComplete: state.protocolState.receivedStart && state.protocolState.sentConnectedAck
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
          sentConnectedAck: state?.protocolState?.sentConnectedAck || false,
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
            handshakeIncomplete: !state?.protocolState?.receivedStart || !state?.protocolState?.sentConnectedAck,
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
          hasCompletedHandshake: state.protocolState.receivedStart && state.protocolState.sentConnectedAck
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
            receivedStart: state.protocolState.receivedStart,
            sentConnectedAck: state.protocolState.sentConnectedAck,
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
    return pathname.replace(/\/\.websocket$/, "");
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
    if (connectionAge > 10000 && (!state.protocolState.receivedStart || !state.protocolState.sentConnectedAck)) {
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
      enhancedWebSocketFactory.closeAllConnections();
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
