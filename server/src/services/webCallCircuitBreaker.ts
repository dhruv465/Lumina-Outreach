/**
 * WebCallCircuitBreaker
 * 
 * Circuit breaker implementation for web call services
 * This service prevents cascading failures by detecting when a service is failing
 * and temporarily stopping requests to that service.
 */

import logger from '../utils/logger';

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'closed',   // Normal operation, requests pass through
  OPEN = 'open',       // Circuit is open, requests fail fast
  HALF_OPEN = 'half-open' // Testing if service is back online
}

/**
 * Service type
 */
export enum ServiceType {
  SPEECH_TO_TEXT = 'speechToText',
  TEXT_TO_SPEECH = 'textToSpeech',
  LLM = 'llm',
  GENERAL = 'general'
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  fallbackFn?: (...args: any[]) => Promise<any>;
}

/**
 * Circuit breaker class
 */
export class WebCallCircuitBreaker {
  private circuits: Map<string, {
    state: CircuitState;
    failures: number;
    lastFailure: number;
    lastSuccess: number;
    resetTimeout: number;
    failureThreshold: number;
    fallbackFn?: (...args: any[]) => Promise<any>;
  }> = new Map();
  
  constructor() {
    // Initialize default circuits
    this.initializeCircuit(ServiceType.SPEECH_TO_TEXT);
    this.initializeCircuit(ServiceType.TEXT_TO_SPEECH);
    this.initializeCircuit(ServiceType.LLM);
    this.initializeCircuit(ServiceType.GENERAL);
    
    // Start health check timer
    setInterval(() => {
      this.checkCircuits();
    }, 5000);
    
    logger.info('WebCallCircuitBreaker initialized');
  }
  
  /**
   * Initialize a circuit
   * @param serviceType Service type
   * @param options Circuit breaker options
   */
  private initializeCircuit(
    serviceType: string,
    options: Partial<CircuitBreakerOptions> = {}
  ): void {
    const now = Date.now();
    
    this.circuits.set(serviceType, {
      state: CircuitState.CLOSED,
      failures: 0,
      lastFailure: 0,
      lastSuccess: now,
      resetTimeout: options.resetTimeout || 30000, // 30 seconds
      failureThreshold: options.failureThreshold || 3,
      fallbackFn: options.fallbackFn
    });
    
    logger.info(`Circuit initialized for service: ${serviceType}`);
  }
  
  /**
   * Execute a function with circuit breaker protection
   * @param serviceType Service type
   * @param fn Function to execute
   * @param options Circuit breaker options
   * @returns Function result
   */
  public async executeWithBreaker<T>(
    serviceType: string,
    fn: () => Promise<T>,
    options: Partial<CircuitBreakerOptions> = {}
  ): Promise<T> {
    // Get or create circuit
    if (!this.circuits.has(serviceType)) {
      this.initializeCircuit(serviceType, options);
    }
    
    const circuit = this.circuits.get(serviceType)!;
    
    // Check if circuit is open
    if (circuit.state === CircuitState.OPEN) {
      logger.warn(`Circuit is open for service: ${serviceType}, failing fast`);
      
      // Use fallback function if provided
      const fallbackFn = options.fallbackFn || circuit.fallbackFn;
      if (fallbackFn) {
        return fallbackFn();
      }
      
      throw new Error(`Service ${serviceType} is unavailable`);
    }
    
    // If half-open, only allow one request to test the service
    if (circuit.state === CircuitState.HALF_OPEN) {
      logger.info(`Circuit is half-open for service: ${serviceType}, testing service`);
    }
    
    try {
      // Execute function
      const result = await fn();
      
      // Record success
      this.recordSuccess(serviceType);
      
      return result;
    } catch (error) {
      // Record failure
      this.recordFailure(serviceType);
      
      // Use fallback function if provided
      const fallbackFn = options.fallbackFn || circuit.fallbackFn;
      if (fallbackFn) {
        logger.info(`Using fallback for service: ${serviceType}`);
        return fallbackFn();
      }
      
      // Re-throw error
      throw error;
    }
  }
  
