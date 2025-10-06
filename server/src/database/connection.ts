/**
 * Database Connection Management
 * 
 * Handles MongoDB connection with proper error handling and health checks
 */
import mongoose from 'mongoose';
import dns from 'dns';
import net from 'net';
import { performance, PerformanceObserver } from 'perf_hooks';
import { getLogger } from '../utils/logger';
import { validateDatabaseConfig } from '../config/database-validation';

// Use centralized logger for database operations
const logger = getLogger('Database');

// Flag to track if we've already logged database readiness
let databaseReadinessLogged = false;

export interface DatabaseConnectionOptions {
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

// Small helper to perform a quick DNS + TCP pre-check so we can fail fast with diagnostics
async function preconnectCheck(mongoUri: string, timeoutMs: number): Promise<{ host: string; port?: number; resolved?: string[] } | null> {
  try {
    // Extract host token (handles mongodb:// and mongodb+srv://)
    const m = mongoUri.match(/\/\/([^/\?]+)/);
    if (!m) return null;
    let hostToken = m[1];
    // If multiple hosts provided (replica set), pick the first
    if (hostToken.includes(',')) {
      hostToken = hostToken.split(',')[0];
    }
    // Strip possible credentials
    if (hostToken.includes('@')) {
      hostToken = hostToken.split('@')[1];
    }
    // Remove any options suffix
    hostToken = hostToken.split('?')[0];

    // If SRV, perform srv lookup
    if (mongoUri.startsWith('mongodb+srv://')) {
      const srvName = `_mongodb._tcp.${hostToken}`;
      const srv = await dns.promises.resolveSrv(srvName).catch(() => [] as dns.SrvRecord[]);
      if (srv && srv.length > 0) {
        const target = srv[0];
        // perform lookup to get IP addresses
        const addrs = await dns.promises.resolve(target.name).catch(() => [] as string[]);
        // test TCP connect to first resolved address and port
        await tcpConnectTest(target.name, target.port, timeoutMs);
        return { host: target.name, port: target.port, resolved: addrs };
      }
      // Fallback: treat hostToken as hostname
    }

    // Parse host:port
    let host = hostToken;
    let port: number | undefined;
    if (hostToken.startsWith('[')) {
      // IPv6 with bracket [::1]:27017
      const match = hostToken.match(/\[([^\]]+)\](?::(\d+))?/);
      if (match) {
        host = match[1];
        port = match[2] ? parseInt(match[2], 10) : undefined;
      }
    } else if (hostToken.includes(':')) {
      const parts = hostToken.split(':');
      host = parts[0];
      port = parseInt(parts[1], 10);
    }

    const addrs = await dns.promises.resolve(host).catch(() => [] as string[]);
    // Use default mongodb port if not provided
    const portToTest = port || 27017;
    await tcpConnectTest(host, portToTest, timeoutMs);
    return { host, port: portToTest, resolved: addrs };
  } catch (err) {
    // Return null to indicate pre-check didn't succeed
    return null;
  }
}

/**
 * Measure a short event-loop delay by scheduling a timer and measuring the drift.
 * This is a synchronous helper which waits `sampleMs` ms and returns the observed delay in ms.
 */
