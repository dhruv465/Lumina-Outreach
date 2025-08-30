import http from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { parse as parseUrl } from 'url';

// Extend WebSocket interface to include isAlive property
interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
}

type ConnectionState = {
  callId: string;
  conversationId: string;
  ws: WebSocket;
  createdAt: number;
  gotConnected: boolean;
  gotStart: boolean;
  streamSid?: string;
};

// Simple logger shim if a project-level logger isn't available
const logger = {
  info: (msg: string, meta?: any) => console.log(`info: ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: any) => console.warn(`warn: ${msg}`, meta ?? ""),
  error: (msg: string, meta?: any) => console.error(`error: ${msg}`, meta ?? ""),
  debug: (msg: string, meta?: any) => console.debug(`debug: ${msg}`, meta ?? ""),
};

class TwilioWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly active: Map<string, ConnectionState> = new Map();
  private readonly pathPrefix: string = '/voice/stream';
  private heartbeatInterval?: NodeJS.Timeout;

  // Optional feature flag to allow bi-directional outbound audio
  private readonly enableBidi: boolean = process.env.ENABLE_TWILIO_BIDI === 'true';

  // For Twilio Media Streams, outbound audio must be 8kHz PCMU (µ-law), ~20ms frames (160 samples)
  public static readonly OUTBOUND_SAMPLES_PER_FRAME = 160;

  constructor(private readonly server: http.Server) {
    // Use "noServer" mode so we can choose which upgrade requests to accept
    this.wss = new WebSocketServer({
      noServer: true,
      // Twilio sends 'audio' subprotocol
      handleProtocols: (protocols) => {
        // Handle both Set and Array formats
        let offered: string[] = [];
        try {
          if (Array.isArray(protocols)) {
            offered = protocols;
          } else if (protocols && typeof protocols[Symbol.iterator] === 'function') {
            offered = Array.from(protocols);
          } else if (protocols && typeof (protocols as any).forEach === 'function') {
            const tmp: string[] = [];
            (protocols as any).forEach((p: string) => tmp.push(p));
            offered = tmp;
          }
        } catch (err) {
          logger.warn('Error handling WebSocket protocols', { error: err });
          return false;
        }
        
        // Prefer 'audio' protocol for Twilio Media Streams
        if (offered.includes('audio')) return 'audio';
        
        // Accept any protocol if no 'audio' is offered
        return offered.length > 0 ? offered[0] : false;
      },
    });

    // Bind to HTTP upgrade
    this.server.on('upgrade', (request, socket, head) => {
      try {
        const upgradeHeader = (request.headers['upgrade'] || '').toString().toLowerCase();
        const connectionHeader = (request.headers['connection'] || '').toString().toLowerCase();
        const url = request.url || '/';
        const { pathname } = parseUrl(url);

        const isWs = upgradeHeader === 'websocket' && connectionHeader.includes('upgrade');
        const isValidPath = !!pathname && pathname.startsWith(this.pathPrefix);

        logger.info('WebSocket upgrade request intercepted', {
          upgradeHeader,
          connectionHeader,
          url,
          pathname,
          isValidPath,
        });

        // Only handle requests for our specific path prefix
        if (!isWs || !isValidPath) {
          // Don't handle this request - let other WebSocket servers handle it
          return;
        }

        // Expected pattern: /voice/stream/:callId/:conversationId
        const parts = pathname!.split('/').filter(Boolean); // ['voice','stream', callId, conversationId]
        if (parts.length !== 4 || parts[0] !== 'voice' || parts[1] !== 'stream') {
          logger.warn('Rejecting WS: unexpected path segments', { 
            pathname, 
            parts,
            expected: '/voice/stream/:callId/:conversationId'
          });
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        const callId = parts[2];
        const conversationId = parts[3];

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          // Build connection state first
          const key = `${callId}:${conversationId}`;
          const state: ConnectionState = {
            callId,
            conversationId,
            ws,
            createdAt: Date.now(),
            gotConnected: false,
            gotStart: false,
          };
          this.active.set(key, state);

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
          ws.on('pong', () => {
            (ws as ExtendedWebSocket).isAlive = true;
          });

          // Handle WebSocket open event
          ws.on('open', () => {
            logger.info('WebSocket connection opened', { callId, conversationId });
          });

          // Wire up events
          ws.on('message', (data: RawData) => {
            try {
              const text = data.toString('utf8');
              logger.debug('Received WebSocket message', { 
                callId, 
                conversationId, 
                messageLength: text.length,
                messagePreview: text.substring(0, 100)
              });
              
              const msg = JSON.parse(text);
              const ev = msg?.event;

              if (ev === 'connected') {
                state.gotConnected = true;
                logger.info('Twilio connected event', { callId, conversationId });
                
                // Send acknowledgment back to Twilio
                try {
                  ws.send(JSON.stringify({ event: 'connected' }));
                } catch (sendErr) {
                  logger.error('Failed to send connected acknowledgment', { error: sendErr });
                }
              } else if (ev === 'start') {
                state.gotStart = true;
                state.streamSid = msg?.start?.streamSid || msg?.streamSid;
                logger.info('Twilio start event', { callId, conversationId, streamSid: state.streamSid });

                // Flush any queued sends and allow outbound
                outboundReady = true;
                while (sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
                  const item = sendQueue.shift()!;
                  try { originalSend(item.data, item.options, item.cb); } catch {}
                }
              } else if (ev === 'media') {
                // Inbound 20ms media frame (base64 PCM µ-law).
                // You can forward to Deepgram here.
                // msg.media.payload (base64)
                logger.debug('Received media frame', { 
                  callId, 
                  conversationId, 
                  payloadLength: msg?.media?.payload?.length || 0 
                });
              } else if (ev === 'mark') {
                // optional marker
                logger.debug('Received mark event', { callId, conversationId, mark: msg?.mark });
              } else if (ev === 'stop') {
                logger.info('Twilio stop event', { callId, conversationId });
                ws.close();
              } else {
                // Unknown or app-specific event
                logger.debug('Unhandled Twilio WS event', { ev, callId, conversationId });
              }
            } catch (err: any) {
              logger.error('Failed to parse Twilio WS message', { 
                error: err?.message, 
                callId, 
                conversationId,
                rawData: data.toString('utf8').substring(0, 200)
              });
            }
          });

          ws.on('close', (code: number, reason: Buffer) => {
            const reasonStr = reason?.toString?.() || '';
            const duration = Date.now() - state.createdAt;
            
            logger.info('WebSocket connection closed', {
              code,
              reason: reasonStr,
              connectionDuration: duration,
              connectionKey: key,
              callId,
              conversationId,
              gotConnected: state.gotConnected,
              gotStart: state.gotStart,
              streamSid: state.streamSid
            });
            
            // Log specific close codes for debugging
            if (code === 1006) {
              logger.warn('WebSocket closed abnormally (1006) - possible network issue or protocol violation', {
                callId,
                conversationId,
                duration,
                gotConnected: state.gotConnected,
                gotStart: state.gotStart
              });
            } else if (code === 1002) {
              logger.error('WebSocket closed due to protocol error (1002)', {
                callId,
                conversationId,
                reason: reasonStr
              });
            }
            
            this.active.delete(key);
          });

          ws.on('error', (err: any) => {
            logger.error('Twilio WS error', { 
              message: (err && err.message) || String(err),
              callId,
              conversationId,
              error: err
            });
          });

          // Emit the connection event to the WebSocket server
          this.wss.emit('connection', ws, request);
          
          // Send a small keepalive to ensure connection stays open
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN && !state.gotConnected) {
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

    // Set up heartbeat to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const extWs = ws as ExtendedWebSocket;
        if (extWs.isAlive === false) {
          logger.warn('Terminating inactive WebSocket connection');
          return ws.terminate();
        }
        
        extWs.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    logger.info('Twilio WebSocket server initialized', { mode: 'noServer', serverCreated: true });
  }

  /** Optional helper to send an outbound PCMU frame (base64) after start */
  public sendUlawFrame(callId: string, conversationId: string, base64Ulaw: string) {
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

  /** Cleanup method to stop heartbeat and close connections */
  public cleanup() {
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
    
    // Close the WebSocket server
    this.wss.close();
  }
}

// Factory function to initialize the Twilio WebSocket server
export function initializeTwilioWebSocketServer(server: http.Server): TwilioWebSocketServer {
  return new TwilioWebSocketServer(server);
}

// Export the class as well for direct usage
export { TwilioWebSocketServer };
export default TwilioWebSocketServer;