import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../index';
import { checkDatabaseHealth, isDatabaseConnected } from '../database/connection';
import { validateGoogleConfig } from '../config/validation';
import Configuration from '../models/Configuration';

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  timestamp: Date;
  details?: any;
}

export interface SystemHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  checks: HealthCheck[];
  uptime: number;
  version?: string;
  memory?: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    arrayBuffers: number;
    status: 'healthy' | 'warning' | 'critical';
  };
}

/**
 * Check Google/Gemini LLM service health
 */
export async function checkGoogleLLMHealth(): Promise<HealthCheck> {
  try {
    const config = validateGoogleConfig();
    return {
      service: 'google-llm',
      status: 'healthy',
      message: `Using model: ${config.modelName}`,
      timestamp: new Date(),
      details: {
        modelName: config.modelName,
        apiKeyConfigured: !!config.apiKey
      }
    };
  } catch (error) {
    return {
      service: 'google-llm',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    };
  }
}

/**
 * Check ElevenLabs service health using database configuration
 */
export async function checkElevenLabsHealth(): Promise<HealthCheck> {
  try {
    // Get configuration from database instead of environment variables
    const config = await Configuration.findOne();
    const elevenLabsConfig = config?.elevenLabsConfig;
    
    if (!elevenLabsConfig) {
      return {
        service: 'elevenlabs',
        status: 'degraded',
        message: 'No ElevenLabs configuration found in database',
        timestamp: new Date()
      };
    }
    
    const hasApiKey = !!elevenLabsConfig.apiKey && elevenLabsConfig.apiKey.trim() !== '';
    const isEnabled = elevenLabsConfig.isEnabled;
    const status = elevenLabsConfig.status || 'unverified';
    
    // Determine health status based on configuration state
    let healthStatus: 'healthy' | 'unhealthy' | 'degraded';
    let message: string;
    
    if (!isEnabled) {
      healthStatus = 'degraded';
      message = 'ElevenLabs is disabled in configuration';
    } else if (!hasApiKey) {
      healthStatus = 'degraded';
      message = 'ElevenLabs API key not configured in database';
    } else if (status === 'verified') {
      healthStatus = 'healthy';
      message = 'ElevenLabs API key verified and active';
    } else if (status === 'failed') {
      healthStatus = 'unhealthy';
      message = 'ElevenLabs API key verification failed';
    } else {
      healthStatus = 'degraded';
      message = 'ElevenLabs API key configured but not verified';
    }
    
    return {
      service: 'elevenlabs',
      status: healthStatus,
      message,
      timestamp: new Date(),
      details: {
        isEnabled,
        apiKeyConfigured: hasApiKey,
        verificationStatus: status,
        lastVerified: elevenLabsConfig.lastVerified,
        unusualActivityDetected: elevenLabsConfig.unusualActivityDetected || false,
        voiceSpeed: elevenLabsConfig.voiceSpeed,
        voiceStability: elevenLabsConfig.voiceStability,
        voiceClarity: elevenLabsConfig.voiceClarity
      }
    };
  } catch (error) {
    return {
      service: 'elevenlabs',
      status: 'unhealthy',
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date()
    };
  }
}

/**
 * Check OpenAI service health using database configuration
 */
export async function checkOpenAIHealth(): Promise<HealthCheck> {
  try {
    // Get configuration from database instead of environment variables
    const config = await Configuration.findOne();
    const openAIProvider = config?.llmConfig?.providers?.find(p => p.name === 'openai');
    
    if (!openAIProvider) {
      return {
        service: 'openai',
        status: 'degraded',
        message: 'OpenAI provider not configured in database',
        timestamp: new Date()
      };
    }
    
    const hasApiKey = !!openAIProvider.apiKey && openAIProvider.apiKey.trim() !== '';
    const isEnabled = openAIProvider.isEnabled;
    const status = openAIProvider.status || 'unverified';
    
    // Determine health status based on configuration state
    let healthStatus: 'healthy' | 'unhealthy' | 'degraded';
    let message: string;
    
    if (!isEnabled) {
      healthStatus = 'degraded';
      message = 'OpenAI provider is disabled in configuration';
    } else if (!hasApiKey) {
      healthStatus = 'degraded';
      message = 'OpenAI API key not configured in database';
    } else if (status === 'verified') {
      healthStatus = 'healthy';
      message = 'OpenAI API key verified and active';
    } else if (status === 'failed') {
      healthStatus = 'unhealthy';
      message = 'OpenAI API key verification failed';
    } else {
      healthStatus = 'degraded';
      message = 'OpenAI API key configured but not verified';
    }
    
    return {
      service: 'openai',
      status: healthStatus,
      message,
      timestamp: new Date(),
      details: {
        isEnabled,
        apiKeyConfigured: hasApiKey,
        verificationStatus: status,
        lastVerified: openAIProvider.lastVerified,
        availableModels: openAIProvider.availableModels
      }
    };
  } catch (error) {
    return {
      service: 'openai',
      status: 'unhealthy',
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date()
    };
  }
}

