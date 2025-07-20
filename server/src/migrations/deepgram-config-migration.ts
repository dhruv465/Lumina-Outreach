import mongoose from 'mongoose';
import Configuration from '../models/Configuration';
import logger from '../utils/logger';

/**
 * Migration script to update existing Deepgram configurations
 * to support the new model compatibility features
 */
export class DeepgramConfigMigration {
  
  /**
   * Migrate existing configurations to new schema
   */
  static async migrateConfigurations(): Promise<void> {
    try {
      logger.info('Starting Deepgram configuration migration...');
      
      // Find all configurations that need migration
      const configurations = await Configuration.find({
        $or: [
          { 'deepgramConfig.primaryModel': { $exists: false } },
          { 'deepgramConfig.fallbackModels': { $exists: false } },
          { 'deepgramConfig.autoFallback': { $exists: false } }
        ]
      });

      logger.info(`Found ${configurations.length} configurations to migrate`);

      for (const config of configurations) {
        await this.migrateConfiguration(config);
      }

      logger.info('Deepgram configuration migration completed successfully');
    } catch (error) {
      logger.error('Error during Deepgram configuration migration:', error);
      throw error;
    }
  }

  /**
   * Migrate a single configuration document
   */
  private static async migrateConfiguration(config: any): Promise<void> {
    try {
      const updates: any = {};
      
      // Migrate old 'model' field to 'primaryModel'
      if (config.deepgramConfig?.model && !config.deepgramConfig?.primaryModel) {
        updates['deepgramConfig.primaryModel'] = config.deepgramConfig.model;
        logger.info(`Migrating model '${config.deepgramConfig.model}' to primaryModel for config ${config._id}`);
      }

      // Set default fallback models based on current model
      if (!config.deepgramConfig?.fallbackModels) {
        const currentModel = config.deepgramConfig?.model || config.deepgramConfig?.primaryModel || 'nova-2';
        updates['deepgramConfig.fallbackModels'] = this.getDefaultFallbackModels(currentModel);
        logger.info(`Setting default fallback models for config ${config._id}`);
      }

      // Set default autoFallback
      if (config.deepgramConfig?.autoFallback === undefined) {
        updates['deepgramConfig.autoFallback'] = true;
        logger.info(`Enabling autoFallback for config ${config._id}`);
      }

      // Set default retry attempts
      if (!config.deepgramConfig?.retryAttempts) {
        updates['deepgramConfig.retryAttempts'] = 3;
      }

      // Set default timeout
      if (!config.deepgramConfig?.timeoutMs) {
        updates['deepgramConfig.timeoutMs'] = 30000;
      }

      // Initialize empty model compatibility status
      if (!config.deepgramConfig?.modelCompatibilityStatus) {
        updates['deepgramConfig.modelCompatibilityStatus'] = new Map();
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await Configuration.updateOne(
          { _id: config._id },
          { $set: updates }
        );
        logger.info(`Successfully migrated configuration ${config._id}`);
      }

    } catch (error) {
      logger.error(`Error migrating configuration ${config._id}:`, error);
      throw error;
    }
  }

  /**
   * Get default fallback models based on the current primary model
   */
  private static getDefaultFallbackModels(primaryModel: string): string[] {
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
      
      // Base models have no fallback (they are the fallback)
      'base': [],
      'base-general': ['base'],
      
      // Legacy models
      'enhanced': ['base'],
      'general': ['base']
    };

    return modelHierarchy[primaryModel] || ['nova', 'base'];
  }

  /**
   * Rollback migration (for testing or emergency rollback)
   */
  static async rollbackMigration(): Promise<void> {
    try {
      logger.info('Starting Deepgram configuration migration rollback...');
      
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
          'deepgramConfig.modelCompatibilityStatus': ''
        };

        await Configuration.updateOne(
          { _id: config._id },
          updates
        );
      }

      logger.info('Deepgram configuration migration rollback completed');
    } catch (error) {
      logger.error('Error during migration rollback:', error);
      throw error;
    }
  }

  /**
   * Validate migration results
   */
  static async validateMigration(): Promise<boolean> {
    try {
      const configurations = await Configuration.find({
        'deepgramConfig.isEnabled': true
      });

      let validCount = 0;
      let totalCount = configurations.length;

      for (const config of configurations) {
        const deepgramConfig = config.deepgramConfig;
        
        // Check if all required new fields are present
        const hasRequiredFields = 
          deepgramConfig?.primaryModel &&
          Array.isArray(deepgramConfig?.fallbackModels) &&
          typeof deepgramConfig?.autoFallback === 'boolean' &&
          typeof deepgramConfig?.retryAttempts === 'number' &&
          typeof deepgramConfig?.timeoutMs === 'number';

        if (hasRequiredFields) {
          validCount++;
        } else {
          logger.warn(`Configuration ${config._id} is missing required fields after migration`);
        }
      }

      const isValid = validCount === totalCount;
      logger.info(`Migration validation: ${validCount}/${totalCount} configurations valid`);
      
      return isValid;
    } catch (error) {
      logger.error('Error validating migration:', error);
      return false;
    }
  }
}

/**
 * CLI script to run migration
 */
if (require.main === module) {
  const command = process.argv[2];
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/projectcall')
    .then(async () => {
      switch (command) {
        case 'migrate':
          await DeepgramConfigMigration.migrateConfigurations();
          break;
        case 'rollback':
          await DeepgramConfigMigration.rollbackMigration();
          break;
        case 'validate':
          const isValid = await DeepgramConfigMigration.validateMigration();
          process.exit(isValid ? 0 : 1);
          break;
        default:
          console.log('Usage: node deepgram-config-migration.js [migrate|rollback|validate]');
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