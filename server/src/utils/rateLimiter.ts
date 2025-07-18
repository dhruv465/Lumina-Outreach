/**
 * Advanced Rate Limiter for API Requests
 * 
 * This utility provides token bucket rate limiting to prevent 429 errors
 * by proactively managing request rates to external APIs.
 */

import { logger } from '../index';

interface RateLimitOptions {
  requestsPerMinute: number;  // Maximum requests per minute
  burstCapacity?: number;     // Maximum burst capacity (defaults to requestsPerMinute)
  refillRate?: number;        // Rate at which tokens refill per second
  queueSize?: number;         // Maximum size of the waiting queue (0 = no queue)
  provider: string;           // Provider name for logging
}

interface QueuedRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  execute: () => Promise<any>;
  timestamp: number;
  timeoutId?: NodeJS.Timeout;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number;
  private provider: string;
  private requestQueue: QueuedRequest[] = [];
  private queueSize: number;
  private processing: boolean = false;
  private windowResetTime: number = 0;
  private requestsThisWindow: number = 0;

  constructor(options: RateLimitOptions) {
    this.maxTokens = options.burstCapacity || options.requestsPerMinute;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.refillRate = options.refillRate || (options.requestsPerMinute / 60); // tokens per second
    this.provider = options.provider;
    this.queueSize = options.queueSize || 0;
    
    logger.info(`Rate limiter initialized for ${this.provider}: ${options.requestsPerMinute} requests/minute, ${this.refillRate.toFixed(2)} tokens/second`);
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    
    if (elapsedSeconds > 0) {
      // Calculate tokens to add based on elapsed time and refill rate
      const tokensToAdd = elapsedSeconds * this.refillRate;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
    
    // Check if we've passed the window reset time
    if (this.windowResetTime > 0 && now > this.windowResetTime) {
      logger.info(`Rate limit window reset for ${this.provider}`);
      this.windowResetTime = 0;
      this.requestsThisWindow = 0;
      // Don't reset tokens here - that's handled by the refill mechanism
    }
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>, timeout: number = 30000): Promise<T> {
    // First, refill tokens based on elapsed time
    this.refillTokens();
    
    // If we have tokens available and not in a rate limit window, execute immediately
    if (this.tokens >= 1 && this.windowResetTime <= Date.now()) {
      this.tokens -= 1;
      this.requestsThisWindow += 1;
      
      try {
        return await fn();
      } catch (error: any) {
        // Check if this is a rate limit error
        if (this.isRateLimitError(error)) {
          // Set window reset time based on error response
          const resetTime = this.extractResetTime(error);
          if (resetTime) {
            this.windowResetTime = resetTime;
            logger.warn(`Rate limit reached, waiting ${Math.ceil((resetTime - Date.now()) / 1000)}s for window reset`);
          } else {
            // Default to 60 seconds if no reset time provided
            this.windowResetTime = Date.now() + 60000;
            logger.warn(`Rate limit reached, waiting 60s for window reset`);
          }
          
          // Queue the request if queueing is enabled
          if (this.queueSize > 0) {
            return this.queueRequest(fn, timeout);
          }
          
          throw new Error(`Rate limit exceeded for ${this.provider}. Please try again later.`);
        }
        
        // For other errors, just rethrow
        throw error;
      }
    }
    
    // If we're in a rate limit window or out of tokens, queue the request
    if (this.queueSize > 0) {
      return this.queueRequest(fn, timeout);
    }
    
    // If queueing is disabled, throw an error
    const waitTime = this.windowResetTime > Date.now() 
      ? Math.ceil((this.windowResetTime - Date.now()) / 1000)
      : Math.ceil((1 - this.tokens) / this.refillRate);
      
    throw new Error(`Rate limit would be exceeded for ${this.provider}. Please wait ${waitTime}s before retrying.`);
  }

  /**
   * Queue a request for later execution
   */
  private queueRequest<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Check if queue is full
      if (this.requestQueue.length >= this.queueSize) {
        reject(new Error(`Request queue full for ${this.provider}. Please try again later.`));
        return;
      }
      
      // Create timeout handler
      const timeoutId = setTimeout(() => {
        // Find and remove the request from the queue
        const index = this.requestQueue.findIndex(req => req.timeoutId === timeoutId);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
          reject(new Error(`Request timed out after ${timeout}ms while waiting for rate limit window`));
        }
      }, timeout);
      
      // Add request to queue
      this.requestQueue.push({
        resolve,
        reject,
        execute: fn,
        timestamp: Date.now(),
        timeoutId
      });
      
      logger.debug(`Request queued for ${this.provider}. Queue size: ${this.requestQueue.length}`);
      
      // Start processing the queue if not already processing
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued requests as tokens become available
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    
    try {
      while (this.requestQueue.length > 0) {
        // Refill tokens
        this.refillTokens();
        
        // Check if we can process a request
        if (this.tokens >= 1 && this.windowResetTime <= Date.now()) {
          // Get the oldest request
          const request = this.requestQueue.shift();
          
          if (!request) continue;
          
          // Clear the timeout
          if (request.timeoutId) {
            clearTimeout(request.timeoutId);
          }
          
          // Use a token
          this.tokens -= 1;
          this.requestsThisWindow += 1;
          
          try {
            // Execute the request
            const result = await request.execute();
            request.resolve(result);
          } catch (error: any) {
            // Check if this is a rate limit error
            if (this.isRateLimitError(error)) {
              // Set window reset time based on error response
              const resetTime = this.extractResetTime(error);
              if (resetTime) {
                this.windowResetTime = resetTime;
                logger.warn(`Rate limit reached while processing queue, waiting ${Math.ceil((resetTime - Date.now()) / 1000)}s for window reset`);
              } else {
                // Default to 60 seconds if no reset time provided
                this.windowResetTime = Date.now() + 60000;
                logger.warn(`Rate limit reached while processing queue, waiting 60s for window reset`);
              }
              
              // Put the request back at the front of the queue
              this.requestQueue.unshift(request);
              
              // Wait for the window to reset
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            
            // For other errors, reject the request
            request.reject(error);
          }
        } else {
          // Calculate wait time
          const waitTime = this.windowResetTime > Date.now()
            ? Math.min(this.windowResetTime - Date.now(), 5000) // Cap at 5 seconds
            : Math.min(Math.ceil(1000 / this.refillRate), 5000); // Cap at 5 seconds
          
          // Wait for tokens to refill or window to reset
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Check if an error is a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    // Check for common rate limit error patterns
    return (
      error?.status === 429 ||
      error?.response?.status === 429 ||
      error?.statusCode === 429 ||
      error?.code === 'rate_limit_exceeded' ||
      error?.message?.includes('rate limit') ||
      error?.message?.includes('quota exceeded') ||
      error?.message?.includes('Too Many Requests')
    );
  }

  /**
   * Extract rate limit reset time from error
   */
  private extractResetTime(error: any): number | null {
    try {
      // Check for Google-specific error format
      if (error?.rawError?.errorDetails) {
        for (const detail of error.rawError.errorDetails) {
          if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
            const retryDelay = detail.retryDelay;
            // Parse "57s" format
            const seconds = parseInt(retryDelay.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(seconds)) {
              return Date.now() + (seconds * 1000);
            }
          }
        }
      }
      
      // Check common headers
      const headers = error?.response?.headers;
      if (headers) {
        // Check Retry-After header
        if (headers['retry-after']) {
          const retryAfter = parseInt(headers['retry-after'], 10);
          if (!isNaN(retryAfter)) {
            return Date.now() + (retryAfter * 1000);
          }
        }
        
        // Check X-RateLimit-Reset header
        if (headers['x-ratelimit-reset']) {
          const resetTime = parseInt(headers['x-ratelimit-reset'], 10);
          if (!isNaN(resetTime)) {
            // Check if it's in seconds or milliseconds
            return resetTime > 1000000000000 ? resetTime : resetTime * 1000;
          }
        }
      }
      
      // Check error message for time information
      if (typeof error.message === 'string') {
        // Look for patterns like "Please retry after 30 seconds"
        const retryMatch = error.message.match(/retry after (\d+) second/i);
        if (retryMatch && retryMatch[1]) {
          const seconds = parseInt(retryMatch[1], 10);
          if (!isNaN(seconds)) {
            return Date.now() + (seconds * 1000);
          }
        }
      }
      
      return null;
    } catch (e) {
      logger.error(`Error extracting reset time: ${e}`);
      return null;
    }
  }

  /**
   * Get current rate limiter status
   */
  getStatus() {
    this.refillTokens();
    return {
      provider: this.provider,
      availableTokens: this.tokens,
      maxTokens: this.maxTokens,
      queueLength: this.requestQueue.length,
      queueSize: this.queueSize,
      inRateLimitWindow: this.windowResetTime > Date.now(),
      windowResetIn: Math.max(0, Math.ceil((this.windowResetTime - Date.now()) / 1000)),
      requestsThisWindow: this.requestsThisWindow
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.windowResetTime = 0;
    this.requestsThisWindow = 0;
    
    // Reject all queued requests
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        request.reject(new Error(`Request cancelled due to rate limiter reset`));
      }
    }
  }
}

