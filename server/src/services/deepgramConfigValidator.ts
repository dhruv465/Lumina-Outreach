import { 
  ModelCompatibilityService, 
  getModelCompatibilityService,
  ModelValidationResult,
  AccountCapabilities,
  ModelPreferences
} from './modelCompatibilityService';
import { getErrorMessage } from '../utils/logger';
import logger from '../utils/logger';

/**
 * Configuration validation result interface
 */
export interface ConfigValidationResult {
  isValid: boolean;
  issues: ConfigValidationIssue[];
  suggestions: ConfigSuggestion[];
  accountInfo?: AccountCapabilities;
}

/**
 * Configuration validation issue
 */
export interface ConfigValidationIssue {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code: string;
}

/**
 * Configuration suggestion
 */
export interface ConfigSuggestion {
  field: string;
  currentValue: any;
  suggestedValue: any;
  reason: string;
  impact: 'performance' | 'compatibility' | 'cost' | 'features';
}

/**
 * Deepgram configuration interface for validation
 */
export interface DeepgramConfigForValidation {
  apiKey?: string;
  model?: string;
  language?: string;
  fallbackModels?: string[];
  accountTier?: 'free' | 'basic' | 'premium';
  availableModels?: string[];
  detectLanguage?: boolean;
  punctuate?: boolean;
  diarize?: boolean;
  profanityFilter?: boolean;
  redact?: boolean;
  keywords?: string[];
  endpointing?: number;
  utteranceEndMs?: number;
  autoFallback?: boolean;
  status?: 'unverified' | 'verified' | 'failed' | 'degraded';
  lastModelValidation?: Date;
  lastError?: string;
}

/**
 * Optimal configuration result
 */
export interface OptimalConfigResult {
  config: Partial<DeepgramConfigForValidation>;
  reasoning: string[];
  warnings: string[];
}

/**
 * Model testing result
 */
export interface ModelTestResult {
  model: string;
  isAccessible: boolean;
  responseTime?: number;
  error?: string;
  tier?: 'free' | 'basic' | 'premium';
  features?: string[];
}

/**
 * Deepgram Configuration Validator
 * Validates Deepgram configuration settings and provides optimization suggestions
 */
export class DeepgramConfigValidator {
  private modelCompatibilityService: ModelCompatibilityService | null;
  private validationCache: Map<string, { result: ConfigValidationResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.modelCompatibilityService = getModelCompatibilityService();
  }

  /**
   * Validate a complete Deepgram configuration
   */
  public async validateConfiguration(config: DeepgramConfigForValidation): Promise<ConfigValidationResult> {
    const cacheKey = this.generateCacheKey(config);
    
    // Check cache first
    const cached = this.validationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug('Using cached configuration validation result');
      return cached.result;
    }

    const issues: ConfigValidationIssue[] = [];
    const suggestions: ConfigSuggestion[] = [];
    let accountInfo: AccountCapabilities | undefined;

