/**
 * performanceMonitorStub.ts
 * Stub implementation for PerformanceMonitor to avoid import issues
 */

import { PerformanceMetrics } from '../monitoring/performance_metrics';

export class PerformanceMonitorStub {
  private static instance: PerformanceMonitorStub | null = null;

  private constructor() {}

  public static getInstance(): PerformanceMonitorStub {
    if (!PerformanceMonitorStub.instance) {
      PerformanceMonitorStub.instance = new PerformanceMonitorStub();
    }
    return PerformanceMonitorStub.instance;
  }

  public getCurrentMetrics(): PerformanceMetrics {
    return {
      timestamp: new Date(),
      cpuUsage: 25.5,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
      responseTime: 150,
      requestCount: 100,
      errorCount: 2
    };
  }

  public getMetricsHistory(limit: number = 100): PerformanceMetrics[] {
    const metrics = this.getCurrentMetrics();
    return Array(Math.min(limit, 10)).fill(metrics);
  }

  public isActive(): boolean {
    return true;
  }
}

// Export singleton instance
export const performanceMonitor = PerformanceMonitorStub.getInstance();
export default PerformanceMonitorStub;
