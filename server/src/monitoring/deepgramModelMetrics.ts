/**
 * deepgramModelMetrics.ts
 * Monitoring and metrics collection for Deepgram model compatibility
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import logger from '../utils/logger';
import { alertSystem, AlertLevel, AlertType } from './alert_system';
import { AccountTier, DeepgramErrorType } from '../services/modelCompatibilityService';

const writeFileAsync = promisify(fs.writeFile);
const appendFileAsync = promisify(fs.appendFile);
const mkdirAsync = promisify(fs.mkdir);

/**
 * Model usage metrics interface
 */
export interface ModelUsageMetrics {
  model: string;
  tier: AccountTier;
  usageCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  lastUsed: string;
  averageResponseTime: number;
  totalResponseTime: number;
  errorTypes: Record<DeepgramErrorType, number>;
}

/**
 * Model validation metrics interface
 */
export interface ModelValidationMetrics {
  model: string;
  validationAttempts: number;
  validationSuccesses: number;
  validationFailures: number;
  successRate: number;
  lastValidation: string;
  lastValidationResult: boolean;
  averageValidationTime: number;
  totalValidationTime: number;
  errorTypes: Record<DeepgramErrorType, number>;
}

/**
 * Fallback metrics interface
 */
export interface FallbackMetrics {
  originalModel: string;
  fallbackModel: string;
  fallbackCount: number;
  lastFallback: string;
  errorType: DeepgramErrorType;
  averageFallbackTime: number;
  totalFallbackTime: number;
  successAfterFallback: number;
  failureAfterFallback: number;
}

/**
 * Account tier metrics interface
 */
export interface AccountTierMetrics {
  tier: AccountTier;
  detectionCount: number;
  lastDetection: string;
  availableModelsCount: number;
  availableModels: string[];
  capabilityChanges: number;
  lastCapabilityChange: string;
}

/**
 * Aggregated metrics interface
 */
export interface DeepgramMetricsSummary {
  timestamp: string;
  period: {
    start: string;
    end: string;
  };
  modelUsage: ModelUsageMetrics[];
  modelValidation: ModelValidationMetrics[];
  fallbacks: FallbackMetrics[];
  accountTier: AccountTierMetrics;
  overallStats: {
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    totalFallbacks: number;
    overallSuccessRate: number;
    overallFallbackRate: number;
    mostUsedModel: string;
    mostFailedModel: string;
    averageResponseTime: number;
  };
  alerts: {
    totalAlerts: number;
    criticalAlerts: number;
    warningAlerts: number;
    infoAlerts: number;
    recentAlerts: Array<{
      level: string;
      type: string;
      message: string;
      timestamp: string;
    }>;
  };
}

/**
 * Deepgram Model Metrics Service
 * Collects and analyzes metrics for model usage, validation, and fallback behavior
 */
export class DeepgramModelMetrics {
  private static instance: DeepgramModelMetrics;
  private events: EventEmitter;
  private metricsPath: string;
  private reportingInterval: NodeJS.Timeout | null = null;
  private alertCheckInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // Metrics storage
  private modelUsageMetrics: Map<string, ModelUsageMetrics> = new Map();
  private modelValidationMetrics: Map<string, ModelValidationMetrics> = new Map();
  private fallbackMetrics: Map<string, FallbackMetrics> = new Map();
  private accountTierMetrics: AccountTierMetrics | null = null;
  private alertHistory: Array<{ level: string; type: string; message: string; timestamp: string }> = [];

  // Configuration
  private readonly REPORTING_INTERVAL = 15 * 60 * 1000; // 15 minutes
  private readonly ALERT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ALERT_HISTORY = 100;
  private readonly METRICS_RETENTION_DAYS = 30;

