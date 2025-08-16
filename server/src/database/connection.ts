/**
 * Database Connection Management
 * 
 * Handles MongoDB connection with proper error handling and health checks
 */
import mongoose from 'mongoose';
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

/**
 * Connect to MongoDB with proper error handling
 */
export async function connectToDatabase(options: DatabaseConnectionOptions = {}): Promise<void> {
  const { timeoutMs = 30000, retryAttempts = 3, retryDelayMs = 2000 } = options;
  
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
    maxPoolSize: process.env.NODE_ENV === 'production' ? 5 : 10, // Reduce pool size in production
    minPoolSize: process.env.NODE_ENV === 'production' ? 1 : 2,  // Reduce min pool size
    bufferCommands: false, // Disable mongoose buffering to prevent race conditions
    maxIdleTimeMS: 30000,  // Close connections after 30 seconds of inactivity
    // Memory optimization settings
    heartbeatFrequencyMS: 30000, // Reduce heartbeat frequency
  };
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      logger.info(`Attempting database connection (${attempt}/${retryAttempts})...`);
      
      await mongoose.connect(mongodbUri, mongooseOptions);
      
      logger.info('Database connected successfully');
      
      // Set up connection event handlers
      setupConnectionEventHandlers();
      
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error(`Database connection attempt ${attempt} failed: ${lastError.message}`);
      
      if (attempt < retryAttempts) {
        logger.info(`Retrying in ${retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
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