/**
 * Check Anthropic service health using database configuration
 */
export async function checkAnthropicHealth(): Promise<HealthCheck> {
  try {
    // Get configuration from database instead of environment variables
    const config = await Configuration.findOne();
    const anthropicProvider = config?.llmConfig?.providers?.find(p => p.name === 'anthropic');
    
    if (!anthropicProvider) {
      return {
        service: 'anthropic',
        status: 'degraded',
        message: 'Anthropic provider not configured in database',
        timestamp: new Date()
      };
    }
    
    const hasApiKey = !!anthropicProvider.apiKey && anthropicProvider.apiKey.trim() !== '';
    const isEnabled = anthropicProvider.isEnabled;
    const status = anthropicProvider.status || 'unverified';
    
    // Determine health status based on configuration state
    let healthStatus: 'healthy' | 'unhealthy' | 'degraded';
    let message: string;
    
    if (!isEnabled) {
      healthStatus = 'degraded';
      message = 'Anthropic provider is disabled in configuration';
    } else if (!hasApiKey) {
      healthStatus = 'degraded';
      message = 'Anthropic API key not configured in database';
    } else if (status === 'verified') {
      healthStatus = 'healthy';
      message = 'Anthropic API key verified and active';
    } else if (status === 'failed') {
      healthStatus = 'unhealthy';
      message = 'Anthropic API key verification failed';
    } else {
      healthStatus = 'degraded';
      message = 'Anthropic API key configured but not verified';
    }
    
    return {
      service: 'anthropic',
      status: healthStatus,
      message,
      timestamp: new Date(),
      details: {
        isEnabled,
        apiKeyConfigured: hasApiKey,
        verificationStatus: status,
        lastVerified: anthropicProvider.lastVerified,
        availableModels: anthropicProvider.availableModels
      }
    };
  } catch (error) {
    return {
      service: 'anthropic',
      status: 'unhealthy',
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date()
    };
  }
}

/**
 * Check Twilio service health using database configuration
 */
export async function checkTwilioHealth(): Promise<HealthCheck> {
  try {
    // Get configuration from database instead of environment variables
    const config = await Configuration.findOne();
    const twilioConfig = config?.twilioConfig;
    
    if (!twilioConfig) {
      return {
        service: 'twilio',
        status: 'degraded',
        message: 'Twilio not configured in database',
        timestamp: new Date()
      };
    }
    
    const hasAccountSid = !!twilioConfig.accountSid && twilioConfig.accountSid.trim() !== '';
    const hasAuthToken = !!twilioConfig.authToken && twilioConfig.authToken.trim() !== '';
    const isEnabled = twilioConfig.isEnabled;
    const status = twilioConfig.status || 'unverified';
    
    // Determine health status based on configuration state
    let healthStatus: 'healthy' | 'unhealthy' | 'degraded';
    let message: string;
    
    if (!isEnabled) {
      healthStatus = 'degraded';
      message = 'Twilio is disabled in configuration';
    } else if (!hasAccountSid || !hasAuthToken) {
      healthStatus = 'degraded';
      message = 'Twilio credentials not fully configured in database';
    } else if (status === 'verified') {
      healthStatus = 'healthy';
      message = 'Twilio credentials verified and active';
    } else if (status === 'failed') {
      healthStatus = 'unhealthy';
      message = 'Twilio credentials verification failed';
    } else {
      healthStatus = 'degraded';
      message = 'Twilio credentials configured but not verified';
    }
    
    return {
      service: 'twilio',
      status: healthStatus,
      message,
      timestamp: new Date(),
      details: {
        isEnabled,
        accountSidConfigured: hasAccountSid,
        authTokenConfigured: hasAuthToken,
        verificationStatus: status,
        lastVerified: twilioConfig.lastVerified,
        phoneNumbers: twilioConfig.phoneNumbers?.length || 0
      }
    };
  } catch (error) {
    return {
      service: 'twilio',
      status: 'unhealthy',
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date()
    };
  }
}

/**
 * Check TTS provider service health using database configuration
 */