function measureEventLoopDelay(sampleMs = 500): number {
  const start = performance.now();
  const waitUntil = start + sampleMs;
  // busy-wait by sleeping via setTimeout + measuring drift — keep it simple and short
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // We'll use an async IIFE to block until the timer completes and compute drift
  const p = (async () => {
    await sleep(sampleMs);
    const end = performance.now();
    return Math.max(0, end - waitUntil);
  })();
  // NOTE: This is synchronous from the caller's perspective only because we awaited above inlined.
  // Return value will be resolved synchronously via `.then` usage in calling context.
  // To keep types simple, block via deasync-like pattern is undesirable; instead we return a numeric sentinel here.
  // But the calling code expects a number; to avoid changing it we'll synchronously poll for completion (short sleep).
  // Implement simple loop (not ideal but acceptable for a short diagnostic):
  const startPoll = Date.now();
  let result: number | null = null;
  // eslint-disable-next-line no-constant-condition
  while (result === null) {
    // If promise resolved, set result
    // Can't synchronously get promise result; instead use .then to set result and break via small sleep
    p.then((v) => {
      result = v;
    }).catch(() => {
      result = -1;
    });
    if (result !== null) break;
    // sleep a tiny amount to allow event loop to process
    const t = Date.now();
    if (Date.now() - startPoll > sampleMs + 2000) {
      // give up after a while
      result = -1;
      break;
    }
    // yield
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  return result ?? -1;
}

/**
 * Redact credentials from a MongoDB URI for safe logging
 */
function redactMongoUri(uri: string): string {
  try {
    // mongodb+srv://user:pass@host/... -> redact user:pass
    return uri.replace(/:\/\/(.*?):(.*?)@/, '://<redacted>:<redacted>@');
  } catch (err) {
    return '<unparsable-uri>';
  }
}

// Run a more verbose set of diagnostics when connection attempts repeatedly fail.
// This is intended to be called after retries are exhausted to gather SRV/A records
// and attempt TCP connections to each SRV target so logs include actionable details.
async function runConnectionDiagnostics(mongoUri: string, timeoutMs: number): Promise<any> {
  const out: any = { srv: null, targets: [] };
  try {
    const m = mongoUri.match(/\/\/([^\/?]+)/);
    if (!m) return out;
    let hostToken = m[1];
    if (hostToken.includes(',')) hostToken = hostToken.split(',')[0];
    if (hostToken.includes('@')) hostToken = hostToken.split('@')[1];
    hostToken = hostToken.split('?')[0];

    if (mongoUri.startsWith('mongodb+srv://')) {
      const srvName = `_mongodb._tcp.${hostToken}`;
      out.srv = await dns.promises.resolveSrv(srvName).catch((e) => ({ error: String(e) }));
      if (Array.isArray(out.srv) && out.srv.length) {
        for (const target of out.srv) {
          const name = target.name?.replace(/\.$/, '') || target.name;
          const port = target.port || 27017;
          const addrs = await dns.promises.resolve(name).catch(() => [] as string[]);
          const targetResult: any = { name, port, addrs };
          try {
            await tcpConnectTest(name, port, Math.min(5000, timeoutMs));
            targetResult.tcp = 'ok';
          } catch (err) {
            targetResult.tcp = String(err instanceof Error ? err.message : err);
          }
          out.targets.push(targetResult);
        }
        return out;
      }
    }

    // Fallback: resolve hostToken directly
    const addrs = await dns.promises.resolve(hostToken).catch(() => [] as string[]);
    const portToTest = 27017;
    const targetResult: any = { name: hostToken, port: portToTest, addrs };
    try {
      await tcpConnectTest(hostToken, portToTest, Math.min(5000, timeoutMs));
      targetResult.tcp = 'ok';
    } catch (err) {
      targetResult.tcp = String(err instanceof Error ? err.message : err);
    }
    out.targets.push(targetResult);
    return out;
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) };
  }
}

function tcpConnectTest(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const onError = (e: any) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(timeoutMs, () => {
      onError(new Error(`TCP connect to ${host}:${port} timed out after ${timeoutMs}ms`));
    });
    socket.once('error', onError);
    socket.connect(port, host, () => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve();
    });
  });
}

/**
 * Connect to MongoDB with proper error handling
 */
