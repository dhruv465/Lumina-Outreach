// Type definitions for CircuitBreaker
declare module '../utils/circuitBreaker' {
  export interface CircuitBreakerOptions {
    failureThreshold?: number;
    resetTimeout?: number;
    maxRetries?: number;
    retryDelay?: number;
  }

  export interface CircuitBreaker {
    execute<T>(fn: () => Promise<T>): Promise<T | null>;
    isOpen(): boolean;
    isClosed(): boolean;
    isHalfOpen(): boolean;
    reset(): void;
  }

  export class CircuitBreakerFactory {
    static create(serviceName: string, options?: CircuitBreakerOptions): CircuitBreaker;
  }
}
