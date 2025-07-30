import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import expressWs from 'express-ws';
import helmet from 'helmet';
import http from 'http';
import mongoose from 'mongoose';
import morgan from 'morgan';
import path from 'path';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { Server as SocketIOServer } from 'socket.io';
import winston from 'winston';
import aiOrchestrationRoutes from './routes/aiOrchestrationRoutes';
import aiRoutes from './routes/aiRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import callRoutes from './routes/callRoutes';
import campaignRoutes from './routes/campaignRoutes';
import configurationRoutes from './routes/configurationRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import debugRoutes from './routes/debugRoutes';
import deepgramTestRoutes, { setupDeepgramWebSocketServer } from './routes/deepgramTestRoutes';
import deepgramTTSRoutes from './routes/deepgramTTSRoutes';
import ttsProviderRoutes from './routes/ttsProviderRoutes';
import knowledgeRoutes from './routes/knowledgeRoutes';
import leadRoutes from './routes/leadRoutes';
import metricsRoutes from './routes/metricsRoutes';
import rootWebhookRoutes from './routes/rootWebhookRoutes';
import streamRoutes from './routes/streamRoutes';
import telephonyRoutes from './routes/telephonyRoutes';
import transcriptionRoutes from './routes/transcriptionRoutes';
import userRoutes from './routes/userRoutes';
import voiceAIRoutes from './routes/voiceAIRoutes';

// Optimized stream controller
import { optimizedStreamRoute } from './controllers/optimizedStreamController';

// Twilio Media Streams WebSocket handler
import { initializeTwilioWebSocketServer } from './services/twilioWebSocketServer';

// WebSocket handlers removed

// Services initialization
import { getAIOrchestrationService } from './services/aiOrchestrationService';
import CampaignService from './services/campaignService';
import ConversationEngineService from './services/conversationEngineService';
import { EnhancedVoiceAIService } from './services/enhancedVoiceAIService';
import leadService from './services/leadService';
import { LLMService } from './services/llm/service';
import { getRAGService } from './services/ragService';
import { initializeSpeechService } from './services/realSpeechService';
import SpeechAnalysisService from './services/speechAnalysisService';

// Configuration and health services
import { validateStartupConfig } from './config/database-validation';
import { connectToDatabase } from './database/connection';
import { healthCheckHandler, readinessCheckHandler } from './health/service';
import { initCloudinary } from './utils/cloudinaryService';

// Load environment variables
dotenv.config();

// Create enhanced logger with production features
const logLevel = process.env.LOG_LEVEL || 'info';
const logFileMaxSize = parseInt(process.env.LOG_FILE_MAX_SIZE || '10485760'); // 10MB in bytes
const logFileMaxFiles = parseInt(process.env.LOG_FILE_MAX_FILES || '5');

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'lumina-outreach',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console transport for development
    ...(process.env.NODE_ENV !== 'production' ? [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      })
    ] : []),

    // File transports with rotation
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: logFileMaxSize,
      maxFiles: logFileMaxFiles,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: logFileMaxSize,
      maxFiles: logFileMaxFiles,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),

    // Console transport for production (structured logging)
    ...(process.env.NODE_ENV === 'production' ? [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      })
    ] : [])
  ],
});

// Create logs directory if it doesn't exist
import fs from 'fs';
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true });
}

// Initialize express app
const app = express();
const server = http.createServer(app);
// Find this section in your index.ts file:

// Initialize dedicated Twilio WebSocket server FIRST (before any other WebSocket servers)
const twilioWSServer = initializeTwilioWebSocketServer(server);
logger.info('Dedicated Twilio WebSocket server initialized for robust framing');

// WebSocket upgrade handling is now managed by TwilioWebSocketServer
// to prevent Express interference with Twilio Media Stream connections

