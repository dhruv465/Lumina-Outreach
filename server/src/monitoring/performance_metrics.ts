/**
 * Performance Metrics Stub
 * Minimal implementation to replace removed monitoring functionality
 */

export interface PerformanceMetrics {
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  responseTime: number;
  requestCount: number;
  errorCount: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];

  recordMetric(metric: Partial<PerformanceMetrics>): void {
    // Stub implementation - just store basic metrics
    this.metrics.push({
      timestamp: new Date(),
      cpuUsage: metric.cpuUsage || 0,
      memoryUsage: metric.memoryUsage || 0,
      responseTime: metric.responseTime || 0,
      requestCount: metric.requestCount || 0,
      errorCount: metric.errorCount || 0
    });

    // Keep only last 100 metrics
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }
  }

  getMetrics(): PerformanceMetrics[] {
    return this.metrics;
  }

  getLatestMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }
}

export const performanceMonitor = new PerformanceMonitor();