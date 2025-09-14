/**
 * Latency Monitoring Service
 * 
 * Tracks and analyzes latency metrics across the entire audio pipeline
 * to identify bottlenecks and optimize performance.
 */

import { EventEmitter } from 'events';
import { logger } from '../index';

export interface LatencyMetrics {
  callId: string;
  timestamp: Date;
  stage: string;
  latency: number;
  provider?: string;
  metadata?: Record<string, any>;
}

export interface LatencySummary {
  callId: string;
  totalCalls: number;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
  stageBreakdown: {
    [stage: string]: {
      count: number;
      average: number;
      min: number;
      max: number;
    };
  };
  providerBreakdown: {
    [provider: string]: {
      count: number;
      average: number;
      min: number;
      max: number;
    };
  };
}

export interface LatencyAlert {
  callId: string;
  stage: string;
  latency: number;
  threshold: number;
  timestamp: Date;
  severity: 'warning' | 'critical';
  message: string;
}

export class LatencyMonitoringService extends EventEmitter {
  private metrics: LatencyMetrics[] = [];
  private alerts: LatencyAlert[] = [];
  private thresholds: Map<string, number> = new Map();
  private maxMetrics: number = 10000; // Keep last 10k metrics
  private alertCooldown: Map<string, number> = new Map();
  
  // Default latency thresholds (in milliseconds)
  private readonly DEFAULT_THRESHOLDS = {
    'audio_processing': 50,      // 50ms for audio processing
    'stt_processing': 200,       // 200ms for STT
    'llm_processing': 500,       // 500ms for LLM
    'tts_processing': 300,       // 300ms for TTS
    'total_roundtrip': 1000,     // 1000ms total roundtrip
    'websocket_send': 10,        // 10ms for WebSocket send
    'websocket_receive': 10,     // 10ms for WebSocket receive
    'database_query': 100,       // 100ms for database queries
    'provider_fallback': 1000,   // 1000ms for provider fallback
  };

  constructor() {
    super();
    this.initializeThresholds();
    this.setupCleanupInterval();
  }

  /**
   * Initialize default thresholds
   */
  private initializeThresholds(): void {
    Object.entries(this.DEFAULT_THRESHOLDS).forEach(([stage, threshold]) => {
      this.thresholds.set(stage, threshold);
    });
  }

  /**
   * Record a latency metric
   */
  public recordLatency(
    callId: string,
    stage: string,
    latency: number,
    provider?: string,
    metadata?: Record<string, any>
  ): void {
    const metric: LatencyMetrics = {
      callId,
      timestamp: new Date(),
      stage,
      latency,
      provider,
      metadata
    };

    this.metrics.push(metric);

    // Keep only the last maxMetrics entries
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Check for alerts
    this.checkForAlerts(metric);

    // Emit metric event
    this.emit('metric', metric);

    logger.debug(`Latency metric recorded: ${stage} for call ${callId}: ${latency}ms`);
  }

  /**
   * Check for latency alerts
   */
  private checkForAlerts(metric: LatencyMetrics): void {
    const threshold = this.thresholds.get(metric.stage);
    if (!threshold) return;

    if (metric.latency > threshold) {
      const alertKey = `${metric.callId}-${metric.stage}`;
      const lastAlert = this.alertCooldown.get(alertKey);
      const now = Date.now();

      // Cooldown period: 30 seconds
      if (lastAlert && (now - lastAlert) < 30000) {
        return;
      }

      const severity = metric.latency > threshold * 2 ? 'critical' : 'warning';
      const alert: LatencyAlert = {
        callId: metric.callId,
        stage: metric.stage,
        latency: metric.latency,
        threshold,
        timestamp: metric.timestamp,
        severity,
        message: `${metric.stage} latency exceeded threshold: ${metric.latency}ms > ${threshold}ms`
      };

      this.alerts.push(alert);
      this.alertCooldown.set(alertKey, now);

      // Keep only last 1000 alerts
      if (this.alerts.length > 1000) {
        this.alerts = this.alerts.slice(-1000);
      }

      // Emit alert event
      this.emit('alert', alert);

      logger.warn(`Latency alert: ${alert.message}`, {
        callId: metric.callId,
        stage: metric.stage,
        latency: metric.latency,
        threshold,
        severity
      });
    }
  }

