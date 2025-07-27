import { Request, Response } from 'express';
import { logger } from '../index';
import { checkDatabaseHealth, isDatabaseConnected } from '../database/connection';
import { validateGoogleConfig, validateElevenLabsConfig } from '../config/validation';

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
 * Check ElevenLabs service health
 */
export async function checkElevenLabsHealth(): Promise<HealthCheck> {
  try {
    const config = validateElevenLabsConfig();
    return {
      service: 'elevenlabs',
      status: 'healthy',
      message: 'API key configured',
      timestamp: new Date(),
      details: {
        apiKeyConfigured: !!config.apiKey
      }
    };
  } catch (error) {
    return {
      service: 'elevenlabs',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    };
  }
}

/**
 * Check OpenAI service health
 */
export async function checkOpenAIHealth(): Promise<HealthCheck> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || apiKey.trim() === '') {
    return {
      service: 'openai',
      status: 'degraded',
      message: 'API key not configured',
      timestamp: new Date()
    };
  }

  return {
    service: 'openai',
    status: 'healthy',
    message: 'API key configured',
    timestamp: new Date(),
    details: {
      apiKeyConfigured: true
    }
  };
}

/**
 * Check Anthropic service health
 */
export async function checkAnthropicHealth(): Promise<HealthCheck> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey.trim() === '') {
    return {
      service: 'anthropic',
      status: 'degraded',
      message: 'API key not configured',
      timestamp: new Date()
    };
  }

  return {
    service: 'anthropic',
    status: 'healthy',
    message: 'API key configured',
    timestamp: new Date(),
    details: {
      apiKeyConfigured: true
    }
  };
}

/**
 * Check Twilio service health
 */
export async function checkTwilioHealth(): Promise<HealthCheck> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return {
      service: 'twilio',
      status: 'unhealthy',
      message: 'Account SID or Auth Token not configured',
      timestamp: new Date()
    };
  }

  return {
    service: 'twilio',
    status: 'healthy',
    message: 'Credentials configured',
    timestamp: new Date(),
    details: {
      accountSidConfigured: !!accountSid,
      authTokenConfigured: !!authToken
    }
  };
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

    // LLM providers health
    checks.push(await checkGoogleLLMHealth());
    checks.push(await checkOpenAIHealth());
    checks.push(await checkAnthropicHealth());

    // Other services health
    checks.push(await checkElevenLabsHealth());
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
    logger.debug(`Health check completed in ${duration}ms - Status: ${overallStatus}`);

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
 * Express route handler for health check endpoint
 */
export async function healthCheckHandler(req: Request, res: Response): Promise<void> {
  try {
    const health = await performSystemHealthCheck();

    // Set appropriate HTTP status code
    const statusCode = health.status === 'healthy' ? 200 :
      health.status === 'degraded' ? 207 : 503;

    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check endpoint error:', error);
    res.status(500).json({
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
export function readinessCheckHandler(req: Request, res: Response): void {
  const isReady = isDatabaseConnected();

  if (isReady) {
    res.status(200).json({
      status: 'ready',
      timestamp: new Date(),
      uptime: process.uptime()
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date(),
      message: 'Database not connected'
    });
  }
}

/**
 * Simple liveness check for container orchestration
 */
export function livenessCheckHandler(req: Request, res: Response): void {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date(),
    uptime: process.uptime(),
    pid: process.pid
  });
}
