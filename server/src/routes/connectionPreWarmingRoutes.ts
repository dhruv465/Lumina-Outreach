import { FastifyInstance } from 'fastify';
import { 
  getConnectionPreWarmingService
} from '../services/connectionPreWarmingService';
import { getWebSocketConnectionPool as getPool } from '../services/websocketConnectionPool';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

export default async function connectionPreWarmingRoutes(fastify: FastifyInstance<any, any, any, any, any>) {
  // Get pre-warming statistics
  fastify.get('/stats', async (req, res) => {
    try {
      const preWarmingService = getConnectionPreWarmingService();
      const connectionPool = getPool();

      if (!preWarmingService || !connectionPool) {
        return res.status(503).send({
          success: false,
          error: 'Pre-warming services not initialized'
        });
      }

      const preWarmingStats = preWarmingService.getStats();
      const poolStats = connectionPool.getStats();
      const health = preWarmingService.getConnectionHealth();

      res.status(200).send({
        success: true,
        preWarming: preWarmingStats,
        connectionPool: poolStats,
        health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error getting pre-warming statistics', {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Get available models
  fastify.get('/models', async (req, res) => {
    try {
      const preWarmingService = getConnectionPreWarmingService();

      if (!preWarmingService) {
        return res.status(503).send({
          success: false,
          error: 'Pre-warming service not initialized'
        });
      }

      const availableModels = preWarmingService.getAvailableModels();
      const health = preWarmingService.getConnectionHealth();

      res.status(200).send({
        success: true,
        availableModels,
        readyModels: health.readyModels,
        totalConnections: health.totalConnections,
        healthy: health.healthy
      });
    } catch (error) {
      logger.error('Error getting available models', {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Check if a specific model is ready
  fastify.get('/models/:model/ready', async (req, res) => {
    try {
      const { model } = req.params as { model: string };
      const preWarmingService = getConnectionPreWarmingService();

      if (!preWarmingService) {
        return res.status(503).send({
          success: false,
          error: 'Pre-warming service not initialized'
        });
      }

      const isReady = preWarmingService.isModelReady(model);
      const health = preWarmingService.getConnectionHealth();

      res.status(200).send({
        success: true,
        model,
        isReady,
        availableModels: health.readyModels,
        totalConnections: health.totalConnections
      });
    } catch (error) {
      logger.error(`Error checking model readiness for ${(req.params as any).model}`, {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Refresh all pre-warmed connections
  fastify.post('/refresh', async (req, res) => {
    try {
      const preWarmingService = getConnectionPreWarmingService();

      if (!preWarmingService) {
        return res.status(503).send({
          success: false,
          error: 'Pre-warming service not initialized'
        });
      }

      logger.info('Manually refreshing pre-warmed connections');
      await preWarmingService.refreshConnections();

      const stats = preWarmingService.getStats();
      const health = preWarmingService.getConnectionHealth();

      res.status(200).send({
        success: true,
        message: 'Connections refreshed successfully',
        stats,
        health
      });
    } catch (error) {
      logger.error('Error refreshing pre-warmed connections', {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Get connection pool statistics
  fastify.get('/pool/stats', async (req, res) => {
    try {
      const connectionPool = getPool();

      if (!connectionPool) {
        return res.status(503).send({
          success: false,
          error: 'Connection pool not initialized'
        });
      }

      const stats = connectionPool.getStats();

      res.status(200).send({
        success: true,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error getting connection pool statistics', {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Get connections by model
  fastify.get('/pool/models/:model', async (req, res) => {
    try {
      const { model } = req.params as { model: string };
      const connectionPool = getPool();

      if (!connectionPool) {
        return res.status(503).send({
          success: false,
          error: 'Connection pool not initialized'
        });
      }

      const connections = connectionPool.getConnectionsByModel(model);

      res.status(200).send({
        success: true,
        model,
        connections: connections.map(conn => ({
          connectionId: conn.connectionId,
          callId: conn.callId,
          conversationId: conn.conversationId,
          isActive: conn.isActive,
          createdAt: conn.createdAt,
          lastActivity: conn.lastActivity,
          messageCount: conn.messageCount,
          errorCount: conn.errorCount
        }))
      });
    } catch (error) {
      logger.error(`Error getting connections for model ${(req.params as any).model}`, {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Get connections for a specific call
  fastify.get('/pool/calls/:callId', async (req, res) => {
    try {
      const { callId } = req.params as { callId: string };
      const connectionPool = getPool();

      if (!connectionPool) {
        return res.status(503).send({
          success: false,
          error: 'Connection pool not initialized'
        });
      }

      const connections = connectionPool.getCallConnections(callId);

      res.status(200).send({
        success: true,
        callId,
        connections: connections.map(conn => ({
          connectionId: conn.connectionId,
          conversationId: conn.conversationId,
          model: conn.model,
          isActive: conn.isActive,
          createdAt: conn.createdAt,
          lastActivity: conn.lastActivity,
          messageCount: conn.messageCount,
          errorCount: conn.errorCount
        }))
      });
    } catch (error) {
      logger.error(`Error getting connections for call ${(req.params as any).callId}`, {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Close connections for a specific call
  fastify.delete('/pool/calls/:callId', async (req, res) => {
    try {
      const { callId } = req.params as { callId: string };
      const connectionPool = getPool();

      if (!connectionPool) {
        return res.status(503).send({
          success: false,
          error: 'Connection pool not initialized'
        });
      }

      const closedCount = await connectionPool.closeCallConnections(callId);

      res.status(200).send({
        success: true,
        callId,
        closedConnections: closedCount,
        message: `Closed ${closedCount} connections for call ${callId}`
      });
    } catch (error) {
      logger.error(`Error closing connections for call ${(req.params as any).callId}`, {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error)
      });
    }
  });

  // Check connection health
  fastify.get('/health', async (req, res) => {
    try {
      const preWarmingService = getConnectionPreWarmingService();
      const connectionPool = getPool();

      if (!preWarmingService || !connectionPool) {
        return res.status(503).send({
          success: false,
          error: 'Services not initialized',
          healthy: false
        });
      }

      const preWarmingHealth = preWarmingService.getConnectionHealth();
      const poolStats = connectionPool.getStats();

      const healthy = preWarmingHealth.healthy && poolStats.errorRate < 10;

      res.status(200).send({
        success: true,
        healthy,
        preWarming: preWarmingHealth,
        connectionPool: {
          totalConnections: poolStats.totalConnections,
          activeConnections: poolStats.activeConnections,
          errorRate: poolStats.errorRate
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error checking connection health', {
        error: getErrorMessage(error)
      });

      res.status(500).send({
        success: false,
        error: getErrorMessage(error),
        healthy: false
      });
    }
  });
}