const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '120000'),      // Use environment variable or default to 120 seconds
  pingInterval: parseInt(process.env.WS_PING_INTERVAL || '15000'),     // Use environment variable or default to 15 seconds
  connectTimeout: parseInt(process.env.WS_CONNECT_TIMEOUT || '60000'), // Use environment variable or default to 60 seconds
  maxHttpBufferSize: 1e8,    // 100MB max buffer size for larger audio chunks
  transports: ['websocket', 'polling'],  // Prefer WebSocket, fallback to polling
});

// WebSocket handlers setup removed

// Initialize Deepgram WebSocket server (after Twilio WebSocket server)
setupDeepgramWebSocketServer(server);
logger.info('Deepgram WebSocket server initialized');

// Enhanced middleware setup for production
const corsOrigin = process.env.CORS_ORIGIN || process.env.CLIENT_URL || 'http://localhost:3000';
const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy configuration for accurate IP detection
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// CORS configuration
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  exposedHeaders: ['x-total-count', 'x-page-count']
}));

// Security middleware
app.use(helmet({
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
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'same-origin' }
}));

// Compression middleware
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// Serve static files for audio
app.use('/audio', express.static(path.join(__dirname, '../public/audio')));
app.use('/fallbacks', express.static(path.join(__dirname, '../public/fallbacks')));

// Body parsing middleware with limits
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (buf && buf.length) {
      (req as any).rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

// Enhanced logging
const morganFormat = isProduction ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message: string) => {
      logger.info(message.trim(), { component: 'http-access' });
    }
  },
  skip: (req) => {
    // Skip health check logs in production
    return isProduction && req.url === '/health';
  }
}));

// Trust proxy in production
if (isProduction) {
  app.set('trust proxy', 1);
}

// Enhanced rate limiting
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 minutes
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.round(rateLimitWindowMs / 1000)
    });
  }
});

// Apply global rate limiting
app.use(globalLimiter);

// Strict rate limiter for authentication endpoints
const authLimitWindowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000'); // 15 minutes
const authLimitMax = parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || '15'); // Increased default to 15

const authLimiter = rateLimit({
  windowMs: authLimitWindowMs,
  max: authLimitMax, // Use environment variable for auth attempts
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: 'Too many authentication attempts, please try again later.'
  }
});

// Advanced rate limiter for API abuse prevention
const apiAbuseProtection = new RateLimiterMemory({
  points: process.env.NODE_ENV === 'development' ? 200 : 50, // Increased for development
  duration: 60, // Per 60 seconds
  blockDuration: process.env.NODE_ENV === 'development' ? 60 : 300, // Reduced for development
});

// Middleware for API abuse protection
const apiAbuseMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    await apiAbuseProtection.consume(req.ip);
    next();
  } catch (rejRes) {
    const remainingPoints = rejRes.remainingPoints || 0;
    const msBeforeNext = rejRes.msBeforeNext || 1000;

    logger.warn(`API abuse detected for IP: ${req.ip}`, {
      ip: req.ip,
      remainingPoints,
      msBeforeNext,
      url: req.url
    });

    res.set('Retry-After', String(Math.round(msBeforeNext / 1000)));
    res.status(429).json({
      error: 'Too many requests. You have been temporarily blocked.',
      retryAfter: Math.round(msBeforeNext / 1000)
    });
  }
};

// Enhanced health check route with system information
app.get('/health', healthCheckHandler);

// Readiness probe (for Kubernetes/Docker)
app.get('/ready', readinessCheckHandler);

// Friendly root route
app.get('/', (_, res) =>
  res.json({ message: 'Lumina Outreach API is up 🚀' })
);

// Metrics endpoint for monitoring
app.get('/metrics', (_req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    database: {
      readyState: mongoose.connection.readyState,
      name: mongoose.connection.name
    },
    activeConnections: io.engine.clientsCount
  };

  res.status(200).json(metrics);
});

// API Routes with enhanced security and monitoring
app.use('/api/users/login', authLimiter); // Apply strict rate limiting to login
app.use('/api/users/register', authLimiter); // Apply strict rate limiting to registration

// Apply API abuse protection to all API routes
app.use('/api', apiAbuseMiddleware);

