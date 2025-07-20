import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import Configuration from '../models/Configuration';
import { 
  ModelCompatibilityService, 
  getModelCompatibilityService,
  initializeModelCompatibilityService,
  ModelPreferences,
  AccountCapabilities
} from './modelCompatibilityService';
import { getDeepgramService } from './deepgramService';

/**
 * Auto-configuration result interface
 */
export interface AutoConfigResult {
  success: boolean;
  model: string;
  previousModel?: string;
  accountTier: 'free' | 'basic' | 'premium';
  availableModels: string[];
  fallbackModels: string[];
  error?: string;
  warnings: string[];
}

/**
 * Background validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  model: string;
  timestamp: Date;
  error?: string;
  suggestedAction?: string;
}

/**
 * Deepgram Auto-Configuration Service
 * Handles automatic model detection, configuration, and background validation
 */
export class DeepgramAutoConfigService {
  private modelCompatibilityService: ModelCompatibilityService | null = null;
  private validationInterval: NodeJS.Timeout | null = null;
  private readonly VALIDATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly STARTUP_VALIDATION_TIMEOUT = 10000; // 10 seconds
  private isValidationRunning = false;

  constructor() {
    logger.info('DeepgramAutoConfigService initialized');
  }

  /**
   * Initialize the service with API key
   */
  public async initialize(apiKey: string): Promise<void> {
    if (!apiKey) {
      logger.warn('DeepgramAutoConfigService: No API key provided, skipping initialization');
      return;
    }

    try {
      this.modelCompatibilityService = initializeModelCompatibilityService(apiKey);
      logger.info('DeepgramAutoConfigService: Model compatibility service initialized');
    } catch (error) {
      logger.error(`DeepgramAutoConfigService initialization failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Automatically detect and configure optimal model
   */
  public async autoConfigureOptimalModel(): Promise<AutoConfigResult> {
    logger.info('Starting automatic model configuration...');

    try {
      // Get current configuration
      const config = await Configuration.findOne();
      if (!config || !config.deepgramConfig?.apiKey) {
        throw new Error('No Deepgram configuration found or API key missing');
      }

      const deepgramConfig = config.deepgramConfig;
      const currentModel = deepgramConfig.primaryModel || 'nova-2';

      // Initialize model compatibility service if not already done
      if (!this.modelCompatibilityService) {
        await this.initialize(deepgramConfig.apiKey);
      }

      if (!this.modelCompatibilityService) {
        throw new Error('Failed to initialize model compatibility service');
      }

      // Get account capabilities
      logger.info('Detecting account capabilities...');
      const capabilities = await this.modelCompatibilityService.getAccountCapabilities(deepgramConfig.apiKey);
      
      if (capabilities.availableModels.length === 0) {
        throw new Error('No compatible models found for this account');
      }

      // Define model preferences based on use case
      const preferences: ModelPreferences = {
        preferredModels: [currentModel, 'nova-2', 'nova', 'base'],
        useCase: 'phone', // Voice calls are primarily phone-based
        language: 'en',
        realtime: true
      };

      // Select optimal model
      const optimalModel = this.modelCompatibilityService.selectBestModel(
        capabilities.availableModels,
        preferences
      );

      // Prepare fallback models (exclude the optimal model)
      const fallbackModels = capabilities.availableModels.filter(model => model !== optimalModel);

      // Update configuration
      const updateData = {
        'deepgramConfig.primaryModel': optimalModel,
        'deepgramConfig.fallbackModels': fallbackModels,
        'deepgramConfig.accountTier': capabilities.tier,
        'deepgramConfig.availableModels': capabilities.availableModels,
        'deepgramConfig.lastModelValidation': new Date(),
        'deepgramConfig.status': 'verified' as const,
        'deepgramConfig.lastError': undefined
      };

      await Configuration.updateOne({}, { $set: updateData });

      // Update Deepgram service if it exists
      const deepgramService = getDeepgramService();
      if (deepgramService) {
        await deepgramService.validateAndSetModel(optimalModel);
        logger.info(`Updated DeepgramService to use model: ${optimalModel}`);
      }

      const warnings: string[] = [];
      
      // Add warnings for account limitations
      if (capabilities.tier === 'free') {
        warnings.push('Free account detected - limited to basic models and features');
      }
      
      if (currentModel !== optimalModel) {
        warnings.push(`Model changed from ${currentModel} to ${optimalModel} for better compatibility`);
      }

      const result: AutoConfigResult = {
        success: true,
        model: optimalModel,
        previousModel: currentModel !== optimalModel ? currentModel : undefined,
        accountTier: capabilities.tier,
        availableModels: capabilities.availableModels,
        fallbackModels,
        warnings
      };

      logger.info('Automatic model configuration completed successfully', {
        optimalModel,
        accountTier: capabilities.tier,
        availableModels: capabilities.availableModels.length,
        fallbackModels: fallbackModels.length
      });

      return result;

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Automatic model configuration failed: ${errorMessage}`);

      return {
        success: false,
        model: 'base', // Fallback to most compatible model
        accountTier: 'free',
        availableModels: [],
        fallbackModels: [],
        error: errorMessage,
        warnings: ['Auto-configuration failed, using fallback settings']
      };
    }
  }