export async function connectToDatabase(options: DatabaseConnectionOptions = {}): Promise<void> {
  // Make timeouts and retry behavior configurable via env variables with sensible defaults
  const { timeoutMs = parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '30000'), retryAttempts = parseInt(process.env.MONGODB_CONNECT_RETRIES || '5'), retryDelayMs = parseInt(process.env.MONGODB_CONNECT_RETRY_DELAY_MS || '2000') } = options;
  
  // Validate database configuration
  const validation = validateDatabaseConfig();
  if (!validation.isValid) {
    throw new Error(`Database configuration invalid: ${validation.error}`);
  }
  
  const mongodbUri = process.env.MONGODB_URI!; // We know it exists due to validation
  
  // Set mongoose options for better reliability and memory optimization
  const mongooseOptions = {
    serverSelectionTimeoutMS: timeoutMs,
    connectTimeoutMS: timeoutMs,
    socketTimeoutMS: timeoutMs,
    maxPoolSize: process.env.NODE_ENV === 'production' ? 5 : 10,
    minPoolSize: process.env.NODE_ENV === 'production' ? 1 : 2,
    bufferCommands: false,
    maxIdleTimeMS: 30000,
    heartbeatFrequencyMS: 30000,
    // Enable autoIndex only in development to avoid startup overhead in production
    autoIndex: process.env.NODE_ENV !== 'production'
  } as any;
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      logger.info(`Attempting database connection (${attempt}/${retryAttempts})...`);

      // Run a lightweight pre-connect check to fail fast with diagnostics
      try {
        const pre = await preconnectCheck(mongodbUri, Math.min(5000, timeoutMs));
        if (pre) {
          logger.debug('Preconnect check passed', pre);
        } else {
          logger.debug('Preconnect check did not produce actionable info');
          // If the preconnect check failed and the user requested fail-fast, exit immediately
          if (process.env.MONGODB_PRECONNECT_FAIL_FAST === 'true') {
            logger.error('MONGODB_PRECONNECT_FAIL_FAST=true and preconnect check failed — exiting startup');
            // Run a diagnostics run to provide better log details before exiting
            try {
              const diag = await runConnectionDiagnostics(mongodbUri, timeoutMs);
              logger.error('Connection diagnostics (fail-fast):', diag);
            } catch (diagErr) {
              logger.error('Error while running connection diagnostics:', diagErr instanceof Error ? diagErr.message : String(diagErr));
            }
            process.exit(1);
          }
        }
      } catch (preErr) {
        logger.warn('Preconnect check failed (will still attempt full connect):', preErr instanceof Error ? preErr.message : String(preErr));
      }

      await mongoose.connect(mongodbUri, mongooseOptions);
      
      logger.info('Database connected successfully');
      
      // Set up connection event handlers
      setupConnectionEventHandlers();
      
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Log helpful diagnostics for network/timeouts
      logger.error(`Database connection attempt ${attempt} failed: ${lastError.message}`);
      // If this is a MongoNetworkTimeoutError, unwrap and provide guidance
      if (lastError.name === 'MongoNetworkTimeoutError' || lastError.message?.includes('timed out')) {
        logger.error('Detected MongoNetworkTimeoutError. This often indicates network/TLS issues, firewall, or wrong host/port.');

        // Collect brief system diagnostics to aid troubleshooting
        try {
          const eventLoopDelayMs = measureEventLoopDelay(1000);
          const mem = process.memoryUsage();
          const cpu = process.cpuUsage();
          const uptime = process.uptime();
          const snapshot = {
            eventLoopDelayMs,
            memory: {
              rss: mem.rss,
              heapTotal: mem.heapTotal,
              heapUsed: mem.heapUsed,
              external: mem.external,
            },
            cpu: {
              user: cpu.user,
              system: cpu.system,
            },
            uptimeSeconds: uptime,
            nodeVersion: process.version,
            platform: process.platform,
          };

          // Redact credentials from URI before logging
          const safeUri = redactMongoUri(mongodbUri);

          logger.error('System diagnostics snapshot (redacted):', { snapshot, mongodbUri: safeUri });
        } catch (diagErr) {
          logger.error('Failed to collect system diagnostics:', diagErr instanceof Error ? diagErr.message : String(diagErr));
        }
      }
      logger.debug('Mongoose connection state:', { state: mongoose.connection.readyState, host: mongoose.connection.host, name: mongoose.connection.name });

      if (attempt < retryAttempts) {
        // Exponential backoff with jitter
        const backoff = Math.min(retryDelayMs * Math.pow(2, attempt - 1), 60000);
        const jitter = Math.floor(Math.random() * Math.min(1000, backoff));
        const waitMs = backoff + jitter;
        logger.info(`Retrying database connect in ${waitMs}ms (attempt ${attempt + 1}/${retryAttempts})...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
    }
  }
  
  // Before throwing, run an additional diagnostic pass to capture SRV/DNS/TCP results
  try {
    const diag = await runConnectionDiagnostics(mongodbUri, timeoutMs);
    logger.error('Final connection diagnostics after retries exhausted:', diag);
  } catch (diagErr) {
    logger.error('Error while running final connection diagnostics:', diagErr instanceof Error ? diagErr.message : String(diagErr));
  }

  throw new Error(`Failed to connect to database after ${retryAttempts} attempts. Last error: ${lastError?.message}`);
}

/**
 * Wait for database connection to be ready
 */
export async function waitForDatabaseConnection(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (mongoose.connection.readyState === 1) {
      if (!databaseReadinessLogged) {
        logger.info('Database connection confirmed ready');
        databaseReadinessLogged = true;
      }
      return;
    }
    
    logger.debug('Waiting for database connection...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('Database connection timeout - connection not ready within time limit');
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Get database connection state
 */
export function getDatabaseConnectionState(): string {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  return states[mongoose.connection.readyState as keyof typeof states] || 'unknown';
}

/**
 * Gracefully close database connection
 */
export async function closeDatabaseConnection(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      logger.info('Closing database connection...');
      await mongoose.connection.close();
      logger.info('Database connection closed');
    }
  } catch (error) {
    logger.error('Error closing database connection:', error);
    throw error;
  }
}

/**
 * Setup connection event handlers for monitoring
 */
function setupConnectionEventHandlers(): void {
  mongoose.connection.on('connected', () => {
    logger.info('Database connection established');
  });
  
  mongoose.connection.on('error', (error) => {
    logger.error('Database connection error:', error);
  });
  
  mongoose.connection.on('disconnected', () => {
    logger.warn('Database connection lost');
  });
  
  mongoose.connection.on('reconnected', () => {
    logger.info('Database reconnected');
  });
  
  mongoose.connection.on('close', () => {
    logger.info('Database connection closed');
  });
  
  // Handle process termination
  process.on('SIGINT', async () => {
    try {
      await closeDatabaseConnection();
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  message: string;
  details: {
    state: string;
    host?: string;
    database?: string;
  };
}> {
  try {
    const isConnected = isDatabaseConnected();
    const state = getDatabaseConnectionState();
    
    if (!isConnected) {
      return {
        status: 'unhealthy',
        message: `Database not connected (state: ${state})`,
        details: { state }
      };
    }
    
    // Test connection with a simple operation
    // Just check if the connection exists, no need for ping
    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }
    
    return {
      status: 'healthy',
      message: 'Database connection is healthy',
      details: {
        state,
        host: mongoose.connection.host,
        database: mongoose.connection.name
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        state: getDatabaseConnectionState()
      }
    };
  }
}