// Mount root webhook route to handle incoming Twilio webhooks (before API routes)
// This is critical for receiving webhooks directly at the root path
app.use('/', rootWebhookRoutes);

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/configuration', configurationRoutes);
app.use('/api/lumina-outreach', voiceAIRoutes);
app.use('/api/telephony', telephonyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRoutes); // Core AI routes
app.use('/api/ai-orchestration', aiOrchestrationRoutes); // AI orchestration layer routes
app.use('/api/knowledge', knowledgeRoutes); // Knowledge management routes
app.use('/api/transcription', transcriptionRoutes);
app.use('/api/deepgram-metrics', (req, res) => {
  res.status(503).json({ error: 'Deepgram metrics service temporarily unavailable' });
}); // Temporarily disabled Deepgram metrics routes
app.use('/api/metrics', metricsRoutes); // Advanced monitoring and metrics endpoints
app.use('/api/deepgram', deepgramTestRoutes); // Deepgram testing routes
app.use('/api/deepgram-tts', deepgramTTSRoutes); // Deepgram TTS routes
app.use('/api/tts-provider', ttsProviderRoutes); // TTS Provider management routes

// Debug routes only in development
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug', debugRoutes);
}

// Add optimized stream route
app.get('/voice/optimized-stream/:callId/:conversationId', optimizedStreamRoute);



// WebSocket routes
app.use('/', streamRoutes);

// Enhanced global error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const errorId = Math.random().toString(36).substring(7);

  logger.error('Unhandled error:', {
    errorId,
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  const errorResponse = {
    error: true,
    message: isDevelopment ? err.message : 'An internal server error occurred',
    errorId,
    timestamp: new Date().toISOString(),
    ...(isDevelopment && {
      stack: err.stack,
      details: err
    })
  };

  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json(errorResponse);
});

// 404 handler
app.use('*', (req: express.Request, res: express.Response) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    error: true,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });

  // Handle real-time dashboard updates
  socket.on('join-dashboard', (userId) => {
    socket.join(`dashboard-${userId}`);
    logger.info(`User ${userId} joined dashboard room`);
  });

  // Handle real-time call monitoring
  socket.on('join-call-monitoring', (campaignId) => {
    socket.join(`campaign-${campaignId}`);
    logger.info(`Joined call monitoring for campaign ${campaignId}`);
  });

  // Handle user-specific notifications
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    logger.info(`User ${userId} joined notification room`);
  });
});