  /**
   * Get latency summary for a call
   */
  public getCallLatencySummary(callId: string): LatencySummary | null {
    const callMetrics = this.metrics.filter(m => m.callId === callId);
    if (callMetrics.length === 0) return null;

    const latencies = callMetrics.map(m => m.latency);
    const sortedLatencies = [...latencies].sort((a, b) => a - b);

    const stageBreakdown: { [stage: string]: any } = {};
    const providerBreakdown: { [provider: string]: any } = {};

    // Calculate stage breakdown
    const stages = [...new Set(callMetrics.map(m => m.stage))];
    stages.forEach(stage => {
      const stageMetrics = callMetrics.filter(m => m.stage === stage);
      const stageLatencies = stageMetrics.map(m => m.latency);
      const sortedStageLatencies = [...stageLatencies].sort((a, b) => a - b);

      stageBreakdown[stage] = {
        count: stageMetrics.length,
        average: stageLatencies.reduce((a, b) => a + b, 0) / stageLatencies.length,
        min: Math.min(...stageLatencies),
        max: Math.max(...stageLatencies)
      };
    });

    // Calculate provider breakdown
    const providers = [...new Set(callMetrics.map(m => m.provider).filter(Boolean))];
    providers.forEach(provider => {
      const providerMetrics = callMetrics.filter(m => m.provider === provider);
      const providerLatencies = providerMetrics.map(m => m.latency);
      const sortedProviderLatencies = [...providerLatencies].sort((a, b) => a - b);

      providerBreakdown[provider] = {
        count: providerMetrics.length,
        average: providerLatencies.reduce((a, b) => a + b, 0) / providerLatencies.length,
        min: Math.min(...providerLatencies),
        max: Math.max(...providerLatencies)
      };
    });

    return {
      callId,
      totalCalls: callMetrics.length,
      averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: this.calculatePercentile(sortedLatencies, 95),
      p99Latency: this.calculatePercentile(sortedLatencies, 99),
      stageBreakdown,
      providerBreakdown
    };
  }

