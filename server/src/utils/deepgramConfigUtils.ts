import { 
  DeepgramConfigValidator, 
  getDeepgramConfigValidator,
  DeepgramConfigForValidation,
  ConfigValidationResult,
  OptimalConfigResult,
  ModelTestResult
} from '../services/deepgramConfigValidator';
import Configuration from '../models/Configuration';
import { getErrorMessage } from './logger';
import logger from './logger';

/**
 * Configuration testing utilities for Deepgram
 */
export class DeepgramConfigUtils {
  private validator: DeepgramConfigValidator;

  constructor() {
    this.validator = getDeepgramConfigValidator();
  }

  /**
   * Validate current Deepgram configuration from database
   */
  public async validateCurrentConfiguration(): Promise<ConfigValidationResult> {
    try {
      const config = await Configuration.findOne();
      if (!config || !config.deepgramConfig) {
        return {
          isValid: false,
          issues: [{
            field: 'configuration',
            severity: 'error',
            message: 'No Deepgram configuration found',
            code: 'NO_CONFIG'
          }],
          suggestions: []
        };
      }

      const deepgramConfig = config.deepgramConfig as DeepgramConfigForValidation;
      return await this.validator.validateConfiguration(deepgramConfig);

    } catch (error) {
      logger.error(`Failed to validate current configuration: ${getErrorMessage(error)}`);
      return {
        isValid: false,
        issues: [{
          field: 'general',
          severity: 'error',
          message: `Configuration validation failed: ${getErrorMessage(error)}`,
          code: 'VALIDATION_ERROR'
        }],
        suggestions: []
      };
    }
  }

