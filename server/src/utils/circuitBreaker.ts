/**
 * Circuit Breaker Utility for Rate Limiting and Error Handling
 * 
 * This utility provides circuit breaker patterns specifically designed to handle
 * 429 (Too Many Requests) errors and prevent infinite retry loops.
 */
import opossum from 'opossum';
import { logger } from '../index';

export interface CircuitBreakerConfig {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  volumeThreshold: number;
  rollingCountTimeout: number;
  rollingCountBuckets: number;
}

export interface RateLimitAwareOptions extends CircuitBreakerConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
}

const DEFAULT_CONFIG: RateLimitAwareOptions = {
  timeout: 30000, // 30 seconds
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 60000, // Try to close circuit after 1 minute
  volumeThreshold: 10, // Need at least 10 requests to calculate error percentage
  rollingCountTimeout: 60000, // 1 minute rolling window
  rollingCountBuckets: 10, // 10 buckets in rolling window
  maxRetries: 3,
  baseDelay: 1000, // 1 second base delay
  maxDelay: 30000, // 30 seconds max delay
  jitter: true
};

export class RateLimitAwareCircuitBreaker<T extends any[], R> {
  private circuitBreaker: any;
  private retryCount: Map<string, number> = new Map();
  private lastRetryTime: Map<string, number> = new Map();
  private rateLimitResetTime: Map<string, number> = new Map();
  private config: RateLimitAwareOptions;

  constructor(
    action: (...args: T) => Promise<R>,
    config: Partial<RateLimitAwareOptions> = {},
    identifier?: string
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.circuitBreaker = new opossum(action, {
      timeout: this.config.timeout,
      errorThresholdPercentage: this.config.errorThresholdPercentage,
      resetTimeout: this.config.resetTimeout,
      volumeThreshold: this.config.volumeThreshold,
      rollingCountTimeout: this.config.rollingCountTimeout,
      rollingCountBuckets: this.config.rollingCountBuckets
      // errorFilter is not supported in the type definition but is a valid option
      // @ts-ignore
      //errorFilter: (err) => this.shouldCircuitBreakerTrigger(err)
    });

    this.setupEventHandlers(identifier);
  }

  private setupEventHandlers(identifier?: string): void {
    const id = identifier || 'unknown';

    this.circuitBreaker.on('open', () => {
      logger.warn(`Circuit breaker opened for ${id} - too many failures`);
    });

    this.circuitBreaker.on('halfOpen', () => {
      logger.info(`Circuit breaker half-open for ${id} - testing if service recovered`);
    });

    this.circuitBreaker.on('close', () => {
      logger.info(`Circuit breaker closed for ${id} - service recovered`);
    });

    this.circuitBreaker.on('fallback', () => {
      logger.debug(`Circuit breaker fallback triggered for ${id}`);
    });
  }

  /**
   * Determine if an error should trigger the circuit breaker
   */
  private shouldCircuitBreakerTrigger(error: any): boolean {
    // Don't trigger circuit breaker for 429 errors immediately
    // Instead, let our retry logic handle them with proper backoff
    if (this.is429Error(error)) {
      return false;
    }

    // Trigger for other server errors (5xx)
    if (error?.response?.status >= 500) {
      return true;
    }

    // Trigger for network errors
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
      return true;
    }

