import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastify from "fastify";

import dotenv from "dotenv";
import http from "http";
import mongoose from "mongoose";

import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { validateStartupConfig } from "./config/database-validation";
import { connectToDatabase } from "./database/connection";
import aiOrchestrationRoutes from "./routes/aiOrchestrationRoutes";
import analyticsRoutes from "./routes/analyticsRoutes";
import batchCallRoutes from "./routes/batchCallRoutes";
import callRoutes from "./routes/callRoutes";
import callFeedbackRoutes from "./routes/callFeedbackRoutes";
import campaignRoutes from "./routes/campaignRoutes";
import configurationRoutes from "./routes/configurationRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import debugRoutes from "./routes/debugRoutes";
import healthRoutes from "./routes/healthRoutes";
import knowledgeRoutes from "./routes/knowledgeRoutes";
import leadRoutes from "./routes/leadRoutes";
import livekitInternalRoutes from "./routes/livekitInternalRoutes";
import livekitWebhookRoutes from "./routes/livekitWebhookRoutes";
import { startLiveKitReconciliation } from "./integrations/livekit/reconciliationJob";
import performanceRoutes from "./routes/performanceRoutes";
import ragRoutes from "./routes/ragRoutes";
import userRoutes from "./routes/userRoutes";
import { getAIOrchestrationService } from "./services/aiOrchestrationService";
import { campaignService } from "./services";
import leadService from "./services/leadService";
import { getRAGSystem } from "./services/rag/ragSystem";
import { initCloudinary } from "./utils/cloudinaryService";

import { authenticate } from "./middleware/auth";

// Import centralized logger utilities
import logger, { phaseLogger } from "./utils/logger";

// Import performance monitoring
import { performanceMonitor } from "./utils/performanceMonitor";
import { cacheOnSendHook } from "./utils/responseCache";

// Load environment variables
dotenv.config();

// Initialize Sentry for Performance Monitoring and Error Tracking
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    // Tracing
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development',
  });
  logger.info('Sentry Initialized');
}

// Use phase-based logging for bootstrap phase
const bootstrapLogger = phaseLogger("BOOTSTRAP");

// Initialize fastify app
// Socket.IO will be attached to the same HTTP server
const app = fastify({
  serverFactory: (handler) => {
    const server = http.createServer(handler);
    return server;
  },
});

app.addHook('onRequest', (req, reply, done) => {
  if (req.raw.url.startsWith('/socket.io')) {
    reply.hijack();
    return;
  }
  done();
});

app.decorate("authenticate", authenticate);

const server = app.server;

// Initialize Socket.IO server with proper configuration
// Socket.IO will intercept /socket.io/ requests before Fastify
const io = new SocketIOServer(server, {
  path: '/socket.io/',
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || "120000"),
  pingInterval: parseInt(process.env.WS_PING_INTERVAL || "15000"),
  connectTimeout: parseInt(process.env.WS_CONNECT_TIMEOUT || "60000"),
  maxHttpBufferSize: 1e8, // 100MB max buffer size
  transports: ["websocket", "polling"],
  allowEIO3: true,
  serveClient: false,
});

// Enhanced middleware setup for production
const corsOrigin =
  process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:3000";
const isProduction = process.env.NODE_ENV === "production";

// Trust proxy configuration for accurate IP detection

// Add performance monitoring hooks (tracks all requests)
const perfHooks = performanceMonitor.createPerformanceHooks();
app.addHook('onRequest', perfHooks.onRequest);
app.addHook('onResponse', perfHooks.onResponse);

// Add response caching onSend hook (for routes that use cacheResponse)
app.addHook('onSend', cacheOnSendHook);

// CORS configuration
app.register(fastifyCors, {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  exposedHeaders: ["x-total-count", "x-page-count", "X-Cache"],
});

// Register formbody to parse x-www-form-urlencoded
app.register(require("@fastify/formbody"));

// Optimized Helmet configuration - CSP disabled for API-only server (significant performance gain)
// CSP is primarily for browser-rendered content, not needed for JSON APIs
app.register(fastifyHelmet, {
  contentSecurityPolicy: false, // Disabled - not needed for API endpoints
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false, // Only enable HSTS in production
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "same-origin" },
});

