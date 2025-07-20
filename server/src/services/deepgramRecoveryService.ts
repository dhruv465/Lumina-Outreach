/**
 * Deepgram Recovery Service
 * 
 * This service provides high-level recovery operations for Deepgram API failures,
 * integrating error classification, model fallback, and retry logic.
 * 
 * Requirements addressed:
 * - 2.1: Detailed error logging and classification
 * - 2.2: Model fallback and recovery strategies
 * - 2.4: Retry logic with exponential backoff
 */

import logger from '../utils/logger';
import { deepgramErrorHandler, DeepgramError, RecoveryContext } from './deepgramErrorHandler';
import { DeepgramErrorType, RecoveryStrategy, DEEPGRAM_MODEL_REGISTRY, DEFAULT_MODEL_HIERARCHY } from '../types/deepgram';
import { getErrorMessage } from '../utils/logger';

export interface RecoveryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  fallbackUsed: boolean;
  modelUsed: string;
  attemptsUsed: number;
  recoveryStrategy?: RecoveryStrategy;
}

export interface ModelFallbackOptions {
  preserveFeatures?: boolean;
  allowTierDowngrade?: boolean;
  maxFallbackAttempts?: number;
}

/**
 * Service for executing Deepgram operations with automatic error recovery
 */
export class DeepgramRecoveryService {
  /**
   * Execute a Deepgram operation with automatic error recovery and model fallback
   */
  public async executeWithRecovery<T>(
    operation: (model: string) => Promise<T>,
    initialModel: string,
    apiKey: string,
    options?: ModelFallbackOptions
  ): Promise<RecoveryResult<T>> {
    const startTime = Date.now();
    const context: RecoveryContext = {
      currentModel: initialModel,
      apiKey,
      attemptNumber: 0,
      previousErrors: []
    };

    const fallbackOptions = {
      preserveFeatures: true,
      allowTierDowngrade: true,
      maxFallbackAttempts: 3,
      ...options
    };

    logger.info('Starting Deepgram operation with recovery', {
      initialModel,
      fallbackOptions
    });

    // Try the initial model first
    try {
      const result = await this.executeOperationWithRetry(operation, context);
      
      logger.info('Deepgram operation succeeded without recovery', {
        model: initialModel,
        duration: Date.now() - startTime
      });

      return {
        success: true,
        result,
        fallbackUsed: false,
        modelUsed: initialModel,
        attemptsUsed: 1
      };
    } catch (error) {
      logger.warn('Initial Deepgram operation failed, attempting recovery', {
        model: initialModel,
        error: getErrorMessage(error)
      });

      context.previousErrors.push(deepgramErrorHandler.classifyError(error) as any);
    }

    // Try fallback models
    const fallbackModels = this.getFallbackModels(initialModel, fallbackOptions);
    
    for (let i = 0; i < fallbackModels.length && i < fallbackOptions.maxFallbackAttempts; i++) {
      const fallbackModel = fallbackModels[i];
      context.currentModel = fallbackModel;
      context.attemptNumber = i + 2; // +2 because we already tried initial model

      logger.info(`Attempting Deepgram operation with fallback model`, {
        fallbackModel,
        attemptNumber: context.attemptNumber,
        remainingFallbacks: fallbackModels.length - i - 1
      });

      try {
        const result = await this.executeOperationWithRetry(operation, context);
        
        logger.info('Deepgram operation succeeded with fallback model', {
          originalModel: initialModel,
          fallbackModel,
          attemptNumber: context.attemptNumber,
          duration: Date.now() - startTime
        });

        return {
          success: true,
          result,
          fallbackUsed: true,
          modelUsed: fallbackModel,
          attemptsUsed: context.attemptNumber
        };
      } catch (error) {
        logger.warn(`Fallback model ${fallbackModel} also failed`, {
          error: getErrorMessage(error),
          attemptNumber: context.attemptNumber
        });

        context.previousErrors.push(deepgramErrorHandler.classifyError(error) as any);
      }
    }

    // All attempts failed
    const finalError = new Error(
      `All Deepgram recovery attempts failed. Tried models: ${[initialModel, ...fallbackModels].join(', ')}`
    );

    logger.error('Deepgram operation failed permanently', {
      initialModel,
      fallbackModels,
      totalAttempts: context.attemptNumber,
      duration: Date.now() - startTime,
      errors: context.previousErrors.map(e => e.message || 'Unknown error')
    });

    return {
      success: false,
      error: finalError,
      fallbackUsed: fallbackModels.length > 0,
      modelUsed: initialModel,
      attemptsUsed: context.attemptNumber
    };
  }

