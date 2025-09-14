/**
 * Connection Pool Service
 * 
 * Manages HTTP connection pooling and network optimization
 * for reduced latency in external API calls.
 */

import { EventEmitter } from 'events';
import { logger } from '../index';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface ConnectionPoolConfig {
  maxConnections: number;
  maxConnectionsPerHost: number;
  keepAlive: boolean;
  keepAliveMsecs: number;
  maxSockets: number;
  maxFreeSockets: number;
  timeout: number;
  freeSocketTimeout: number;
  enableHTTP2: boolean;
  enableCompression: boolean;
  retryAttempts: number;
  retryDelay: number;
}

export interface PooledConnection {
  id: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  agent: http.Agent | https.Agent;
  createdAt: Date;
  lastUsed: Date;
  requestCount: number;
  isHealthy: boolean;
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  totalRequests: number;
  averageLatency: number;
  errorRate: number;
  hostBreakdown: { [host: string]: number };
}

export class ConnectionPoolService extends EventEmitter {
  private pools: Map<string, PooledConnection> = new Map();
  private config: ConnectionPoolConfig;
  private stats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalLatency: number;
    hostStats: Map<string, { requests: number; latency: number; errors: number }>;
  };

  private readonly DEFAULT_CONFIG: ConnectionPoolConfig = {
    maxConnections: 50,
    maxConnectionsPerHost: 10,
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 5000, // 5 seconds
    freeSocketTimeout: 4000, // 4 seconds
    enableHTTP2: false, // Disabled for now due to complexity
    enableCompression: false, // Disabled for latency
    retryAttempts: 2,
    retryDelay: 100
  };

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    super();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      hostStats: new Map()
    };
    
    this.setupCleanupInterval();
  }

  /**
   * Get or create a connection pool for a host
   */
  public getConnection(url: string): PooledConnection {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const protocol = parsedUrl.protocol === 'https:' ? 'https' : 'http';
    const poolKey = `${protocol}://${host}:${port}`;

    let connection = this.pools.get(poolKey);
    
    if (!connection) {
      connection = this.createConnection(poolKey, host, port, protocol);
      this.pools.set(poolKey, connection);
      logger.info(`Created new connection pool for ${poolKey}`);
    }

    // Update usage stats
    connection.lastUsed = new Date();
    connection.requestCount++;

    return connection;
  }

  /**
   * Create a new connection pool
   */
  private createConnection(
    poolKey: string,
    host: string,
    port: number,
    protocol: 'http' | 'https'
  ): PooledConnection {
    const agentOptions = {
      keepAlive: this.config.keepAlive,
      keepAliveMsecs: this.config.keepAliveMsecs,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: this.config.maxFreeSockets,
      timeout: this.config.timeout,
      freeSocketTimeout: this.config.freeSocketTimeout
    };

    const agent = protocol === 'https' 
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions);

    return {
      id: poolKey,
      host,
      port,
      protocol,
      agent,
      createdAt: new Date(),
      lastUsed: new Date(),
      requestCount: 0,
      isHealthy: true
    };
  }

  /**
   * Make an HTTP request using the connection pool
   */
  public async makeRequest(
    url: string,
    options: http.RequestOptions = {}
  ): Promise<{ data: any; statusCode: number; headers: any }> {
    const startTime = Date.now();
    const connection = this.getConnection(url);
    const parsedUrl = new URL(url);

    // Update stats
    this.stats.totalRequests++;
    const hostKey = parsedUrl.hostname;
    const hostStats = this.stats.hostStats.get(hostKey) || { requests: 0, latency: 0, errors: 0 };
    hostStats.requests++;
    this.stats.hostStats.set(hostKey, hostStats);

    return new Promise((resolve, reject) => {
      const requestOptions: http.RequestOptions = {
        ...options,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Connection': 'keep-alive',
          'User-Agent': 'ProjectLumina/1.0',
          ...options.headers
        },
        agent: connection.agent,
        timeout: this.config.timeout
      };

      const request = (parsedUrl.protocol === 'https:' ? https : http).request(
        requestOptions,
        (response) => {
          let data = '';

          response.on('data', (chunk) => {
            data += chunk;
          });

          response.on('end', () => {
            const latency = Date.now() - startTime;
            this.stats.totalLatency += latency;
            hostStats.latency += latency;
            this.stats.hostStats.set(hostKey, hostStats);

            this.stats.successfulRequests++;
            connection.isHealthy = true;

            this.emit('requestSuccess', {
              url,
              statusCode: response.statusCode,
              latency,
              host: hostKey
            });

            resolve({
              data: this.parseResponseData(data, response.headers),
              statusCode: response.statusCode || 200,
              headers: response.headers
            });
          });
        }
      );

      request.on('error', (error) => {
        const latency = Date.now() - startTime;
        this.stats.totalLatency += latency;
        hostStats.latency += latency;
        hostStats.errors++;
        this.stats.hostStats.set(hostKey, hostStats);

        this.stats.failedRequests++;
        connection.isHealthy = false;

        this.emit('requestError', {
          url,
          error: error.message,
          latency,
          host: hostKey
        });

        reject(error);
      });

      request.on('timeout', () => {
        const latency = Date.now() - startTime;
        this.stats.totalLatency += latency;
        hostStats.latency += latency;
        hostStats.errors++;
        this.stats.hostStats.set(hostKey, hostStats);

        this.stats.failedRequests++;
        connection.isHealthy = false;

        request.destroy();

        this.emit('requestTimeout', {
          url,
          latency,
          host: hostKey
        });

        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      });

      // Send request body if provided
      if ((options as any).body) {
        request.write((options as any).body);
      }

      request.end();
    });
  }

  /**
   * Make a POST request with JSON data
   */
  public async postJSON(
    url: string,
    data: any,
    headers: Record<string, string> = {}
  ): Promise<{ data: any; statusCode: number; headers: any }> {
    return this.makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      ...(data && { body: JSON.stringify(data) })
    } as any);
  }

  /**
   * Make a GET request
   */
  public async get(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<{ data: any; statusCode: number; headers: any }> {
    return this.makeRequest(url, {
      method: 'GET',
      headers
    });
  }

  /**
   * Parse response data based on content type
   */
  private parseResponseData(data: string, headers: any): any {
    const contentType = headers['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(data);
      } catch (error) {
        logger.warn('Failed to parse JSON response:', error);
        return data;
      }
    }
    
    return data;
  }

  /**
   * Get connection statistics
   */
  public getStats(): ConnectionStats {
    const totalConnections = this.pools.size;
    const activeConnections = Array.from(this.pools.values())
      .filter(conn => conn.isHealthy).length;
    const idleConnections = totalConnections - activeConnections;
    
    const averageLatency = this.stats.totalRequests > 0 
      ? this.stats.totalLatency / this.stats.totalRequests 
      : 0;
    
    const errorRate = this.stats.totalRequests > 0 
      ? this.stats.failedRequests / this.stats.totalRequests 
      : 0;

    const hostBreakdown: { [host: string]: number } = {};
    for (const [host, stats] of this.stats.hostStats.entries()) {
      hostBreakdown[host] = stats.requests;
    }

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      totalRequests: this.stats.totalRequests,
      averageLatency,
      errorRate,
      hostBreakdown
    };
  }

  /**
   * Get connection details
   */
  public getConnections(): PooledConnection[] {
    return Array.from(this.pools.values());
  }

  /**
   * Get connection for a specific host
   */
  public getConnectionForHost(host: string, port: number, protocol: 'http' | 'https'): PooledConnection | null {
    const poolKey = `${protocol}://${host}:${port}`;
    return this.pools.get(poolKey) || null;
  }

  /**
   * Remove a connection pool
   */
  public removeConnection(url: string): boolean {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const protocol = parsedUrl.protocol === 'https:' ? 'https' : 'http';
    const poolKey = `${protocol}://${host}:${port}`;

    const connection = this.pools.get(poolKey);
    if (connection) {
      // Destroy the agent
      connection.agent.destroy();
      this.pools.delete(poolKey);
      logger.info(`Removed connection pool for ${poolKey}`);
      return true;
    }

    return false;
  }

  /**
   * Remove idle connections
   */
  public removeIdleConnections(maxIdleTime: number = 300000): number { // 5 minutes
    const now = Date.now();
    let removedCount = 0;

    for (const [poolKey, connection] of this.pools.entries()) {
      const idleTime = now - connection.lastUsed.getTime();
      
      if (idleTime > maxIdleTime) {
        connection.agent.destroy();
        this.pools.delete(poolKey);
        removedCount++;
        logger.debug(`Removed idle connection: ${poolKey}`);
      }
    }

    if (removedCount > 0) {
      logger.info(`Removed ${removedCount} idle connections`);
    }

    return removedCount;
  }

  /**
   * Health check for all connections
   */
  public async healthCheck(): Promise<{ healthy: number; unhealthy: number; total: number }> {
    let healthy = 0;
    let unhealthy = 0;

    for (const connection of this.pools.values()) {
      try {
        // Simple health check - try to make a request
        const testUrl = `${connection.protocol}://${connection.host}:${connection.port}/`;
        await this.makeRequest(testUrl, { timeout: 1000 });
        connection.isHealthy = true;
        healthy++;
      } catch (error) {
        connection.isHealthy = false;
        unhealthy++;
      }
    }

    const total = healthy + unhealthy;
    logger.info(`Health check completed: ${healthy} healthy, ${unhealthy} unhealthy, ${total} total`);

    return { healthy, unhealthy, total };
  }

  /**
   * Clear all connections
   */
  public clearAllConnections(): void {
    for (const connection of this.pools.values()) {
      connection.agent.destroy();
    }
    
    this.pools.clear();
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      hostStats: new Map()
    };

    logger.info('Cleared all connection pools');
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<ConnectionPoolConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Connection pool configuration updated');
  }

  /**
   * Setup cleanup interval
   */
  private setupCleanupInterval(): void {
    // Clean up idle connections every 5 minutes
    setInterval(() => {
      this.removeIdleConnections();
    }, 5 * 60 * 1000);

    // Health check every 2 minutes
    setInterval(() => {
      this.healthCheck().catch(error => {
        logger.error('Health check failed:', error);
      });
    }, 2 * 60 * 1000);
  }

  /**
   * Get configuration
   */
  public getConfig(): ConnectionPoolConfig {
    return { ...this.config };
  }

  /**
   * Reset statistics
   */
  public resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      hostStats: new Map()
    };
    logger.info('Connection pool statistics reset');
  }
}

// Export singleton instance
export const connectionPoolService = new ConnectionPoolService();
