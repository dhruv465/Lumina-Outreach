import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";

import fastifyWebsocket from "@fastify/websocket";
import http from "http";
import dotenv from "dotenv";
import mongoose from "mongoose";

import path from "path";
import { Server as SocketIOServer } from "socket.io";
import aiOrchestrationRoutes from "./routes/aiOrchestrationRoutes";
import aiRoutes from "./routes/aiRoutes";
import analyticsRoutes from "./routes/analyticsRoutes";
import callRoutes from "./routes/callRoutes";
import campaignRoutes from "./routes/campaignRoutes";
import configurationRoutes from "./routes/configurationRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import debugRoutes from "./routes/debugRoutes";
import deepgramTestRoutes, {
  setupDeepgramWebSocketServer,
} from "./routes/deepgramTestRoutes";
import deepgramTTSRoutes from "./routes/deepgramTTSRoutes";
import streamingTTSRoutes from "./routes/streamingTTSRoutes";
import sttRoutes from "./routes/sttRoutes";
import knowledgeRoutes from "./routes/knowledgeRoutes";
import leadRoutes from "./routes/leadRoutes";
import ragRoutes from "./routes/ragRoutes";
import ttsProviderRoutes from "./routes/ttsProviderRoutes";
import enhancedRealTimeRoutes from "./routes/enhancedRealTimeRoutes";
import rootWebhookRoutes from "./routes/rootWebhookRoutes";
import streamRoutes from "./routes/streamRoutes";
import telephonyRoutes from "./routes/telephonyRoutes";
import transcriptionRoutes from "./routes/transcriptionRoutes";
import userRoutes from "./routes/userRoutes";
import voiceAIRoutes from "./routes/voiceAIRoutes";
import healthRoutes from "./routes/healthRoutes";
import audioStreamingRoutes from "./routes/audioStreamingRoutes";
import { TwilioStreamHandler } from "./services/twilioStreamHandler";
import { getAIOrchestrationService } from "./services/aiOrchestrationService";
import { AudioStreamingService } from "./services/audioStreamingService";
import CampaignService from "./services/campaignService";
import ConversationEngineService from "./services/conversationEngineService";
import { EnhancedVoiceAIService } from "./services/enhancedVoiceAIService";
import leadService from "./services/leadService";
import { LLMService } from "./services/llm/service";
import { getRAGSystem } from "./services/rag/ragSystem";
import { initializeSpeechService } from "./services/realSpeechService";
import SpeechAnalysisService from "./services/speechAnalysisService";
import { validateStartupConfig } from "./config/database-validation";
import { connectToDatabase } from "./database/connection";
import { healthCheckHandler, readinessCheckHandler } from "./health/service";
import { initCloudinary } from "./utils/cloudinaryService";

import { authenticate } from "./middleware/auth";

// Import centralized logger utilities
import logger, { phaseLogger } from "./utils/logger";

// Load environment variables
dotenv.config();

// Use phase-based logging for bootstrap phase
const bootstrapLogger = phaseLogger("BOOTSTRAP");

// Initialize fastify app
const app = fastify({
  serverFactory: (handler) => {
    const server = http.createServer((req, res) => {
      handler(req, res);
    });

    return server;
  },
});

app.decorate("authenticate", authenticate);

const server = app.server;
// Find this section in your index.ts file:

// Initialize Socket.IO server first (before other WebSocket servers)
// Configure it to avoid conflicts with Twilio Media Streams
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || "120000"), // Use environment variable or default to 120 seconds
  pingInterval: parseInt(process.env.WS_PING_INTERVAL || "15000"), // Use environment variable or default to 15 seconds
  connectTimeout: parseInt(process.env.WS_CONNECT_TIMEOUT || "60000"), // Use environment variable or default to 60 seconds
  maxHttpBufferSize: 1e8, // 100MB max buffer size for larger audio chunks
  transports: ["websocket", "polling"], // Prefer WebSocket, fallback to polling
  // Configure Socket.IO to avoid interfering with Twilio Media Streams
  allowEIO3: true, // Allow Engine.IO v3 clients
  serveClient: false, // Don't serve the client files
});

// Initialize Audio Streaming Service
const audioStreamingService = new AudioStreamingService(io);