  /**
   * Execute a single operation with retry logic
   */
  private async executeOperationWithRetry<T>(
    operation: (model: string) => Promise<T>,
    context: RecoveryContext
  ): Promise<T> {
    return deepgramErrorHandler.executeRecovery(
      () => operation(context.currentModel),
      context,
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterEnabled: true
      }
    );
  }

  /**
   * Get appropriate fallback models for a given model
   */
  private getFallbackModels(model: string, options: ModelFallbackOptions): string[] {
    const fallbackModels = DEFAULT_MODEL_HIERARCHY[model] || ['nova', 'base'];
    
    if (!options.allowTierDowngrade) {
      // Filter out models from lower tiers
      const currentModelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
      if (currentModelInfo) {
        return fallbackModels.filter(fallbackModel => {
          const fallbackInfo = DEEPGRAM_MODEL_REGISTRY.models[fallbackModel];
          return fallbackInfo && this.isSameTierOrHigher(fallbackInfo.tier, currentModelInfo.tier);
        });
      }
    }

    if (options.preserveFeatures) {
      // Filter models that support similar features
      const currentModelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
      if (currentModelInfo) {
        return fallbackModels.filter(fallbackModel => {
          const fallbackInfo = DEEPGRAM_MODEL_REGISTRY.models[fallbackModel];
          return fallbackInfo && this.hasCompatibleFeatures(fallbackInfo.features, currentModelInfo.features);
        });
      }
    }

    return fallbackModels;
  }

  /**
   * Check if a tier is same or higher than another tier
   */
  private isSameTierOrHigher(tier1: string, tier2: string): boolean {
    const tierOrder = { 'free': 0, 'basic': 1, 'premium': 2 };
    return (tierOrder[tier1 as keyof typeof tierOrder] || 0) >= (tierOrder[tier2 as keyof typeof tierOrder] || 0);
  }

  /**
   * Check if features are compatible (fallback has at least some of the original features)
   */
  private hasCompatibleFeatures(fallbackFeatures: string[], originalFeatures: string[]): boolean {
    // At least 50% of original features should be supported
    const commonFeatures = fallbackFeatures.filter(feature => originalFeatures.includes(feature));
    return commonFeatures.length >= Math.ceil(originalFeatures.length * 0.5);
  }

  /**
   * Validate if a model is accessible with the given API key
   */
  public async validateModelAccess(
    model: string,
    apiKey: string,
    testOperation?: (model: string) => Promise<any>
  ): Promise<boolean> {
    try {
      if (testOperation) {
        await testOperation(model);
      } else {
        // Default validation - just check if model exists in registry
        const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
        if (!modelInfo) {
          logger.warn(`Model ${model} not found in registry`);
          return false;
        }
      }

      logger.info(`Model ${model} validation successful`);
      return true;
    } catch (error) {
      const classification = deepgramErrorHandler.classifyError(error);
      
      logger.warn(`Model ${model} validation failed`, {
        errorType: classification.errorType,
        message: getErrorMessage(error)
      });

      // Only return false for permission/model errors, not network errors
      return classification.errorType !== DeepgramErrorType.INSUFFICIENT_PERMISSIONS &&
             classification.errorType !== DeepgramErrorType.INVALID_MODEL;
    }
  }

  /**
   * Get recommended model based on account capabilities and use case
   */
  public getRecommendedModel(
    availableModels: string[],
    useCase: 'general' | 'meeting' | 'phone' | 'conversational' = 'general',
    preferRealtime: boolean = false
  ): string {
    // Filter models by use case
    const suitableModels = availableModels.filter(model => {
      const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
      return modelInfo && (
        modelInfo.useCases.includes(useCase) ||
        modelInfo.useCases.includes('general')
      );
    });

    // Filter by realtime capability if needed
    const realtimeCompatible = preferRealtime 
      ? suitableModels.filter(model => {
          const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
          return modelInfo && modelInfo.features.includes('realtime');
        })
      : suitableModels;

    // Prefer higher tier models
    const sortedModels = (realtimeCompatible.length > 0 ? realtimeCompatible : suitableModels)
      .sort((a, b) => {
        const aInfo = DEEPGRAM_MODEL_REGISTRY.models[a];
        const bInfo = DEEPGRAM_MODEL_REGISTRY.models[b];
        
        if (!aInfo || !bInfo) return 0;
        
        const tierOrder = { 'premium': 2, 'basic': 1, 'free': 0 };
        return (tierOrder[bInfo.tier as keyof typeof tierOrder] || 0) - 
               (tierOrder[aInfo.tier as keyof typeof tierOrder] || 0);
      });

    return sortedModels[0] || 'base'; // Fallback to base model
  }

  /**
   * Create a recovery context for error handling
   */
  public createRecoveryContext(
    model: string,
    apiKey: string,
    accountTier?: string
  ): RecoveryContext {
    return {
      currentModel: model,
      apiKey,
      accountTier,
      attemptNumber: 0,
      previousErrors: []
    };
  }
}

// Export singleton instance
export const deepgramRecoveryService = new DeepgramRecoveryService();