app.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public/audio'),
  prefix: '/audio',
});
app.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public/fallbacks'),
  prefix: '/fallbacks',
  decorateReply: false,
});

// Trust proxy in production


// Enhanced rate limiting
const rateLimitWindowMs = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || "900000"
); // 15 minutes
const rateLimitMax = parseInt(
  process.env.NODE_ENV === "development"
    ? "5000" // Much higher limit for development
    : process.env.RATE_LIMIT_MAX_REQUESTS || "100"
);

// Optimized rate limiting - only apply to API routes, not webhooks/websockets
// This prevents unnecessary rate limit checks on high-frequency real-time connections
app.register(fastifyRateLimit, {
  max: rateLimitMax,
  timeWindow: rateLimitWindowMs,
  global: false, // Changed to false - we'll apply selectively
  skipOnError: true, // Skip rate limiting if there's an error checking
});

// Strict rate limiter for authentication endpoints
const authLimitWindowMs = parseInt(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000"
); // 15 minutes
const authLimitMax = parseInt(
  process.env.NODE_ENV === "development"
    ? "100" // Much higher limit for development
    : process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || "15"
); // Increased default to 15

// Advanced rate limiter for API abuse prevention


// Enhanced health check route with system information


// Metrics endpoint removed

// LiveKit webhook (signature-authenticated, outside the /api JWT scope)
app.register(livekitWebhookRoutes, { prefix: "/webhooks" });

// LiveKit reconciliation: finalizes calls whose webhooks were missed
startLiveKitReconciliation();

// Consolidated API routes with shared rate limiting
// This groups all API routes together for better routing performance
app.register(async (apiRouter) => {
  // Apply rate limiting once for all API routes
  apiRouter.addHook('onRequest', async (request, reply) => {
    // Skip rate limiting for health checks
    if (request.url.includes('/health') || request.url.includes('/ready')) {
      return;
    }
  });

  // User routes with stricter rate limiting
  apiRouter.register(userRoutes, {
    prefix: "/users",
    rateLimit: {
      max: authLimitMax,
      timeWindow: authLimitWindowMs,
    },
  });

  // Core business logic routes
  apiRouter.register(leadRoutes, { prefix: "/leads" });
  apiRouter.register(campaignRoutes, { prefix: "/campaigns" });
  apiRouter.register(callRoutes, { prefix: "/calls" });
  apiRouter.register(batchCallRoutes, { prefix: "/batch-calls" });
  apiRouter.register(callFeedbackRoutes, { prefix: "/feedback" });
  apiRouter.register(dashboardRoutes, { prefix: "/dashboard" });
  apiRouter.register(configurationRoutes, { prefix: "/configuration" });
  apiRouter.register(analyticsRoutes, { prefix: "/analytics" });

  // AI routes
  apiRouter.register(aiOrchestrationRoutes, { prefix: "/ai-orchestration" });
  apiRouter.register(knowledgeRoutes, { prefix: "/knowledge" });
  apiRouter.register(ragRoutes, { prefix: "/rag" });

  // Internal service-to-service routes (LiveKit agent tools)
  apiRouter.register(livekitInternalRoutes, { prefix: "/internal/livekit" });


  // Health and monitoring routes
  apiRouter.register(healthRoutes, { prefix: "/" });

  // Performance monitoring routes
  apiRouter.register(performanceRoutes, { prefix: "/performance" });


  // Debug routes only in development
  if (process.env.NODE_ENV !== "production") {
    apiRouter.register(debugRoutes, { prefix: "/debug" });
  }
}, { prefix: "/api" });

// WebSocket routes already registered above with webhooks

// Enhanced global error handler
app.setErrorHandler((error, request, reply) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
  }

  const errorId = Math.random().toString(36).substring(7);

  logger.error("Unhandled error:", {
    errorId,
    message: error.message,
    stack: error.stack,
    url: request.url,
    method: request.method,
    ip: request.ip,
    userAgent: request.headers["user-agent"],
    timestamp: new Date().toISOString(),
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === "development";

  const errorResponse = {
    error: true,
    message: isDevelopment
      ? error.message
      : "An internal server error occurred",
    errorId,
    timestamp: new Date().toISOString(),
    ...(isDevelopment && {
      stack: error.stack,
      details: error,
    }),
  };

  const statusCode = error.statusCode || 500;
  reply.status(statusCode).send(errorResponse);
});

