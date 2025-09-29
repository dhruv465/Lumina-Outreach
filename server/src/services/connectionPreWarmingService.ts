import { createClient } from '@deepgram/sdk';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import Configuration from '../models/Configuration';

export interface PreWarmedConnection {
  connectionId: string;
  client: any;
  model: string;
  tier: string;
  isReady: boolean;
  createdAt: Date;
  lastUsed: Date;
}

export interface PreWarmingStats {
  totalConnections: number;
  readyConnections: number;
  failedConnections: number;
  averageSetupTime: number;
  lastPreWarming: Date;
}

export class ConnectionPreWarmingService {
  private preWarmedConnections: Map<string, PreWarmedConnection> = new Map();
  private isPreWarming: boolean = false;
  private preWarmingStats: PreWarmingStats = {
    totalConnections: 0,
    readyConnections: 0,
    failedConnections: 0,
    averageSetupTime: 0,
    lastPreWarming: new Date()
  };

  constructor() {
    // Clean up connections every 5 minutes
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 5 * 60 * 1000);
  }

  /**
   * Pre-warm connections during server startup
   * Validates models and establishes connections in advance
   */
  async preWarmConnections(): Promise<void> {
    if (this.isPreWarming) {
      logger.info('Pre-warming already in progress, skipping');
      return;
    }

    this.isPreWarming = true;
    const startTime = Date.now();

    try {
      logger.info('Starting connection pre-warming process');

      // Get configuration
      const config = await Configuration.findOne();
      if (!config?.ttsConfig?.deepgramTTS?.apiKey) {
        logger.warn('No Deepgram API key found, skipping pre-warming');
        return;
      }

      const apiKey = config.ttsConfig.deepgramTTS.apiKey;
      const client = createClient(apiKey);

      // Get available models from configuration
      const availableModels = config.ttsConfig.deepgramTTS.availableModels || [
        'aura-asteria-en',
        'aura-2-thalia-en',
        'aura-2-luna-en',
        'aura-2-stella-en',
        'aura-2-zeus-en'
      ];

      // Pre-warm connections for each model
      const preWarmingPromises = availableModels.map(model => 
        this.preWarmModelConnection(client, model, apiKey)
      );

      const results = await Promise.allSettled(preWarmingPromises);
      
      // Process results
      let successCount = 0;
      let failureCount = 0;
      const setupTimes: number[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++;
          if (result.value.setupTime) {
            setupTimes.push(result.value.setupTime);
          }
        } else {
          failureCount++;
          logger.error(`Failed to pre-warm connection for model ${availableModels[index]}`, {
            error: getErrorMessage(result.reason)
          });
        }
      });

      // Update statistics
      this.preWarmingStats = {
        totalConnections: availableModels.length,
        readyConnections: successCount,
        failedConnections: failureCount,
        averageSetupTime: setupTimes.length > 0 ? 
          setupTimes.reduce((a, b) => a + b, 0) / setupTimes.length : 0,
        lastPreWarming: new Date()
      };

      const totalTime = Date.now() - startTime;
      logger.info('Connection pre-warming completed', {
        ...this.preWarmingStats,
        totalTime,
        successRate: `${Math.round((successCount / availableModels.length) * 100)}%`
      });

    } catch (error) {
      logger.error('Connection pre-warming failed', {
        error: getErrorMessage(error)
      });
    } finally {
      this.isPreWarming = false;
    }
  }

  /**
   * Pre-warm a specific model connection
   */
  private async preWarmModelConnection(
    client: any,
    model: string,
    apiKey: string
  ): Promise<{ success: boolean; setupTime?: number }> {
    const startTime = Date.now();
    const connectionId = `prewarm-${model}-${Date.now()}`;

    try {
      logger.debug(`Pre-warming connection for model: ${model}`);

      // Test the model with a simple request
      const testResponse = await client.speak.request(
        { text: 'test' },
        {
          model: model,
          encoding: 'mp3'
        }
      );

      // Get the stream to test connection
      const stream = await testResponse.getStream();
      if (!stream) {
        throw new Error('Failed to get stream from test request');
      }

      // Store the pre-warmed connection
      const preWarmedConnection: PreWarmedConnection = {
        connectionId,
        client: createClient(apiKey), // Create a fresh client for this connection
        model,
        tier: 'base', // Default tier
        isReady: true,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      this.preWarmedConnections.set(connectionId, preWarmedConnection);

      const setupTime = Date.now() - startTime;
      logger.debug(`Pre-warmed connection for model ${model} in ${setupTime}ms`);

      return { success: true, setupTime };

    } catch (error) {
      logger.error(`Failed to pre-warm connection for model ${model}`, {
        error: getErrorMessage(error)
      });
      return { success: false };
    }
  }

  /**
   * Get a pre-warmed connection for a specific model
   */
  getPreWarmedConnection(model: string): PreWarmedConnection | null {
    // Find the most recently used connection for this model
    let bestConnection: PreWarmedConnection | null = null;
    let oldestLastUsed = new Date();

    for (const connection of this.preWarmedConnections.values()) {
      if (connection.model === model && connection.isReady) {
        if (connection.lastUsed < oldestLastUsed) {
          bestConnection = connection;
          oldestLastUsed = connection.lastUsed;
        }
      }
    }

    if (bestConnection) {
      // Update last used time
      bestConnection.lastUsed = new Date();
      logger.debug(`Retrieved pre-warmed connection for model ${model}`);
    }

    return bestConnection;
  }

  /**
   * Create a new connection using pre-warmed client
   */
  async createConnectionFromPreWarmed(
    model: string,
    options: any = {}
  ): Promise<any> {
    const preWarmedConnection = this.getPreWarmedConnection(model);
    
    if (!preWarmedConnection) {
      logger.warn(`No pre-warmed connection available for model ${model}, creating new one`);
      return null;
    }

    try {
      // Use the pre-warmed client to create a new connection
      const connection = preWarmedConnection.client.listen.live({
        model: preWarmedConnection.model,
        tier: preWarmedConnection.tier,
        ...options
      });

      logger.debug(`Created connection from pre-warmed client for model ${model}`);
      return connection;

    } catch (error) {
      logger.error(`Failed to create connection from pre-warmed client for model ${model}`, {
        error: getErrorMessage(error)
      });
      return null;
    }
  }

  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections(): void {
    const now = new Date();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    let cleanedCount = 0;
    for (const [connectionId, connection] of this.preWarmedConnections.entries()) {
      const timeSinceLastUsed = now.getTime() - connection.lastUsed.getTime();
      
      if (timeSinceLastUsed > staleThreshold) {
        this.preWarmedConnections.delete(connectionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} stale pre-warmed connections`);
    }
  }

  /**
   * Get pre-warming statistics
   */
  getStats(): PreWarmingStats & { activeConnections: number } {
    return {
      ...this.preWarmingStats,
      activeConnections: this.preWarmedConnections.size
    };
  }

  /**
   * Force refresh all pre-warmed connections
   */
  async refreshConnections(): Promise<void> {
    logger.info('Refreshing all pre-warmed connections');
    this.preWarmedConnections.clear();
    await this.preWarmConnections();
  }

  /**
   * Get available models from pre-warmed connections
   */
  getAvailableModels(): string[] {
    const models = new Set<string>();
    for (const connection of this.preWarmedConnections.values()) {
      if (connection.isReady) {
        models.add(connection.model);
      }
    }
    return Array.from(models);
  }

  /**
   * Check if a model is pre-warmed and ready
   */
  isModelReady(model: string): boolean {
    return this.getPreWarmedConnection(model) !== null;
  }

  /**
   * Get connection health status
   */
  getConnectionHealth(): {
    healthy: boolean;
    readyModels: string[];
    totalConnections: number;
    lastPreWarming: Date;
  } {
    const readyModels = this.getAvailableModels();
    const healthy = readyModels.length > 0;

    return {
      healthy,
      readyModels,
      totalConnections: this.preWarmedConnections.size,
      lastPreWarming: this.preWarmingStats.lastPreWarming
    };
  }
}

// Singleton instance
let connectionPreWarmingService: ConnectionPreWarmingService | null = null;

export function initializeConnectionPreWarming(): ConnectionPreWarmingService {
  if (!connectionPreWarmingService) {
    connectionPreWarmingService = new ConnectionPreWarmingService();
  }
  return connectionPreWarmingService;
}

export function getConnectionPreWarmingService(): ConnectionPreWarmingService | null {
  return connectionPreWarmingService;
}