  /**
   * Get overall latency summary
   */
  public getOverallLatencySummary(): LatencySummary {
    const latencies = this.metrics.map(m => m.latency);
    const sortedLatencies = [...latencies].sort((a, b) => a - b);

    const stageBreakdown: { [stage: string]: any } = {};
    const providerBreakdown: { [provider: string]: any } = {};

    // Calculate stage breakdown
    const stages = [...new Set(this.metrics.map(m => m.stage))];
    stages.forEach(stage => {
      const stageMetrics = this.metrics.filter(m => m.stage === stage);
      const stageLatencies = stageMetrics.map(m => m.latency);
      const sortedStageLatencies = [...stageLatencies].sort((a, b) => a - b);

      stageBreakdown[stage] = {
        count: stageMetrics.length,
        average: stageLatencies.reduce((a, b) => a + b, 0) / stageLatencies.length,
        min: Math.min(...stageLatencies),
        max: Math.max(...stageLatencies)
      };
    });

    // Calculate provider breakdown
    const providers = [...new Set(this.metrics.map(m => m.provider).filter(Boolean))];
    providers.forEach(provider => {
      const providerMetrics = this.metrics.filter(m => m.provider === provider);
      const providerLatencies = providerMetrics.map(m => m.latency);
      const sortedProviderLatencies = [...providerLatencies].sort((a, b) => a - b);

      providerBreakdown[provider] = {
        count: providerMetrics.length,
        average: providerLatencies.reduce((a, b) => a + b, 0) / providerLatencies.length,
        min: Math.min(...providerLatencies),
        max: Math.max(...providerLatencies)
      };
    });

    return {
      callId: 'overall',
      totalCalls: this.metrics.length,
      averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: this.calculatePercentile(sortedLatencies, 95),
      p99Latency: this.calculatePercentile(sortedLatencies, 99),
      stageBreakdown,
      providerBreakdown
    };
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Set custom threshold for a stage
   */
  public setThreshold(stage: string, threshold: number): void {
    this.thresholds.set(stage, threshold);
    logger.info(`Latency threshold set for ${stage}: ${threshold}ms`);
  }

  /**
   * Get current thresholds
   */
  public getThresholds(): Map<string, number> {
    return new Map(this.thresholds);
  }

  /**
   * Get recent alerts
   */
  public getRecentAlerts(limit: number = 100): LatencyAlert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Get alerts by severity
   */
  public getAlertsBySeverity(severity: 'warning' | 'critical'): LatencyAlert[] {
    return this.alerts.filter(alert => alert.severity === severity);
  }

  /**
   * Get alerts for a specific call
   */
  public getCallAlerts(callId: string): LatencyAlert[] {
    return this.alerts.filter(alert => alert.callId === callId);
  }

  /**
   * Clear metrics for a call
   */
  public clearCallMetrics(callId: string): void {
    this.metrics = this.metrics.filter(m => m.callId !== callId);
    this.alerts = this.alerts.filter(a => a.callId !== callId);
    logger.info(`Cleared metrics for call ${callId}`);
  }

  /**
   * Clear all metrics
   */
  public clearAllMetrics(): void {
    this.metrics = [];
    this.alerts = [];
    this.alertCooldown.clear();
    logger.info('Cleared all latency metrics');
  }

  /**
   * Get metrics for a specific stage
   */
  public getStageMetrics(stage: string, limit: number = 1000): LatencyMetrics[] {
    return this.metrics
      .filter(m => m.stage === stage)
      .slice(-limit);
  }

  /**
   * Get metrics for a specific provider
   */
  public getProviderMetrics(provider: string, limit: number = 1000): LatencyMetrics[] {
    return this.metrics
      .filter(m => m.provider === provider)
      .slice(-limit);
  }

  /**
   * Get metrics within a time range
   */
  public getMetricsInRange(startTime: Date, endTime: Date): LatencyMetrics[] {
    return this.metrics.filter(m => 
      m.timestamp >= startTime && m.timestamp <= endTime
    );
  }

  /**
   * Get latency trends over time
   */
  public getLatencyTrends(
    stage: string,
    timeWindowMinutes: number = 60
  ): { timestamp: Date; averageLatency: number; count: number }[] {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - timeWindowMinutes * 60 * 1000);
    
    const stageMetrics = this.metrics.filter(m => 
      m.stage === stage && 
      m.timestamp >= startTime && 
      m.timestamp <= endTime
    );

    // Group by 5-minute intervals
    const intervalMinutes = 5;
    const intervals: { [key: string]: LatencyMetrics[] } = {};

    stageMetrics.forEach(metric => {
      const intervalStart = new Date(
        Math.floor(metric.timestamp.getTime() / (intervalMinutes * 60 * 1000)) * 
        (intervalMinutes * 60 * 1000)
      );
      const key = intervalStart.toISOString();
      
      if (!intervals[key]) {
        intervals[key] = [];
      }
      intervals[key].push(metric);
    });

    return Object.entries(intervals).map(([timestamp, metrics]) => ({
      timestamp: new Date(timestamp),
      averageLatency: metrics.reduce((sum, m) => sum + m.latency, 0) / metrics.length,
      count: metrics.length
    })).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Setup cleanup interval
   */
  private setupCleanupInterval(): void {
    // Clean up old metrics every hour
    setInterval(() => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      this.metrics = this.metrics.filter(m => m.timestamp > oneHourAgo);
      this.alerts = this.alerts.filter(a => a.timestamp > oneHourAgo);
      
      // Clean up old cooldown entries
      const now = Date.now();
      for (const [key, timestamp] of this.alertCooldown.entries()) {
        if (now - timestamp > 300000) { // 5 minutes
          this.alertCooldown.delete(key);
        }
      }
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Export metrics to JSON
   */
  public exportMetrics(): string {
    return JSON.stringify({
      metrics: this.metrics,
      alerts: this.alerts,
      thresholds: Object.fromEntries(this.thresholds),
      summary: this.getOverallLatencySummary()
    }, null, 2);
  }

  /**
   * Import metrics from JSON
   */
  public importMetrics(jsonData: string): void {
    try {
      const data = JSON.parse(jsonData);
      this.metrics = data.metrics || [];
      this.alerts = data.alerts || [];
      
      if (data.thresholds) {
        this.thresholds = new Map(Object.entries(data.thresholds));
      }
      
      logger.info('Latency metrics imported successfully');
    } catch (error) {
      logger.error('Failed to import latency metrics:', error);
    }
  }
}

// Export singleton instance
export const latencyMonitoringService = new LatencyMonitoringService();