// Initialize services with configuration from database
const initializeServices = async () => {
  try {
    // Get configuration from database
    const Configuration = require('./models/Configuration').default;
    const config = await Configuration.findOne();

    let elevenLabsApiKey = '';
    let openAIApiKey = '';
    let anthropicApiKey = '';
    let googleSpeechApiKey = '';
    let deepgramApiKey = '';

    // If configuration exists, use it; otherwise use empty keys (no environment fallback)
    if (config) {
      logger.info('Using API configuration from database');

      // ElevenLabs
      elevenLabsApiKey = config.elevenLabsConfig?.apiKey || '';

      // LLM providers
      const openAIProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'openai');
      openAIApiKey = openAIProvider?.apiKey || '';

      const anthropicProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'anthropic');
      anthropicApiKey = anthropicProvider?.apiKey || '';

      // Google (if configured)
      const googleProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'google');
      googleSpeechApiKey = googleProvider?.apiKey || '';

      // Deepgram for STT (Nova-2)
      deepgramApiKey = config.deepgramConfig?.apiKey || process.env.DEEPGRAM_API_KEY || '';
      logger.info('Deepgram API key ' + (deepgramApiKey ? 'found' : 'not found') + ' in configuration' +
        (process.env.DEEPGRAM_API_KEY && !config.deepgramConfig?.apiKey ? ' (using environment fallback)' : ''));

      // Initialize and validate Deepgram auto-configuration with graceful startup
      if (deepgramApiKey) {
        try {
          logger.info('Initializing Deepgram auto-configuration service...');
          const { getDeepgramAutoConfigService } = await import('./services/deepgramAutoConfigService');
          const autoConfigService = getDeepgramAutoConfigService();
          await autoConfigService.initialize(deepgramApiKey);

          // Perform graceful startup validation that won't fail the server
          logger.info('Performing graceful Deepgram startup validation...');
          const gracefulResult = await autoConfigService.performGracefulStartupValidation();

          if (gracefulResult.success) {
            logger.info(`Deepgram startup validation successful: ${gracefulResult.message}`);

            // Log details about the configuration
            if (gracefulResult.autoConfigResult) {
              logger.info('Auto-configuration details:', {
                model: gracefulResult.autoConfigResult.model,
                accountTier: gracefulResult.autoConfigResult.accountTier,
                availableModels: gracefulResult.autoConfigResult.availableModels.length,
                warnings: gracefulResult.autoConfigResult.warnings
              });

              // Update deepgramApiKey reference for service initialization
              const updatedConfig = await Configuration.findOne();
              if (updatedConfig?.deepgramConfig?.apiKey) {
                deepgramApiKey = updatedConfig.deepgramConfig.apiKey;
              }
            }
          } else {
            logger.warn(`Deepgram startup validation issues: ${gracefulResult.message}`);

            // Log validation details for troubleshooting
            if (gracefulResult.validationResult) {
              logger.warn('Validation details:', {
                model: gracefulResult.validationResult.model,
                error: gracefulResult.validationResult.error,
                suggestedAction: gracefulResult.validationResult.suggestedAction
              });
            }

            if (gracefulResult.autoConfigResult && !gracefulResult.autoConfigResult.success) {
              logger.warn('Auto-configuration failed:', {
                error: gracefulResult.autoConfigResult.error,
                warnings: gracefulResult.autoConfigResult.warnings
              });
            }

            // Server continues regardless - graceful degradation
            logger.info('Server will continue with Deepgram in degraded mode');
          }

          // Always start background validation if possible
          try {
            autoConfigService.startBackgroundValidation();
            logger.info('Deepgram background validation started');
          } catch (bgError) {
            logger.warn(`Failed to start background validation: ${getErrorMessage(bgError)}`);
          }

        } catch (error) {
          logger.error(`Deepgram auto-configuration initialization failed: ${getErrorMessage(error)}`);
          logger.warn('Deepgram services will start without auto-configuration');
          logger.info('Manual configuration may be required via the Configuration page');

          // Server continues even if initialization completely fails
          logger.info('Server startup continuing without Deepgram auto-configuration');
        }
      } else {
        logger.info('No Deepgram API key found - Deepgram services will be disabled');
        logger.info('To enable speech-to-text functionality:');
        logger.info('1. Configure Deepgram API key in the Configuration page');
        logger.info('2. The system will automatically detect optimal model settings');
        logger.info('3. Background validation will ensure continued compatibility');
      }
    } else {
      logger.warn('No configuration found in database, using environment variables as fallback');
      elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || '';
      openAIApiKey = process.env.OPENAI_API_KEY || '';
      anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
      googleSpeechApiKey = process.env.GOOGLE_SPEECH_API_KEY || '';
      deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';
    }

    // Speech synthesis service
    const speechService = initializeSpeechService(
      elevenLabsApiKey,
      path.join(__dirname, '../uploads/audio')
    );

    // Get the selected TTS provider from configuration
    const selectedTTSProvider = config?.ttsConfig?.provider || 'elevenlabs';
    logger.info(`Initializing services for selected TTS provider: ${selectedTTSProvider}`);

    // Initialize Enhanced Voice AI Service only if ElevenLabs is the selected TTS provider
    let enhancedVoiceAI;
    if (selectedTTSProvider === 'elevenlabs' && elevenLabsApiKey) {
      enhancedVoiceAI = new EnhancedVoiceAIService(elevenLabsApiKey);
      logger.info('ElevenLabs Enhanced Voice AI Service initialized');
    } else {
      // Create a minimal service instance for compatibility
      enhancedVoiceAI = new EnhancedVoiceAIService('');
      if (selectedTTSProvider !== 'elevenlabs') {
        logger.info(`Skipping ElevenLabs service initialization - selected TTS provider is ${selectedTTSProvider}`);
      } else {
        logger.warn('ElevenLabs selected as TTS provider but no API key available');
      }
    }

    // Initialize Deepgram TTS service as fallback
    if (deepgramApiKey) {
      try {
        const { initializeDeepgramTTS } = await import('./services/deepgramTTSService');
        initializeDeepgramTTS(deepgramApiKey);
        logger.info('Deepgram TTS service initialized as fallback for voice synthesis');
      } catch (error) {
        logger.warn(`Failed to initialize Deepgram TTS service: ${getErrorMessage(error)}`);
      }
    } else {
      logger.info('Deepgram TTS service not initialized - no API key available');
    }

    // Initialize TTS Provider Service
    try {
      const { initializeTTSProviderService } = await import('./services/ttsProviderService');
      initializeTTSProviderService();
      logger.info('TTS Provider Service initialized');
    } catch (error) {
      logger.warn(`Failed to initialize TTS Provider Service: ${getErrorMessage(error)}`);
    }

    // Conversation engine
    const conversationEngine = new ConversationEngineService(
      enhancedVoiceAI,
      new SpeechAnalysisService(openAIApiKey, googleSpeechApiKey, deepgramApiKey),
      new LLMService({
        providers: [
          {
            name: 'openai',
            apiKey: openAIApiKey,
            isEnabled: true
          },
          {
            name: 'anthropic',
            apiKey: anthropicApiKey,
            isEnabled: true
          }
        ],
        defaultProvider: 'openai'
      })
    );

    // Campaign service
    const campaignService = new CampaignService(
      elevenLabsApiKey,
      openAIApiKey,
      anthropicApiKey,
      googleSpeechApiKey,
      deepgramApiKey
    );

    // Initialize AdvancedTelephonyService manually (safe initialization)
    const { advancedTelephonyService } = require('./services/advancedTelephonyService');
    await advancedTelephonyService.updateConfiguration();
    logger.info('Advanced telephony service initialized');

    // Export services
    global.speechService = speechService;
    global.conversationEngine = conversationEngine;
    global.campaignService = campaignService;

    return {
      speechService,
      conversationEngine,
      campaignService
    };
  } catch (error) {
    logger.error('Error initializing services:', error);
    throw error;
  }
};