  /**
   * Validate configured model at startup
   */
  public async validateStartupConfiguration(): Promise<ValidationResult> {
    logger.info('Validating Deepgram configuration at startup...');

    try {
      // Set timeout for startup validation
      const validationPromise = this.performConfigurationValidation();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Startup validation timeout')), this.STARTUP_VALIDATION_TIMEOUT);
      });

      const result = await Promise.race([validationPromise, timeoutPromise]);
      
      if (result.isValid) {
        logger.info('Startup configuration validation passed');
      } else {
        logger.warn(`Startup configuration validation failed: ${result.error}`);
      }

      return result;

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Startup validation failed: ${errorMessage}`);

      return {
        isValid: false,
        model: 'unknown',
        timestamp: new Date(),
        error: errorMessage,
        suggestedAction: 'Run auto-configuration to fix model settings'
      };
    }
  }

  /**
   * Perform the actual configuration validation
   */
  private async performConfigurationValidation(): Promise<ValidationResult> {
    const config = await Configuration.findOne();
    
    if (!config || !config.deepgramConfig?.apiKey) {
      return {
        isValid: false,
        model: 'none',
        timestamp: new Date(),
        error: 'No Deepgram configuration found',
        suggestedAction: 'Configure Deepgram API key and run auto-configuration'
      };
    }

    const deepgramConfig = config.deepgramConfig;
    const modelToValidate = deepgramConfig.primaryModel || 'nova-2';

    // Initialize model compatibility service if needed
    if (!this.modelCompatibilityService) {
      await this.initialize(deepgramConfig.apiKey);
    }

    if (!this.modelCompatibilityService) {
      return {
        isValid: false,
        model: modelToValidate,
        timestamp: new Date(),
        error: 'Failed to initialize model compatibility service',
        suggestedAction: 'Check API key and network connectivity'
      };
    }

    // Validate the configured model
    const validation = await this.modelCompatibilityService.validateModelAccess(
      deepgramConfig.apiKey,
      modelToValidate
    );

    if (validation.isValid) {
      // Update last validation timestamp
      await Configuration.updateOne(
        {},
        { 
          $set: { 
            'deepgramConfig.lastModelValidation': new Date(),
            'deepgramConfig.status': 'verified',
            'deepgramConfig.lastError': undefined
          }
        }
      );

      return {
        isValid: true,
        model: modelToValidate,
        timestamp: new Date()
      };
    } else {
      // Update configuration with error
      await Configuration.updateOne(
        {},
        { 
          $set: { 
            'deepgramConfig.lastModelValidation': new Date(),
            'deepgramConfig.status': 'failed',
            'deepgramConfig.lastError': validation.error
          }
        }
      );

      return {
        isValid: false,
        model: modelToValidate,
        timestamp: new Date(),
        error: validation.error,
        suggestedAction: validation.suggestedAlternatives.length > 0 
          ? `Try alternative models: ${validation.suggestedAlternatives.join(', ')}`
          : 'Run auto-configuration to find compatible models'
      };
    }
  }

  /**
   * Start background model validation with periodic checks
   */
  public startBackgroundValidation(): void {
    if (this.validationInterval) {
      logger.warn('Background validation is already running');
      return;
    }

    logger.info(`Starting background model validation (interval: ${this.VALIDATION_INTERVAL_MS / 1000 / 60} minutes)`);

    this.validationInterval = setInterval(async () => {
      if (this.isValidationRunning) {
        logger.debug('Background validation already in progress, skipping this cycle');
        return;
      }

      this.isValidationRunning = true;
      
      try {
        await this.performBackgroundValidation();
      } catch (error) {
        logger.error(`Background validation error: ${getErrorMessage(error)}`);
      } finally {
        this.isValidationRunning = false;
      }
    }, this.VALIDATION_INTERVAL_MS);

    logger.info('Background model validation started');
  }

  /**
   * Stop background model validation
   */
  public stopBackgroundValidation(): void {
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
      this.validationInterval = null;
      logger.info('Background model validation stopped');
    }
  }

  /**
   * Perform background validation check
   */
  private async performBackgroundValidation(): Promise<void> {
    logger.debug('Performing background model validation...');

    try {
      const result = await this.performConfigurationValidation();
      
      if (!result.isValid) {
        logger.warn(`Background validation failed for model ${result.model}: ${result.error}`);
        
        // Attempt auto-recovery if validation fails
        logger.info('Attempting automatic recovery...');
        const autoConfigResult = await this.autoConfigureOptimalModel();
        
        if (autoConfigResult.success) {
          logger.info(`Auto-recovery successful: switched to model ${autoConfigResult.model}`);
        } else {
          logger.error(`Auto-recovery failed: ${autoConfigResult.error}`);
        }
      } else {
        logger.debug(`Background validation passed for model ${result.model}`);
      }

    } catch (error) {
      logger.error(`Background validation error: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get current validation status
   */
  public async getValidationStatus(): Promise<{
    isRunning: boolean;
    lastValidation?: Date;
    currentModel?: string;
    status?: string;
    error?: string;
  }> {
    const config = await Configuration.findOne();
    const deepgramConfig = config?.deepgramConfig;

    return {
      isRunning: this.validationInterval !== null,
      lastValidation: deepgramConfig?.lastModelValidation || undefined,
      currentModel: deepgramConfig?.primaryModel || undefined,
      status: deepgramConfig?.status || 'unverified',
      error: deepgramConfig?.lastError || undefined
    };
  }

  /**
   * Force immediate validation
   */
  public async forceValidation(): Promise<ValidationResult> {
    logger.info('Forcing immediate model validation...');
    return await this.performConfigurationValidation();
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.stopBackgroundValidation();
    this.modelCompatibilityService = null;
    logger.info('DeepgramAutoConfigService cleanup completed');
  }
}

// Singleton instance
let autoConfigServiceInstance: DeepgramAutoConfigService | null = null;

/**
 * Get the auto-configuration service instance
 */
export function getDeepgramAutoConfigService(): DeepgramAutoConfigService {
  if (!autoConfigServiceInstance) {
    autoConfigServiceInstance = new DeepgramAutoConfigService();
  }
  return autoConfigServiceInstance;
}

/**
 * Initialize auto-configuration service with API key
 */
export async function initializeDeepgramAutoConfig(apiKey: string): Promise<DeepgramAutoConfigService> {
  const service = getDeepgramAutoConfigService();
  await service.initialize(apiKey);
  return service;
}