import * as winston from 'winston';

// Create a custom logger instance with desired format and transports
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'lumina-outreach' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
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
 * Safely extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
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
export { logStream };