// 404 handler
app.setNotFoundHandler((request, reply) => {
  logger.warn(`404 - Route not found: ${request.method} ${request.url}`, {
    ip: request.ip,
    userAgent: request.headers["user-agent"],
  });

  reply.status(404).send({
    error: true,
    message: "Route not found",
    path: request.url,
    method: request.method,
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO connection handler
io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });

  // Handle real-time dashboard updates
  socket.on("join-dashboard", (userId) => {
    socket.join(`dashboard-${userId}`);
    logger.info(`User ${userId} joined dashboard room`);
  });

  // Handle real-time call monitoring
  socket.on("join-call-monitoring", (campaignId) => {
    socket.join(`campaign-${campaignId}`);
    logger.info(`Joined call monitoring for campaign ${campaignId}`);
  });

  // Handle user-specific notifications
  socket.on("join-user-room", (userId) => {
    socket.join(`user-${userId}`);
    logger.info(`User ${userId} joined notification room`);
  });
});

// Initialize services with configuration from database
const initializeServices = async () => {
  global.campaignService = campaignService;
  logger.info("Legacy voice pipeline services removed; initializing LiveKit-era services only");

  return {
    campaignService,
  };
};

// Enhanced server startup with production optimizations
const PORT = parseInt(process.env.PORT || "8000");
const HOST = process.env.HOST || "0.0.0.0";

