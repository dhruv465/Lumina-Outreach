/**
 * TTS Provider Metrics
 * Tracks success rates, latency, and fallback usage for TTS providers
 */
import logger from '../utils/logger';

export interface TTSMetric {
  timestamp: Date;
  provider: string;
  success: boolean;
  latency: number;
  audioSize?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  errorCode?: string;
  requestId?: string;
}

export interface TTSProviderStats {
  provider: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  averageLatency: number;
  fallbackCount: number;
  lastUsed: Date;
  successRate: number; // percentage
}

export class TTSMetrics {
  private static instance: TTSMetrics;
  private metrics: TTSMetric[] = [];
  private readonly maxMetrics = 1000; // Keep last 1000 metrics

  static getInstance(): TTSMetrics {
    if (!TTSMetrics.instance) {
      TTSMetrics.instance = new TTSMetrics();
    }
    return TTSMetrics.instance;
  }

  /**
   * Record a TTS request metric
   */
  recordRequest(metric: Omit<TTSMetric, 'timestamp'>): void {
    const fullMetric: TTSMetric = {
      timestamp: new Date(),
      ...metric
    };

    this.metrics.push(fullMetric);

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log the metric for debugging
    logger.debug('TTS metric recorded', {
      provider: metric.provider,
      success: metric.success,
      latency: metric.latency,
      fallbackUsed: metric.fallbackUsed
    });
  }

  /**
   * Get statistics for all providers
   */
  getProviderStats(): TTSProviderStats[] {
    const statsByProvider = new Map<string, TTSProviderStats>();

    this.metrics.forEach(metric => {
      const existing = statsByProvider.get(metric.provider) || {
        provider: metric.provider,
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        averageLatency: 0,
        fallbackCount: 0,
        lastUsed: new Date(0),
        successRate: 0
      };

      existing.totalRequests++;
      if (metric.success) {
        existing.successCount++;
      } else {
        existing.failureCount++;
      }
      
      if (metric.fallbackUsed) {
        existing.fallbackCount++;
      }

      // Update average latency
      existing.averageLatency = (existing.averageLatency + metric.latency) / 2;
      
      // Update last used
      if (metric.timestamp > existing.lastUsed) {
        existing.lastUsed = metric.timestamp;
      }

      // Calculate success rate
      existing.successRate = (existing.successCount / existing.totalRequests) * 100;

      statsByProvider.set(metric.provider, existing);
    });

    return Array.from(statsByProvider.values());
  }

  /**
   * Get statistics for a specific provider
   */
  getProviderStat(provider: string): TTSProviderStats | null {
    const stats = this.getProviderStats();
    return stats.find(stat => stat.provider === provider) || null;
  }

  /**
   * Get recent metrics (last N entries)
   */
  getRecentMetrics(count: number = 50): TTSMetric[] {
    return this.metrics.slice(-count);
  }

  /**
   * Get metrics for a specific time period
   */
  getMetricsInPeriod(startTime: Date, endTime: Date): TTSMetric[] {
    return this.metrics.filter(metric => 
      metric.timestamp >= startTime && metric.timestamp <= endTime
    );
  }

  /**
   * Get fallback metrics
   */
  getFallbackStats(): { total: number; byProvider: Record<string, number> } {
    const fallbackMetrics = this.metrics.filter(m => m.fallbackUsed);
    const byProvider: Record<string, number> = {};

    fallbackMetrics.forEach(metric => {
      byProvider[metric.provider] = (byProvider[metric.provider] || 0) + 1;
    });

    return {
      total: fallbackMetrics.length,
      byProvider
    };
  }

  /**
   * Clear all metrics (for testing or cleanup)
   */
  clearMetrics(): void {
    this.metrics = [];
    logger.info('TTS metrics cleared');
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalRequests: number;
    overallSuccessRate: number;
    averageLatency: number;
    fallbackRate: number;
    providerStats: TTSProviderStats[];
  } {
    const providerStats = this.getProviderStats();
    const totalRequests = this.metrics.length;
    const successfulRequests = this.metrics.filter(m => m.success).length;
    const fallbackRequests = this.metrics.filter(m => m.fallbackUsed).length;
    const totalLatency = this.metrics.reduce((sum, m) => sum + m.latency, 0);

    return {
      totalRequests,
      overallSuccessRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
      averageLatency: totalRequests > 0 ? totalLatency / totalRequests : 0,
      fallbackRate: totalRequests > 0 ? (fallbackRequests / totalRequests) * 100 : 0,
      providerStats
    };
  }
}

// Export singleton instance
export const ttsMetrics = TTSMetrics.getInstance();

export default ttsMetrics;