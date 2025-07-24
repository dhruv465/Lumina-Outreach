/**
 * performance_metrics.ts
 * Collects and tracks performance metrics for the application
 */

import * as os from 'os';
import * as process from 'process';
import * as v8 from 'v8';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { Request, Response, NextFunction } from 'express';
import logger, { getErrorMessage } from '../utils/logger';

const fsWrite = promisify(fs.writeFile);
const fsAppend = promisify(fs.appendFile);
const fsMkdir = promisify(fs.mkdir);

export interface PerformanceMetrics {
  timestamp: string;
  memory: {
    used: number;
    total: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  system: {
    uptime: number;
    platform: string;
    arch: string;
    nodeVersion: string;
  };
  v8: {
    heapSpaceStatistics: any[];
    heapStatistics: any;
  };
  gc?: {
    collections: number;
    duration: number;
  };
  eventLoop?: {
    lag: number;
  };
}

export interface RequestMetrics {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  memoryUsage: number;
  timestamp: string;
}

export class PerformanceMonitor extends EventEmitter {
  private static instance: PerformanceMonitor | null = null;
  private metrics: PerformanceMetrics;
  private metricsHistory: PerformanceMetrics[] = [];
  private requestMetrics: RequestMetrics[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private isCollecting: boolean = false;
  private metricsFilePath: string;
  private maxHistorySize: number = 1000;
  private collectionInterval: number = 60000; // 1 minute
  private gcStats: { collections: number; duration: number } = { collections: 0, duration: 0 };

  private constructor() {
    super();
    this.metricsFilePath = './logs/performance_metrics.json';
    this.metrics = this.initializeMetrics();
    this.ensureMetricsDirectory();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Start collecting performance metrics
   */
  public start(interval: number = 60000): void {
    if (this.isCollecting) {
      logger.warn('Performance monitoring is already running');
      return;
    }

    this.collectionInterval = interval;
    this.isCollecting = true;

    // Initial collection
    this.collectMetrics();

    // Set up periodic collection
    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, this.collectionInterval);

    this.setupGCMonitoring();

    logger.info(`Performance monitoring started (interval: ${interval}ms)`);
    this.emit('started', { interval });
  }

  /**
   * Stop collecting performance metrics
   */
  public stop(): void {
    if (!this.isCollecting) {
      logger.warn('Performance monitoring is not running');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isCollecting = false;

    logger.info('Performance monitoring stopped');
    this.emit('stopped');
  }

  /**
   * Get current metrics
   */
  public getCurrentMetrics(): PerformanceMetrics {
    return this.metrics;
  }

  /**
   * Get metrics history
   */
  public getMetricsHistory(limit: number = 100): PerformanceMetrics[] {
    return this.metricsHistory.slice(-limit);
  }

  /**
   * Check if performance monitor is active
   */
  public isActive(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Record request metrics
   */
  public recordRequest(req: Request, res: Response, responseTime: number): void {
    const memoryUsage = process.memoryUsage().rss;
    
    const requestMetric: RequestMetrics = {
      requestId: this.generateRequestId(),
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime,
      memoryUsage,
      timestamp: new Date().toISOString()
    };

    this.requestMetrics.push(requestMetric);
    
    // Keep only recent request metrics
    if (this.requestMetrics.length > this.maxHistorySize) {
      this.requestMetrics = this.requestMetrics.slice(-this.maxHistorySize);
    }

    this.emit('request-recorded', requestMetric);
  }

  /**
   * Get request metrics
   */
  public getRequestMetrics(limit: number = 100): RequestMetrics[] {
    return this.requestMetrics.slice(-limit);
  }

  /**
   * Get performance summary
   */
  public getPerformanceSummary(): any {
    const recentMetrics = this.getMetricsHistory(10);
    const recentRequests = this.getRequestMetrics(100);

    if (recentMetrics.length === 0) {
      return {
        memory: { average: 0, peak: 0 },
        cpu: { average: 0 },
        requests: { total: 0, averageResponseTime: 0 },
        uptime: process.uptime()
      };
    }

    const memoryUsage = recentMetrics.map(m => m.memory.used);
    const cpuUsage = recentMetrics.map(m => m.cpu.usage);
    const responseTimes = recentRequests.map(r => r.responseTime);

    return {
      memory: {
        average: this.average(memoryUsage),
        peak: Math.max(...memoryUsage),
        current: this.metrics.memory.used
      },
      cpu: {
        average: this.average(cpuUsage),
        current: this.metrics.cpu.usage
      },
      requests: {
        total: recentRequests.length,
        averageResponseTime: responseTimes.length > 0 ? this.average(responseTimes) : 0,
        totalRequests: this.requestMetrics.length
      },
      uptime: process.uptime(),
      gc: this.gcStats,
      eventLoop: this.metrics.eventLoop
    };
  }

  /**
   * Express middleware for automatic request tracking
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();

      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        this.recordRequest(req, res, responseTime);
      });

      next();
    };
  }

  /**
   * Save metrics to file
   */
  public async saveMetricsToFile(): Promise<void> {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        currentMetrics: this.metrics,
        metricsHistory: this.metricsHistory,
        requestMetrics: this.requestMetrics.slice(-100), // Save only recent requests
        summary: this.getPerformanceSummary()
      };

      await fsWrite(this.metricsFilePath, JSON.stringify(data, null, 2));
      logger.debug('Performance metrics saved to file');
    } catch (error) {
      logger.error('Failed to save performance metrics to file:', error);
    }
  }

  private collectMetrics(): void {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.metrics = {
        timestamp: new Date().toISOString(),
        memory: {
          used: memUsage.rss,
          total: os.totalmem(),
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss
        },
        cpu: {
          usage: this.calculateCPUUsage(cpuUsage),
          loadAverage: os.loadavg()
        },
        system: {
          uptime: process.uptime(),
          platform: os.platform(),
          arch: os.arch(),
          nodeVersion: process.version
        },
        v8: {
          heapSpaceStatistics: v8.getHeapSpaceStatistics(),
          heapStatistics: v8.getHeapStatistics()
        },
        gc: { ...this.gcStats },
        eventLoop: {
          lag: this.measureEventLoopLag()
        }
      };

      this.metricsHistory.push({ ...this.metrics });
      
      // Keep history within limits
      if (this.metricsHistory.length > this.maxHistorySize) {
        this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
      }

      this.emit('metrics-collected', this.metrics);
      
      // Check for performance issues
      this.checkPerformanceThresholds();
      
    } catch (error) {
      logger.error('Error collecting performance metrics:', error);
    }
  }

