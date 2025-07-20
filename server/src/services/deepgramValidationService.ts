import { 
  ModelCompatibilityService, 
  initializeModelCompatibilityService,
  getModelCompatibilityService,
  ModelValidationResult,
  AccountCapabilities,
  ModelPreferences
} from './modelCompatibilityService';
import { getDeepgramConfigValidator } from './deepgramConfigValidator';
import { 
  EnhancedDeepgramConfig,
  ValidationResult,
  DeepgramAccountTier,
  ModelCompatibilityStatus
} from '../types/deepgram';
import Configuration from '../models/Configuration';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

/**
 * Cached validation result interface
 */
interface CachedValidationResult {
  result: ModelValidationResult;
  timestamp: number;
  accountCapabilities?: AccountCapabilities;
}

/**
 * Account tier detection result
 */
interface AccountTierDetectionResult {
  tier: DeepgramAccountTier;
  availableModels: string[];
  capabilities: AccountCapabilities;
  detectedAt: Date;
}

/**
 * Comprehensive Deepgram Validation Service
 * Integrates model compatibility checking, account tier detection, and caching
 */
export class DeepgramValidationService {
  private modelCompatibilityService: ModelCompatibilityService | null = null;
  private validationCache: Map<string, CachedValidationResult> = new Map();
  private accountTierCache: Map<string, AccountTierDetectionResult> = new Map();
  private readonly VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly ACCOUNT_TIER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Initialize cleanup intervals
    this.startCacheCleanup();
  }

  /**
   * Initialize the validation service with API key
   */
  public async initialize(apiKey: string): Promise<void> {
    try {
      this.modelCompatibilityService = initializeModelCompatibilityService(apiKey);
      logger.info('DeepgramValidationService initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize DeepgramValidationService: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Test model access against Deepgram API with caching
   */
  public async validateModelAccess(apiKey: string, model: string): Promise<ModelValidationResult> {
    const cacheKey = `${apiKey.slice(-8)}-${model}`;
    
    // Check cache first
    const cached = this.validationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.VALIDATION_CACHE_TTL) {
      logger.debug(`Using cached validation result for model ${model}`);
      return cached.result;
    }

    try {
      // Ensure service is initialized
      if (!this.modelCompatibilityService) {
        await this.initialize(apiKey);
      }

      // Validate model access
      const result = await this.modelCompatibilityService!.validateModelAccess(apiKey, model);
      
      // Cache the result
      this.validationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      // Update configuration with validation result
      await this.updateConfigurationValidationStatus(model, result);

      logger.info(`Model ${model} validation completed: ${result.isValid ? 'valid' : 'invalid'}`);
      return result;

    } catch (error) {
      logger.error(`Model validation failed for ${model}: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Detect account tier based on available models with caching
   */
  public async detectAccountTier(apiKey: string): Promise<AccountTierDetectionResult> {
    const cacheKey = apiKey.slice(-8);
    
    // Check cache first
    const cached = this.accountTierCache.get(cacheKey);
    if (cached && (Date.now() - cached.detectedAt.getTime()) < this.ACCOUNT_TIER_CACHE_TTL) {
      logger.debug('Using cached account tier detection result');
      return cached;
    }

    try {
      // Ensure service is initialized
      if (!this.modelCompatibilityService) {
        await this.initialize(apiKey);
      }

      // Get account capabilities
      const capabilities = await this.modelCompatibilityService!.getAccountCapabilities(apiKey);
      
      const result: AccountTierDetectionResult = {
        tier: capabilities.tier,
        availableModels: capabilities.availableModels,
        capabilities,
        detectedAt: new Date()
      };

      // Cache the result
      this.accountTierCache.set(cacheKey, result);

      // Update configuration with detected tier
      await this.updateConfigurationAccountTier(result);

      logger.info(`Account tier detected: ${result.tier} with ${result.availableModels.length} available models`);
      return result;

    } catch (error) {
      logger.error(`Account tier detection failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Validate complete Deepgram configuration
   */
  public async validateConfiguration(config: EnhancedDeepgramConfig): Promise<ValidationResult> {
    try {
      // First, validate the configuration structure
      const configValidator = getDeepgramConfigValidator();
      const structuralValidation = await configValidator.validateConfiguration(config);
      
      if (!structuralValidation.isValid) {
        return {
          isValid: structuralValidation.isValid,
          issues: structuralValidation.issues
            .filter(issue => issue.severity !== 'info')
            .map(issue => ({
              type: issue.severity as 'error' | 'warning',
              field: issue.field,
              message: issue.message,
              suggestedFix: `Code: ${issue.code}`
            })),
          recommendations: structuralValidation.suggestions.map(suggestion => ({
            field: suggestion.field,
            currentValue: suggestion.currentValue,
            recommendedValue: suggestion.suggestedValue,
            reason: suggestion.reason,
            impact: suggestion.impact
          }))
        };
      }

      // If API key is provided, test actual model access
      if (config.apiKey && config.apiKey.trim() !== '') {
        // Test primary model
        const primaryModelValidation = await this.validateModelAccess(config.apiKey, config.primaryModel);
        
        if (!primaryModelValidation.isValid) {
          structuralValidation.issues.push({
            field: 'primaryModel',
            severity: 'error',
            message: `Primary model ${config.primaryModel} is not accessible: ${primaryModelValidation.error}`,
            code: 'PRIMARY_MODEL_INACCESSIBLE'
          });
        }

        // Test fallback models
        for (const fallbackModel of config.fallbackModels) {
          const fallbackValidation = await this.validateModelAccess(config.apiKey, fallbackModel);
          
          if (!fallbackValidation.isValid) {
            structuralValidation.issues.push({
              field: 'fallbackModels',
              severity: 'warning',
              message: `Fallback model ${fallbackModel} is not accessible: ${fallbackValidation.error}`,
              code: 'FALLBACK_MODEL_INACCESSIBLE'
            });
          }
        }

        // Detect and validate account tier
        const accountTierResult = await this.detectAccountTier(config.apiKey);
        
        if (config.accountTier && config.accountTier !== accountTierResult.tier) {
          structuralValidation.issues.push({
            field: 'accountTier',
            severity: 'warning',
            message: `Configured tier (${config.accountTier}) doesn't match detected tier (${accountTierResult.tier})`,
            code: 'ACCOUNT_TIER_MISMATCH'
          });
        }
      }

      // Recalculate validity based on all issues
      const hasErrors = structuralValidation.issues.some(issue => issue.severity === 'error');
      structuralValidation.isValid = !hasErrors;

      return {
        isValid: structuralValidation.isValid,
        issues: structuralValidation.issues
          .filter(issue => issue.severity !== 'info')
          .map(issue => ({
            type: issue.severity as 'error' | 'warning',
            field: issue.field,
            message: issue.message,
            suggestedFix: `Code: ${issue.code}`
          })),
        recommendations: structuralValidation.suggestions.map(suggestion => ({
          field: suggestion.field,
          currentValue: suggestion.currentValue,
          recommendedValue: suggestion.suggestedValue,
          reason: suggestion.reason,
          impact: suggestion.impact
        }))
      };

    } catch (error) {
      logger.error(`Configuration validation failed: ${getErrorMessage(error)}`);
      return {
        isValid: false,
        issues: [{
          type: 'error',
          field: 'general',
          message: `Validation failed: ${getErrorMessage(error)}`,
          suggestedFix: 'Check API key and network connectivity'
        }],
        recommendations: []
      };
    }
  }

  /**
   * Get optimal model selection based on preferences and account capabilities
   */
  public async getOptimalModel(apiKey: string, preferences: ModelPreferences): Promise<string> {
    try {
      // Ensure service is initialized
      if (!this.modelCompatibilityService) {
        await this.initialize(apiKey);
      }

      // Get available models for the account
      const compatibleModels = await this.modelCompatibilityService!.getCompatibleModels(apiKey);
      
      if (compatibleModels.length === 0) {
        logger.warn('No compatible models found, using base as fallback');
        return 'base';
      }

      // Select best model based on preferences
      const selectedModel = this.modelCompatibilityService!.selectBestModel(compatibleModels, preferences);
      
      logger.info(`Selected optimal model: ${selectedModel} from ${compatibleModels.length} available models`);
      return selectedModel;

    } catch (error) {
      logger.error(`Optimal model selection failed: ${getErrorMessage(error)}`);
      return 'base'; // Ultimate fallback
    }
  }

  /**
   * Batch validate multiple models
   */
  public async batchValidateModels(apiKey: string, models: string[]): Promise<Map<string, ModelValidationResult>> {
    const results = new Map<string, ModelValidationResult>();
    
    // Process models in parallel with concurrency limit
    const concurrencyLimit = 3;
    const chunks = this.chunkArray(models, concurrencyLimit);
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (model) => {
        try {
          const result = await this.validateModelAccess(apiKey, model);
          return { model, result };
        } catch (error) {
          logger.error(`Batch validation failed for model ${model}: ${getErrorMessage(error)}`);
          return {
            model,
            result: {
              isValid: false,
              model,
              tier: 'free' as DeepgramAccountTier,
              error: getErrorMessage(error),
              suggestedAlternatives: []
            }
          };
        }
      });
      
      const chunkResults = await Promise.all(promises);
      chunkResults.forEach(({ model, result }) => {
        results.set(model, result);
      });
    }
    
    logger.info(`Batch validated ${models.length} models`);
    return results;
  }

  /**
   * Update configuration with validation status
   */
  private async updateConfigurationValidationStatus(model: string, result: ModelValidationResult): Promise<void> {
    try {
      const config = await Configuration.findOne();
      if (!config) return;

      // Initialize modelCompatibilityStatus if it doesn't exist
      if (!config.deepgramConfig.modelCompatibilityStatus) {
        config.deepgramConfig.modelCompatibilityStatus = {};
      }

      // Update model compatibility status
      const compatibilityStatus: ModelCompatibilityStatus = {
        isCompatible: result.isValid,
        lastTested: new Date(),
        error: result.error
      };

      // Update the status for this model
      config.deepgramConfig.modelCompatibilityStatus[model] = compatibilityStatus;
      config.deepgramConfig.lastModelValidation = new Date();

      await config.save();
      logger.debug(`Updated configuration validation status for model ${model}`);

    } catch (error) {
      logger.error(`Failed to update configuration validation status: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Update configuration with detected account tier
   */
  private async updateConfigurationAccountTier(tierResult: AccountTierDetectionResult): Promise<void> {
    try {
      const config = await Configuration.findOne();
      if (!config) return;

      config.deepgramConfig.accountTier = tierResult.tier;
      config.deepgramConfig.availableModels = tierResult.availableModels;
      config.deepgramConfig.lastModelValidation = tierResult.detectedAt;

      await config.save();
      logger.debug(`Updated configuration with account tier: ${tierResult.tier}`);

    } catch (error) {
      logger.error(`Failed to update configuration account tier: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Clear all caches
   */
  public clearCache(): void {
    this.validationCache.clear();
    this.accountTierCache.clear();
    
    if (this.modelCompatibilityService) {
      this.modelCompatibilityService.clearCache();
    }
    
    logger.info('DeepgramValidationService cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { validationCache: number; accountTierCache: number } {
    return {
      validationCache: this.validationCache.size,
      accountTierCache: this.accountTierCache.size
    };
  }

  /**
   * Start periodic cache cleanup
   */
  private startCacheCleanup(): void {
    // Clean up validation cache every 10 minutes
    setInterval(() => {
      const now = Date.now();
      
      // Clean validation cache
      for (const [key, value] of this.validationCache.entries()) {
        if (now - value.timestamp > this.VALIDATION_CACHE_TTL) {
          this.validationCache.delete(key);
        }
      }
      
      // Clean account tier cache
      for (const [key, value] of this.accountTierCache.entries()) {
        if (now - value.detectedAt.getTime() > this.ACCOUNT_TIER_CACHE_TTL) {
          this.accountTierCache.delete(key);
        }
      }
      
      logger.debug('DeepgramValidationService cache cleanup completed');
    }, 10 * 60 * 1000); // 10 minutes
  }

  /**
   * Utility method to chunk array for batch processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// Singleton instance
let deepgramValidationServiceInstance: DeepgramValidationService | null = null;

/**
 * Initialize the Deepgram Validation Service
 */
export function initializeDeepgramValidationService(): DeepgramValidationService {
  if (!deepgramValidationServiceInstance) {
    deepgramValidationServiceInstance = new DeepgramValidationService();
  }
  return deepgramValidationServiceInstance;
}

/**
 * Get the Deepgram Validation Service instance
 */
export function getDeepgramValidationService(): DeepgramValidationService | null {
  return deepgramValidationServiceInstance;
}