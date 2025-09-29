import { WebSocket } from 'ws';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { ConnectionPreWarmingService, getConnectionPreWarmingService } from './connectionPreWarmingService';

export interface PooledWebSocketConnection {
  connectionId: string;
  callId: string;
  conversationId: string;
  model: string;
  connection: any;
  isActive: boolean;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  errorCount: number;
}

export interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  errorRate: number;
  averageMessageCount: number;
  oldestConnection: Date | null;
  newestConnection: Date | null;
}

export class WebSocketConnectionPool {
  private connections: Map<string, PooledWebSocketConnection> = new Map();
  private preWarmingService: ConnectionPreWarmingService | null = null;
  private maxConnections: number = 100;
  private connectionTimeout: number = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.preWarmingService = getConnectionPreWarmingService();
    this.startCleanupTimer();
  }

  /**
   * Get or create a WebSocket connection for a call
   */
  async getConnection(
    callId: string,
    conversationId: string,
    model: string = 'aura-asteria-en',
    options: any = {}
  ): Promise<PooledWebSocketConnection | null> {
    const connectionId = `${callId}-${conversationId}`;

    try {
      // Check if connection already exists
      let pooledConnection = this.connections.get(connectionId);
      
      if (pooledConnection && pooledConnection.isActive) {
        logger.debug(`Reusing existing connection for call ${callId}`);
        pooledConnection.lastActivity = new Date();
        return pooledConnection;
      }

      // Try to get a pre-warmed connection
      let connection = null;
      if (this.preWarmingService) {
        connection = await this.preWarmingService.createConnectionFromPreWarmed(model, options);
      }

      // If no pre-warmed connection available, create a new one
      if (!connection) {
        logger.warn(`No pre-warmed connection available for model ${model}, creating new one`);
        // This would typically create a new Deepgram connection
        // For now, we'll return null and let the calling code handle it
        return null;
      }

      // Create pooled connection
      pooledConnection = {
        connectionId,
        callId,
        conversationId,
        model,
        connection,
        isActive: true,
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        errorCount: 0
      };

      this.connections.set(connectionId, pooledConnection);

      logger.info(`Created new pooled connection for call ${callId} with model ${model}`, {
        connectionId,
        model,
        totalConnections: this.connections.size
      });

      return pooledConnection;

    } catch (error) {
      logger.error(`Failed to get connection for call ${callId}`, {
        error: getErrorMessage(error),
        model,
        connectionId
      });
      return null;
    }
  }

  /**
   * Send audio data through a pooled connection
   */
  async sendAudioData(
    connectionId: string,
    audioData: Buffer
  ): Promise<boolean> {
    const pooledConnection = this.connections.get(connectionId);
    
    if (!pooledConnection || !pooledConnection.isActive) {
      logger.warn(`Connection ${connectionId} not found or inactive`);
      return false;
    }

    try {
      // Send audio data through the connection
      pooledConnection.connection.send(audioData);
      pooledConnection.messageCount++;
      pooledConnection.lastActivity = new Date();

      logger.debug(`Sent audio data through connection ${connectionId}`, {
        dataSize: audioData.length,
        messageCount: pooledConnection.messageCount
      });

      return true;

    } catch (error) {
      pooledConnection.errorCount++;
      logger.error(`Failed to send audio data through connection ${connectionId}`, {
        error: getErrorMessage(error),
        messageCount: pooledConnection.messageCount,
        errorCount: pooledConnection.errorCount
      });
      return false;
    }
  }

  /**
   * Close a specific connection
   */
  async closeConnection(connectionId: string): Promise<boolean> {
    const pooledConnection = this.connections.get(connectionId);
    
    if (!pooledConnection) {
      logger.warn(`Connection ${connectionId} not found`);
      return false;
    }

    try {
      // Close the underlying connection
      if (pooledConnection.connection && typeof pooledConnection.connection.close === 'function') {
        pooledConnection.connection.close();
      }

      // Mark as inactive
      pooledConnection.isActive = false;
      this.connections.delete(connectionId);

      logger.info(`Closed connection ${connectionId}`, {
        callId: pooledConnection.callId,
        conversationId: pooledConnection.conversationId,
        messageCount: pooledConnection.messageCount,
        errorCount: pooledConnection.errorCount
      });

      return true;

    } catch (error) {
      logger.error(`Failed to close connection ${connectionId}`, {
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Close all connections for a specific call
   */
  async closeCallConnections(callId: string): Promise<number> {
    let closedCount = 0;
    
    for (const [connectionId, pooledConnection] of this.connections.entries()) {
      if (pooledConnection.callId === callId) {
        if (await this.closeConnection(connectionId)) {
          closedCount++;
        }
      }
    }

    logger.info(`Closed ${closedCount} connections for call ${callId}`);
    return closedCount;
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionPoolStats {
    const connections = Array.from(this.connections.values());
    const activeConnections = connections.filter(c => c.isActive);
    const idleConnections = connections.filter(c => !c.isActive);
    
    const totalMessages = connections.reduce((sum, c) => sum + c.messageCount, 0);
    const totalErrors = connections.reduce((sum, c) => sum + c.errorCount, 0);
    
    const errorRate = totalMessages > 0 ? (totalErrors / totalMessages) * 100 : 0;
    const averageMessageCount = connections.length > 0 ? totalMessages / connections.length : 0;

    const timestamps = connections.map(c => c.createdAt);
    const oldestConnection = timestamps.length > 0 ? new Date(Math.min(...timestamps.map(d => d.getTime()))) : null;
    const newestConnection = timestamps.length > 0 ? new Date(Math.max(...timestamps.map(d => d.getTime()))) : null;

    return {
      totalConnections: connections.length,
      activeConnections: activeConnections.length,
      idleConnections: idleConnections.length,
      errorRate: Math.round(errorRate * 100) / 100,
      averageMessageCount: Math.round(averageMessageCount * 100) / 100,
      oldestConnection,
      newestConnection
    };
  }

  /**
   * Get connections by model
   */
  getConnectionsByModel(model: string): PooledWebSocketConnection[] {
    return Array.from(this.connections.values()).filter(c => c.model === model);
  }

  /**
   * Get active connections for a call
   */
  getCallConnections(callId: string): PooledWebSocketConnection[] {
    return Array.from(this.connections.values()).filter(c => c.callId === callId && c.isActive);
  }

  /**
   * Check if a connection is healthy
   */
  isConnectionHealthy(connectionId: string): boolean {
    const pooledConnection = this.connections.get(connectionId);
    if (!pooledConnection) return false;

    const now = new Date();
    const timeSinceLastActivity = now.getTime() - pooledConnection.lastActivity.getTime();
    const maxIdleTime = 5 * 60 * 1000; // 5 minutes

    return pooledConnection.isActive && 
           timeSinceLastActivity < maxIdleTime && 
           pooledConnection.errorCount < 10; // Less than 10 errors
  }

  /**
   * Start cleanup timer for stale connections
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 60 * 1000); // Clean up every minute
  }

  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [connectionId, pooledConnection] of this.connections.entries()) {
      const timeSinceLastActivity = now.getTime() - pooledConnection.lastActivity.getTime();
      
      // Clean up if connection is inactive or hasn't been used for a while
      if (!pooledConnection.isActive || 
          timeSinceLastActivity > this.connectionTimeout ||
          pooledConnection.errorCount > 20) {
        
        this.closeConnection(connectionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} stale connections`);
    }
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Close all connections and cleanup
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up WebSocket connection pool');
    
    this.stopCleanupTimer();
    
    // Close all connections
    const closePromises = Array.from(this.connections.keys()).map(connectionId => 
      this.closeConnection(connectionId)
    );
    
    await Promise.all(closePromises);
    
    logger.info('WebSocket connection pool cleanup completed');
  }
}

// Singleton instance
let webSocketConnectionPool: WebSocketConnectionPool | null = null;

export function initializeWebSocketConnectionPool(): WebSocketConnectionPool {
  if (!webSocketConnectionPool) {
    webSocketConnectionPool = new WebSocketConnectionPool();
  }
  return webSocketConnectionPool;
}

export function getWebSocketConnectionPool(): WebSocketConnectionPool | null {
  return webSocketConnectionPool;
}