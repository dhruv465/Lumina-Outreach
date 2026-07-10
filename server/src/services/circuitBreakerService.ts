import CircuitBreaker from 'opossum';
import { logger } from '../index';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  timeout?: number;
  resetTimeout?: number;
  errorThresholdPercentage?: number;
  rollingCountTimeout?: number;
  rollingCountBuckets?: number;
  capacity?: number;
  volumeThreshold?: number;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitStats {
  name: string;
  state: CircuitState;
  stats: {
    successes: number;
    failures: number;
    rejects: number;
    timeout: number;
    percentiles: {
      '0.5': number;
      '0.9': number;
      '0.95': number;
      '0.99': number;
      '0.995': number;
    };
    latencyMean: number;
  };
  timestamp: Date;
}

/**
 * Default circuit breaker options
 */
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 10000, // Time in ms before a request is considered failed
  resetTimeout: 30000, // Time in ms before trying again after circuit opens
  errorThresholdPercentage: 50, // Percentage of failures before opening the circuit
  rollingCountTimeout: 10000, // Time window for failure percentage calculation
  rollingCountBuckets: 10, // Number of buckets for rolling window
  capacity: 10, // Number of concurrent requests allowed
  volumeThreshold: 5 // Minimum number of requests needed before tripping circuit
};

/**
 * Circuit breaker service for resilient API calls
 * Implements the circuit breaker pattern to prevent cascading failures
 */
export class CircuitBreakerService {
  private circuits: Map<string, any> = new Map();
  
  /**
   * Get a circuit breaker for a specific service
   * Creates one if it doesn't exist
   */
  public getCircuit(name: string, options: CircuitBreakerOptions = {}): any {
    if (!this.circuits.has(name)) {
      this.createCircuit(name, options);
    }
    
    return this.circuits.get(name)!;
  }
  
  /**
   * Create a new circuit breaker
   */
  private createCircuit(name: string, customOptions: CircuitBreakerOptions = {}): any {
    // Merge default options with custom options
    const options = { ...DEFAULT_OPTIONS, ...customOptions };
    
    // Create an action wrapper for the circuit
    // This allows passing any function to fire() and having it executed
    const actionWrapper = async (fn: (...args: any[]) => Promise<any>, ...args: any[]) => {
      return fn(...args);
    };
    
    // Create the circuit breaker
    const circuit = new CircuitBreaker(actionWrapper, {
      timeout: options.timeout,
      resetTimeout: options.resetTimeout,
      errorThresholdPercentage: options.errorThresholdPercentage,
      rollingCountTimeout: options.rollingCountTimeout,
      rollingCountBuckets: options.rollingCountBuckets,
      capacity: options.capacity,
      volumeThreshold: options.volumeThreshold,
      name
    });
    
    // Set up event listeners
    circuit.on('open', () => {
      logger.warn(`Circuit ${name} is now OPEN`);
    });
    
    circuit.on('halfOpen', () => {
      logger.info(`Circuit ${name} is now HALF-OPEN`);
    });
    
    circuit.on('close', () => {
      logger.info(`Circuit ${name} is now CLOSED`);
    });
    
    circuit.on('reject', () => {
      logger.warn(`Circuit ${name} rejected a request`);
    });
    
    circuit.on('timeout', () => {
      logger.warn(`Circuit ${name} request timed out`);
    });
    
    circuit.on('fallback', (result) => {
      logger.info(`Circuit ${name} executed fallback: ${result}`);
    });
    
    this.circuits.set(name, circuit);
    return circuit;
  }
  
  /**
   * Execute a function with circuit breaker protection
   */
  public async execute<T>(
    circuitName: string,
    func: () => Promise<T>,
    fallback?: (error: Error) => Promise<T> | T,
    options: CircuitBreakerOptions = {}
  ): Promise<T> {
    const circuit = this.getCircuit(circuitName, options);
    
    if (fallback) {
      circuit.fallback(fallback);
    }
    
    return circuit.fire(func);
  }
  
  /**
   * Get statistics for all circuits
   */
  public getStats(): CircuitStats[] {
    const stats: CircuitStats[] = [];
    
    for (const [name, circuit] of this.circuits.entries()) {
      stats.push({
        name,
        state: circuit.status.state as CircuitState,
        stats: {
          successes: circuit.stats.successes,
          failures: circuit.stats.failures,
          rejects: circuit.stats.rejects,
          timeout: circuit.stats.timeouts,
          percentiles: {
            '0.5': circuit.stats.latency.percentiles['0.5'],
            '0.9': circuit.stats.latency.percentiles['0.9'],
            '0.95': circuit.stats.latency.percentiles['0.95'],
            '0.99': circuit.stats.latency.percentiles['0.99'],
            '0.995': circuit.stats.latency.percentiles['0.995']
          },
          latencyMean: circuit.stats.latency.mean
        },
        timestamp: new Date()
      });
    }
    
    return stats;
  }
  
  /**
   * Reset a specific circuit
   */
  public resetCircuit(name: string): boolean {
    if (this.circuits.has(name)) {
      const circuit = this.circuits.get(name)!;
      circuit.close();
      return true;
    }
    
    return false;
  }
  
  /**
   * Reset all circuits
   */
  public resetAllCircuits(): void {
    for (const circuit of this.circuits.values()) {
      circuit.close();
    }
  }
}

// Singleton instance
let circuitBreakerService: CircuitBreakerService | null = null;

export const getCircuitBreakerService = (): CircuitBreakerService => {
  if (!circuitBreakerService) {
    circuitBreakerService = new CircuitBreakerService();
    logger.info('CircuitBreakerService initialized');
  }
  return circuitBreakerService;
};

export const initializeCircuitBreakerService = (): CircuitBreakerService => {
  circuitBreakerService = new CircuitBreakerService();
  logger.info('CircuitBreakerService initialized');
  return circuitBreakerService;
};
