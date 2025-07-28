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

      // Handle both with and without .websocket suffix
      const normalizedPathname = pathname.replace(/\/\.websocket$/, "");

      const isValidPath =
        normalizedPathname.startsWith("/voice/optimized-stream") ||
        normalizedPathname.startsWith("/voice/low-latency") ||
        normalizedPathname.startsWith("/stream") ||
        pathname.includes(".websocket") ||
        pathname.includes("project-call-stream");

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
        } else if (message.event === 'start') {
          logger.info('Twilio Media Stream started', {
            callId,
            conversationId,
            streamSid: message.start?.streamSid
          });
        } else if (message.event === 'media') {
          // Handle incoming audio data
          logger.debug('Received audio data from Twilio', {
            callId,
            payloadSize: message.media?.payload?.length || 0,
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
    this.wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
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

        // Handle the optimized voice stream
        handleOptimizedVoiceStream(ws, mockReq as Request);

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
          // Remove from active connections
          const connectionKey = `${callId}:${conversationId}`;
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