  /**
   * Test and update configuration with validation results
   */
  public async testAndUpdateConfiguration(apiKey: string): Promise<{
    validationResult: ConfigValidationResult;
    updated: boolean;
  }> {
    try {
      // Get current configuration
      let config = await Configuration.findOne();
      if (!config) {
        config = new Configuration();
      }

      // Initialize deepgramConfig if it doesn't exist
      if (!config.deepgramConfig) {
        config.deepgramConfig = {
          apiKey: '',
          isEnabled: true,
          primaryModel: 'nova-2',
          fallbackModels: ['nova', 'base'],
          autoFallback: true,
          tier: 'enhanced',
          retryAttempts: 3,
          timeoutMs: 10000
        };
      }

      // Update API key
      config.deepgramConfig.apiKey = apiKey;

      // Validate the configuration
      const validationResult = await this.validator.validateConfiguration(
        config.deepgramConfig as DeepgramConfigForValidation
      );

      // Update configuration with validation results
      let updated = false;
      if (validationResult.accountInfo) {
        config.deepgramConfig.accountTier = validationResult.accountInfo.tier;
        config.deepgramConfig.availableModels = validationResult.accountInfo.availableModels;
        config.deepgramConfig.lastModelValidation = new Date();
        
        if (validationResult.isValid) {
          config.deepgramConfig.status = 'verified';
          config.deepgramConfig.lastError = undefined;
        } else {
          config.deepgramConfig.status = 'failed';
          config.deepgramConfig.lastError = validationResult.issues
            .filter(issue => issue.severity === 'error')
            .map(issue => issue.message)
            .join('; ');
        }

        await config.save();
        updated = true;
        
        logger.info('Configuration updated with validation results', {
          isValid: validationResult.isValid,
          accountTier: validationResult.accountInfo.tier,
          availableModels: validationResult.accountInfo.availableModels.length
        });
      }

      return { validationResult, updated };

    } catch (error) {
      logger.error(`Failed to test and update configuration: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Auto-configure Deepgram settings based on account capabilities
   */
  public async autoConfigureDeepgram(
    apiKey: string,
    preferences?: {
      useCase?: 'general' | 'meeting' | 'phone';
      language?: string;
      prioritizeAccuracy?: boolean;
      prioritizeSpeed?: boolean;
      prioritizeCost?: boolean;
    }
  ): Promise<{
    optimalConfig: OptimalConfigResult;
    applied: boolean;
  }> {
    try {
      // Generate optimal configuration
      const optimalConfig = await this.validator.suggestOptimalConfiguration(apiKey, preferences);

      // Get or create configuration document
      let config = await Configuration.findOne();
      if (!config) {
        config = new Configuration();
      }

      // Apply optimal configuration
      config.deepgramConfig = {
        ...config.deepgramConfig,
        ...optimalConfig.config,
        apiKey, // Ensure API key is set
        status: 'verified',
        lastModelValidation: new Date()
      };

      await config.save();

      logger.info('Auto-configuration applied successfully', {
        model: optimalConfig.config.model,
        accountTier: optimalConfig.config.accountTier,
        fallbackModels: optimalConfig.config.fallbackModels?.length || 0
      });

      return { optimalConfig, applied: true };

    } catch (error) {
      logger.error(`Auto-configuration failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Test specific model access
   */
  public async testModelAccess(apiKey: string, model: string): Promise<ModelTestResult> {
    return await this.validator.testModelAccess(apiKey, model);
  }

  /**
   * Test multiple models and return compatibility report
   */
  public async generateCompatibilityReport(apiKey: string, models?: string[]): Promise<{
    accountTier: string;
    totalModels: number;
    accessibleModels: ModelTestResult[];
    inaccessibleModels: ModelTestResult[];
    recommendations: string[];
  }> {
    try {
      // Use default model list if none provided
      const modelsToTest = models || [
        'nova-2', 'nova-2-general', 'nova-2-meeting', 'nova-2-phonecall',
        'nova', 'nova-general',
        'base', 'base-general'
      ];

      // Test all models
      const testResults = await this.validator.batchTestModels(apiKey, modelsToTest);
      
      // Separate accessible and inaccessible models
      const accessibleModels: ModelTestResult[] = [];
      const inaccessibleModels: ModelTestResult[] = [];
      
      testResults.forEach(result => {
        if (result.isAccessible) {
          accessibleModels.push(result);
        } else {
          inaccessibleModels.push(result);
        }
      });

      // Determine account tier based on accessible models
      let accountTier = 'free';
      if (accessibleModels.some(model => model.tier === 'premium')) {
        accountTier = 'premium';
      } else if (accessibleModels.some(model => model.tier === 'basic')) {
        accountTier = 'basic';
      }

      // Generate recommendations
      const recommendations: string[] = [];
      
      if (accessibleModels.length === 0) {
        recommendations.push('No models are accessible. Please check your API key.');
      } else if (accountTier === 'free') {
        recommendations.push('Consider upgrading to a paid plan for access to more accurate models.');
        recommendations.push('Free tier has limited monthly usage hours.');
      } else if (accountTier === 'basic') {
        recommendations.push('Consider upgrading to premium for access to Nova-2 models with highest accuracy.');
      }

      if (accessibleModels.length > 0) {
        const fastestModel = accessibleModels.reduce((fastest, current) => 
          (current.responseTime || 0) < (fastest.responseTime || 0) ? current : fastest
        );
        recommendations.push(`Fastest responding model: ${fastestModel.model} (${fastestModel.responseTime}ms)`);
      }

      logger.info('Compatibility report generated', {
        accountTier,
        accessibleModels: accessibleModels.length,
        inaccessibleModels: inaccessibleModels.length
      });

      return {
        accountTier,
        totalModels: modelsToTest.length,
        accessibleModels,
        inaccessibleModels,
        recommendations
      };

    } catch (error) {
      logger.error(`Failed to generate compatibility report: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Validate configuration before saving
   */
  public async validateBeforeSave(configData: any): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    suggestions: string[];
  }> {
    try {
      const validationResult = await this.validator.validateConfiguration(configData);
      
      const errors = validationResult.issues
        .filter(issue => issue.severity === 'error')
        .map(issue => issue.message);
        
      const warnings = validationResult.issues
        .filter(issue => issue.severity === 'warning')
        .map(issue => issue.message);
        
      const suggestions = validationResult.suggestions
        .map(suggestion => `${suggestion.field}: ${suggestion.reason}`);

      return {
        isValid: validationResult.isValid,
        errors,
        warnings,
        suggestions
      };

    } catch (error) {
      logger.error(`Validation before save failed: ${getErrorMessage(error)}`);
      return {
        isValid: false,
        errors: [`Validation failed: ${getErrorMessage(error)}`],
        warnings: [],
        suggestions: []
      };
    }
  }

  /**
   * Get configuration health status
   */
  public async getConfigurationHealth(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    lastValidated?: Date;
    issues: string[];
    suggestions: string[];
  }> {
    try {
      const validationResult = await this.validateCurrentConfiguration();
      
      let status: 'healthy' | 'warning' | 'error' = 'healthy';
      const issues: string[] = [];
      const suggestions: string[] = [];

      // Check for errors
      const errors = validationResult.issues.filter(issue => issue.severity === 'error');
      if (errors.length > 0) {
        status = 'error';
        issues.push(...errors.map(error => error.message));
      }

      // Check for warnings
      const warnings = validationResult.issues.filter(issue => issue.severity === 'warning');
      if (warnings.length > 0 && status === 'healthy') {
        status = 'warning';
      }
      issues.push(...warnings.map(warning => warning.message));

      // Add suggestions
      suggestions.push(...validationResult.suggestions.map(suggestion => suggestion.reason));

      // Get last validation date
      const config = await Configuration.findOne();
      const lastValidated = config?.deepgramConfig?.lastModelValidation;

      return {
        status,
        lastValidated,
        issues,
        suggestions
      };

    } catch (error) {
      logger.error(`Failed to get configuration health: ${getErrorMessage(error)}`);
      return {
        status: 'error',
        issues: [`Health check failed: ${getErrorMessage(error)}`],
        suggestions: []
      };
    }
  }
}

// Singleton instance
let configUtilsInstance: DeepgramConfigUtils | null = null;

/**
 * Get the Deepgram Configuration Utils instance
 */
export function getDeepgramConfigUtils(): DeepgramConfigUtils {
  if (!configUtilsInstance) {
    configUtilsInstance = new DeepgramConfigUtils();
  }
  return configUtilsInstance;
}

/**
 * Initialize the Deepgram Configuration Utils
 */
export function initializeDeepgramConfigUtils(): DeepgramConfigUtils {
  return getDeepgramConfigUtils();
}