export async function checkTTSProviderHealth(): Promise<HealthCheck> {
  try {
    // Get configuration from database
    const config = await Configuration.findOne();
    const ttsConfig = config?.ttsConfig;
    
    if (!ttsConfig) {
      return {
        service: 'tts-provider',
        status: 'degraded',
        message: 'TTS provider not configured in database',
        timestamp: new Date()
      };
    }
    
    const provider = ttsConfig.provider || 'elevenlabs';
    const primaryProvider = ttsConfig.primaryProvider || provider;
    const autoFallback = ttsConfig.autoFallback;
    
    // Check if the primary TTS provider is properly configured
    let healthStatus: 'healthy' | 'unhealthy' | 'degraded';
    let message: string;
    let details: any = {
      provider,
      primaryProvider,
      autoFallback,
      fallbackProviders: ttsConfig.fallbackProviders || []
    };
    
    if (primaryProvider === 'elevenlabs') {
      const elevenLabsConfig = config?.elevenLabsConfig;
      const hasApiKey = !!elevenLabsConfig?.apiKey && elevenLabsConfig.apiKey.trim() !== '';
      const isEnabled = elevenLabsConfig?.isEnabled;
      const status = elevenLabsConfig?.status;
      
      if (!isEnabled || !hasApiKey) {
        healthStatus = 'degraded';
        message = `Primary TTS provider (ElevenLabs) not properly configured`;
      } else if (status === 'verified') {
        healthStatus = 'healthy';
        message = `TTS provider (ElevenLabs) is active and verified`;
      } else {
        healthStatus = 'degraded';
        message = `TTS provider (ElevenLabs) configured but not verified`;
      }
      
      details.elevenLabsStatus = {
        isEnabled,
        hasApiKey,
        verificationStatus: status
      };
    } else if (primaryProvider === 'deepgram') {
      const deepgramTTSConfig = ttsConfig.deepgramTTS;
      const hasApiKey = !!deepgramTTSConfig?.apiKey && deepgramTTSConfig.apiKey.trim() !== '';
      const isEnabled = deepgramTTSConfig?.isEnabled;
      const status = deepgramTTSConfig?.status;
      
      if (!isEnabled || !hasApiKey) {
        healthStatus = 'degraded';
        message = `Primary TTS provider (Deepgram) not properly configured`;
      } else if (status === 'verified') {
        healthStatus = 'healthy';
        message = `TTS provider (Deepgram) is active and verified`;
      } else {
        healthStatus = 'degraded';
        message = `TTS provider (Deepgram) configured but not verified`;
      }
      
      details.deepgramTTSStatus = {
        isEnabled,
        hasApiKey,
        verificationStatus: status,
        defaultModel: deepgramTTSConfig?.defaultModel
      };
    } else {
      healthStatus = 'degraded';
      message = `TTS provider (${primaryProvider}) not yet implemented`;
    }
    
    return {
      service: 'tts-provider',
      status: healthStatus,
      message,
      timestamp: new Date(),
      details
    };
  } catch (error) {
    return {
      service: 'tts-provider',
      status: 'unhealthy',
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date()
    };
  }
}

/**
 * Check Deepgram STT service health using database configuration
 */
export async function checkDeepgramSTTHealth(): Promise<HealthCheck> {
  try {
    // Get configuration from database
    const config = await Configuration.findOne();
    const deepgramConfig = config?.deepgramConfig;
    
    if (!deepgramConfig) {
      return {
        service: 'deepgram-stt',
        status: 'degraded',
        message: 'Deepgram STT not configured in database',
        timestamp: new Date()
      };
    }
    
    const hasApiKey = !!deepgramConfig.apiKey && deepgramConfig.apiKey.trim() !== '';
    const isEnabled = deepgramConfig.isEnabled;
    const status = deepgramConfig.status || 'unverified';
    const primaryModel = deepgramConfig.primaryModel;
    
    // Determine health status based on configuration state
    let healthStatus: 'healthy' | 'unhealthy' | 'degraded';
    let message: string;
    
    if (!isEnabled) {
      healthStatus = 'degraded';
      message = 'Deepgram STT is disabled in configuration';
    } else if (!hasApiKey) {
      healthStatus = 'degraded';
      message = 'Deepgram STT API key not configured in database';
    } else if (status === 'verified') {
      healthStatus = 'healthy';
      message = 'Deepgram STT API key verified and active';
    } else if (status === 'failed') {
      healthStatus = 'unhealthy';
      message = 'Deepgram STT API key verification failed';
    } else if (status === 'degraded') {
      healthStatus = 'degraded';
      message = 'Deepgram STT experiencing degraded performance';
    } else {
      healthStatus = 'degraded';
      message = 'Deepgram STT API key configured but not verified';
    }
    
    return {
      service: 'deepgram-stt',
      status: healthStatus,
      message,
      timestamp: new Date(),
      details: {
        isEnabled,
        apiKeyConfigured: hasApiKey,
        verificationStatus: status,
        lastVerified: deepgramConfig.lastVerified,
        primaryModel,
        fallbackModels: deepgramConfig.fallbackModels,
        autoFallback: deepgramConfig.autoFallback,
        accountTier: deepgramConfig.accountTier,
        availableModels: deepgramConfig.availableModels?.length || 0
      }
    };
  } catch (error) {
    return {
      service: 'deepgram-stt',
      status: 'unhealthy',
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date()
    };
  }
}
/**
 * Perform comprehensive system health check
 */