// Enhanced server startup with production optimizations
const PORT = parseInt(process.env.PORT || '8000');
const HOST = process.env.HOST || '0.0.0.0';

const startServer = async () => {
  try {
    logger.info('Starting Lumina Outreach server...');

    // Step 1: Validate startup configuration (environment variables only)
    logger.info('Validating startup configuration...');
    const configValidation = validateStartupConfig();
    if (!configValidation.isValid) {
      logger.error('Startup configuration validation failed:', configValidation);
      throw new Error(`Invalid startup configuration: ${configValidation.error}`);
    }
    logger.info('Startup configuration validation passed');

    // Step 2: Connect to database
    logger.info('Establishing database connection...');
    await connectToDatabase();

    // Step 2.1: Wait for database to be ready
    logger.info('Waiting for database to be ready...');
    const { waitForDatabaseConnection } = await import('./database/connection');
    await waitForDatabaseConnection();
    logger.info('Database connection confirmed ready');

    // Step 2.5: Validate database-loaded configuration (optional)
    logger.info('Validating database configuration...');
    try {
      const { validateDatabaseLoadedConfig, validateDeepgramStartupConfig } = await import('./config/database-validation');
      const Configuration = require('./models/Configuration').default;
      const config = await Configuration.findOne();

      const dbConfigValidation = validateDatabaseLoadedConfig(config);
      if (!dbConfigValidation.isValid) {
        logger.warn('Database configuration has issues:', dbConfigValidation.error);
        logger.warn('Services will start with limited functionality. Configure API keys in the Configuration page.');

        // Log warnings if they exist
        if (dbConfigValidation.details?.warnings) {
          dbConfigValidation.details.warnings.forEach((warning: string) => {
            logger.warn(`Configuration warning: ${warning}`);
          });
        }
      } else {
        logger.info('Database configuration is valid');

        // Log warnings even for valid configurations
        if (dbConfigValidation.details?.warnings) {
          dbConfigValidation.details.warnings.forEach((warning: string) => {
            logger.warn(`Configuration warning: ${warning}`);
          });
        }
      }

      // Perform specific Deepgram startup validation
      if (config?.deepgramConfig) {
        logger.info('Performing Deepgram-specific startup validation...');
        const deepgramValidation = validateDeepgramStartupConfig(config.deepgramConfig);

        if (!deepgramValidation.isValid) {
          logger.warn(`Deepgram startup validation failed: ${deepgramValidation.error}`);
          logger.info('Auto-configuration will attempt to resolve these issues during service initialization');
        } else {
          logger.info('Deepgram startup validation passed');
          if (deepgramValidation.details) {
            logger.info('Deepgram validation details:', deepgramValidation.details);
          }
        }
      }

    } catch (error) {
      logger.warn('Could not validate database configuration:', error);
      logger.warn('Services will start with empty credentials - configure via Configuration page');
    }

    // Step 3: Initialize services with database-driven configuration
    logger.info('Initializing application services...');

    // Initialize Cloudinary service
    initCloudinary();

    // Test Cloudinary connection
    const cloudinaryService = await import('./utils/cloudinaryService').then(m => m.default);
    const cloudinaryWorks = await cloudinaryService.testCloudinaryConnection();
    logger.info(`Cloudinary connection test result: ${cloudinaryWorks ? 'SUCCESS' : 'FAILED'}`);

    // Initialize services that load configuration from database
    await initializeServices();

    // Initialize post-database services
    const { initializeServicesAfterDB } = await import('./services');
    await initializeServicesAfterDB();

    // Initialize rate limiters for API providers
    try {
      const { getRateLimiter } = await import('./utils/rateLimiter');

      // Initialize rate limiters with appropriate limits
      // Google/Gemini - 15 requests per minute (free tier)
      getRateLimiter('google', { requestsPerMinute: 15, queueSize: 30 });

      // OpenAI - 60 requests per minute (default tier)
      getRateLimiter('openai', { requestsPerMinute: 60, queueSize: 30 });

      // ElevenLabs - 30 requests per minute (default tier)
      getRateLimiter('elevenlabs', { requestsPerMinute: 30, queueSize: 20 });

      logger.info('Rate limiters initialized for API providers');
    } catch (error) {
      logger.error(`Error initializing rate limiters: ${error.message}`);
    }

    // Initialize AI Orchestration service
    const { getLLMService } = await import('./services');
    const llmService = getLLMService();
    const aiOrchestrationService = getAIOrchestrationService();
    const ragService = getRAGService(llmService);

    logger.info('AI Orchestration and RAG services initialized');

    logger.info('Services initialization completed');

    // Step 4: Start server
    server.listen(PORT, HOST, () => {
      logger.info('Server started successfully', {
        port: PORT,
        host: HOST,
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0',
        processId: process.pid,
        nodeVersion: process.version,
        uptime: process.uptime()
      });

      // Log service URLs
      logger.info('Service endpoints:', {
        health: `http://${HOST}:${PORT}/health`,
        ready: `http://${HOST}:${PORT}/ready`,
        metrics: `http://${HOST}:${PORT}/metrics`,
        api: `http://${HOST}:${PORT}/api`
      });

      // Initialize cache preloading for optimized latency
      try {
        const { preloadAllVoices } = require('./utils/cachePreloader');
        const { cacheSettings } = require('./config/latencyOptimization');

        // Check if preloading is enabled
        if (cacheSettings.preload.enabled) {
          logger.info('Starting voice response cache preloading...');

          // Start preloading with a delay to allow server to stabilize
          setTimeout(() => {
            preloadAllVoices()
              .then(result => {
                logger.info(`Cache preloading completed: ${result.voiceCount} voices, ${result.phrasesLoaded} phrases`);
              })
              .catch(error => {
                logger.error(`Cache preloading failed: ${error.message}`);
              });
          }, 5000); // 5-second delay before starting preload
        } else {
          logger.info('Voice response cache preloading disabled by configuration');
        }
      } catch (error) {
        logger.error(`Error initializing cache preloading: ${error.message}`);
      }

      // Initialize temporary file cleanup
      try {
        const { TempFileCleanup } = require('./utils/tempFileCleanup');

        // Perform emergency cleanup of any existing temp files
        TempFileCleanup.emergencyCleanup();

        // Start periodic cleanup
        TempFileCleanup.startPeriodicCleanup();

        logger.info('Temporary file cleanup initialized');
      } catch (error) {
        logger.error(`Error initializing temp file cleanup: ${error.message}`);
      }

      // Initialize monitoring and metrics systems
      try {
        const { initializeMonitoringSystems } = require('./monitoring/initializeMetrics');
        initializeMonitoringSystems();
        logger.info('Monitoring and metrics systems initialized');
      } catch (error) {
        logger.error(`Error initializing monitoring systems: ${error.message}`);
      }
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.syscall !== 'listen') {
        throw error;
      }

      const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

      switch (error.code) {
        case 'EACCES':
          logger.error(`${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          logger.error(`${bind} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

  } catch (error) {
    logger.error('Failed to start server:', {
      message: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

// Start the server
startServer();

// Enhanced process error handling and graceful shutdown
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Promise Rejection:', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString()
  });

  // In production, don't exit immediately, but log and monitor
  if (process.env.NODE_ENV === 'production') {
    // Give some time for the error to be logged
    setTimeout(() => {
      logger.error('Shutting down due to unhandled rejection');
      gracefulShutdown('UNHANDLED_REJECTION');
    }, 1000);
  } else {
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });

  // For uncaught exceptions, we should exit
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Graceful shutdown function
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async (error) => {
    if (error) {
      logger.error('Error during server shutdown:', error);
    } else {
      logger.info('HTTP server closed');
    }

    try {
      // Stop temp file cleanup process
      const { TempFileCleanup } = require('./utils/tempFileCleanup');
      TempFileCleanup.stopPeriodicCleanup();

      // Perform final cleanup of temp files
      TempFileCleanup.emergencyCleanup();

      // Stop Deepgram auto-configuration background validation
      try {
        const { getDeepgramAutoConfigService } = require('./services/deepgramAutoConfigService');
        const autoConfigService = getDeepgramAutoConfigService();
        autoConfigService.cleanup();
        logger.info('Deepgram auto-configuration service cleaned up');
      } catch (error) {
        logger.warn(`Error cleaning up Deepgram auto-config service: ${getErrorMessage(error)}`);
      }

      // Close database connections
      logger.info('Closing database connection...');
      await mongoose.connection.close();
      logger.info('Database connections closed');

      // Close Socket.IO connections
      io.close((err) => {
        if (err) {
          logger.error('Error closing Socket.IO:', err);
        } else {
          logger.info('Socket.IO server closed');
        }
      });

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (shutdownError) {
      logger.error('Error during graceful shutdown:', shutdownError);
      process.exit(1);
    }
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 30000); // 30 seconds timeout
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle memory warnings
process.on('warning', (warning) => {
  logger.warn('Process warning:', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack
  });
});

// Create helper for error handling
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return 'Unknown error occurred';
}

// Define global namespace for TypeScript
declare global {
  var speechService: any;
  var modelRegistry: any;
  var conversationEngine: any;
  var campaignService: any;
}

export {
  app, campaignService, getErrorMessage, io, leadService, logger
};