  // Thresholds for alerting
  private readonly thresholds = {
    modelFailureRate: parseFloat(process.env.MODEL_FAILURE_RATE_THRESHOLD || '0.1'), // 10%
    fallbackRate: parseFloat(process.env.MODEL_FALLBACK_RATE_THRESHOLD || '0.05'), // 5%
    validationFailureRate: parseFloat(process.env.VALIDATION_FAILURE_RATE_THRESHOLD || '0.2'), // 20%
    responseTimeThreshold: parseInt(process.env.MODEL_RESPONSE_TIME_THRESHOLD || '5000', 10), // 5 seconds
    consecutiveFailures: parseInt(process.env.CONSECUTIVE_FAILURES_THRESHOLD || '5', 10),
    minRequestsForAlert: parseInt(process.env.MIN_REQUESTS_FOR_ALERT || '10', 10)
  };

  private constructor() {
    this.events = new EventEmitter();
    this.metricsPath = process.env.DEEPGRAM_METRICS_PATH || path.resolve(process.cwd(), 'metrics/deepgram');
    
    // Ensure metrics directory exists
    this.ensureMetricsDirectory();
    
    logger.info('DeepgramModelMetrics service initialized', {
      metricsPath: this.metricsPath,
      thresholds: this.thresholds,
      context: 'deepgram-metrics-init'
    });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DeepgramModelMetrics {
    if (!DeepgramModelMetrics.instance) {
      DeepgramModelMetrics.instance = new DeepgramModelMetrics();
    }
    return DeepgramModelMetrics.instance;
  }

  /**
   * Start metrics collection and reporting
   */
  public start(): void {
    if (this.reportingInterval) {
      this.stop();
    }

    // Start periodic reporting
    this.reportingInterval = setInterval(() => {
      this.generateAndSaveReport().catch(error => {
        logger.error('Error generating metrics report:', error);
      });
    }, this.REPORTING_INTERVAL);

    // Start alert checking
    this.alertCheckInterval = setInterval(() => {
      this.checkMetricsForAlerts().catch(error => {
        logger.error('Error checking metrics for alerts:', error);
      });
    }, this.ALERT_CHECK_INTERVAL);

    this.isRunning = true;

    logger.info('DeepgramModelMetrics collection started', {
      reportingInterval: this.REPORTING_INTERVAL,
      alertCheckInterval: this.ALERT_CHECK_INTERVAL,
      context: 'deepgram-metrics-start'
    });
  }

  /**
   * Stop metrics collection and reporting
   */
  public stop(): void {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }

    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }

    this.isRunning = false;

