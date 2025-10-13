import { FastifyRequest, FastifyReply } from 'fastify';
import logger from './logger';

interface PerformanceMetrics {
  totalRequests: number;
  averageResponseTime: number;
  slowestRoutes: Map<string, { count: number; avgTime: number; maxTime: number }>;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    totalRequests: 0,
    averageResponseTime: 0,
    slowestRoutes: new Map(),
  };

  private responseTimes: number[] = [];
  private readonly MAX_SAMPLES = 1000; // Keep last 1000 samples

  /**
   * Fastify hook to measure request performance
   * Returns both onRequest and onResponse hooks
   */
  public createPerformanceHooks() {
    const requestTimes = new Map<string, number>();

    return {
      onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
        const requestId = `${request.id || Math.random()}`;
        requestTimes.set(requestId, Date.now());
        (request as any)._perfRequestId = requestId;
      },
      onResponse: async (request: FastifyRequest, reply: FastifyReply) => {
        const requestId = (request as any)._perfRequestId;
        const startTime = requestTimes.get(requestId);
        
        if (startTime) {
          const duration = Date.now() - startTime;
          const url = request.raw.url || '';
          const method = request.raw.method || '';
          this.recordRequest(url, duration);
          requestTimes.delete(requestId);

          // Log slow requests (over 1 second)
          if (duration > 1000) {
            logger.warn(`Slow request detected: ${method} ${url} took ${duration}ms`);
          }
        }
      }
    };
  }

  /**
   * Record a request's performance
   */
  private recordRequest(route: string, duration: number) {
    this.metrics.totalRequests++;
    
    // Update response times
    this.responseTimes.push(duration);
    if (this.responseTimes.length > this.MAX_SAMPLES) {
      this.responseTimes.shift();
    }

    // Calculate average
    this.metrics.averageResponseTime = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;

    // Track per-route metrics
    const routeKey = this.normalizeRoute(route);
    const existing = this.metrics.slowestRoutes.get(routeKey) || { count: 0, avgTime: 0, maxTime: 0 };
    
    const newCount = existing.count + 1;
    const newAvg = (existing.avgTime * existing.count + duration) / newCount;
    const newMax = Math.max(existing.maxTime, duration);

    this.metrics.slowestRoutes.set(routeKey, {
      count: newCount,
      avgTime: newAvg,
      maxTime: newMax,
    });
  }

  /**
   * Normalize route to remove IDs and query params
   */
  private normalizeRoute(route: string): string {
    return route
      .split('?')[0] // Remove query params
      .replace(/\/[0-9a-f]{24}/gi, '/:id') // Replace MongoDB IDs
      .replace(/\/\d+/g, '/:id'); // Replace numeric IDs
  }

  /**
   * Get current performance metrics
   */
  public getMetrics(): PerformanceMetrics & { 
    p50: number; 
    p95: number; 
    p99: number;
    topSlowestRoutes: Array<{ route: string; avgTime: number; maxTime: number; count: number }>;
  } {
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    // Get top 10 slowest routes
    const topSlowestRoutes = Array.from(this.metrics.slowestRoutes.entries())
      .map(([route, metrics]) => ({ route, ...metrics }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, 10);

    return {
      ...this.metrics,
      p50,
      p95,
      p99,
      topSlowestRoutes,
    };
  }

  /**
   * Reset all metrics
   */
  public reset() {
    this.metrics = {
      totalRequests: 0,
      averageResponseTime: 0,
      slowestRoutes: new Map(),
    };
    this.responseTimes = [];
  }

  /**
   * Log performance summary
   */
  public logSummary() {
    const metrics = this.getMetrics();
    logger.info('Performance Summary:', {
      totalRequests: metrics.totalRequests,
      avgResponseTime: `${metrics.averageResponseTime.toFixed(2)}ms`,
      p50: `${metrics.p50}ms`,
      p95: `${metrics.p95}ms`,
      p99: `${metrics.p99}ms`,
      topSlowestRoutes: metrics.topSlowestRoutes.slice(0, 5),
    });
  }
}

export const performanceMonitor = new PerformanceMonitor();

// Log performance summary every 5 minutes
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    performanceMonitor.logSummary();
  }, 5 * 60 * 1000);
}

// Export for backward compatibility
export default performanceMonitor;