// Initialize Deepgram WebSocket server (it's a 'ws' server instance)
const deepgramWss = setupDeepgramWebSocketServer(server);
bootstrapLogger.info("Deepgram WebSocket server initialized");

// Register fastify-websocket plugin
app.register(fastifyWebsocket);

// Setup WebSocket routes
app.register(async function (fastify) {
  // Handle Twilio Media Streams
  fastify.get('/voice/stream/:callId/:conversationId', { websocket: true }, (connection, req) => {
    new TwilioStreamHandler(connection, req.raw);
  });

  // Handle Deepgram connections
  fastify.get('/api/deepgram/ws', { websocket: true }, (connection, req) => {
    deepgramWss.emit('connection', connection.socket, req.raw);
  });
});

// Enhanced middleware setup for production
const corsOrigin =
  process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:3000";
const isProduction = process.env.NODE_ENV === "production";

// Trust proxy configuration for accurate IP detection


// CORS configuration
app.register(fastifyCors, {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  exposedHeaders: ["x-total-count", "x-page-count"],
});

// Register formbody to parse x-www-form-urlencoded
app.register(require("@fastify/formbody"));

app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "data:"],
      fontSrc: ["'self'", "https:", "data:", "blob:"],
      imgSrc: ["'self'", "https:", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "https:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
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

// Global rate limiter
app.register(fastifyRateLimit, {
  max: rateLimitMax,
  timeWindow: rateLimitWindowMs,
  global: true,
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

// API Routes with enhanced security and monitoring
app.register(rootWebhookRoutes, { prefix: "/" });

// API Routes
app.register(userRoutes, {
  prefix: "/api/users",
  rateLimit: {
    max: authLimitMax,
    timeWindow: authLimitWindowMs,
  },
});
app.register(leadRoutes, { prefix: "/api/leads" });
app.register(campaignRoutes, { prefix: "/api/campaigns" });
app.register(callRoutes, { prefix: "/api/calls" });
app.register(dashboardRoutes, { prefix: "/api/dashboard" });
app.register(configurationRoutes, { prefix: "/api/configuration" });
app.register(voiceAIRoutes, { prefix: "/api/lumina-outreach" });
app.register(telephonyRoutes, { prefix: "/api/telephony" });
app.register(analyticsRoutes, { prefix: "/api/analytics" });
app.register(aiRoutes, { prefix: "/api/ai" }); // Core AI routes
app.register(aiOrchestrationRoutes, { prefix: "/api/ai-orchestration" }); // AI orchestration layer routes
app.register(knowledgeRoutes, { prefix: "/api/knowledge" }); // Knowledge management routes
app.register(ragRoutes, { prefix: "/api/rag" }); // RAG (Retrieval-Augmented Generation) routes
app.register(transcriptionRoutes, { prefix: "/api/transcription" });
app.get("/api/deepgram-metrics", (req, res) => {
  res
    .status(503)
    .send({ error: "Deepgram metrics service temporarily unavailable" });
}); // Temporarily disabled Deepgram metrics routes
// Monitoring API routes removed
app.register(deepgramTestRoutes, { prefix: "/api/deepgram" }); // Deepgram testing routes
app.register(deepgramTTSRoutes, { prefix: "/api/deepgram-tts" }); // Deepgram TTS routes
app.register(streamingTTSRoutes, { prefix: "/api/streaming-tts" }); // Streaming TTS routes
app.register(sttRoutes, { prefix: "/api/stt" }); // Speech-to-Text testing routes
app.register(ttsProviderRoutes, { prefix: "/api/tts-provider" }); // TTS Provider management routes
app.register(enhancedRealTimeRoutes, { prefix: "/api/realtime" }); // Enhanced real-time call functionality
app.register(healthRoutes, { prefix: "/api" }); // Health monitoring and resilience routes
app.register(audioStreamingRoutes, { prefix: '/api/audio-streaming', audioStreamingService });

// Debug routes only in development
if (process.env.NODE_ENV !== "production") {
  app.register(debugRoutes, { prefix: "/api/debug" });
}

// Add optimized stream route

// WebSocket routes
app.register(streamRoutes, { prefix: "/" });

// Enhanced global error handler
app.setErrorHandler((error, request, reply) => {
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
  logger.warn(`404 - Route not found: ${request.method} ${request.raw.originalUrl}`, {
    ip: request.ip,
    userAgent: request.headers["user-agent"],
  });

  reply.status(404).send({
    error: true,
    message: "Route not found",
    path: request.raw.originalUrl,
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
  try {
    // Get configuration from database
    const Configuration = require("./models/Configuration").default;
    const config = await Configuration.findOne();

    let elevenLabsApiKey = "";
    let openAIApiKey = "";
    let anthropicApiKey = "";
    let googleSpeechApiKey = "";
    let deepgramApiKey = "";

    // If configuration exists, use it; otherwise use empty keys (no environment fallback)
    if (config) {
      logger.info("Using API configuration from database");

      // ElevenLabs
      elevenLabsApiKey = config.elevenLabsConfig?.apiKey || "";

      // LLM providers
      const openAIProvider = config.llmConfig?.providers?.find(
        (p: any) => p.name === "openai"
      );
      openAIApiKey = openAIProvider?.apiKey || "";

      const anthropicProvider = config.llmConfig?.providers?.find(
        (p: any) => p.name === "anthropic"
      );
      anthropicApiKey = anthropicProvider?.apiKey || "";

      // Google (if configured)
      const googleProvider = config.llmConfig?.providers?.find(
        (p: any) => p.name === "google"
      );
      googleSpeechApiKey = googleProvider?.apiKey || "";

      // Deepgram for STT (Nova-2) - now purely database-driven
      deepgramApiKey = config.deepgramConfig?.apiKey || "";
      logger.info(
        "Deepgram API key " +
          (deepgramApiKey ? "found" : "not found") +
          " in database configuration"
      );

      // Initialize and validate Deepgram auto-configuration with graceful startup
      if (deepgramApiKey) {
        try {
          logger.info("Initializing Deepgram auto-configuration service...");
          const { getDeepgramAutoConfigService } = await import(
            "./services/deepgramAutoConfigService"
          );
          const autoConfigService = getDeepgramAutoConfigService();
          await autoConfigService.initialize(deepgramApiKey);

          // Perform graceful startup validation that won't fail the server
          logger.info("Performing graceful Deepgram startup validation...");
          const gracefulResult =
            await autoConfigService.performGracefulStartupValidation();

          if (gracefulResult.success) {
            logger.info(
              `Deepgram startup validation successful: ${gracefulResult.message}`
            );

            // Log details about the configuration
            if (gracefulResult.autoConfigResult) {
              logger.info("Auto-configuration details:", {
                model: gracefulResult.autoConfigResult.model,
                accountTier: gracefulResult.autoConfigResult.accountTier,
                availableModels:
                  gracefulResult.autoConfigResult.availableModels.length,
                warnings: gracefulResult.autoConfigResult.warnings,
              });

              // Update deepgramApiKey reference for service initialization
              const updatedConfig = await Configuration.findOne();
              if (updatedConfig?.deepgramConfig?.apiKey) {
                deepgramApiKey = updatedConfig.deepgramConfig.apiKey;
              }
            }
          } else {
            logger.warn(
              `Deepgram startup validation issues: ${gracefulResult.message}`
            );

            // Log validation details for troubleshooting
            if (gracefulResult.validationResult) {
              logger.warn("Validation details:", {
                model: gracefulResult.validationResult.model,
                error: gracefulResult.validationResult.error,
                suggestedAction:
                  gracefulResult.validationResult.suggestedAction,
              });
            }

            if (
              gracefulResult.autoConfigResult &&
              !gracefulResult.autoConfigResult.success
            ) {
              logger.warn("Auto-configuration failed:", {
                error: gracefulResult.autoConfigResult.error,
                warnings: gracefulResult.autoConfigResult.warnings,
              });
            }

            // Server continues regardless - graceful degradation
            logger.info("Server will continue with Deepgram in degraded mode");
          }

          // Always start background validation if possible
          try {
            autoConfigService.startBackgroundValidation();
            logger.info("Deepgram background validation started");
          } catch (bgError) {
            logger.warn(
              `Failed to start background validation: ${getErrorMessage(
                bgError
              )}`
            );
          }
        } catch (error) {
          logger.error(
            `Deepgram auto-configuration initialization failed: ${getErrorMessage(
              error
            )}`
          );
          logger.warn(
            "Deepgram services will start without auto-configuration"
          );
          logger.info(
            "Manual configuration may be required via the Configuration page"
          );

          // Server continues even if initialization completely fails
          logger.info(
            "Server startup continuing without Deepgram auto-configuration"
          );
        }
      } else {
        logger.info(
          "No Deepgram API key found - Deepgram services will be disabled"
        );
        logger.info("To enable speech-to-text functionality:");
        logger.info("1. Configure Deepgram API key in the Configuration page");
        logger.info(
          "2. The system will automatically detect optimal model settings"
        );
        logger.info(
          "3. Background validation will ensure continued compatibility"
        );
      }
    } else {
      logger.info(
        "No configuration found in database, all services will start with empty configuration"
      );
      logger.info(
        "API keys can be configured dynamically through the web interface"
      );
      // No environment variable fallbacks - system is now fully dynamic
      elevenLabsApiKey = "";
      openAIApiKey = "";
      anthropicApiKey = "";
      googleSpeechApiKey = "";
      deepgramApiKey = "";
    }

    // Speech synthesis service
    const speechService = initializeSpeechService(
      elevenLabsApiKey,
      path.join(__dirname, "../uploads/audio")
    );

    // Get the selected TTS provider from configuration
    const selectedTTSProvider = config?.ttsConfig?.provider || "elevenlabs";
    logger.info(
      `Initializing services for selected TTS provider: ${selectedTTSProvider}`
    );

    // Import TTS configuration helper
    const { isTTSProviderConfigured } = await import(
      "./utils/ttsServiceFactory"
    );
    const isSelectedTTSConfigured = isTTSProviderConfigured(config);

    // Initialize Enhanced Voice AI Service only if ElevenLabs is the selected TTS provider AND properly configured
    let enhancedVoiceAI;
    if (
      selectedTTSProvider === "elevenlabs" &&
      isSelectedTTSConfigured &&
      elevenLabsApiKey
    ) {
      enhancedVoiceAI = new EnhancedVoiceAIService(elevenLabsApiKey);
      logger.info("ElevenLabs Enhanced Voice AI Service initialized");
    } else {
      // Create a minimal service instance for compatibility
      enhancedVoiceAI = new EnhancedVoiceAIService("");
      if (selectedTTSProvider !== "elevenlabs") {
        logger.info(
          `Skipping ElevenLabs service initialization - selected TTS provider is ${selectedTTSProvider}`
        );
      } else if (!isSelectedTTSConfigured) {
        logger.warn(
          "ElevenLabs selected as TTS provider but not properly configured"
        );
      } else {
        logger.warn(
          "ElevenLabs selected as TTS provider but no API key available"
        );
      }
    }

    // Initialize Deepgram TTS service if it's the selected provider or as fallback
    const shouldInitializeDeepgramAsSelected =
      selectedTTSProvider === "deepgram" &&
      isSelectedTTSConfigured &&
      deepgramApiKey;
    const shouldInitializeDeepgramAsFallback =
      selectedTTSProvider !== "deepgram" && deepgramApiKey;

    if (shouldInitializeDeepgramAsSelected) {
      try {
        const { initializeDeepgramTTS } = await import(
          "./services/deepgramTTSService"
        );
        initializeDeepgramTTS(deepgramApiKey);
        logger.info("Deepgram TTS service initialized as primary TTS provider");
        
        // Initialize streaming TTS service
        const { initializeStreamingTTS } = await import(
          "./services/streamingTTSService"
        );
        initializeStreamingTTS(deepgramApiKey);
        logger.info("Streaming TTS service initialized successfully");
      } catch (error) {
        logger.warn(
          `Failed to initialize Deepgram TTS service: ${getErrorMessage(error)}`
        );
      }
    } else if (shouldInitializeDeepgramAsFallback) {
      try {
        const { initializeDeepgramTTS } = await import(
          "./services/deepgramTTSService"
        );
        initializeDeepgramTTS(deepgramApiKey);
        logger.info(
          "Deepgram TTS service initialized as fallback for voice synthesis"
        );
        
        // Initialize streaming TTS service
        const { initializeStreamingTTS } = await import(
          "./services/streamingTTSService"
        );
        initializeStreamingTTS(deepgramApiKey);
        logger.info("Streaming TTS service initialized as fallback");
      } catch (error) {
        logger.warn(
          `Failed to initialize Deepgram TTS service: ${getErrorMessage(error)}`
        );
      }
    } else {
      if (selectedTTSProvider === "deepgram" && !isSelectedTTSConfigured) {
        logger.warn(
          "Deepgram selected as TTS provider but not properly configured"
        );
      } else if (selectedTTSProvider === "deepgram" && !deepgramApiKey) {
        logger.warn(
          "Deepgram selected as TTS provider but no API key available"
        );
      } else {
        logger.info(
          "Deepgram TTS service not initialized - not selected and no API key for fallback"
        );
      }
    }

    // Initialize Deepgram STT service if API key is available
    if (deepgramApiKey) {
      try {
        const { initializeDeepgramService } = await import(
          "./services/deepgramService"
        );
        initializeDeepgramService(deepgramApiKey);
        logger.info("Deepgram STT service initialized successfully");
      } catch (error) {
        logger.warn(
          `Failed to initialize Deepgram STT service: ${getErrorMessage(error)}`
        );
      }
    } else {
      logger.warn(
        "Deepgram STT service not initialized - no API key available"
      );
    }

    // Initialize TTS Provider Service
    try {
      const { initializeTTSProviderService } = await import(
        "./services/ttsProviderService"
      );
      initializeTTSProviderService();
      logger.info("TTS Provider Service initialized");
    } catch (error) {
      logger.warn(
        `Failed to initialize TTS Provider Service: ${getErrorMessage(error)}`
      );
    }

    // Conversation engine
    const conversationEngine = new ConversationEngineService(
      enhancedVoiceAI,
      new SpeechAnalysisService(
        openAIApiKey,
        googleSpeechApiKey,
        deepgramApiKey
      ),
      new LLMService({
        providers: [
          {
            name: "openai",
            apiKey: openAIApiKey,
            isEnabled: true,
          },
          {
            name: "google",
            apiKey: googleSpeechApiKey,
            isEnabled: true,
          },
          {
            name: "anthropic",
            apiKey: anthropicApiKey,
            isEnabled: true,
          },
        ],
        defaultProvider: "openai",
      })
    );

    // Campaign service
    const campaignService = new CampaignService(
      openAIApiKey,
      anthropicApiKey,
      googleSpeechApiKey,
      deepgramApiKey
    );

    // Initialize RealTelephonyService with configuration
    try {
      const {
        initializeTelephonyService,
      } = require("./services/realTelephonyService");

      // Get Twilio configuration from database or environment
      const twilioAccountSid =
        config?.twilioConfig?.accountSid ||
        process.env.TWILIO_ACCOUNT_SID ||
        "";
      const twilioAuthToken =
        config?.twilioConfig?.authToken || process.env.TWILIO_AUTH_TOKEN || "";
      const webhookBaseUrl =
        process.env.WEBHOOK_BASE_URL ||
        process.env.API_BASE_URL ||
        "http://localhost:8000";

      if (twilioAccountSid && twilioAuthToken) {
        initializeTelephonyService({
          accountSid: twilioAccountSid,
          authToken: twilioAuthToken,
          webhookBaseUrl: webhookBaseUrl,
        });
        logger.info("Real telephony service initialized successfully");
      } else {
        logger.warn(
          "Twilio credentials not found - telephony service will be unavailable"
        );
        logger.info(
          "To enable telephony features, configure Twilio credentials in the Configuration page"
        );
      }
    } catch (error) {
      logger.error("Failed to initialize telephony service:", error);
      logger.warn("Telephony features will be unavailable");
    }

    // Export services
    global.speechService = speechService;
    global.conversationEngine = conversationEngine;
    global.campaignService = campaignService;

    return {
      speechService,
      conversationEngine,
      campaignService,
    };
  } catch (error) {
    logger.error("Error initializing services:", error);
    throw error;
  }
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

    // Step 2.5: Validate database-loaded configuration (optional)
    bootstrapLogger.info("Validating database configuration...");
    let config = null;
    let activeProviders = { tts: "unknown", llm: [], optionalMissing: [] };

    try {
      const { validateDatabaseLoadedConfig, validateDeepgramStartupConfig } =
        await import("./config/database-validation");
      const Configuration = require("./models/Configuration").default;
      config = await Configuration.findOne();

      const dbConfigValidation = validateDatabaseLoadedConfig(config);
      if (!dbConfigValidation.isValid) {
        bootstrapLogger.warn(
          "Database configuration has issues:",
          dbConfigValidation.error
        );
        bootstrapLogger.warn(
          "Services will start with limited functionality. Configure API keys in the Configuration page."
        );

        // Log warnings if they exist
        if (dbConfigValidation.details?.warnings) {
          dbConfigValidation.details.warnings.forEach((warning: string) => {
            bootstrapLogger.warn(`Configuration warning: ${warning}`);
          });
        }
      } else {
        bootstrapLogger.info("Database configuration is valid");

        // Log warnings even for valid configurations
        if (dbConfigValidation.details?.warnings) {
          dbConfigValidation.details.warnings.forEach((warning: string) => {
            bootstrapLogger.warn(`Configuration warning: ${warning}`);
          });
        }
      }

      // Perform specific Deepgram startup validation
      if (config?.deepgramConfig) {
        bootstrapLogger.info(
          "Performing Deepgram-specific startup validation..."
        );
        const deepgramValidation = validateDeepgramStartupConfig(
          config.deepgramConfig
        );

        if (!deepgramValidation.isValid) {
          bootstrapLogger.warn(
            `Deepgram startup validation failed: ${deepgramValidation.error}`
          );
          bootstrapLogger.info(
            "Auto-configuration will attempt to resolve these issues during service initialization"
          );
        } else {
          bootstrapLogger.info("Deepgram startup validation passed");
          if (deepgramValidation.details) {
            bootstrapLogger.info(
              "Deepgram validation details:",
              deepgramValidation.details
            );
          }
        }
      }

      // Determine active providers for summary
      if (config) {
        // Determine TTS provider
        if (config.deepgramConfig?.ttsApiKey) {
          activeProviders.tts = "deepgram";
        } else if (config.elevenLabsApiKey) {
          activeProviders.tts = "elevenlabs";
        } else {
          activeProviders.tts = "fallback";
        }

        // Determine LLM providers
        if (config.openaiApiKey) activeProviders.llm.push("openai");
        if (config.anthropicApiKey) activeProviders.llm.push("anthropic");
        if (config.googleApiKey) activeProviders.llm.push("google");

        // Determine missing optional providers
        if (!config.elevenLabsApiKey)
          activeProviders.optionalMissing.push("elevenlabs");
        if (!config.openaiApiKey)
          activeProviders.optionalMissing.push("openai");
        if (!config.anthropicApiKey)
          activeProviders.optionalMissing.push("anthropic");
        if (!config.googleApiKey)
          activeProviders.optionalMissing.push("google");
      }
    } catch (error) {
      bootstrapLogger.warn("Could not validate database configuration:", error);
      bootstrapLogger.warn(
        "Services will start with empty credentials - configure via Configuration page"
      );
    }

    // Switch to runtime phase logging after DB and config load
    const runtimeLogger = phaseLogger("RUNTIME");

    // Emit provider summary
    runtimeLogger.info("Provider configuration summary", {
      event: "providers.summary",
      tts: activeProviders.tts,
      llm: activeProviders.llm,
      optionalMissing: activeProviders.optionalMissing,
    });

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
          `Cloudinary connection test result: ${
            cloudinaryWorks ? "SUCCESS" : "FAILED"
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

      // ElevenLabs - 30 requests per minute (default tier)
      getRateLimiter("elevenlabs", { requestsPerMinute: 30, queueSize: 20 });

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
          break;
        case "EADDRINUSE":
          logger.error(`${bind} is already in use`);
          process.exit(1);
          break;
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

      // Stop Deepgram auto-configuration background validation
      try {
        const {
          getDeepgramAutoConfigService,
        } = require("./services/deepgramAutoConfigService");
        const autoConfigService = getDeepgramAutoConfigService();
        autoConfigService.cleanup();
        logger.info("Deepgram auto-configuration service cleaned up");
      } catch (error) {
        logger.warn(
          `Error cleaning up Deepgram auto-config service: ${getErrorMessage(
            error
          )}`
        );
      }

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
  var speechService: any;
  var modelRegistry: any;
  var conversationEngine: any;
  var campaignService: any;
}

export { app, campaignService, getErrorMessage, io, leadService, logger };