    logger.info('DeepgramModelMetrics collection stopped');
  }
  
  /**
   * Check if metrics collection is active
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Record model usage event
   */
  public recordModelUsage(
    model: string,
    tier: AccountTier,
    success: boolean,
    responseTime: number,
    errorType?: DeepgramErrorType
  ): void {
    const key = model;
    const existing = this.modelUsageMetrics.get(key) || this.createEmptyModelUsageMetrics(model, tier);

    // Update usage statistics
    existing.usageCount++;
    existing.lastUsed = new Date().toISOString();
    existing.totalResponseTime += responseTime;
    existing.averageResponseTime = existing.totalResponseTime / existing.usageCount;

    if (success) {
      existing.successCount++;
    } else {
      existing.failureCount++;
      if (errorType) {
        existing.errorTypes[errorType] = (existing.errorTypes[errorType] || 0) + 1;
      }
    }

    this.modelUsageMetrics.set(key, existing);

    // Emit event for real-time monitoring
    this.events.emit('model-usage', {
      model,
      tier,
      success,
      responseTime,
      errorType,
      timestamp: new Date().toISOString()
    });

    logger.debug(`Model usage recorded: ${model}`, {
      model,
      tier,
      success,
      responseTime,
      errorType,
      totalUsage: existing.usageCount,
      successRate: existing.successCount / existing.usageCount,
      context: 'model-usage-recorded'
    });
  }

  /**
   * Record model validation event
   */
  public recordModelValidation(
    model: string,
    success: boolean,
    validationTime: number,
    errorType?: DeepgramErrorType
  ): void {
    const key = model;
    const existing = this.modelValidationMetrics.get(key) || this.createEmptyModelValidationMetrics(model);

    // Update validation statistics
    existing.validationAttempts++;
    existing.lastValidation = new Date().toISOString();
    existing.lastValidationResult = success;
    existing.totalValidationTime += validationTime;
    existing.averageValidationTime = existing.totalValidationTime / existing.validationAttempts;

    if (success) {
      existing.validationSuccesses++;
    } else {
      existing.validationFailures++;
      if (errorType) {
        existing.errorTypes[errorType] = (existing.errorTypes[errorType] || 0) + 1;
      }
    }

    existing.successRate = existing.validationSuccesses / existing.validationAttempts;
    this.modelValidationMetrics.set(key, existing);

    // Emit event for real-time monitoring
    this.events.emit('model-validation', {
      model,
      success,
      validationTime,
      errorType,
      successRate: existing.successRate,
      timestamp: new Date().toISOString()
    });

    logger.debug(`Model validation recorded: ${model}`, {
      model,
      success,
      validationTime,
      errorType,
      totalValidations: existing.validationAttempts,
      successRate: existing.successRate,
      context: 'model-validation-recorded'
    });
  }

  /**
   * Record model fallback event
   */
  public recordModelFallback(
    originalModel: string,
    fallbackModel: string,
    fallbackTime: number,
    errorType: DeepgramErrorType,
    fallbackSuccess: boolean
  ): void {
    const key = `${originalModel}->${fallbackModel}`;
    const existing = this.fallbackMetrics.get(key) || this.createEmptyFallbackMetrics(originalModel, fallbackModel, errorType);

    // Update fallback statistics
    existing.fallbackCount++;
    existing.lastFallback = new Date().toISOString();
    existing.totalFallbackTime += fallbackTime;
    existing.averageFallbackTime = existing.totalFallbackTime / existing.fallbackCount;

    if (fallbackSuccess) {
      existing.successAfterFallback++;
    } else {
      existing.failureAfterFallback++;
    }

    this.fallbackMetrics.set(key, existing);

    // Also update the original model's fallback count
    const originalModelUsage = this.modelUsageMetrics.get(originalModel);
    if (originalModelUsage) {
      originalModelUsage.fallbackCount++;
      this.modelUsageMetrics.set(originalModel, originalModelUsage);
    }

    // Emit event for real-time monitoring
    this.events.emit('model-fallback', {
      originalModel,
      fallbackModel,
      fallbackTime,
      errorType,
      fallbackSuccess,
      timestamp: new Date().toISOString()
    });

    logger.info(`Model fallback recorded: ${originalModel} → ${fallbackModel}`, {
      originalModel,
      fallbackModel,
      fallbackTime,
      errorType,
      fallbackSuccess,
      totalFallbacks: existing.fallbackCount,
      fallbackSuccessRate: existing.successAfterFallback / existing.fallbackCount,
      context: 'model-fallback-recorded'
    });
  }

  /**
   * Record account tier detection
   */
  public recordAccountTierDetection(
    tier: AccountTier,
    availableModels: string[],
    detectionTime: number
  ): void {
    const previousTier = this.accountTierMetrics?.tier;
    const previousModelsCount = this.accountTierMetrics?.availableModelsCount || 0;
    
    if (!this.accountTierMetrics) {
      this.accountTierMetrics = {
        tier,
        detectionCount: 0,
        lastDetection: '',
        availableModelsCount: availableModels.length,
        availableModels: [...availableModels],
        capabilityChanges: 0,
        lastCapabilityChange: ''
      };
    }

    // Update account tier metrics
    this.accountTierMetrics.detectionCount++;
    this.accountTierMetrics.lastDetection = new Date().toISOString();

    // Check for capability changes
    if (previousTier && (previousTier !== tier || previousModelsCount !== availableModels.length)) {
      this.accountTierMetrics.capabilityChanges++;
      this.accountTierMetrics.lastCapabilityChange = new Date().toISOString();
      
      logger.warn('Account capability change detected', {
        previousTier,
        newTier: tier,
        previousModelsCount,
        newModelsCount: availableModels.length,
        previousModels: this.accountTierMetrics.availableModels,
        newModels: availableModels,
        context: 'account-capability-change'
      });

      // Create alert for capability changes
      this.createCapabilityChangeAlert(previousTier, tier, previousModelsCount, availableModels.length);
    }

    this.accountTierMetrics.tier = tier;
    this.accountTierMetrics.availableModelsCount = availableModels.length;
    this.accountTierMetrics.availableModels = [...availableModels];

    // Emit event for real-time monitoring
    this.events.emit('account-tier-detection', {
      tier,
      availableModels,
      detectionTime,
      capabilityChanged: previousTier !== tier || previousModelsCount !== availableModels.length,
      timestamp: new Date().toISOString()
    });

    logger.debug(`Account tier detection recorded: ${tier}`, {
      tier,
      availableModelsCount: availableModels.length,
      availableModels,
      detectionTime,
      totalDetections: this.accountTierMetrics.detectionCount,
      context: 'account-tier-recorded'
    });
  }

  /**
   * Get current metrics summary
   */
  public getMetricsSummary(): DeepgramMetricsSummary {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Calculate overall statistics
    let totalRequests = 0;
    let totalSuccesses = 0;
    let totalFailures = 0;
    let totalFallbacks = 0;
    let totalResponseTime = 0;
    let mostUsedModel = '';
    let mostFailedModel = '';
    let maxUsage = 0;
    let maxFailures = 0;

    const modelUsageArray: ModelUsageMetrics[] = [];
    for (const [model, metrics] of this.modelUsageMetrics) {
      modelUsageArray.push(metrics);
      totalRequests += metrics.usageCount;
      totalSuccesses += metrics.successCount;
      totalFailures += metrics.failureCount;
      totalFallbacks += metrics.fallbackCount;
      totalResponseTime += metrics.totalResponseTime;

      if (metrics.usageCount > maxUsage) {
        maxUsage = metrics.usageCount;
        mostUsedModel = model;
      }

      if (metrics.failureCount > maxFailures) {
        maxFailures = metrics.failureCount;
        mostFailedModel = model;
      }
    }

    const modelValidationArray: ModelValidationMetrics[] = Array.from(this.modelValidationMetrics.values());
    const fallbackArray: FallbackMetrics[] = Array.from(this.fallbackMetrics.values());

    return {
      timestamp: now.toISOString(),
      period: {
        start: oneDayAgo.toISOString(),
        end: now.toISOString()
      },
      modelUsage: modelUsageArray,
      modelValidation: modelValidationArray,
      fallbacks: fallbackArray,
      accountTier: this.accountTierMetrics || {
        tier: 'free',
        detectionCount: 0,
        lastDetection: '',
        availableModelsCount: 0,
        availableModels: [],
        capabilityChanges: 0,
        lastCapabilityChange: ''
      },
      overallStats: {
        totalRequests,
        totalSuccesses,
        totalFailures,
        totalFallbacks,
        overallSuccessRate: totalRequests > 0 ? totalSuccesses / totalRequests : 0,
        overallFallbackRate: totalRequests > 0 ? totalFallbacks / totalRequests : 0,
        mostUsedModel: mostUsedModel || 'none',
        mostFailedModel: mostFailedModel || 'none',
        averageResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0
      },
      alerts: {
        totalAlerts: this.alertHistory.length,
        criticalAlerts: this.alertHistory.filter(a => a.level === 'critical').length,
        warningAlerts: this.alertHistory.filter(a => a.level === 'warning').length,
        infoAlerts: this.alertHistory.filter(a => a.level === 'info').length,
        recentAlerts: this.alertHistory.slice(-10) // Last 10 alerts
      }
    };
  }

  /**
   * Generate and save metrics report
   */
  private async generateAndSaveReport(): Promise<void> {
    try {
      const summary = this.getMetricsSummary();
      const timestamp = new Date();
      const fileName = `deepgram_metrics_${timestamp.getFullYear()}-${(timestamp.getMonth() + 1).toString().padStart(2, '0')}-${timestamp.getDate().toString().padStart(2, '0')}_${timestamp.getHours().toString().padStart(2, '0')}-${timestamp.getMinutes().toString().padStart(2, '0')}.json`;
      const filePath = path.join(this.metricsPath, 'reports', fileName);

      // Ensure reports directory exists
      const reportsDir = path.join(this.metricsPath, 'reports');
      if (!fs.existsSync(reportsDir)) {
        await mkdirAsync(reportsDir, { recursive: true });
      }

      await writeFileAsync(filePath, JSON.stringify(summary, null, 2));

      logger.info('Deepgram metrics report generated', {
        fileName,
        totalRequests: summary.overallStats.totalRequests,
        successRate: summary.overallStats.overallSuccessRate,
        fallbackRate: summary.overallStats.overallFallbackRate,
        modelsTracked: summary.modelUsage.length,
        context: 'metrics-report-generated'
      });

      // Emit event
      this.events.emit('report-generated', { fileName, summary });

      // Clean up old reports
      await this.cleanupOldReports();

    } catch (error) {
      logger.error('Error generating Deepgram metrics report:', error);
    }
  }
  
  /**
   * Event listeners
   */
  public onReportGenerated(callback: (event: { fileName: string; summary: DeepgramMetricsSummary }) => void): void {
    this.events.on('report-generated', callback);
  }

  public onModelUsage(callback: (event: { model: string; tier: AccountTier; success: boolean; responseTime: number; errorType?: DeepgramErrorType; timestamp: string }) => void): void {
    this.events.on('model-usage', callback);
  }

  public onModelValidation(callback: (event: { model: string; success: boolean; validationTime: number; errorType?: DeepgramErrorType; successRate: number; timestamp: string }) => void): void {
    this.events.on('model-validation', callback);
  }

  public onModelFallback(callback: (event: { originalModel: string; fallbackModel: string; fallbackTime: number; errorType: DeepgramErrorType; fallbackSuccess: boolean; timestamp: string }) => void): void {
    this.events.on('model-fallback', callback);
  }

  public onAccountTierDetection(callback: (event: { tier: AccountTier; availableModels: string[]; detectionTime: number; capabilityChanged: boolean; timestamp: string }) => void): void {
    this.events.on('account-tier-detection', callback);
  }

  /**
   * Check metrics for alert conditions
   */
  private async checkMetricsForAlerts(): Promise<void> {
    try {
      const summary = this.getMetricsSummary();

      // Check overall failure rate
      if (summary.overallStats.totalRequests >= this.thresholds.minRequestsForAlert) {
        const failureRate = 1 - summary.overallStats.overallSuccessRate;
        if (failureRate >= this.thresholds.modelFailureRate) {
          this.createHighFailureRateAlert(failureRate, summary.overallStats.totalRequests);
        }

        // Check overall fallback rate
        if (summary.overallStats.overallFallbackRate >= this.thresholds.fallbackRate) {
          this.createHighFallbackRateAlert(summary.overallStats.overallFallbackRate, summary.overallStats.totalFallbacks);
        }
      }

      // Check individual model performance
      for (const modelMetrics of summary.modelUsage) {
        if (modelMetrics.usageCount >= this.thresholds.minRequestsForAlert) {
          const modelFailureRate = modelMetrics.failureCount / modelMetrics.usageCount;
          
          if (modelFailureRate >= this.thresholds.modelFailureRate) {
            this.createModelPerformanceAlert(modelMetrics.model, modelFailureRate, modelMetrics.usageCount);
          }

          if (modelMetrics.averageResponseTime >= this.thresholds.responseTimeThreshold) {
            this.createSlowResponseAlert(modelMetrics.model, modelMetrics.averageResponseTime);
          }
        }
      }

      // Check model validation success rates
      for (const validationMetrics of summary.modelValidation) {
        if (validationMetrics.validationAttempts >= this.thresholds.minRequestsForAlert) {
          const validationFailureRate = 1 - validationMetrics.successRate;
          
          if (validationFailureRate >= this.thresholds.validationFailureRate) {
            this.createValidationFailureAlert(validationMetrics.model, validationFailureRate, validationMetrics.validationAttempts);
          }
        }
      }

      // Check for persistent fallback patterns
      for (const fallbackMetrics of summary.fallbacks) {
        if (fallbackMetrics.fallbackCount >= this.thresholds.consecutiveFailures) {
          this.createPersistentFallbackAlert(fallbackMetrics.originalModel, fallbackMetrics.fallbackModel, fallbackMetrics.fallbackCount);
        }
      }

    } catch (error) {
      logger.error('Error checking metrics for alerts:', error);
    }
  }

  /**
   * Create helper methods for empty metrics objects
   */
  private createEmptyModelUsageMetrics(model: string, tier: AccountTier): ModelUsageMetrics {
    return {
      model,
      tier,
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      fallbackCount: 0,
      lastUsed: '',
      averageResponseTime: 0,
      totalResponseTime: 0,
      errorTypes: {} as Record<DeepgramErrorType, number>
    };
  }

  private createEmptyModelValidationMetrics(model: string): ModelValidationMetrics {
    return {
      model,
      validationAttempts: 0,
      validationSuccesses: 0,
      validationFailures: 0,
      successRate: 0,
      lastValidation: '',
      lastValidationResult: false,
      averageValidationTime: 0,
      totalValidationTime: 0,
      errorTypes: {} as Record<DeepgramErrorType, number>
    };
  }

  private createEmptyFallbackMetrics(originalModel: string, fallbackModel: string, errorType: DeepgramErrorType): FallbackMetrics {
    return {
      originalModel,
      fallbackModel,
      fallbackCount: 0,
      lastFallback: '',
      errorType,
      averageFallbackTime: 0,
      totalFallbackTime: 0,
      successAfterFallback: 0,
      failureAfterFallback: 0
    };
  }

  /**
   * Alert creation methods
   */
  private createHighFailureRateAlert(failureRate: number, totalRequests: number): void {
    const alert = {
      level: 'critical',
      type: 'deepgram-high-failure-rate',
      message: `High Deepgram failure rate detected: ${(failureRate * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'deepgram-high-failure-rate' as AlertType,
      alert.message,
      {
        failureRate,
        failurePercentage: (failureRate * 100).toFixed(2),
        totalRequests,
        threshold: (this.thresholds.modelFailureRate * 100).toFixed(2),
        impact: 'High failure rate may indicate service degradation',
        recommendation: 'Check Deepgram service status and account limits',
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  private createHighFallbackRateAlert(fallbackRate: number, totalFallbacks: number): void {
    const alert = {
      level: 'warning',
      type: 'deepgram-high-fallback-rate',
      message: `High Deepgram fallback rate detected: ${(fallbackRate * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    alertSystem.createAlert(
      AlertLevel.WARNING,
      'deepgram-high-fallback-rate' as AlertType,
      alert.message,
      {
        fallbackRate,
        fallbackPercentage: (fallbackRate * 100).toFixed(2),
        totalFallbacks,
        threshold: (this.thresholds.fallbackRate * 100).toFixed(2),
        impact: 'Frequent fallbacks may indicate model access issues',
        recommendation: 'Review model permissions and account tier',
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  private createModelPerformanceAlert(model: string, failureRate: number, usageCount: number): void {
    const alert = {
      level: 'warning',
      type: 'deepgram-model-performance',
      message: `Poor performance for model ${model}: ${(failureRate * 100).toFixed(2)}% failure rate`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    alertSystem.createAlert(
      AlertLevel.WARNING,
      'deepgram-model-performance' as AlertType,
      alert.message,
      {
        model,
        failureRate,
        failurePercentage: (failureRate * 100).toFixed(2),
        usageCount,
        threshold: (this.thresholds.modelFailureRate * 100).toFixed(2),
        impact: `Model ${model} experiencing high failure rate`,
        recommendation: `Consider switching to alternative model or check ${model} availability`,
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  private createSlowResponseAlert(model: string, averageResponseTime: number): void {
    const alert = {
      level: 'warning',
      type: 'deepgram-slow-response',
      message: `Slow response time for model ${model}: ${averageResponseTime.toFixed(0)}ms`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    alertSystem.createAlert(
      AlertLevel.WARNING,
      'deepgram-slow-response' as AlertType,
      alert.message,
      {
        model,
        averageResponseTime: averageResponseTime.toFixed(0),
        threshold: this.thresholds.responseTimeThreshold,
        impact: `Model ${model} responding slowly`,
        recommendation: 'Monitor network conditions and Deepgram service status',
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  private createValidationFailureAlert(model: string, failureRate: number, attempts: number): void {
    const alert = {
      level: 'warning',
      type: 'deepgram-validation-failure',
      message: `High validation failure rate for model ${model}: ${(failureRate * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    alertSystem.createAlert(
      AlertLevel.WARNING,
      'deepgram-validation-failure' as AlertType,
      alert.message,
      {
        model,
        failureRate,
        failurePercentage: (failureRate * 100).toFixed(2),
        attempts,
        threshold: (this.thresholds.validationFailureRate * 100).toFixed(2),
        impact: `Model ${model} validation frequently failing`,
        recommendation: `Check model availability and account permissions for ${model}`,
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  private createPersistentFallbackAlert(originalModel: string, fallbackModel: string, fallbackCount: number): void {
    const alert = {
      level: 'critical',
      type: 'deepgram-persistent-fallback',
      message: `Persistent fallback pattern: ${originalModel} → ${fallbackModel} (${fallbackCount} times)`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'deepgram-persistent-fallback' as AlertType,
      alert.message,
      {
        originalModel,
        fallbackModel,
        fallbackCount,
        threshold: this.thresholds.consecutiveFailures,
        impact: `Persistent issues with ${originalModel}, consistently falling back to ${fallbackModel}`,
        recommendation: `Investigate ${originalModel} availability or consider updating primary model configuration`,
        urgency: 'High - indicates ongoing service degradation',
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  private createCapabilityChangeAlert(previousTier: AccountTier, newTier: AccountTier, previousModelsCount: number, newModelsCount: number): void {
    const alert = {
      level: newTier < previousTier ? 'critical' : 'info',
      type: 'deepgram-capability-change',
      message: `Account capability change: ${previousTier} → ${newTier}`,
      timestamp: new Date().toISOString()
    };

    this.alertHistory.push(alert);
    this.trimAlertHistory();

    const alertLevel = newTier < previousTier ? AlertLevel.CRITICAL : AlertLevel.INFO;

    alertSystem.createAlert(
      alertLevel,
      'deepgram-capability-change' as AlertType,
      alert.message,
      {
        previousTier,
        newTier,
        previousModelsCount,
        newModelsCount,
        impact: newTier < previousTier 
          ? 'Account downgrade detected - reduced model access' 
          : 'Account upgrade detected - enhanced model access',
        recommendation: newTier < previousTier 
          ? 'Verify account status and billing' 
          : 'Consider utilizing new model capabilities',
        timestamp: alert.timestamp
      },
      'deepgram-model-metrics'
    );
  }

  /**
   * Utility methods
   */
  private trimAlertHistory(): void {
    if (this.alertHistory.length > this.MAX_ALERT_HISTORY) {
      this.alertHistory = this.alertHistory.slice(-this.MAX_ALERT_HISTORY);
    }
  }

  private async ensureMetricsDirectory(): Promise<void> {
    try {
      if (!fs.existsSync(this.metricsPath)) {
        await mkdirAsync(this.metricsPath, { recursive: true });
      }
    } catch (error) {
      logger.error('Error creating metrics directory:', error);
    }
  }

  private async cleanupOldReports(): Promise<void> {
    try {
      const reportsDir = path.join(this.metricsPath, 'reports');
      if (!fs.existsSync(reportsDir)) {
        return;
      }

      const files = fs.readdirSync(reportsDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.METRICS_RETENTION_DAYS);

      for (const file of files) {
        const filePath = path.join(reportsDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          logger.debug(`Cleaned up old metrics report: ${file}`);
        }
      }
    } catch (error) {
      logger.error('Error cleaning up old reports:', error);
    }
  }

  /**
   * Reset metrics (for testing or maintenance)
   */
  public resetMetrics(): void {
    this.modelUsageMetrics.clear();
    this.modelValidationMetrics.clear();
    this.fallbackMetrics.clear();
    this.accountTierMetrics = null;
    this.alertHistory = [];
    
    logger.info('DeepgramModelMetrics reset');
  }
}

// Create and export singleton instance
export const deepgramModelMetrics = DeepgramModelMetrics.getInstance();
export default deepgramModelMetrics;