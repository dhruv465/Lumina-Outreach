import { performanceMonitor } from '../utils/performanceMonitor';
import { responseCache } from '../utils/responseCache';
import { getAuthCacheStats } from '../middleware/auth';

const performanceRoutes = async (fastify, opts: Record<string, any>) => {
  // Only allow in development or for authenticated admin users
  if (process.env.NODE_ENV === 'production') {
    fastify.addHook('onRequest', fastify.authenticate);
  }

  /**
   * Get performance metrics
   */
  fastify.get('/metrics', async (request, reply) => {
    const metrics = performanceMonitor.getMetrics();
    const authCacheStats = getAuthCacheStats();
    const responseCacheStats = responseCache.getStats();

    return {
      performance: {
        totalRequests: metrics.totalRequests,
        averageResponseTime: `${metrics.averageResponseTime.toFixed(2)}ms`,
        percentiles: {
          p50: `${metrics.p50}ms`,
          p95: `${metrics.p95}ms`,
          p99: `${metrics.p99}ms`,
        },
        topSlowestRoutes: metrics.topSlowestRoutes.slice(0, 10).map(route => ({
          route: route.route,
          avgTime: `${route.avgTime.toFixed(2)}ms`,
          maxTime: `${route.maxTime}ms`,
          count: route.count,
        })),
      },
      caching: {
        auth: {
          hits: authCacheStats.hits,
          misses: authCacheStats.misses,
          keys: authCacheStats.keys,
          hitRate: authCacheStats.hits > 0 
            ? `${((authCacheStats.hits / (authCacheStats.hits + authCacheStats.misses)) * 100).toFixed(2)}%`
            : '0%',
        },
        response: {
          hits: responseCacheStats.hits,
          misses: responseCacheStats.misses,
          keys: responseCacheStats.keys,
          hitRate: responseCacheStats.hits > 0
            ? `${((responseCacheStats.hits / (responseCacheStats.hits + responseCacheStats.misses)) * 100).toFixed(2)}%`
            : '0%',
        },
      },
      memory: {
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
        rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
      },
      uptime: `${(process.uptime() / 60).toFixed(2)} minutes`,
    };
  });

  /**
   * Reset performance metrics
   */
  fastify.post('/metrics/reset', async (request, reply) => {
    performanceMonitor.reset();
    return { message: 'Performance metrics reset successfully' };
  });

  /**
   * Clear response cache
   */
  fastify.post('/cache/clear', async (request, reply) => {
    responseCache.clear();
    return { message: 'Response cache cleared successfully' };
  });

  /**
   * Invalidate specific cache pattern
   */
  fastify.post('/cache/invalidate', async (request, reply) => {
    const { pattern } = request.body as { pattern: string };
    if (!pattern) {
      return reply.status(400).send({ error: 'Pattern is required' });
    }
    const count = responseCache.invalidate(pattern);
    return { message: `Invalidated ${count} cache entries matching pattern: ${pattern}` };
  });
};

export default performanceRoutes;
