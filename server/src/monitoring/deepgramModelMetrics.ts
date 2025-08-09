/**
 * Deepgram Model Metrics Stub
 * Minimal implementation to replace removed monitoring functionality
 */

export interface ModelMetrics {
  modelName: string;
  requestCount: number;
  errorCount: number;
  averageLatency: number;
  lastUsed: Date;
}

export class DeepgramModelMetrics {
  private static instance: DeepgramModelMetrics;
  private metrics: Map<string, ModelMetrics> = new Map();

  static getInstance(): DeepgramModelMetrics {
    if (!DeepgramModelMetrics.instance) {
      DeepgramModelMetrics.instance = new DeepgramModelMetrics();
    }
    return DeepgramModelMetrics.instance;
  }

  recordRequest(modelName: string, latency: number, success: boolean): void {
    // Stub implementation - just track basic metrics
    const existing = this.metrics.get(modelName) || {
      modelName,
      requestCount: 0,
      errorCount: 0,
      averageLatency: 0,
      lastUsed: new Date()
    };

    existing.requestCount++;
    if (!success) existing.errorCount++;
    existing.averageLatency = (existing.averageLatency + latency) / 2;
    existing.lastUsed = new Date();

    this.metrics.set(modelName, existing);
  }

  recordModelUsage(model: string, tier: string, success: boolean, latency: number, errorType?: string): void {
    // Stub implementation
    this.recordRequest(model, latency, success);
  }

  recordModelValidation(model: string, success: boolean, latency: number, errorType?: string): void {
    // Stub implementation
    this.recordRequest(model, latency, success);
  }

  recordModelFallback(fromModel: string, toModel: string, latency: number, errorType: string, success: boolean): void {
    // Stub implementation
    this.recordRequest(fromModel, latency, false);
    this.recordRequest(toModel, latency, success);
  }

  recordAccountTierDetection(tier: string, availableModels: string[], latency: number): void {
    // Stub implementation - no-op
    console.log(`Account tier detected: ${tier}, models: ${availableModels.length}`);
  }

  getMetrics(modelName?: string): ModelMetrics | ModelMetrics[] {
    if (modelName) {
      return this.metrics.get(modelName) || {
        modelName,
        requestCount: 0,
        errorCount: 0,
        averageLatency: 0,
        lastUsed: new Date()
      };
    }
    return Array.from(this.metrics.values());
  }

  getMetricsSummary(): any {
    // Stub implementation
    return {
      totalRequests: Array.from(this.metrics.values()).reduce((sum, m) => sum + m.requestCount, 0),
      totalErrors: Array.from(this.metrics.values()).reduce((sum, m) => sum + m.errorCount, 0),
      averageLatency: Array.from(this.metrics.values()).reduce((sum, m) => sum + m.averageLatency, 0) / this.metrics.size || 0,
      models: Array.from(this.metrics.values())
    };
  }

  resetMetrics(): void {
    // Stub implementation
    this.metrics.clear();
  }

  isActive(): boolean {
    // Stub implementation
    return true;
  }

  start(): void {
    // Stub implementation - no-op
    console.log('DeepgramModelMetrics stub started');
  }

  stop(): void {
    // Stub implementation - no-op
    console.log('DeepgramModelMetrics stub stopped');
  }
}

export const deepgramModelMetrics = new DeepgramModelMetrics();