const startServer = async () => {
  try {
    logger.info("Starting Lumina Outreach server...");

    // Step 1: Validate startup configuration (environment variables only)
    bootstrapLogger.info("Validating startup configuration...");
    const configValidation = validateStartupConfig();
    if (!configValidation.isValid) {
      bootstrapLogger.error(
        "Startup configuration validation failed:",
        configValidation
      );
      throw new Error(
        `Invalid startup configuration: ${configValidation.error}`
      );
    }
    bootstrapLogger.info("Startup configuration validation passed");

    // Step 2: Connect to database
    bootstrapLogger.info("Establishing database connection...");
    await connectToDatabase();

    // Step 2.1: Wait for database to be ready
    bootstrapLogger.info("Waiting for database to be ready...");
    const { waitForDatabaseConnection } = await import("./database/connection");
    await waitForDatabaseConnection();

    void import("./services/batchCallService")
      .then(({ batchCallService }) => batchCallService.resumeInterruptedBatches())
      .catch((e) => logger.error(`batch resume on boot failed: ${e.message}`));

    // Per-user BYO credentials are validated only in owner-scoped request
    // flows. Startup must never select an arbitrary tenant configuration.
    bootstrapLogger.info(
      "Skipping global provider validation; BYO credentials are owner-scoped"
    );

    // Switch to runtime phase logging after DB and config load
    const runtimeLogger = phaseLogger("RUNTIME");

    // Step 3: Initialize services with database-driven configuration
    runtimeLogger.info("Initializing application services...");

    // Initialize Cloudinary service
    initCloudinary();

    // Test Cloudinary connection
    const cloudinaryService = import("./utils/cloudinaryService").then(
      (m) => m.default
    );
    cloudinaryService.then((service) => {
      service.testCloudinaryConnection().then((cloudinaryWorks) => {
        runtimeLogger.info(
          `Cloudinary connection test result: ${cloudinaryWorks ? "SUCCESS" : "FAILED"
          }`
        );
      });
    });

    // Initialize services that load configuration from database
    await initializeServices();

    // Initialize post-database services
    const { initializeServicesAfterDB } = await import("./services");
    await initializeServicesAfterDB();

    // Initialize rate limiters for API providers
    try {
      const { getRateLimiter } = await import("./utils/rateLimiter");

      // Initialize rate limiters with appropriate limits
      // Google/Gemini - 15 requests per minute (free tier)
      getRateLimiter("google", { requestsPerMinute: 15, queueSize: 30 });

      // OpenAI - 60 requests per minute (default tier)
      getRateLimiter("openai", { requestsPerMinute: 60, queueSize: 30 });

      logger.info("Rate limiters initialized for API providers");
    } catch (error) {
      logger.error(`Error initializing rate limiters: ${error.message}`);
    }

    // Initialize AI Orchestration service with error handling
    try {
      const { getLLMService } = await import("./services");
      const llmService = getLLMService();
      const aiOrchestrationService = getAIOrchestrationService();
      const ragService = getRAGSystem();

      logger.info("AI Orchestration and RAG services initialized");
    } catch (error) {
      logger.error(
        `Failed to initialize AI Orchestration Service: ${getErrorMessage(
          error
        )}`
      );
    }

    try {
      const { getLLMService } = await import("./services");
      const llmService = getLLMService();
      const ragService = getRAGSystem();

      // Ensure RAG models are imported and registered
      await import("./models/KnowledgeBase");
      await import("./models/FAQ");
      await import("./models/Product");

      logger.info("RAG service initialized with models");
    } catch (error) {
      logger.error(
        `Failed to initialize RAG Service: ${getErrorMessage(error)}`
      );
    }

    logger.info("Services initialization completed");

    // Step 4: Start server
    app.listen({ port: PORT, host: HOST }, (err, address) => {
      if (err) {
        logger.error("Failed to start server:", {
          message: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
      logger.info(`Server listening at ${address}`);
    });

    // Handle server errors
    server.on("error", (error: any) => {
      if (error.syscall !== "listen") {
        throw error;
      }

      const bind = typeof PORT === "string" ? "Pipe " + PORT : "Port " + PORT;

      switch (error.code) {
        case "EACCES":
          logger.error(`${bind} requires elevated privileges`);
          process.exit(1);
        case "EADDRINUSE":
          logger.error(`${bind} is already in use`);
          process.exit(1);
        default:
          throw error;
      }
    });
  } catch (error) {
    logger.error("Failed to start server:", {
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

// Start the server
startServer();

// Enhanced process error handling and graceful shutdown
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  logger.error("Unhandled Promise Rejection:", {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString(),
  });

  // In production, don't exit immediately, but log and monitor
  if (process.env.NODE_ENV === "production") {
    // Give some time for the error to be logged
    setTimeout(() => {
      logger.error("Shutting down due to unhandled rejection");
      gracefulShutdown("UNHANDLED_REjection");
    }, 1000);
  } else {
    gracefulShutdown("UNHANDLED_REJECTION");
  }
});

process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception:", {
    message: error.message,
    stack: error.stack,
    name: error.name,
  });

  // For uncaught exceptions, we should exit
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// Graceful shutdown function
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  app.close(async () => {
    logger.info("HTTP server closed");

    try {
      // Stop temp file cleanup process
      const { TempFileCleanup } = require("./utils/tempFileCleanup");
      TempFileCleanup.stopPeriodicCleanup();

      // Perform final cleanup of temp files
      TempFileCleanup.emergencyCleanup();

      // Clean up enhanced WebSocket connections

      // Close database connections
      logger.info("Closing database connection...");
      await mongoose.connection.close();
      logger.info("Database connections closed");

      // Close Socket.IO connections
      io.close((err) => {
        if (err) {
          logger.error("Error closing Socket.IO:", err);
        } else {
          logger.info("Socket.IO server closed");
        }
      });

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (shutdownError) {
      logger.error("Error during graceful shutdown:", shutdownError);
      process.exit(1);
    }
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error("Graceful shutdown timeout, forcing exit");
    process.exit(1);
  }, 30000); // 30 seconds timeout
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle memory warnings
process.on("warning", (warning) => {
  logger.warn("Process warning:", {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
  });
});

// Create helper for error handling
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as any).message);
  }
  return "Unknown error occurred";
}

// Define global namespace for TypeScript
declare global {
  var modelRegistry: any;
  var campaignService: any;
}

export { app, campaignService, getErrorMessage, io, leadService, logger };
