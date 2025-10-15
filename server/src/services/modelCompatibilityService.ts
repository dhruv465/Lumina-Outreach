import { createClient, DeepgramClient } from '@deepgram/sdk';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { validateAndFetch } from './deepgramUtils';
import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';
import { deepgramModelMetrics } from '../monitoring/deepgramModelMetrics';

/**
 * Deepgram account tier types
 */
export type AccountTier = 'free' | 'basic' | 'premium';

/**
 * Model validation result interface
 */
export interface ModelValidationResult {
  isValid: boolean;
  model: string;
  tier: AccountTier;
  error?: string;
  suggestedAlternatives: string[];
}

/**
 * Account capabilities interface
 */
export interface AccountCapabilities {
  tier: AccountTier;
  availableModels: string[];
  features: {
    realtime: boolean;
    batch: boolean;
    streaming: boolean;
  };
  limits: {
    requestsPerMinute: number;
    hoursPerMonth: number;
  };
}

/**
 * Model preferences for selection
 */
export interface ModelPreferences {
  preferredModels: string[];
  useCase: 'general' | 'meeting' | 'phone';
  language: string;
  realtime: boolean;
}

/**
 * Model information interface
 */
export interface ModelInfo {
  name: string;
  tier: AccountTier;
  features: string[];
  useCases: string[];
  languages: string[];
  deprecated?: boolean;
  replacedBy?: string;
}

/**
 * Model registry with tier-based compatibility matrix
 */
export interface ModelRegistry {
  models: {
    [key: string]: ModelInfo;
  };
}

/**
 * Deepgram error types for classification
 */
export enum DeepgramErrorType {
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_MODEL = 'INVALID_MODEL',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR'
}

/**
 * Model Compatibility Service
 * Handles Deepgram model validation, fallback logic, and account capability detection
 */
export class ModelCompatibilityService {
  private apiKey: string;
  private client: DeepgramClient;
  private modelRegistry: ModelRegistry;
  private validationCache: Map<string, { result: ModelValidationResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    this.modelRegistry = this.initializeModelRegistry();
  }

  /**
   * Initialize the model registry with tier-based compatibility matrix
   */
  private initializeModelRegistry(): ModelRegistry {
    return {
      models: {
        // Premium models (Paid accounts)
        'nova-2': {
          name: 'nova-2',
          tier: 'premium',
          features: ['realtime', 'batch', 'streaming', 'high-accuracy'],
          useCases: ['general', 'meeting', 'phone'],
          languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh', 'hi', 'ar']
        },
        'nova-2-general': {
          name: 'nova-2-general',
          tier: 'premium',
          features: ['realtime', 'batch', 'streaming', 'high-accuracy', 'general-purpose'],
          useCases: ['general', 'meeting'],
          languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh', 'hi', 'ar']
        },
        'nova-2-meeting': {
          name: 'nova-2-meeting',
          tier: 'premium',
          features: ['realtime', 'batch', 'streaming', 'meeting-optimized'],
          useCases: ['meeting'],
          languages: ['en', 'es', 'fr', 'de', 'it', 'pt']
        },
        'nova-2-phonecall': {
          name: 'nova-2-phonecall',
          tier: 'premium',
          features: ['realtime', 'streaming', 'phone-optimized'],
          useCases: ['phone'],
          languages: ['en', 'es', 'fr', 'de', 'it', 'pt']
        },
        
        // Standard models (Basic paid accounts)
        'nova': {
          name: 'nova',
          tier: 'basic',
          features: ['realtime', 'batch', 'streaming'],
          useCases: ['general', 'meeting', 'phone'],
          languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh']
        },
        'nova-general': {
          name: 'nova-general',
          tier: 'basic',
          features: ['realtime', 'batch', 'streaming', 'general-purpose'],
          useCases: ['general', 'meeting'],
          languages: ['en', 'es', 'fr', 'de', 'it', 'pt']
        },
        
        // Base models (Free accounts)
        'base': {
          name: 'base',
          tier: 'free',
          features: ['batch', 'streaming'],
          useCases: ['general', 'meeting', 'phone'],
          languages: ['en']
        },
        'base-general': {
          name: 'base-general',
          tier: 'free',
          features: ['batch', 'streaming', 'general-purpose'],
          useCases: ['general'],
          languages: ['en']
        }
      }
    };
  }

