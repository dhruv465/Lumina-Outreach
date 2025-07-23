import mongoose from 'mongoose';
import Configuration from '../models/Configuration';
import { ModelCompatibilityService, AccountCapabilities } from '../services/modelCompatibilityService';
import logger from '../utils/logger';

/**
 * Enhanced migration script for Deepgram model compatibility
 * Handles database migration, model testing, and configuration updates
 */
export class DeepgramModelCompatibilityMigration {
  private modelCompatibilityService: ModelCompatibilityService | null = null;

  /**
   * Run the complete migration process
   */
  static async runMigration(): Promise<void> {
    const migration = new DeepgramModelCompatibilityMigration();
    
    try {
      logger.info('Starting Deepgram model compatibility migration...');
      
      // Step 1: Migrate database schema
      await migration.migrateConfigurationSchema();
      
      // Step 2: Test and update model settings for existing users
      await migration.testAndUpdateModelSettings();
      
      // Step 3: Validate migration results
      const isValid = await migration.validateMigration();
      
      if (!isValid) {
        throw new Error('Migration validation failed');
      }
      
      logger.info('Deepgram model compatibility migration completed successfully');
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate configuration schema to support new model compatibility features
   */
  private async migrateConfigurationSchema(): Promise<void> {
    try {
      logger.info('Migrating configuration schema...');
      
      // Find configurations that need schema migration
      const configurations = await Configuration.find({
        $or: [
          { 'deepgramConfig.primaryModel': { $exists: false } },
          { 'deepgramConfig.fallbackModels': { $exists: false } },
          { 'deepgramConfig.autoFallback': { $exists: false } },
          { 'deepgramConfig.retryAttempts': { $exists: false } },
          { 'deepgramConfig.timeoutMs': { $exists: false } }
        ]
      });

      logger.info(`Found ${configurations.length} configurations requiring schema migration`);

      for (const config of configurations) {
        await this.migrateConfigurationDocument(config);
      }

      logger.info('Configuration schema migration completed');
    } catch (error) {
      logger.error('Error during schema migration:', error);
      throw error;
    }
  }

  /**
   * Migrate a single configuration document
   */
  private async migrateConfigurationDocument(config: any): Promise<void> {
    try {
      const updates: any = {};
      
      // Migrate old 'model' field to 'primaryModel'
      const legacyModel = (config.deepgramConfig as any)?.model;
      if (legacyModel && !config.deepgramConfig?.primaryModel) {
        updates['deepgramConfig.primaryModel'] = legacyModel;
        logger.info(`Migrating model '${legacyModel}' to primaryModel for config ${config._id}`);
      } else if (!config.deepgramConfig?.primaryModel) {
        // Set default primary model if none exists
        updates['deepgramConfig.primaryModel'] = 'nova-2';
        logger.info(`Setting default primaryModel 'nova-2' for config ${config._id}`);
      }

      // Set default fallback models
      if (!config.deepgramConfig?.fallbackModels) {
        const primaryModel = legacyModel || config.deepgramConfig?.primaryModel || 'nova-2';
        updates['deepgramConfig.fallbackModels'] = this.getDefaultFallbackModels(primaryModel);
        logger.info(`Setting default fallback models for config ${config._id}`);
      }

      // Set default autoFallback
      if (config.deepgramConfig?.autoFallback === undefined) {
        updates['deepgramConfig.autoFallback'] = true;
      }

      // Set default retry attempts
      if (!config.deepgramConfig?.retryAttempts) {
        updates['deepgramConfig.retryAttempts'] = 3;
      }

      // Set default timeout
      if (!config.deepgramConfig?.timeoutMs) {
        updates['deepgramConfig.timeoutMs'] = 30000;
      }

      // Initialize model compatibility status
      if (!config.deepgramConfig?.modelCompatibilityStatus) {
        updates['deepgramConfig.modelCompatibilityStatus'] = new Map();
      }

      // Set first-time setup flags
      if (config.deepgramConfig?.firstTimeSetupCompleted === undefined) {
        updates['deepgramConfig.firstTimeSetupCompleted'] = false;
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await Configuration.updateOne(
          { _id: config._id },
          { $set: updates }
        );
        logger.info(`Successfully migrated configuration schema for ${config._id}`);
      }

    } catch (error) {
      logger.error(`Error migrating configuration ${config._id}:`, error);
      throw error;
    }
  }

  /**
   * Test and update model settings for existing users
   */
  private async testAndUpdateModelSettings(): Promise<void> {
    try {
      logger.info('Testing and updating model settings for existing users...');
      
      // Find all enabled Deepgram configurations
      const configurations = await Configuration.find({
        'deepgramConfig.isEnabled': true,
        'deepgramConfig.apiKey': { $ne: '', $exists: true }
      });

      logger.info(`Found ${configurations.length} enabled Deepgram configurations to test`);

      for (const config of configurations) {
        await this.testAndUpdateConfiguration(config);
      }

      logger.info('Model settings testing and update completed');
    } catch (error) {
      logger.error('Error during model settings update:', error);
      throw error;
    }
  }

  /**
   * Test and update a single configuration
   */
  private async testAndUpdateConfiguration(config: any): Promise<void> {
    try {
      const apiKey = config.deepgramConfig.apiKey;
      if (!apiKey) {
        logger.warn(`Skipping configuration ${config._id} - no API key`);
        return;
      }

      logger.info(`Testing model compatibility for configuration ${config._id}`);

      // Initialize model compatibility service
      this.modelCompatibilityService = new ModelCompatibilityService(apiKey);

      // Get account capabilities
      const capabilities = await this.modelCompatibilityService.getAccountCapabilities(apiKey);
      
      // Test current primary model
      const primaryModel = config.deepgramConfig.primaryModel || 'nova-2';
      const validation = await this.modelCompatibilityService.validateModelAccess(apiKey, primaryModel);

      const updates: any = {};

      // Update account information
      updates['deepgramConfig.accountTier'] = capabilities.tier;
      updates['deepgramConfig.availableModels'] = capabilities.availableModels;
      updates['deepgramConfig.lastModelValidation'] = new Date();

      // Update model compatibility status
      const compatibilityStatus = new Map();
      for (const model of capabilities.availableModels) {
        compatibilityStatus.set(model, {
          isCompatible: true,
          lastTested: new Date()
        });
      }
      
      // Add failed model if primary model is not compatible
      if (!validation.isValid) {
        compatibilityStatus.set(primaryModel, {
          isCompatible: false,
          lastTested: new Date(),
          error: validation.error
        });
      }

      updates['deepgramConfig.modelCompatibilityStatus'] = compatibilityStatus;

      // Update configuration status based on validation
      if (validation.isValid) {
        updates['deepgramConfig.status'] = 'verified';
        updates['deepgramConfig.lastVerified'] = new Date();
        updates['deepgramConfig.lastError'] = undefined;
        logger.info(`Configuration ${config._id} validated successfully with model ${primaryModel}`);
      } else {
        // Handle model fallback
        const fallbackModel = this.selectBestFallbackModel(capabilities.availableModels, config.deepgramConfig.fallbackModels);
        
        if (fallbackModel) {
          updates['deepgramConfig.primaryModel'] = fallbackModel;
          updates['deepgramConfig.status'] = 'degraded';
          updates['deepgramConfig.lastError'] = `Original model '${primaryModel}' not accessible, using fallback '${fallbackModel}'`;
          logger.warn(`Configuration ${config._id} using fallback model: ${primaryModel} → ${fallbackModel}`);
        } else {
          updates['deepgramConfig.status'] = 'failed';
          updates['deepgramConfig.lastError'] = `No compatible models found. Error: ${validation.error}`;
          logger.error(`Configuration ${config._id} has no compatible models available`);
        }
      }

      // Update optimized fallback models based on account capabilities
      updates['deepgramConfig.fallbackModels'] = this.optimizeFallbackModels(
        capabilities.availableModels,
        config.deepgramConfig.fallbackModels || []
      );

      // Apply updates
      await Configuration.updateOne(
        { _id: config._id },
        { $set: updates }
      );

      logger.info(`Successfully updated model settings for configuration ${config._id}`, {
        accountTier: capabilities.tier,
        availableModels: capabilities.availableModels.length,
        primaryModel: updates['deepgramConfig.primaryModel'] || primaryModel,
        status: updates['deepgramConfig.status']
      });

    } catch (error) {
      logger.error(`Error testing configuration ${config._id}:`, error);
      
      // Update configuration with error status
      await Configuration.updateOne(
        { _id: config._id },
        { 
          $set: {
            'deepgramConfig.status': 'failed',
            'deepgramConfig.lastError': `Migration test failed: ${error.message}`,
            'deepgramConfig.lastModelValidation': new Date()
          }
        }
      );
    }
  }

  /**
   * Select the best fallback model from available models
   */
  private selectBestFallbackModel(availableModels: string[], configuredFallbacks: string[]): string | null {
    // Handle undefined/null inputs
    if (!availableModels || availableModels.length === 0) {
      return null;
    }
    
    const fallbacks = configuredFallbacks || [];
    
    // First try configured fallback models in order
    for (const fallback of fallbacks) {
      if (availableModels.includes(fallback)) {
        return fallback;
      }
    }

    // If no configured fallbacks work, use the best available model
    const modelPriority = [
      'nova-2', 'nova-2-general', 'nova-2-meeting', 'nova-2-phonecall',
      'nova', 'nova-general',
      'base', 'base-general'
    ];

    for (const model of modelPriority) {
      if (availableModels.includes(model)) {
        return model;
      }
    }

    return availableModels.length > 0 ? availableModels[0] : null;
  }

  /**
   * Optimize fallback models based on account capabilities
   */
  private optimizeFallbackModels(availableModels: string[], currentFallbacks: string[]): string[] {
    // Handle undefined/null inputs
    if (!availableModels || availableModels.length === 0) {
      return [];
    }
    
    const fallbacks = currentFallbacks || [];
    
    // Filter current fallbacks to only include available models and remove duplicates
    const validFallbacks = [...new Set(fallbacks.filter(model => availableModels.includes(model)))];
    
    // Add additional fallbacks from available models if needed
    const modelPriority = ['nova', 'base', 'base-general'];
    
    for (const model of modelPriority) {
      if (availableModels.includes(model) && !validFallbacks.includes(model)) {
        validFallbacks.push(model);
      }
    }

    return validFallbacks;
  }

  /**
   * Get default fallback models based on primary model
   */
  private getDefaultFallbackModels(primaryModel: string | undefined): string[] {
    // Handle undefined/null inputs
    if (!primaryModel) {
      return ['nova', 'base'];
    }
    const modelHierarchy: { [key: string]: string[] } = {
      // Premium models fallback to standard then base
      'nova-2': ['nova', 'base'],
      'nova-2-general': ['nova-general', 'nova', 'base-general', 'base'],
      'nova-2-meeting': ['nova-meeting', 'nova', 'base'],
      'nova-2-phonecall': ['nova-phonecall', 'nova', 'base'],
      'nova-2-voicemail': ['nova-voicemail', 'nova', 'base'],
      'nova-2-finance': ['nova-finance', 'nova', 'base'],
      'nova-2-conversationalai': ['nova-conversationalai', 'nova', 'base'],
      'nova-2-video': ['nova-video', 'nova', 'base'],
      'nova-2-medical': ['nova-medical', 'nova', 'base'],
      'nova-2-drivethru': ['nova-drivethru', 'nova', 'base'],
      'nova-2-automotive': ['nova-automotive', 'nova', 'base'],
      
      // Standard models fallback to base
      'nova': ['base'],
      'nova-general': ['nova', 'base-general', 'base'],
      'nova-meeting': ['nova', 'base'],
      'nova-phonecall': ['nova', 'base'],
      'nova-voicemail': ['nova', 'base'],
      'nova-finance': ['nova', 'base'],
      'nova-conversationalai': ['nova', 'base'],
      'nova-video': ['nova', 'base'],
      'nova-medical': ['nova', 'base'],
      'nova-drivethru': ['nova', 'base'],
      'nova-automotive': ['nova', 'base'],
      
      // Base models have minimal fallback
      'base': [],
      'base-general': ['base'],
      
      // Legacy models
      'enhanced': ['base'],
      'general': ['base']
    };

    return modelHierarchy[primaryModel] || ['nova', 'base'];
  }

  /**
   * Validate migration results
   */
  private async validateMigration(): Promise<boolean> {
    try {
      logger.info('Validating migration results...');
      
      const configurations = await Configuration.find({
        'deepgramConfig.isEnabled': true
      });

      let validCount = 0;
      let totalCount = configurations.length;
      const issues: string[] = [];

      for (const config of configurations) {
        const deepgramConfig = config.deepgramConfig;
        
        // Check schema migration
        const hasRequiredFields = 
          deepgramConfig?.primaryModel &&
          Array.isArray(deepgramConfig?.fallbackModels) &&
          typeof deepgramConfig?.autoFallback === 'boolean' &&
          typeof deepgramConfig?.retryAttempts === 'number' &&
          typeof deepgramConfig?.timeoutMs === 'number';

        if (!hasRequiredFields) {
          issues.push(`Configuration ${config._id} missing required schema fields`);
          continue;
        }

        // Check model testing results (only for configurations with API keys)
        if (deepgramConfig.apiKey) {
          const hasTestingResults = 
            deepgramConfig.accountTier &&
            Array.isArray(deepgramConfig.availableModels) &&
            deepgramConfig.lastModelValidation &&
            deepgramConfig.status;

          if (!hasTestingResults) {
            issues.push(`Configuration ${config._id} missing model testing results`);
            continue;
          }

          // Check if status is reasonable
          if (deepgramConfig.status === 'failed' && deepgramConfig.availableModels.length > 0) {
            issues.push(`Configuration ${config._id} has failed status but available models`);
            continue;
          }
        }

        validCount++;
      }

      const isValid = validCount === totalCount;
      
      if (isValid) {
        logger.info(`Migration validation successful: ${validCount}/${totalCount} configurations valid`);
      } else {
        logger.error(`Migration validation failed: ${validCount}/${totalCount} configurations valid`);
        logger.error('Validation issues:', issues);
      }
      
      return isValid;
    } catch (error) {
      logger.error('Error validating migration:', error);
      return false;
    }
  }

  /**
   * Generate migration report
   */
  static async generateMigrationReport(): Promise<void> {
    try {
      logger.info('Generating migration report...');
      
      const configurations = await Configuration.find({
        'deepgramConfig.isEnabled': true
      });

      const report = {
        totalConfigurations: configurations.length,
        byAccountTier: {
          free: 0,
          basic: 0,
          premium: 0,
          unknown: 0
        },
        byStatus: {
          verified: 0,
          degraded: 0,
          failed: 0,
          unverified: 0
        },
        modelUsage: {} as { [key: string]: number },
        fallbackEvents: 0,
        issues: [] as string[]
      };

      for (const config of configurations) {
        const deepgramConfig = config.deepgramConfig;
        
        // Count by account tier
        const tier = deepgramConfig.accountTier || 'unknown';
        report.byAccountTier[tier as keyof typeof report.byAccountTier]++;
        
        // Count by status
        const status = deepgramConfig.status || 'unverified';
        report.byStatus[status as keyof typeof report.byStatus]++;
        
        // Count model usage
        const primaryModel = deepgramConfig.primaryModel;
        if (primaryModel) {
          report.modelUsage[primaryModel] = (report.modelUsage[primaryModel] || 0) + 1;
        }
        
        // Count fallback events
        if (deepgramConfig.status === 'degraded') {
          report.fallbackEvents++;
        }
        
        // Collect issues
        if (deepgramConfig.status === 'failed') {
          report.issues.push(`Config ${config._id}: ${deepgramConfig.lastError || 'Unknown error'}`);
        }
      }

      logger.info('Migration Report:', {
        summary: {
          totalConfigurations: report.totalConfigurations,
          accountTiers: report.byAccountTier,
          statuses: report.byStatus,
          fallbackEvents: report.fallbackEvents,
          issueCount: report.issues.length
        },
        modelUsage: report.modelUsage,
        issues: report.issues.slice(0, 10) // Show first 10 issues
      });

    } catch (error) {
      logger.error('Error generating migration report:', error);
    }
  }

  /**
   * Rollback migration (for emergency situations)
   */
  static async rollbackMigration(): Promise<void> {
    try {
      logger.info('Starting migration rollback...');
      
      const configurations = await Configuration.find({
        'deepgramConfig.primaryModel': { $exists: true }
      });

      for (const config of configurations) {
        const updates: any = {};
        
        // Restore old 'model' field from 'primaryModel'
        if (config.deepgramConfig?.primaryModel) {
          updates['deepgramConfig.model'] = config.deepgramConfig.primaryModel;
        }

        // Remove new fields
        updates['$unset'] = {
          'deepgramConfig.primaryModel': '',
          'deepgramConfig.fallbackModels': '',
          'deepgramConfig.autoFallback': '',
          'deepgramConfig.accountTier': '',
          'deepgramConfig.availableModels': '',
          'deepgramConfig.lastModelValidation': '',
          'deepgramConfig.retryAttempts': '',
          'deepgramConfig.timeoutMs': '',
          'deepgramConfig.modelCompatibilityStatus': '',
          'deepgramConfig.firstTimeSetupCompleted': '',
          'deepgramConfig.firstTimeSetupDate': ''
        };

        await Configuration.updateOne(
          { _id: config._id },
          updates
        );
      }

      logger.info('Migration rollback completed');
    } catch (error) {
      logger.error('Error during migration rollback:', error);
      throw error;
    }
  }

  /**
   * Ensure backward compatibility with existing configurations
   */
  static async ensureBackwardCompatibility(): Promise<void> {
    try {
      logger.info('Ensuring backward compatibility...');
      
      // Find configurations that might have compatibility issues
      const configurations = await Configuration.find({
        'deepgramConfig.isEnabled': true,
        $or: [
          { 'deepgramConfig.model': { $exists: true } }, // Old schema
          { 'deepgramConfig.primaryModel': { $exists: false } } // Missing new schema
        ]
      });

      for (const config of configurations) {
        const updates: any = {};
        
        // Ensure primaryModel exists (backward compatibility)
        const legacyModel = (config.deepgramConfig as any).model;
        if (!config.deepgramConfig.primaryModel && legacyModel) {
          updates['deepgramConfig.primaryModel'] = legacyModel;
        }
        
        // Ensure fallbackModels exists
        if (!config.deepgramConfig.fallbackModels) {
          const primaryModel = config.deepgramConfig.primaryModel || legacyModel || 'nova-2';
          updates['deepgramConfig.fallbackModels'] = ['nova', 'base'];
        }
        
        // Ensure autoFallback is set
        if (config.deepgramConfig.autoFallback === undefined) {
          updates['deepgramConfig.autoFallback'] = true;
        }

        if (Object.keys(updates).length > 0) {
          await Configuration.updateOne(
            { _id: config._id },
            { $set: updates }
          );
        }
      }

      logger.info('Backward compatibility ensured');
    } catch (error) {
      logger.error('Error ensuring backward compatibility:', error);
      throw error;
    }
  }
}

/**
 * CLI script to run migration commands
 */
if (require.main === module) {
  const command = process.argv[2];
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/projectcall')
    .then(async () => {
      switch (command) {
        case 'migrate':
          await DeepgramModelCompatibilityMigration.runMigration();
          break;
        case 'rollback':
          await DeepgramModelCompatibilityMigration.rollbackMigration();
          break;
        case 'report':
          await DeepgramModelCompatibilityMigration.generateMigrationReport();
          break;
        case 'compatibility':
          await DeepgramModelCompatibilityMigration.ensureBackwardCompatibility();
          break;
        default:
          console.log('Usage: node deepgram-model-compatibility-migration.js [migrate|rollback|report|compatibility]');
          console.log('');
          console.log('Commands:');
          console.log('  migrate       - Run full migration (schema + model testing)');
          console.log('  rollback      - Rollback migration changes');
          console.log('  report        - Generate migration status report');
          console.log('  compatibility - Ensure backward compatibility');
          process.exit(1);
      }
      
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}