    return false;
  }

  /**
   * Check if error is a 429 rate limit error
   */
  private is429Error(error: any): boolean {
    return error?.response?.status === 429 || 
           error?.status === 429 ||
           error?.code === 'rate_limit_exceeded' ||
           error?.type === 'rate_limit_error';
  }

  /**
   * Extract rate limit reset time from error response
   */
  private extractRateLimitResetTime(error: any): number | null {
    const headers = error?.response?.headers;
    if (!headers) return null;

    // Check common rate limit headers
    const retryAfter = headers['retry-after'];
    const rateLimitReset = headers['x-ratelimit-reset'] || headers['x-rate-limit-reset'];
    const rateLimitResetAfter = headers['x-ratelimit-reset-after'] || headers['x-rate-limit-reset-after'];

    if (retryAfter) {
      // Retry-After can be in seconds or HTTP date
      const retryAfterNum = parseInt(retryAfter, 10);
      if (!isNaN(retryAfterNum)) {
        return Date.now() + (retryAfterNum * 1000);
      } else {
        return new Date(retryAfter).getTime();
      }
    }

    if (rateLimitReset) {
      // Usually a Unix timestamp
      const resetTime = parseInt(rateLimitReset, 10);
      if (!isNaN(resetTime)) {
        // Check if it's in seconds or milliseconds
        return resetTime > 1000000000000 ? resetTime : resetTime * 1000;
      }
    }

    if (rateLimitResetAfter) {
      const resetAfter = parseInt(rateLimitResetAfter, 10);
      if (!isNaN(resetAfter)) {
        return Date.now() + (resetAfter * 1000);
      }
    }

    return null;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number, rateLimitResetTime?: number): number {
    // If we have a rate limit reset time, use it
    if (rateLimitResetTime && rateLimitResetTime > Date.now()) {
      const waitTime = rateLimitResetTime - Date.now();
      // Add some buffer to avoid hitting the limit immediately when it resets
      return Math.min(waitTime + 1000, this.config.maxDelay);
    }

    // Calculate exponential backoff
    const exponentialDelay = this.config.baseDelay * Math.pow(2, attempt - 1);
    let delay = Math.min(exponentialDelay, this.config.maxDelay);

    // Add jitter to prevent thundering herd
    if (this.config.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  /**
   * Execute with rate limit aware retry logic
   */
  async execute(...args: T): Promise<R> {
    const requestId = this.generateRequestId(args);
    let lastError: any;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      try {
        // Check if we're still in a rate limit period
        const rateLimitResetTime = this.rateLimitResetTime.get(requestId);
        if (rateLimitResetTime && rateLimitResetTime > Date.now()) {
          const waitTime = rateLimitResetTime - Date.now();
          logger.info(`Waiting ${waitTime}ms for rate limit to reset`);
          await this.sleep(waitTime);
        }

        // Execute the action through circuit breaker
        const result = await this.circuitBreaker.fire(...args);
        
        // Success - reset retry count and rate limit tracking
        this.retryCount.delete(requestId);
        this.lastRetryTime.delete(requestId);
        this.rateLimitResetTime.delete(requestId);
        
        return result;
      } catch (error) {
        lastError = error;

        // Check if this is a 429 error
        if (this.is429Error(error)) {
          if (attempt > this.config.maxRetries) {
            logger.error(`Max retries (${this.config.maxRetries}) exceeded for rate limit error`);
            throw new Error(`Rate limit exceeded after ${this.config.maxRetries} retries. Please try again later.`);
          }

          // Extract and store rate limit reset time
          const resetTime = this.extractRateLimitResetTime(error);
          if (resetTime) {
            this.rateLimitResetTime.set(requestId, resetTime);
          }

          // Calculate delay for next attempt
          const delay = this.calculateDelay(attempt, resetTime);
          
          logger.warn(`Rate limit hit (attempt ${attempt}/${this.config.maxRetries}). Retrying in ${delay}ms`);
          
          // Update retry tracking
          this.retryCount.set(requestId, attempt);
          this.lastRetryTime.set(requestId, Date.now());
          
          // Wait before retrying
          await this.sleep(delay);
          continue;
        }

        // For non-429 errors, let circuit breaker handle them
        // Don't retry - let the circuit breaker open if needed
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Generate a request ID for tracking retries
   */
  private generateRequestId(args: T): string {
    // Create a simple hash of the arguments for tracking
    return JSON.stringify(args).slice(0, 50);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      state: this.circuitBreaker.status,
      failures: this.circuitBreaker.stats.failures,
      successes: this.circuitBreaker.stats.successes,
      requests: this.circuitBreaker.stats.requests,
      rollingCounts: this.circuitBreaker.stats.rollingCounts,
      activeRetries: this.retryCount.size
    };
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.circuitBreaker.status === 'OPEN';
  }

  /**
   * Manually open the circuit
   */
  open(): void {
    this.circuitBreaker.open();
  }

  /**
   * Manually close the circuit
   */
  close(): void {
    this.circuitBreaker.close();
  }

  /**
   * Clear retry tracking for a specific request
   */
  clearRetryTracking(requestId?: string): void {
    if (requestId) {
      this.retryCount.delete(requestId);
      this.lastRetryTime.delete(requestId);
      this.rateLimitResetTime.delete(requestId);
    } else {
      this.retryCount.clear();
      this.lastRetryTime.clear();
      this.rateLimitResetTime.clear();
    }
  }
}

/**
 * Factory function to create rate limit aware circuit breakers
 */
export function createRateLimitAwareCircuitBreaker<T extends any[], R>(
  action: (...args: T) => Promise<R>,
  config: Partial<RateLimitAwareOptions> = {},
  identifier?: string
): RateLimitAwareCircuitBreaker<T, R> {
  return new RateLimitAwareCircuitBreaker(action, config, identifier);
}

/**
 * Decorator to add circuit breaker to a method
 */
export function withCircuitBreaker(
  config: Partial<RateLimitAwareOptions> = {},
  identifier?: string
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const circuitBreaker = createRateLimitAwareCircuitBreaker(
      originalMethod,
      config,
      identifier || `${target.constructor.name}.${propertyKey}`
    );

    descriptor.value = function (...args: any[]) {
      return circuitBreaker.execute.apply(circuitBreaker, [this, ...args]);
    };

    return descriptor;
  };
}

/**
 * Circuit Breaker Factory for creating service-specific circuit breakers
 */
export class CircuitBreakerFactory {
  private static instances: Map<string, RateLimitAwareCircuitBreaker<any, any>> = new Map();
  
  /**
   * Create or get a circuit breaker for a specific service
   * @param serviceName Name of the service
   * @param options Circuit breaker options
   * @returns Circuit breaker instance
   */
  static create(serviceName: string, options?: Partial<RateLimitAwareOptions>): RateLimitAwareCircuitBreaker<any, any> {
    if (this.instances.has(serviceName)) {
      return this.instances.get(serviceName)!;
    }
    
    // Create a generic action function that can be used for any service
    const genericAction = async (...args: any[]) => {
      throw new Error(`Circuit breaker for ${serviceName} called without proper action`);
    };
    
    const circuitBreaker = createRateLimitAwareCircuitBreaker(
      genericAction,
      options,
      serviceName
    );
    
    this.instances.set(serviceName, circuitBreaker);
    return circuitBreaker;
  }
  
  /**
   * Clear all circuit breaker instances
   */
  static clear(): void {
    this.instances.clear();
  }
}
