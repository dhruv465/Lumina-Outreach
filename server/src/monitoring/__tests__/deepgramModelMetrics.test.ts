/**
 * deepgramModelMetrics.test.ts
 * Unit tests for Deepgram model compatibility metrics
 */

import { DeepgramModelMetrics } from '../deepgramModelMetrics';
import { AccountTier, DeepgramErrorType } from '../../services/modelCompatibilityService';
import { alertSystem } from '../alert_system';

// Mock dependencies
jest.mock('../alert_system');
jest.mock('../../utils/logger');
jest.mock('fs');

describe('DeepgramModelMetrics', () => {
  let metrics: DeepgramModelMetrics;

  beforeEach(() => {
    // Create a new instance for each test
    metrics = new (DeepgramModelMetrics as any)();
    jest.clearAllMocks();
  });

  afterEach(() => {
    metrics.stop();
    metrics.resetMetrics();
  });

  describe('Model Usage Recording', () => {
    it('should record successful model usage', () => {
      const model = 'nova-2';
      const tier: AccountTier = 'premium';
      const responseTime = 1500;

      metrics.recordModelUsage(model, tier, true, responseTime);

      const summary = metrics.getMetricsSummary();
      const modelMetrics = summary.modelUsage.find(m => m.model === model);

      expect(modelMetrics).toBeDefined();
      expect(modelMetrics!.model).toBe(model);
      expect(modelMetrics!.tier).toBe(tier);
      expect(modelMetrics!.usageCount).toBe(1);
      expect(modelMetrics!.successCount).toBe(1);
      expect(modelMetrics!.failureCount).toBe(0);
      expect(modelMetrics!.averageResponseTime).toBe(responseTime);
    });

    it('should record failed model usage with error type', () => {
      const model = 'nova-2';
      const tier: AccountTier = 'premium';
      const responseTime = 2000;
      const errorType = DeepgramErrorType.INSUFFICIENT_PERMISSIONS;

      metrics.recordModelUsage(model, tier, false, responseTime, errorType);

      const summary = metrics.getMetricsSummary();
      const modelMetrics = summary.modelUsage.find(m => m.model === model);

      expect(modelMetrics).toBeDefined();
      expect(modelMetrics!.usageCount).toBe(1);
      expect(modelMetrics!.successCount).toBe(0);
      expect(modelMetrics!.failureCount).toBe(1);
      expect(modelMetrics!.errorTypes[errorType]).toBe(1);
    });

    it('should accumulate multiple usage records', () => {
      const model = 'nova';
      const tier: AccountTier = 'basic';

      // Record multiple successful uses
      metrics.recordModelUsage(model, tier, true, 1000);
      metrics.recordModelUsage(model, tier, true, 1500);
      metrics.recordModelUsage(model, tier, false, 2000);

      const summary = metrics.getMetricsSummary();
      const modelMetrics = summary.modelUsage.find(m => m.model === model);

      expect(modelMetrics!.usageCount).toBe(3);
      expect(modelMetrics!.successCount).toBe(2);
      expect(modelMetrics!.failureCount).toBe(1);
      expect(modelMetrics!.averageResponseTime).toBe(1500); // (1000 + 1500 + 2000) / 3
    });
  });

  describe('Model Validation Recording', () => {
    it('should record successful model validation', () => {
      const model = 'base';
      const validationTime = 500;

      metrics.recordModelValidation(model, true, validationTime);

      const summary = metrics.getMetricsSummary();
      const validationMetrics = summary.modelValidation.find(m => m.model === model);

      expect(validationMetrics).toBeDefined();
      expect(validationMetrics!.model).toBe(model);
      expect(validationMetrics!.validationAttempts).toBe(1);
      expect(validationMetrics!.validationSuccesses).toBe(1);
      expect(validationMetrics!.validationFailures).toBe(0);
      expect(validationMetrics!.successRate).toBe(1);
      expect(validationMetrics!.averageValidationTime).toBe(validationTime);
    });

    it('should record failed model validation with error type', () => {
      const model = 'nova-2';
      const validationTime = 800;
      const errorType = DeepgramErrorType.AUTHENTICATION_ERROR;

      metrics.recordModelValidation(model, false, validationTime, errorType);

      const summary = metrics.getMetricsSummary();
      const validationMetrics = summary.modelValidation.find(m => m.model === model);

      expect(validationMetrics).toBeDefined();
      expect(validationMetrics!.validationAttempts).toBe(1);
      expect(validationMetrics!.validationSuccesses).toBe(0);
      expect(validationMetrics!.validationFailures).toBe(1);
      expect(validationMetrics!.successRate).toBe(0);
      expect(validationMetrics!.errorTypes[errorType]).toBe(1);
    });

    it('should calculate success rate correctly', () => {
      const model = 'nova';

      // Record mixed validation results
      metrics.recordModelValidation(model, true, 400);
      metrics.recordModelValidation(model, true, 600);
      metrics.recordModelValidation(model, false, 800);
      metrics.recordModelValidation(model, true, 500);

      const summary = metrics.getMetricsSummary();
      const validationMetrics = summary.modelValidation.find(m => m.model === model);

      expect(validationMetrics!.validationAttempts).toBe(4);
      expect(validationMetrics!.validationSuccesses).toBe(3);
      expect(validationMetrics!.validationFailures).toBe(1);
      expect(validationMetrics!.successRate).toBe(0.75);
    });
  });

  describe('Model Fallback Recording', () => {
    it('should record successful model fallback', () => {
      const originalModel = 'nova-2';
      const fallbackModel = 'nova';
      const fallbackTime = 300;
      const errorType = DeepgramErrorType.INSUFFICIENT_PERMISSIONS;

      metrics.recordModelFallback(originalModel, fallbackModel, fallbackTime, errorType, true);

      const summary = metrics.getMetricsSummary();
      const fallbackMetrics = summary.fallbacks.find(f => 
        f.originalModel === originalModel && f.fallbackModel === fallbackModel
      );

      expect(fallbackMetrics).toBeDefined();
      expect(fallbackMetrics!.originalModel).toBe(originalModel);
      expect(fallbackMetrics!.fallbackModel).toBe(fallbackModel);
      expect(fallbackMetrics!.fallbackCount).toBe(1);
      expect(fallbackMetrics!.errorType).toBe(errorType);
      expect(fallbackMetrics!.successAfterFallback).toBe(1);
      expect(fallbackMetrics!.failureAfterFallback).toBe(0);
      expect(fallbackMetrics!.averageFallbackTime).toBe(fallbackTime);
    });

    it('should record failed model fallback', () => {
      const originalModel = 'nova-2';
      const fallbackModel = 'base';
      const fallbackTime = 500;
      const errorType = DeepgramErrorType.INVALID_MODEL;

      metrics.recordModelFallback(originalModel, fallbackModel, fallbackTime, errorType, false);

      const summary = metrics.getMetricsSummary();
      const fallbackMetrics = summary.fallbacks.find(f => 
        f.originalModel === originalModel && f.fallbackModel === fallbackModel
      );

      expect(fallbackMetrics!.successAfterFallback).toBe(0);
      expect(fallbackMetrics!.failureAfterFallback).toBe(1);
    });

    it('should update original model fallback count', () => {
      const originalModel = 'nova-2';
      const fallbackModel = 'nova';
      const tier: AccountTier = 'premium';

      // First record some usage for the original model
      metrics.recordModelUsage(originalModel, tier, true, 1000);

      // Then record a fallback
      metrics.recordModelFallback(originalModel, fallbackModel, 300, DeepgramErrorType.INSUFFICIENT_PERMISSIONS, true);

      const summary = metrics.getMetricsSummary();
      const originalModelMetrics = summary.modelUsage.find(m => m.model === originalModel);

      expect(originalModelMetrics!.fallbackCount).toBe(1);
    });
  });

  describe('Account Tier Detection', () => {
    it('should record account tier detection', () => {
      const tier: AccountTier = 'premium';
      const availableModels = ['nova-2', 'nova-2-general', 'nova', 'base'];
      const detectionTime = 1200;

      metrics.recordAccountTierDetection(tier, availableModels, detectionTime);

      const summary = metrics.getMetricsSummary();
      const accountTier = summary.accountTier;

      expect(accountTier.tier).toBe(tier);
      expect(accountTier.availableModelsCount).toBe(availableModels.length);
      expect(accountTier.availableModels).toEqual(availableModels);
      expect(accountTier.detectionCount).toBe(1);
    });

    it('should detect capability changes', () => {
      const initialTier: AccountTier = 'premium';
      const initialModels = ['nova-2', 'nova', 'base'];
      
      const newTier: AccountTier = 'basic';
      const newModels = ['nova', 'base'];

      // Record initial detection
      metrics.recordAccountTierDetection(initialTier, initialModels, 1000);

      // Record capability change
      metrics.recordAccountTierDetection(newTier, newModels, 1100);

      const summary = metrics.getMetricsSummary();
      const accountTier = summary.accountTier;

      expect(accountTier.tier).toBe(newTier);
      expect(accountTier.availableModelsCount).toBe(newModels.length);
      expect(accountTier.capabilityChanges).toBe(1);
      expect(accountTier.detectionCount).toBe(2);
    });
  });

  describe('Metrics Summary', () => {
    it('should generate comprehensive metrics summary', () => {
      // Record various metrics
      metrics.recordModelUsage('nova-2', 'premium', true, 1000);
      metrics.recordModelUsage('nova-2', 'premium', false, 1500, DeepgramErrorType.QUOTA_EXCEEDED);
      metrics.recordModelUsage('nova', 'basic', true, 800);
      
      metrics.recordModelValidation('nova-2', false, 600, DeepgramErrorType.INSUFFICIENT_PERMISSIONS);
      metrics.recordModelValidation('nova', true, 400);
      
      metrics.recordModelFallback('nova-2', 'nova', 300, DeepgramErrorType.INSUFFICIENT_PERMISSIONS, true);
      
      metrics.recordAccountTierDetection('basic', ['nova', 'base'], 1000);

      const summary = metrics.getMetricsSummary();

      // Check overall stats
      expect(summary.overallStats.totalRequests).toBe(3);
      expect(summary.overallStats.totalSuccesses).toBe(2);
      expect(summary.overallStats.totalFailures).toBe(1);
      expect(summary.overallStats.totalFallbacks).toBe(1);
      expect(summary.overallStats.overallSuccessRate).toBeCloseTo(2/3);
      expect(summary.overallStats.overallFallbackRate).toBeCloseTo(1/3);

      // Check model usage
      expect(summary.modelUsage).toHaveLength(2);
      expect(summary.modelValidation).toHaveLength(2);
      expect(summary.fallbacks).toHaveLength(1);

      // Check account tier
      expect(summary.accountTier.tier).toBe('basic');
      expect(summary.accountTier.availableModelsCount).toBe(2);
    });

    it('should identify most used and most failed models', () => {
      // Record usage for multiple models
      metrics.recordModelUsage('nova-2', 'premium', true, 1000);
      metrics.recordModelUsage('nova-2', 'premium', true, 1200);
      metrics.recordModelUsage('nova-2', 'premium', false, 1500);
      
      metrics.recordModelUsage('nova', 'basic', true, 800);
      metrics.recordModelUsage('nova', 'basic', false, 900);
      metrics.recordModelUsage('nova', 'basic', false, 1100);
      
      metrics.recordModelUsage('base', 'free', true, 600);

      const summary = metrics.getMetricsSummary();

      expect(summary.overallStats.mostUsedModel).toBe('nova-2'); // 3 uses
      expect(summary.overallStats.mostFailedModel).toBe('nova'); // 2 failures
    });
  });

  describe('Alert Generation', () => {
    beforeEach(() => {
      // Mock the alert system
      (alertSystem.createAlert as jest.Mock).mockClear();
    });

    it('should create alert for high failure rate', async () => {
      // Set up metrics that would trigger high failure rate alert
      const model = 'nova-2';
      const tier: AccountTier = 'premium';
      
      // Record enough requests to meet minimum threshold
      for (let i = 0; i < 15; i++) {
        metrics.recordModelUsage(model, tier, i < 5, 1000); // 5 successes, 10 failures = 66% failure rate
      }

      // Trigger alert check
      await (metrics as any).checkMetricsForAlerts();

      expect(alertSystem.createAlert).toHaveBeenCalledWith(
        expect.any(String), // AlertLevel.CRITICAL
        expect.stringContaining('deepgram-high-failure-rate'),
        expect.stringContaining('High Deepgram failure rate detected'),
        expect.objectContaining({
          failureRate: expect.any(Number),
          totalRequests: 15
        }),
        'deepgram-model-metrics'
      );
    });

    it('should create alert for high fallback rate', async () => {
      const model = 'nova-2';
      const tier: AccountTier = 'premium';
      
      // Record usage with high fallback rate
      for (let i = 0; i < 12; i++) {
        metrics.recordModelUsage(model, tier, true, 1000);
        if (i < 8) { // 8 fallbacks out of 12 requests = 66% fallback rate
          metrics.recordModelFallback(model, 'nova', 300, DeepgramErrorType.INSUFFICIENT_PERMISSIONS, true);
        }
      }

      await (metrics as any).checkMetricsForAlerts();

      expect(alertSystem.createAlert).toHaveBeenCalledWith(
        expect.any(String), // AlertLevel.WARNING
        expect.stringContaining('deepgram-high-fallback-rate'),
        expect.stringContaining('High Deepgram fallback rate detected'),
        expect.objectContaining({
          fallbackRate: expect.any(Number),
          totalFallbacks: 8
        }),
        'deepgram-model-metrics'
      );
    });

    it('should create alert for persistent fallback pattern', async () => {
      const originalModel = 'nova-2';
      const fallbackModel = 'nova';
      
      // Record many fallbacks for the same pattern
      for (let i = 0; i < 6; i++) {
        metrics.recordModelFallback(originalModel, fallbackModel, 300, DeepgramErrorType.INSUFFICIENT_PERMISSIONS, true);
      }

      await (metrics as any).checkMetricsForAlerts();

      expect(alertSystem.createAlert).toHaveBeenCalledWith(
        expect.any(String), // AlertLevel.CRITICAL
        expect.stringContaining('deepgram-persistent-fallback'),
        expect.stringContaining(`Persistent fallback pattern: ${originalModel} → ${fallbackModel}`),
        expect.objectContaining({
          originalModel,
          fallbackModel,
          fallbackCount: 6
        }),
        'deepgram-model-metrics'
      );
    });
  });

  describe('Metrics Reset', () => {
    it('should reset all metrics', () => {
      // Record some metrics
      metrics.recordModelUsage('nova-2', 'premium', true, 1000);
      metrics.recordModelValidation('nova', true, 500);
      metrics.recordAccountTierDetection('basic', ['nova', 'base'], 800);

      // Verify metrics exist
      let summary = metrics.getMetricsSummary();
      expect(summary.modelUsage).toHaveLength(1);
      expect(summary.modelValidation).toHaveLength(1);
      expect(summary.accountTier.detectionCount).toBe(1);

      // Reset metrics
      metrics.resetMetrics();

      // Verify metrics are cleared
      summary = metrics.getMetricsSummary();
      expect(summary.modelUsage).toHaveLength(0);
      expect(summary.modelValidation).toHaveLength(0);
      expect(summary.accountTier.detectionCount).toBe(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit events for model usage', (done) => {
      const model = 'nova-2';
      const tier: AccountTier = 'premium';

      metrics.onModelUsage((event) => {
        expect(event.model).toBe(model);
        expect(event.tier).toBe(tier);
        expect(event.success).toBe(true);
        expect(event.responseTime).toBe(1000);
        done();
      });

      metrics.recordModelUsage(model, tier, true, 1000);
    });

    it('should emit events for model validation', (done) => {
      const model = 'nova';

      metrics.onModelValidation((event) => {
        expect(event.model).toBe(model);
        expect(event.success).toBe(true);
        expect(event.validationTime).toBe(500);
        done();
      });

      metrics.recordModelValidation(model, true, 500);
    });

    it('should emit events for model fallback', (done) => {
      const originalModel = 'nova-2';
      const fallbackModel = 'nova';

      metrics.onModelFallback((event) => {
        expect(event.originalModel).toBe(originalModel);
        expect(event.fallbackModel).toBe(fallbackModel);
        expect(event.fallbackSuccess).toBe(true);
        done();
      });

      metrics.recordModelFallback(originalModel, fallbackModel, 300, DeepgramErrorType.INSUFFICIENT_PERMISSIONS, true);
    });
  });
});