    try {
      // Validate API key
      if (!config.apiKey) {
        issues.push({
          field: 'apiKey',
          severity: 'error',
          message: 'Deepgram API key is required',
          code: 'MISSING_API_KEY'
        });
      } else {
        // Get account capabilities if we have a valid service
        if (this.modelCompatibilityService) {
          try {
            accountInfo = await this.modelCompatibilityService.getAccountCapabilities(config.apiKey);
            
            // Validate primary model
            if (config.model) {
              const modelValidation = await this.modelCompatibilityService.validateModelAccess(
                config.apiKey, 
                config.model
              );
              
              if (!modelValidation.isValid) {
                issues.push({
                  field: 'model',
                  severity: 'error',
                  message: `Primary model '${config.model}' is not accessible: ${modelValidation.error}`,
                  code: 'INVALID_PRIMARY_MODEL'
                });

                // Suggest alternatives
                if (modelValidation.suggestedAlternatives.length > 0) {
                  suggestions.push({
                    field: 'model',
                    currentValue: config.model,
                    suggestedValue: modelValidation.suggestedAlternatives[0],
                    reason: `Model '${config.model}' is not available. Suggested alternative: '${modelValidation.suggestedAlternatives[0]}'`,
                    impact: 'compatibility'
                  });
                }
              }
            }

            // Validate fallback models
            if (config.fallbackModels && config.fallbackModels.length > 0) {
              for (const fallbackModel of config.fallbackModels) {
                const fallbackValidation = await this.modelCompatibilityService.validateModelAccess(
                  config.apiKey,
                  fallbackModel
                );

                if (!fallbackValidation.isValid) {
                  issues.push({
                    field: 'fallbackModels',
                    severity: 'warning',
                    message: `Fallback model '${fallbackModel}' is not accessible: ${fallbackValidation.error}`,
                    code: 'INVALID_FALLBACK_MODEL'
                  });
                }
              }
            }

            // Check account tier compatibility
            if (config.accountTier && config.accountTier !== accountInfo.tier) {
              issues.push({
                field: 'accountTier',
                severity: 'warning',
                message: `Configured account tier '${config.accountTier}' does not match detected tier '${accountInfo.tier}'`,
                code: 'TIER_MISMATCH'
              });

              suggestions.push({
                field: 'accountTier',
                currentValue: config.accountTier,
                suggestedValue: accountInfo.tier,
                reason: 'Update account tier to match actual Deepgram account capabilities',
                impact: 'compatibility'
              });
            }
          } catch (error) {
            issues.push({
              field: 'apiKey',
              severity: 'error',
              message: `Failed to validate API key: ${getErrorMessage(error)}`,
              code: 'API_KEY_VALIDATION_FAILED'
            });
          }
        }
      }

      // Validate language setting
      if (config.language && !this.isValidLanguageCode(config.language)) {
        issues.push({
          field: 'language',
          severity: 'warning',
          message: `Language code '${config.language}' may not be supported by all models`,
          code: 'UNSUPPORTED_LANGUAGE'
        });
      }

      // Validate endpointing settings
      if (config.endpointing !== undefined) {
        if (config.endpointing < 10 || config.endpointing > 2000) {
          issues.push({
            field: 'endpointing',
            severity: 'warning',
            message: 'Endpointing value should be between 10ms and 2000ms for optimal performance',
            code: 'INVALID_ENDPOINTING'
          });
        }
      }

      // Validate utterance end settings
      if (config.utteranceEndMs !== undefined) {
        if (config.utteranceEndMs < 100 || config.utteranceEndMs > 5000) {
          issues.push({
            field: 'utteranceEndMs',
            severity: 'warning',
            message: 'Utterance end timeout should be between 100ms and 5000ms',
            code: 'INVALID_UTTERANCE_END'
          });
        }
      }

      // Generate optimization suggestions
      if (accountInfo) {
        const optimizationSuggestions = this.generateOptimizationSuggestions(config, accountInfo);
        suggestions.push(...optimizationSuggestions);
      }

      const result: ConfigValidationResult = {
        isValid: issues.filter(issue => issue.severity === 'error').length === 0,
        issues,
        suggestions,
        accountInfo
      };

      // Cache the result
      this.validationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      logger.info(`Configuration validation completed`, {
        isValid: result.isValid,
        issuesCount: issues.length,
        suggestionsCount: suggestions.length
      });

      return result;

    } catch (error) {
      logger.error(`Configuration validation error: ${getErrorMessage(error)}`);
      
      const errorResult: ConfigValidationResult = {
        isValid: false,
        issues: [{
          field: 'general',
          severity: 'error',
          message: `Validation failed: ${getErrorMessage(error)}`,
          code: 'VALIDATION_ERROR'
        }],
        suggestions: []
      };

      return errorResult;
    }
  }

  /**
   * Suggest optimal configuration based on account capabilities
   */
  public async suggestOptimalConfiguration(
    apiKey: string,
    preferences?: {
      useCase?: 'general' | 'meeting' | 'phone';
      language?: string;
      prioritizeAccuracy?: boolean;
      prioritizeSpeed?: boolean;
      prioritizeCost?: boolean;
    }
  ): Promise<OptimalConfigResult> {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    try {
      if (!this.modelCompatibilityService) {
        throw new Error('Model compatibility service not available');
      }

      // Get account capabilities
      const capabilities = await this.modelCompatibilityService.getAccountCapabilities(apiKey);
      reasoning.push(`Detected ${capabilities.tier} account tier with ${capabilities.availableModels.length} available models`);

      // Set up model preferences
      const modelPreferences: ModelPreferences = {
        preferredModels: [],
        useCase: preferences?.useCase || 'general',
        language: preferences?.language || 'en',
        realtime: true
      };

      // Determine preferred models based on priorities
      if (preferences?.prioritizeAccuracy) {
        modelPreferences.preferredModels = capabilities.availableModels.filter(model => 
          model.includes('nova-2') || model.includes('nova')
        );
        reasoning.push('Prioritizing accuracy: selected Nova models for best transcription quality');
      } else if (preferences?.prioritizeCost) {
        modelPreferences.preferredModels = capabilities.availableModels.filter(model => 
          model.includes('base')
        );
        reasoning.push('Prioritizing cost: selected Base models for economical transcription');
      } else if (preferences?.prioritizeSpeed) {
        modelPreferences.preferredModels = capabilities.availableModels.filter(model => 
          !model.includes('nova-2')
        );
        reasoning.push('Prioritizing speed: selected faster models for low-latency transcription');
      }

      // Select optimal model
      const optimalModel = this.modelCompatibilityService.selectBestModel(
        capabilities.availableModels,
        modelPreferences
      );

      // Set up fallback models
      const fallbackModels = capabilities.availableModels
        .filter(model => model !== optimalModel)
        .slice(0, 3); // Limit to 3 fallback models

      // Generate optimal configuration
      const config: Partial<DeepgramConfigForValidation> = {
        model: optimalModel,
        language: preferences?.language || 'en',
        fallbackModels,
        accountTier: capabilities.tier,
        availableModels: capabilities.availableModels,
        autoFallback: true,
        punctuate: true,
        detectLanguage: false,
        diarize: preferences?.useCase === 'meeting',
        profanityFilter: false,
        redact: false,
        endpointing: preferences?.useCase === 'phone' ? 300 : 150,
        utteranceEndMs: preferences?.useCase === 'meeting' ? 1000 : 500
      };

      reasoning.push(`Selected '${optimalModel}' as primary model`);
      reasoning.push(`Configured ${fallbackModels.length} fallback models: ${fallbackModels.join(', ')}`);

      // Add use case specific settings
      if (preferences?.useCase === 'meeting') {
        reasoning.push('Enabled diarization and longer utterance timeout for meeting use case');
      } else if (preferences?.useCase === 'phone') {
        reasoning.push('Configured shorter endpointing for phone call use case');
      }

      // Add warnings for limitations
      if (capabilities.tier === 'free') {
        warnings.push('Free tier has limited monthly hours and request rate limits');
        warnings.push('Consider upgrading for production use');
      }

      if (!capabilities.features.realtime && preferences?.useCase === 'phone') {
        warnings.push('Real-time transcription may not be available with current account tier');
      }

      return {
        config,
        reasoning,
        warnings
      };

    } catch (error) {
      logger.error(`Failed to generate optimal configuration: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Test model access for a specific model
   */
  public async testModelAccess(apiKey: string, model: string): Promise<ModelTestResult> {
    try {
      if (!this.modelCompatibilityService) {
        throw new Error('Model compatibility service not available');
      }

      const startTime = Date.now();
      const validation = await this.modelCompatibilityService.validateModelAccess(apiKey, model);
      const responseTime = Date.now() - startTime;

      const result: ModelTestResult = {
        model,
        isAccessible: validation.isValid,
        responseTime,
        tier: validation.tier,
        error: validation.error
      };

      // Get model features from registry
      const registry = this.modelCompatibilityService.getModelRegistry();
      const modelInfo = registry.models[model];
      if (modelInfo) {
        result.features = modelInfo.features;
      }

      logger.info(`Model access test completed for ${model}`, {
        isAccessible: result.isAccessible,
        responseTime: result.responseTime
      });

      return result;

    } catch (error) {
      logger.error(`Model access test failed for ${model}: ${getErrorMessage(error)}`);
      
      return {
        model,
        isAccessible: false,
        error: getErrorMessage(error)
      };
    }
  }

  /**
   * Batch test multiple models
   */
  public async batchTestModels(apiKey: string, models: string[]): Promise<Map<string, ModelTestResult>> {
    const results = new Map<string, ModelTestResult>();
    
    logger.info(`Starting batch model testing for ${models.length} models`);

    // Test models in parallel with concurrency limit
    const concurrencyLimit = 3;
    const chunks = this.chunkArray(models, concurrencyLimit);

    for (const chunk of chunks) {
      const promises = chunk.map(model => this.testModelAccess(apiKey, model));
      const chunkResults = await Promise.all(promises);
      
      chunkResults.forEach((result, index) => {
        results.set(chunk[index], result);
      });
    }

    logger.info(`Batch model testing completed: ${results.size} models tested`);
    return results;
  }

  /**
   * Clear validation cache
   */
  public clearCache(): void {
    this.validationCache.clear();
    logger.debug('Configuration validation cache cleared');
  }

  /**
   * Generate cache key for configuration
   */
  private generateCacheKey(config: DeepgramConfigForValidation): string {
    if (!config) {
      return 'null-config';
    }
    
    const keyData = {
      apiKey: config.apiKey?.slice(-8), // Only use last 8 chars for security
      model: config.model,
      language: config.language,
      fallbackModels: config.fallbackModels?.sort(),
      accountTier: config.accountTier
    };
    
    return Buffer.from(JSON.stringify(keyData)).toString('base64');
  }

  /**
   * Check if language code is valid
   */
  private isValidLanguageCode(language: string): boolean {
    const supportedLanguages = [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 
      'ja', 'ko', 'zh', 'hi', 'ar', 'sv', 'da', 'no', 'fi'
    ];
    
    return supportedLanguages.includes(language.toLowerCase());
  }

  /**
   * Generate optimization suggestions based on account capabilities
   */
  private generateOptimizationSuggestions(
    config: DeepgramConfigForValidation,
    capabilities: AccountCapabilities
  ): ConfigSuggestion[] {
    const suggestions: ConfigSuggestion[] = [];

    // Suggest enabling auto-fallback if not enabled
    if (!config.autoFallback) {
      suggestions.push({
        field: 'autoFallback',
        currentValue: false,
        suggestedValue: true,
        reason: 'Enable automatic model fallback for better reliability',
        impact: 'compatibility'
      });
    }

    // Suggest fallback models if none configured
    if (!config.fallbackModels || config.fallbackModels.length === 0) {
      const availableFallbacks = capabilities.availableModels.filter(model => model !== config.model);
      if (availableFallbacks.length > 0) {
        suggestions.push({
          field: 'fallbackModels',
          currentValue: [],
          suggestedValue: availableFallbacks.slice(0, 2),
          reason: 'Configure fallback models to ensure service continuity',
          impact: 'compatibility'
        });
      }
    }

    // Suggest tier-appropriate settings
    if (capabilities.tier === 'free') {
      if (config.diarize) {
        suggestions.push({
          field: 'diarize',
          currentValue: true,
          suggestedValue: false,
          reason: 'Diarization may not be available on free tier',
          impact: 'compatibility'
        });
      }
    }

    // Suggest performance optimizations
    if (config.endpointing && config.endpointing > 500) {
      suggestions.push({
        field: 'endpointing',
        currentValue: config.endpointing,
        suggestedValue: 300,
        reason: 'Lower endpointing value for better responsiveness',
        impact: 'performance'
      });
    }

    return suggestions;
  }

  /**
   * Utility function to chunk array for batch processing
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
let configValidatorInstance: DeepgramConfigValidator | null = null;

/**
 * Get the Deepgram Configuration Validator instance
 */
export function getDeepgramConfigValidator(): DeepgramConfigValidator {
  if (!configValidatorInstance) {
    configValidatorInstance = new DeepgramConfigValidator();
  }
  return configValidatorInstance;
}

/**
 * Initialize the Deepgram Configuration Validator
 */
export function initializeDeepgramConfigValidator(): DeepgramConfigValidator {
  return getDeepgramConfigValidator();
}