/**
 * Service Recovery Utilities
 * 
 * Provides helper functions for service recovery and resilience
 */

import logger from './logger';

/**
 * Retry options interface
 */
interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  factor: number;
  jitter: boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  factor: 2,
  jitter: true
};

/**
 * Execute a function with exponential backoff retry
 * @param fn Function to execute
 * @param options Retry options
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const retryOptions: RetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };
  
  let attempt = 0;
  let lastError: Error | null = null;
  
  while (attempt <= retryOptions.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;
      
      if (attempt > retryOptions.maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      let delay = retryOptions.initialDelay * Math.pow(retryOptions.factor, attempt - 1);
      delay = Math.min(delay, retryOptions.maxDelay);
      
      // Add jitter if enabled
      if (retryOptions.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      
      // Call onRetry callback if provided
      if (retryOptions.onRetry) {
        retryOptions.onRetry(lastError, attempt);
      }
      
      // Log retry attempt
      logger.debug(`Retry attempt ${attempt}/${retryOptions.maxRetries} after ${delay}ms: ${lastError.message}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // All retries failed
  throw lastError || new Error('All retry attempts failed');
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

/**
 * Circuit breaker options
 */
interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  onOpen?: () => void;
  onClose?: () => void;
  onHalfOpen?: () => void;
}

/**
 * Simple circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private resetTimer: NodeJS.Timeout | null = null;
  
  constructor(private options: CircuitBreakerOptions) {}
  
  /**
   * Execute a function with circuit breaker protection
   * @param fn Function to execute
   * @returns Result of the function
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      // Check if reset timeout has elapsed
      const now = Date.now();
      if (now - this.lastFailureTime > this.options.resetTimeout) {
        this.halfOpen();
      } else {
        throw new Error('Circuit is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= 2) {
        this.close();
      }
    } else {
      this.failures = 0;
    }
  }
  
  /**
   * Handle execution failure
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.CLOSED && 
        this.failures >= this.options.failureThreshold) {
      this.open();
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.open();
    }
  }
  
  /**
   * Open the circuit
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.successes = 0;
    
    if (this.options.onOpen) {
      this.options.onOpen();
    }
    
    // Set timer to attempt reset
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.options.resetTimeout);
  }
  
  /**
   * Set circuit to half-open state
   */
  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successes = 0;
    
    if (this.options.onHalfOpen) {
      this.options.onHalfOpen();
    }
  }
  
  /**
   * Close the circuit
   */
  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    
    if (this.options.onClose) {
      this.options.onClose();
    }
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
  
  /**
   * Force reset the circuit
   */
  reset(): void {
    this.close();
  }
  
  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Create a timeout promise
 * @param ms Timeout in milliseconds
 * @returns Promise that rejects after timeout
 */
export function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
}

/**
 * Execute a function with timeout
 * @param fn Function to execute
 * @param ms Timeout in milliseconds
 * @returns Result of the function
 */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    timeout(ms)
  ]);
}

/**
 * Fallback function that returns a default value if the primary function fails
 * @param fn Primary function to execute
 * @param fallbackFn Fallback function to execute if primary fails
 * @returns Result of either primary or fallback function
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  fallbackFn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`Primary function failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);
    return fallbackFn();
  }
}