// Type definitions for logger
declare module '../utils/logger' {
  import * as winston from 'winston';
  
  const logger: winston.Logger;
  export default logger;
  
  export function getErrorMessage(error: unknown): string;
  
  export const logStream: {
    write: (message: string) => void;
  };
  
  // Existing createLogger function
  export function createLogger(context: string): winston.Logger;
  
  // New logger utilities
  export function getLogger(component: string): winston.Logger;
  export function phaseLogger(phase: string): winston.Logger;
  export function logOnce(key: string, logFn: () => void): void;
}
