import * as winston from 'winston';

// Create a custom logger instance with desired format and transports
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    process.env.NODE_ENV === 'production' ? winston.format.json() : winston.format.simple()
  ),
  defaultMeta: { service: 'lumina-outreach' },
  transports: [
    // Console transport for development (colorized) and production (JSON)
    new winston.transports.Console({
      format: winston.format.combine(
        ...(process.env.NODE_ENV === 'production' 
          ? [winston.format.timestamp(), winston.format.json()]
          : [winston.format.colorize(), winston.format.simple()]
        )
      ),
    }),
    new winston.transports.File({ filename: 'lumina_outreach.log' }),
  ],
});

// Define a stream object for Morgan HTTP request logging
const logStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

/**
 * Create a logger with context information
 */
export function createLogger(context: string): winston.Logger {
  return logger.child({ context });
}

/**
 * Get a logger for a specific component
 */
export function getLogger(component: string): winston.Logger {
  return logger.child({ component });
}

/**
 * Get a logger for a specific phase (e.g., 'BOOTSTRAP', 'RUNTIME')
 */
export function phaseLogger(phase: string): winston.Logger {
  return logger.child({ phase });
}

// Store for tracking logged messages to prevent duplicates
const loggedMessages = new Set<string>();

/**
 * Log a message only once per key to prevent spam
 */
export function logOnce(key: string, logFn: () => void): void {
  if (!loggedMessages.has(key)) {
    loggedMessages.add(key);
    logFn();
  }
}

/**
 * Safely extract error message from unknown error type
 */
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

// Export the logger for use in other modules
export default logger;
export { logStream, getErrorMessage };