  /**
   * Record a successful request
   * @param serviceType Service type
   */
  private recordSuccess(serviceType: string): void {
    const circuit = this.circuits.get(serviceType);
    
    if (!circuit) {
      return;
    }
    
    // Update circuit state
    circuit.failures = 0;
    circuit.lastSuccess = Date.now();
    
    // If half-open, close the circuit
    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.CLOSED;
      logger.info(`Circuit closed for service: ${serviceType}`);
    }
  }
  
  /**
   * Record a failed request
   * @param serviceType Service type
   */
  private recordFailure(serviceType: string): void {
    const circuit = this.circuits.get(serviceType);
    
    if (!circuit) {
      return;
    }
    
    // Update circuit state
    circuit.failures++;
    circuit.lastFailure = Date.now();
    
    // Check if threshold is reached
    if (circuit.failures >= circuit.failureThreshold) {
      // Open the circuit
      circuit.state = CircuitState.OPEN;
      logger.warn(`Circuit opened for service: ${serviceType} after ${circuit.failures} failures`);
    }
  }
  
  /**
   * Check circuits and reset if needed
   */
  private checkCircuits(): void {
    const now = Date.now();
    
    for (const [serviceType, circuit] of this.circuits.entries()) {
      // Check if open circuit should be reset to half-open
      if (circuit.state === CircuitState.OPEN) {
        const timeElapsed = now - circuit.lastFailure;
        
        if (timeElapsed >= circuit.resetTimeout) {
          // Reset to half-open
          circuit.state = CircuitState.HALF_OPEN;
          logger.info(`Circuit reset to half-open for service: ${serviceType}`);
        }
      }
    }
  }
  
  /**
   * Get circuit state
   * @param serviceType Service type
   * @returns Circuit state
   */
  public getCircuitState(serviceType: string): CircuitState | null {
    const circuit = this.circuits.get(serviceType);
    
    if (!circuit) {
      return null;
    }
    
    return circuit.state;
  }
  
  /**
   * Get circuit health
   * @returns Circuit health information
   */
  public getHealth(): Record<string, any> {
    const health: Record<string, any> = {};
    
    for (const [serviceType, circuit] of this.circuits.entries()) {
      health[serviceType] = {
        state: circuit.state,
        failures: circuit.failures,
        lastFailure: circuit.lastFailure > 0 ? new Date(circuit.lastFailure).toISOString() : null,
        lastSuccess: new Date(circuit.lastSuccess).toISOString(),
        timeSinceLastFailure: circuit.lastFailure > 0 ? Date.now() - circuit.lastFailure : null,
        resetTimeout: circuit.resetTimeout
      };
    }
    
    return health;
  }
  
  /**
   * Get circuit health for a specific service
   * @param serviceType Service type
   * @returns Circuit health information
   */
  public getCircuitHealth(serviceType: string): any {
    const circuit = this.circuits.get(serviceType);
    
    if (!circuit) {
      return null;
    }
    
    return {
      serviceType,
      state: circuit.state,
      failures: circuit.failures,
      lastFailure: circuit.lastFailure > 0 ? new Date(circuit.lastFailure).toISOString() : null,
      lastSuccess: new Date(circuit.lastSuccess).toISOString(),
      timeSinceLastFailure: circuit.lastFailure > 0 ? Date.now() - circuit.lastFailure : null,
      resetTimeout: circuit.resetTimeout
    };
  }
  
  /**
   * Get health for all circuits
   * @returns Array of circuit health information
   */
  public getAllCircuitHealth(): any[] {
    const health: any[] = [];
    
    for (const [serviceType, circuit] of this.circuits.entries()) {
      health.push({
        serviceType,
        state: circuit.state,
        failures: circuit.failures,
        lastFailure: circuit.lastFailure > 0 ? new Date(circuit.lastFailure).toISOString() : null,
        lastSuccess: new Date(circuit.lastSuccess).toISOString(),
        timeSinceLastFailure: circuit.lastFailure > 0 ? Date.now() - circuit.lastFailure : null,
        resetTimeout: circuit.resetTimeout
      });
    }
    
    return health;
  }
  
  /**
   * Force reset a circuit
   * @param serviceType Service type
   * @param reason Reason for reset
   */
  public forceReset(serviceType: string, reason: string = 'manual'): void {
    const circuit = this.circuits.get(serviceType);
    
    if (!circuit) {
      return;
    }
    
    // Reset circuit state
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.lastSuccess = Date.now();
    
    logger.info(`Circuit manually reset for service: ${serviceType}, reason: ${reason}`);
  }
  
  /**
   * Reset circuit
   * @param serviceType Service type
   */
  public resetCircuit(serviceType: string): void {
    const circuit = this.circuits.get(serviceType);
    
    if (!circuit) {
      return;
    }
    
    // Reset circuit state
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.lastSuccess = Date.now();
    
    logger.info(`Circuit manually reset for service: ${serviceType}`);
  }
  
  /**
   * Reset all circuits
   */
  public resetAllCircuits(): void {
    for (const serviceType of this.circuits.keys()) {
      this.resetCircuit(serviceType);
    }
    
    logger.info('All circuits reset');
  }
}

// Create singleton instance
const webCallCircuitBreaker = new WebCallCircuitBreaker();

export default webCallCircuitBreaker;