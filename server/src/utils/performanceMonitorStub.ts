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
      timestamp: new Date().toISOString(),
      memory: {
        used: 104857600, // 100MB
        total: 8589934592, // 8GB
        heapUsed: 26214400, // 25MB
        heapTotal: 52428800, // 50MB
        external: 10485760, // 10MB
        rss: 104857600 // 100MB
      },
      cpu: {
        usage: 25.5,
        loadAverage: [0.5, 0.3, 0.2]
      },
      system: {
        uptime: 3600,
        platform: 'darwin',
        arch: 'x64',
        nodeVersion: process.version
      },
      v8: {
        heapSpaceStatistics: [],
        heapStatistics: {}
      }
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