export async function performSystemHealthCheck(): Promise<SystemHealth> {
  const startTime = Date.now();

  try {
    const checks: HealthCheck[] = [];

    // Database health
    const dbHealth = await checkDatabaseHealth();
    checks.push({
      service: 'database',
      status: dbHealth.status,
      message: dbHealth.message,
      timestamp: new Date(),
      details: dbHealth.details
    });

    // LLM providers health (using database configuration)
    checks.push(await checkGoogleLLMHealth());
    checks.push(await checkOpenAIHealth());
    checks.push(await checkAnthropicHealth());

    // TTS/STT services health (using database configuration)
    checks.push(await checkElevenLabsHealth());
    checks.push(await checkTTSProviderHealth());
    checks.push(await checkDeepgramSTTHealth());
    
    // Other services health (using database configuration)
    checks.push(await checkTwilioHealth());

    // Memory health check
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const memoryStatus = heapUsedMB > 1400 ? 'critical' :
      heapUsedMB > 1200 ? 'warning' : 'healthy';

    checks.push({
      service: 'memory',
      status: memoryStatus === 'critical' ? 'unhealthy' :
        memoryStatus === 'warning' ? 'degraded' : 'healthy',
      message: `Heap usage: ${heapUsedMB}MB / RSS: ${rssMB}MB`,
      timestamp: new Date(),
      details: {
        heapUsed: heapUsedMB,
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: rssMB,
        external: Math.round(memoryUsage.external / 1024 / 1024),
        arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024)
      }
    });

    // Determine overall system status
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;

    let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
    if (unhealthyCount > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    const result: SystemHealth = {
      status: overallStatus,
      timestamp: new Date(),
      checks,
      uptime: process.uptime(),
      version: process.env.npm_package_version,
      memory: {
        ...memoryUsage,
        status: memoryStatus
      }
    };

    const duration = Date.now() - startTime;
    logger.debug(`Health check completed in ${duration}ms - Status: ${overallStatus} (using database configuration)`);

    return result;
  } catch (error) {
    logger.error('System health check failed:', error);

    return {
      status: 'unhealthy',
      timestamp: new Date(),
      checks: [{
        service: 'system',
        status: 'unhealthy',
        message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date()
      }],
      uptime: process.uptime()
    };
  }
}

/**
 * Fastify route handler for health check endpoint
 */
export async function healthCheckHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const health = await performSystemHealthCheck();

    // Set appropriate HTTP status code
    const statusCode = health.status === 'healthy' ? 200 :
      health.status === 'degraded' ? 207 : 503;

    reply.code(statusCode).send(health);
  } catch (error) {
    logger.error('Health check endpoint error:', error);
    reply.code(500).send({
      status: 'unhealthy',
      timestamp: new Date(),
      checks: [{
        service: 'health-endpoint',
        status: 'unhealthy',
        message: 'Health check endpoint error',
        timestamp: new Date()
      }],
      uptime: process.uptime()
    });
  }
}

/**
 * Simple readiness check for load balancers
 */
export function readinessCheckHandler(req: FastifyRequest, reply: FastifyReply): void {
  const isReady = isDatabaseConnected();

  if (isReady) {
    reply.code(200).send({
      status: 'ready',
      timestamp: new Date(),
      uptime: process.uptime()
    });
  } else {
    reply.code(503).send({
      status: 'not ready',
      timestamp: new Date(),
      message: 'Database not connected'
    });
  }
}

/**
 * Simple liveness check for container orchestration
 */
export function livenessCheckHandler(req: FastifyRequest, reply: FastifyReply): void {
  reply.code(200).send({
    status: 'alive',
    timestamp: new Date(),
    uptime: process.uptime(),
    pid: process.pid
  });
}