  private initializeMetrics(): PerformanceMetrics {
    const memUsage = process.memoryUsage();
    
    return {
      timestamp: new Date().toISOString(),
      memory: {
        used: memUsage.rss,
        total: os.totalmem(),
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      cpu: {
        usage: 0,
        loadAverage: os.loadavg()
      },
      system: {
        uptime: process.uptime(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version
      },
      v8: {
        heapSpaceStatistics: v8.getHeapSpaceStatistics(),
        heapStatistics: v8.getHeapStatistics()
      }
    };
  }

  private calculateCPUUsage(cpuUsage: NodeJS.CpuUsage): number {
    // Simple CPU usage calculation
    const total = cpuUsage.user + cpuUsage.system;
    return total / 1000000; // Convert to milliseconds
  }

  private measureEventLoopLag(): number {
    const start = process.hrtime();
    setImmediate(() => {
      const delta = process.hrtime(start);
      const lag = delta[0] * 1e9 + delta[1] - 1e6; // 1ms in nanoseconds
      return Math.max(0, lag / 1e6); // Convert to milliseconds
    });
    return 0; // Simplified for now
  }

  private setupGCMonitoring(): void {
    if (typeof (global as any).gc === 'function') {
      const originalGC = (global as any).gc;
      (global as any).gc = (...args: any[]) => {
        const start = Date.now();
        const result = originalGC.apply(this, args);
        const duration = Date.now() - start;
        
        this.gcStats.collections++;
        this.gcStats.duration += duration;
        
        return result;
      };
    }
  }

  private checkPerformanceThresholds(): void {
    const memoryUsagePercent = (this.metrics.memory.used / this.metrics.memory.total) * 100;
    const heapUsagePercent = (this.metrics.memory.heapUsed / this.metrics.memory.heapTotal) * 100;

    // Emit warnings for high resource usage
    if (memoryUsagePercent > 80) {
      this.emit('high-memory-usage', {
        percentage: memoryUsagePercent,
        metrics: this.metrics
      });
    }

    if (heapUsagePercent > 80) {
      this.emit('high-heap-usage', {
        percentage: heapUsagePercent,
        metrics: this.metrics
      });
    }

    if (this.metrics.cpu.usage > 80) {
      this.emit('high-cpu-usage', {
        usage: this.metrics.cpu.usage,
        metrics: this.metrics
      });
    }
  }

  private async ensureMetricsDirectory(): Promise<void> {
    try {
      const dir = this.metricsFilePath.substring(0, this.metricsFilePath.lastIndexOf('/'));
      await fsMkdir(dir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create metrics directory:', error);
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }
}

// Export singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();