  /**
   * Update API key and reinitialize client
   */
  public updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    this.clearCache(); // Clear cache when API key changes
    logger.info('ModelCompatibilityService API key updated');
  }

  /**
   * Validate model access against Deepgram API
   */
  public async validateModelAccess(apiKey: string, model: string): Promise<ModelValidationResult> {
    const cacheKey = `${apiKey.slice(-8)}-${model}`;
    const validationStartTime = Date.now();
    
    // Check cache first
    const cached = this.validationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug(`Using cached validation result for model ${model}`, {
        model,
        cacheAge: Date.now() - cached.timestamp,
        isValid: cached.result.isValid,
        context: 'model-validation-cache-hit'
      });
      return cached.result;
    }

    // Log validation attempt
    logger.info(`Starting model validation for ${model}`, {
      model,
      apiKeyHash: apiKey.slice(-8),
      context: 'model-validation-start'
    });

    try {
      // Create a temporary client for validation
      const testClient = createClient(apiKey);
      
      // Create a minimal WAV file buffer for testing (1 second of silence)
      // WAV header for 16-bit PCM, 16kHz, mono, 1 second
      const sampleRate = 16000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const duration = 1; // seconds
      const numSamples = sampleRate * duration;
      const dataSize = numSamples * numChannels * (bitsPerSample / 8);
      const fileSize = 44 + dataSize;
      
      const audioBuffer = Buffer.alloc(fileSize);
      
      // WAV header
      audioBuffer.write('RIFF', 0);
      audioBuffer.writeUInt32LE(fileSize - 8, 4);
      audioBuffer.write('WAVE', 8);
      audioBuffer.write('fmt ', 12);
      audioBuffer.writeUInt32LE(16, 16); // fmt chunk size
      audioBuffer.writeUInt16LE(1, 20); // audio format (PCM)
      audioBuffer.writeUInt16LE(numChannels, 22);
      audioBuffer.writeUInt32LE(sampleRate, 24);
      audioBuffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // byte rate
      audioBuffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // block align
      audioBuffer.writeUInt16LE(bitsPerSample, 34);
      audioBuffer.write('data', 36);
      audioBuffer.writeUInt32LE(dataSize, 40);
      // Audio data is already zeros (silence)

      // Call transcribeFile with the generated audio buffer
      await testClient.listen.prerecorded.transcribeFile(audioBuffer, {
        model: model,
        language: 'en',
        smart_format: true
      } as any);

      const validationDuration = Date.now() - validationStartTime;
      const modelInfo = this.modelRegistry.models[model];
      
      const result: ModelValidationResult = {
        isValid: true,
        model: model,
        tier: modelInfo?.tier || 'free',
        suggestedAlternatives: []
      };

      // Cache the result
      this.validationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      // Record validation metrics
      deepgramModelMetrics.recordModelValidation(model, true, validationDuration);

      // Enhanced success logging
      logger.info(`Model validation successful for ${model}`, {
        model,
        tier: result.tier,
        validationDuration,
        apiKeyHash: apiKey.slice(-8),
        context: 'model-validation-success'
      });

      return result;

    } catch (error: any) {
      const errorType = this.classifyError(error);
      const modelInfo = this.modelRegistry.models[model];
      const suggestedAlternatives = this.getSuggestedAlternatives(model, errorType);
      const validationDuration = Date.now() - validationStartTime;

      const result: ModelValidationResult = {
        isValid: false,
        model: model,
        tier: modelInfo?.tier || 'free',
        error: getErrorMessage(error),
        suggestedAlternatives
      };

      // Cache failed results for a shorter time
      this.validationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      // Record validation metrics
      deepgramModelMetrics.recordModelValidation(model, false, validationDuration, errorType);

      // Enhanced failure logging
      logger.warn(`Model validation failed for ${model}`, {
        model,
        tier: result.tier,
        errorType,
        errorMessage: result.error,
        suggestedAlternatives,
        validationDuration,
        apiKeyHash: apiKey.slice(-8),
        context: 'model-validation-failed'
      });

      // Create admin alert for validation failures
      this.createModelValidationAlert(model, error, errorType, suggestedAlternatives);

      return result;
    }
  }

  /**
   * Get compatible models for the account
   */
  public async getCompatibleModels(apiKey: string): Promise<string[]> {
    const compatibleModels: string[] = [];
    
    // Test models in order of preference (premium -> basic -> free)
    const modelsToTest = [
      'nova-2', 'nova-2-general', 'nova-2-meeting', 'nova-2-phonecall',
      'nova', 'nova-general',
      'base', 'base-general'
    ];

    for (const model of modelsToTest) {
      try {
        const validation = await this.validateModelAccess(apiKey, model);
        if (validation.isValid) {
          compatibleModels.push(model);
        }
      } catch (error) {
        logger.debug(`Model ${model} not compatible: ${getErrorMessage(error)}`);
      }
    }

    logger.info(`Found ${compatibleModels.length} compatible models`);
    return compatibleModels;
  }

  /**
   * Select the best model based on available models and preferences
   */
  public selectBestModel(availableModels: string[], preferences: ModelPreferences): string {
    // First, try preferred models in order
    for (const preferredModel of preferences.preferredModels) {
      if (availableModels.includes(preferredModel)) {
        const modelInfo = this.modelRegistry.models[preferredModel];
        if (modelInfo && this.isModelSuitableForUseCase(modelInfo, preferences)) {
          logger.info(`Selected preferred model: ${preferredModel}`);
          return preferredModel;
        }
      }
    }

    // Filter models by use case and features
    const suitableModels = availableModels.filter(model => {
      const modelInfo = this.modelRegistry.models[model];
      return modelInfo && this.isModelSuitableForUseCase(modelInfo, preferences);
    });

    if (suitableModels.length === 0) {
      // Fallback to any available model
      const fallbackModel = availableModels[0] || 'base';
      logger.warn(`No suitable models found, using fallback: ${fallbackModel}`);
      return fallbackModel;
    }

    // Sort by tier preference (premium > basic > free)
    const tierOrder: AccountTier[] = ['premium', 'basic', 'free'];
    suitableModels.sort((a, b) => {
      const aInfo = this.modelRegistry.models[a];
      const bInfo = this.modelRegistry.models[b];
      const aTierIndex = tierOrder.indexOf(aInfo?.tier || 'free');
      const bTierIndex = tierOrder.indexOf(bInfo?.tier || 'free');
      return aTierIndex - bTierIndex;
    });

    const selectedModel = suitableModels[0];
    logger.info(`Selected best available model: ${selectedModel}`);
    return selectedModel;
  }

  /**
   * Handle model fallback when current model fails
   */
  public handleModelFallback(currentModel: string, error: any): string {
    const fallbackStartTime = Date.now();
    const errorType = this.classifyError(error);
    const alternatives = this.getSuggestedAlternatives(currentModel, errorType);
    const currentModelInfo = this.modelRegistry.models[currentModel];
    
    // Enhanced logging for fallback events
    logger.warn(`Model fallback initiated for ${currentModel}`, {
      currentModel,
      currentModelTier: currentModelInfo?.tier,
      errorType,
      errorMessage: getErrorMessage(error),
      availableAlternatives: alternatives,
      context: 'model-fallback-initiated'
    });
    
    if (alternatives.length > 0) {
      const fallbackModel = alternatives[0];
      const fallbackModelInfo = this.modelRegistry.models[fallbackModel];
      const fallbackDuration = Date.now() - fallbackStartTime;
      
      logger.info(`Model fallback successful: ${currentModel} → ${fallbackModel}`, {
        originalModel: currentModel,
        originalTier: currentModelInfo?.tier,
        fallbackModel,
        fallbackTier: fallbackModelInfo?.tier,
        errorType,
        reason: getErrorMessage(error),
        context: 'model-fallback-success'
      });

      // Record fallback metrics
      deepgramModelMetrics.recordModelFallback(currentModel, fallbackModel, fallbackDuration, errorType, true);

      // Create admin alert for model fallback
      this.createModelFallbackAlert(currentModel, fallbackModel, error, errorType);
      
      return fallbackModel;
    }

    // Ultimate fallback
    const ultimateFallback = 'base';
    const ultimateFallbackInfo = this.modelRegistry.models[ultimateFallback];
    const fallbackDuration = Date.now() - fallbackStartTime;
    
    logger.warn(`Using ultimate fallback model: ${ultimateFallback}`, {
      originalModel: currentModel,
      originalTier: currentModelInfo?.tier,
      ultimateFallback,
      ultimateFallbackTier: ultimateFallbackInfo?.tier,
      errorType,
      reason: 'No suitable alternatives found',
      context: 'model-ultimate-fallback'
    });

    // Record ultimate fallback metrics
    deepgramModelMetrics.recordModelFallback(currentModel, ultimateFallback, fallbackDuration, errorType, false);

    // Create critical alert for ultimate fallback usage
    this.createUltimateFallbackAlert(currentModel, ultimateFallback, error, errorType);
    
    return ultimateFallback;
  }

  /**
   * Detect account capabilities based on available models
   */
  public async getAccountCapabilities(apiKey: string): Promise<AccountCapabilities> {
    const capabilityDetectionStart = Date.now();
    
    logger.info('Starting account capability detection', {
      apiKeyHash: apiKey.slice(-8),
      context: 'account-capability-detection-start'
    });
    
    const availableModels = await this.getCompatibleModels(apiKey);
    
    // Determine tier based on highest tier model available
    let tier: AccountTier = 'free';
    let hasRealtime = false;
    let hasBatch = false;
    let hasStreaming = false;

    for (const model of availableModels) {
      const modelInfo = this.modelRegistry.models[model];
      if (modelInfo) {
        // Update tier to highest available
        if (modelInfo.tier === 'premium') tier = 'premium';
        else if (modelInfo.tier === 'basic' && tier === 'free') tier = 'basic';

        // Update features
        if (modelInfo.features.includes('realtime')) hasRealtime = true;
        if (modelInfo.features.includes('batch')) hasBatch = true;
        if (modelInfo.features.includes('streaming')) hasStreaming = true;
      }
    }

    // Set limits based on tier
    const limits = this.getLimitsForTier(tier);
    const detectionDuration = Date.now() - capabilityDetectionStart;

    const capabilities: AccountCapabilities = {
      tier,
      availableModels,
      features: {
        realtime: hasRealtime,
        batch: hasBatch,
        streaming: hasStreaming
      },
      limits
    };

    // Record account tier detection metrics
    deepgramModelMetrics.recordAccountTierDetection(tier, availableModels, detectionDuration);

    // Enhanced logging for account capabilities
    logger.info('Account capabilities detected', {
      tier,
      modelCount: availableModels.length,
      availableModels,
      features: capabilities.features,
      limits: capabilities.limits,
      detectionDuration,
      apiKeyHash: apiKey.slice(-8),
      context: 'account-capability-detection-complete'
    });

    // Create alert if account has limited capabilities
    this.createAccountCapabilityAlert(capabilities);

    return capabilities;
  }

  /**
   * Classify Deepgram errors for appropriate handling
   */
  private classifyError(error: any): DeepgramErrorType {
    const errorMessage = getErrorMessage(error).toLowerCase();
    const statusCode = error?.status || error?.response?.status;

    if (statusCode === 401 || errorMessage.includes('unauthorized') || errorMessage.includes('invalid api key')) {
      return DeepgramErrorType.AUTHENTICATION_ERROR;
    }

    if (statusCode === 403 || errorMessage.includes('insufficient') || errorMessage.includes('permission')) {
      return DeepgramErrorType.INSUFFICIENT_PERMISSIONS;
    }

    if (statusCode === 400 || errorMessage.includes('invalid model') || errorMessage.includes('model not found')) {
      return DeepgramErrorType.INVALID_MODEL;
    }

    if (statusCode === 429 || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
      return DeepgramErrorType.QUOTA_EXCEEDED;
    }

    if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('connection')) {
      return DeepgramErrorType.NETWORK_ERROR;
    }

    return DeepgramErrorType.NETWORK_ERROR; // Default fallback
  }

  /**
   * Get suggested alternative models based on error type
   */
  private getSuggestedAlternatives(currentModel: string, errorType: DeepgramErrorType): string[] {
    const currentModelInfo = this.modelRegistry.models[currentModel];
    
    if (errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      // Suggest lower tier models
      if (currentModelInfo?.tier === 'premium') {
        return ['nova', 'nova-general', 'base', 'base-general'];
      } else if (currentModelInfo?.tier === 'basic') {
        return ['base', 'base-general'];
      }
    }

    if (errorType === DeepgramErrorType.INVALID_MODEL) {
      // Suggest similar models from the same or lower tier
      const useCase = currentModelInfo?.useCases?.[0] || 'general';
      return this.getModelsByUseCase(useCase);
    }

    // For unknown models or other errors, prioritize most compatible fallback
    if (!currentModelInfo) {
      return ['base', 'base-general', 'nova'];
    }

    // Default alternatives in order of preference
    return ['nova', 'base', 'base-general'];
  }

  /**
   * Check if model is suitable for the given use case and preferences
   */
  private isModelSuitableForUseCase(modelInfo: ModelInfo, preferences: ModelPreferences): boolean {
    // Check use case compatibility
    if (!modelInfo.useCases.includes(preferences.useCase)) {
      return false;
    }

    // Check language support
    if (!modelInfo.languages.includes(preferences.language)) {
      return false;
    }

    // Check realtime requirement
    if (preferences.realtime && !modelInfo.features.includes('realtime')) {
      return false;
    }

    return true;
  }

  /**
   * Get models by use case
   */
  private getModelsByUseCase(useCase: string): string[] {
    return Object.keys(this.modelRegistry.models).filter(model => {
      const modelInfo = this.modelRegistry.models[model];
      return modelInfo.useCases.includes(useCase);
    });
  }

  /**
   * Get account limits based on tier
   */
  private getLimitsForTier(tier: AccountTier): { requestsPerMinute: number; hoursPerMonth: number } {
    switch (tier) {
      case 'premium':
        return { requestsPerMinute: 1000, hoursPerMonth: 1000 };
      case 'basic':
        return { requestsPerMinute: 100, hoursPerMonth: 100 };
      case 'free':
        return { requestsPerMinute: 10, hoursPerMonth: 12 };
      default:
        return { requestsPerMinute: 10, hoursPerMonth: 12 };
    }
  }

  /**
   * Clear validation cache
   */
  public clearCache(): void {
    this.validationCache.clear();
    logger.info('ModelCompatibilityService cache cleared');
  }

  /**
   * Get model registry for inspection
   */
  public getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
  }

  /**
   * Create admin alert for model validation failures
   */
  private createModelValidationAlert(model: string, error: any, errorType: DeepgramErrorType, alternatives: string[]): void {
    // Only create alerts for permission and authentication errors
    if (errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS || errorType === DeepgramErrorType.AUTHENTICATION_ERROR) {
      const alertLevel = errorType === DeepgramErrorType.AUTHENTICATION_ERROR ? AlertLevel.CRITICAL : AlertLevel.WARNING;
      
      alertSystem.createAlert(
        alertLevel,
        'deepgram-model-validation' as AlertType,
        `Model validation failed for ${model}: ${errorType}`,
        {
          model,
          errorType,
          errorMessage: getErrorMessage(error),
          suggestedAlternatives: alternatives,
          modelTier: this.modelRegistry.models[model]?.tier || 'unknown',
          impact: errorType === DeepgramErrorType.AUTHENTICATION_ERROR 
            ? 'All Deepgram services affected' 
            : 'Specific model unavailable, fallback required',
          timestamp: new Date().toISOString()
        },
        'model-compatibility-service'
      );
    }
  }

  /**
   * Create admin alert for model fallback events
   */
  private createModelFallbackAlert(originalModel: string, fallbackModel: string, error: any, errorType: DeepgramErrorType): void {
    const originalTier = this.modelRegistry.models[originalModel]?.tier || 'unknown';
    const fallbackTier = this.modelRegistry.models[fallbackModel]?.tier || 'unknown';
    
    alertSystem.createAlert(
      AlertLevel.WARNING,
      'deepgram-model-fallback' as AlertType,
      `Model fallback: ${originalModel} → ${fallbackModel}`,
      {
        originalModel,
        originalTier,
        fallbackModel,
        fallbackTier,
        errorType,
        errorMessage: getErrorMessage(error),
        impact: originalTier !== fallbackTier 
          ? `Service quality may be affected (${originalTier} → ${fallbackTier})` 
          : 'Service continues with alternative model',
        recommendation: originalTier === 'premium' && fallbackTier !== 'premium'
          ? 'Consider upgrading Deepgram account to restore premium model access'
          : 'Monitor service performance with fallback model',
        timestamp: new Date().toISOString()
      },
      'model-compatibility-service'
    );
  }

  /**
   * Create critical alert for ultimate fallback usage
   */
  private createUltimateFallbackAlert(originalModel: string, ultimateFallback: string, error: any, errorType: DeepgramErrorType): void {
    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'deepgram-ultimate-fallback' as AlertType,
      `Ultimate fallback activated: ${originalModel} → ${ultimateFallback}`,
      {
        originalModel,
        originalTier: this.modelRegistry.models[originalModel]?.tier || 'unknown',
        ultimateFallback,
        ultimateFallbackTier: this.modelRegistry.models[ultimateFallback]?.tier || 'unknown',
        errorType,
        errorMessage: getErrorMessage(error),
        impact: 'Service degraded to minimum functionality',
        urgency: 'High - immediate attention required',
        recommendation: 'Check Deepgram account status and model availability',
        actionRequired: 'Investigate and resolve underlying model access issues',
        timestamp: new Date().toISOString()
      },
      'model-compatibility-service'
    );
  }

  /**
   * Create alert for account capability limitations
   */
  private createAccountCapabilityAlert(capabilities: AccountCapabilities): void {
    // Create info alert for free tier accounts
    if (capabilities.tier === 'free') {
      alertSystem.createAlert(
        AlertLevel.INFO,
        'deepgram-account-tier' as AlertType,
        'Deepgram free tier detected - Limited model access',
        {
          tier: capabilities.tier,
          availableModels: capabilities.availableModels,
          modelCount: capabilities.availableModels.length,
          features: capabilities.features,
          limits: capabilities.limits,
          recommendation: 'Consider upgrading to access premium models and higher limits',
          impact: 'Limited to base models with reduced features',
          timestamp: new Date().toISOString()
        },
        'model-compatibility-service'
      );
    }

    // Create warning if very few models are available
    if (capabilities.availableModels.length <= 1) {
      alertSystem.createAlert(
        AlertLevel.WARNING,
        'deepgram-limited-models' as AlertType,
        `Very limited model access detected (${capabilities.availableModels.length} models available)`,
        {
          tier: capabilities.tier,
          availableModels: capabilities.availableModels,
          modelCount: capabilities.availableModels.length,
          concern: 'Limited fallback options available',
          recommendation: 'Verify account status and consider upgrading for better reliability',
          impact: 'Reduced service resilience due to limited model options',
          timestamp: new Date().toISOString()
        },
        'model-compatibility-service'
      );
    }
  }
}

// Singleton instance
let modelCompatibilityServiceInstance: ModelCompatibilityService | null = null;

/**
 * Initialize the Model Compatibility Service
 */
export function initializeModelCompatibilityService(apiKey: string): ModelCompatibilityService {
  if (!modelCompatibilityServiceInstance) {
    modelCompatibilityServiceInstance = new ModelCompatibilityService(apiKey);
  } else {
    modelCompatibilityServiceInstance.updateApiKey(apiKey);
  }
  return modelCompatibilityServiceInstance;
}

/**
 * Get the Model Compatibility Service instance
 */
export function getModelCompatibilityService(): ModelCompatibilityService | null {
  return modelCompatibilityServiceInstance;
}