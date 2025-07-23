// Type definitions for logger
declare module '../utils/logger' {
  import * as winston from 'winston';
  
  const logger: winston.Logger;
  export default logger;
  
  export function getErrorMessage(error: unknown): string;
  
  export const logStream: {
    write: (message: string) => void;
  };
  
  // Adding a createLogger function that doesn't exist in the original implementation
  // but is needed for the fixed controller
  export function createLogger(context: string): winston.Logger;
}