// Global rate limiters for different providers
const rateLimiters: Map<string, TokenBucketRateLimiter> = new Map();

/**
 * Get or create a rate limiter for a provider
 */
export function getRateLimiter(provider: string, options?: Partial<RateLimitOptions>): TokenBucketRateLimiter {
  if (!rateLimiters.has(provider)) {
    // Default options based on provider
    let defaultOptions: RateLimitOptions;
    
    switch (provider.toLowerCase()) {
      case 'google':
      case 'gemini':
        defaultOptions = {
          requestsPerMinute: 15,  // Google Gemini free tier limit
          burstCapacity: 5,       // Allow small bursts
          queueSize: 20,          // Queue up to 20 requests
          provider: provider
        };
        break;
        
      case 'openai':
        defaultOptions = {
          requestsPerMinute: 60,  // OpenAI default tier
          burstCapacity: 10,
          queueSize: 30,
          provider: provider
        };
        break;
        
      case 'anthropic':
        defaultOptions = {
          requestsPerMinute: 50,  // Anthropic default tier
          burstCapacity: 10,
          queueSize: 20,
          provider: provider
        };
        break;
        
      case 'elevenlabs':
        defaultOptions = {
          requestsPerMinute: 30,  // ElevenLabs default tier
          burstCapacity: 5,
          queueSize: 10,
          provider: provider
        };
        break;
        
      default:
        defaultOptions = {
          requestsPerMinute: 30,  // Conservative default
          burstCapacity: 5,
          queueSize: 10,
          provider: provider
        };
    }
    
    // Merge with provided options
    const mergedOptions = { ...defaultOptions, ...options };
    
    // Create and store the rate limiter
    rateLimiters.set(provider, new TokenBucketRateLimiter(mergedOptions));
  }
  
  return rateLimiters.get(provider)!;
}

/**
 * Execute a function with rate limiting
 */
export async function executeWithRateLimit<T>(
  provider: string,
  fn: () => Promise<T>,
  options?: Partial<RateLimitOptions>
): Promise<T> {
  const limiter = getRateLimiter(provider, options);
  return limiter.execute(fn);
}

/**
 * Reset a rate limiter
 */
export function resetRateLimiter(provider: string): void {
  if (rateLimiters.has(provider)) {
    rateLimiters.get(provider)!.reset();
  }
}

/**
 * Get status of all rate limiters
 */
export function getAllRateLimiterStatus(): Record<string, any> {
  const status: Record<string, any> = {};
  
  for (const [provider, limiter] of rateLimiters.entries()) {
    status[provider] = limiter.getStatus();
  }
  
  return status;
}