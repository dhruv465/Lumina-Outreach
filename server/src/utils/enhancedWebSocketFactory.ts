/**
 * Enhanced WebSocket Factory
 * 
 * Provides a centralized way to create enhanced WebSocket connections
 * with robust reconnection, heartbeat, and health monitoring capabilities.
 * 
 * This factory ensures all outbound WebSocket connections in the system
 * use the EnhancedWebSocketManager to prevent premature closures.
 */

import { EnhancedWebSocketManager, ConnectionConfig } from './enhancedWebSocketManager';
import { createCompatibleWebSocket, CompatibleWebSocket } from './websocketCompatibility';
import logger from './logger';

export interface EnhancedWebSocketOptions extends Partial<ConnectionConfig> {
  // Additional options specific to the factory
  callId?: string;
  connectionId?: string;
  serviceName?: string;
}

export class EnhancedWebSocketFactory {
  private static instance: EnhancedWebSocketFactory;
  private readonly activeConnections: Map<string, EnhancedWebSocketManager> = new Map();

  private constructor() {}

  public static getInstance(): EnhancedWebSocketFactory {
    if (!EnhancedWebSocketFactory.instance) {
      EnhancedWebSocketFactory.instance = new EnhancedWebSocketFactory();
    }
    return EnhancedWebSocketFactory.instance;
  }

  /**
   * Create an enhanced WebSocket connection
   * @param url - WebSocket URL to connect to
   * @param options - Connection options
   * @returns Promise<EnhancedWebSocketManager>
   */
  public async createConnection(
    url: string, 
    options: EnhancedWebSocketOptions = {}
  ): Promise<EnhancedWebSocketManager> {
    const {
      callId,
      connectionId,
      serviceName = 'unknown-service',
      ...enhancedOptions
    } = options;

    // Generate a unique call ID if not provided
    const finalCallId = callId || `${serviceName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const finalConnectionId = connectionId || `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`Creating enhanced WebSocket connection for ${serviceName}`, {
      url,
      callId: finalCallId,
      connectionId: finalConnectionId,
      serviceName
    });

    // Default configuration optimized for real-time services
    const defaultConfig: Partial<ConnectionConfig> = {
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 15000, // 15 seconds - good balance for real-time services
      connectionTimeout: 10000,
      maxHeartbeatMisses: 3,
      pingInterval: 20000,
      pongTimeout: 5000
    };

    // Merge with provided options
    const config = { ...defaultConfig, ...enhancedOptions };

    // Create enhanced WebSocket manager
    const manager = new EnhancedWebSocketManager(finalCallId, url, config);

    try {
      // Connect
      await manager.connect();

      // Store reference for cleanup
      this.activeConnections.set(finalConnectionId, manager);

      // Set up cleanup on close
      manager.on('disconnected', () => {
        logger.info(`Enhanced WebSocket disconnected for ${serviceName}`, { 
          callId: finalCallId, 
          connectionId: finalConnectionId 
        });
        this.activeConnections.delete(finalConnectionId);
      });

      manager.on('error', (error) => {
        logger.error(`Enhanced WebSocket error for ${serviceName}`, { 
          error: error.message, 
          callId: finalCallId, 
          connectionId: finalConnectionId 
        });
      });

      logger.info(`Enhanced WebSocket connection established for ${serviceName}`, {
        callId: finalCallId,
        connectionId: finalConnectionId,
        isConnected: manager.isConnected()
      });

      return manager;

    } catch (error) {
      logger.error(`Failed to create enhanced WebSocket connection for ${serviceName}`, {
        error: error.message,
        callId: finalCallId,
        connectionId: finalConnectionId,
        url
      });
      throw error;
    }
  }

  /**
   * Create a plain WebSocket using the enhanced manager
   * This method is useful for services that expect a plain WebSocket interface
   */
  public async createPlainWebSocket(
    url: string, 
    options: EnhancedWebSocketOptions = {}
  ): Promise<WebSocket> {
    const manager = await this.createConnection(url, options);
    const ws = manager.getWebSocket();
    
    if (!ws) {
      throw new Error('Failed to get WebSocket from enhanced manager');
    }

    // Attach cleanup reference to the WebSocket
    (ws as any)._enhancedManager = manager;

    return ws;
  }

  /**
   * Get connection statistics
   */
  public getConnectionStats(): { 
    activeConnections: number;
    connectionIds: string[];
  } {
    return {
      activeConnections: this.activeConnections.size,
      connectionIds: Array.from(this.activeConnections.keys())
    };
  }

  /**
   * Close all active connections
   */
  public async closeAllConnections(): Promise<void> {
    logger.info(`Closing ${this.activeConnections.size} enhanced WebSocket connections`);
    
    const promises = Array.from(this.activeConnections.values()).map(manager => {
      try {
        manager.close();
      } catch (error) {
        logger.error('Error closing enhanced WebSocket connection', { error: error.message });
      }
    });

    await Promise.allSettled(promises);
    this.activeConnections.clear();
    
    logger.info('All enhanced WebSocket connections closed');
  }
}

// Export singleton instance
export const enhancedWebSocketFactory = EnhancedWebSocketFactory.getInstance();

// Export convenience functions
export async function createEnhancedWebSocket(
  url: string, 
  options: EnhancedWebSocketOptions = {}
): Promise<EnhancedWebSocketManager> {
  return enhancedWebSocketFactory.createConnection(url, options);
}

export async function createPlainWebSocket(
  url: string, 
  options: EnhancedWebSocketOptions = {}
): Promise<WebSocket> {
  return enhancedWebSocketFactory.createPlainWebSocket(url, options);
}