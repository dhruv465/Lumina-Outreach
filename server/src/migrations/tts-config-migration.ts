import mongoose from 'mongoose';
import Configuration from '../models/Configuration';
import logger from '../utils/logger';

/**
 * Migration script to add default TTS configuration
 * for configurations that don't have it
 */
export class TTSConfigMigration {
  
  /**
   * Migrate existing configurations to include TTS config
   */
  static async migrateConfigurations(): Promise<void> {
    try {
      logger.info('Starting TTS configuration migration...');
      
      // Find all configurations that need migration
      const configurations = await Configuration.find({
        $or: [
          { 'ttsConfig': { $exists: false } },
          { 'ttsConfig.deepgramTTS': { $exists: false } }
        ]
      });

      logger.info(`Found ${configurations.length} configurations to migrate`);

      for (const config of configurations) {
        await this.migrateConfiguration(config);
      }

      logger.info('TTS configuration migration completed successfully');
    } catch (error) {
      logger.error('Error during TTS configuration migration:', error);
      throw error;
    }
  }

  /**
   * Migrate a single configuration document
   */
  private static async migrateConfiguration(config: any): Promise<void> {
    try {
      const updates: any = {};
      
      // Add default TTS config if missing
      if (!config.ttsConfig) {
        updates['ttsConfig'] = {
          provider: 'elevenlabs',
          primaryProvider: 'elevenlabs',
          fallbackProviders: ['deepgram'],
          autoFallback: true,
          deepgramTTS: {
            apiKey: '',
            isEnabled: false,
            defaultModel: 'aura-asteria-en',
            availableModels: [
              'aura-2-thalia-en',
              'aura-asteria-en',
              'aura-luna-en',
              'aura-stella-en',
              'aura-athena-en',
              'aura-hera-en',
              'aura-orion-en',
              'aura-arcas-en',
              'aura-perseus-en',
              'aura-angus-en',
              'aura-orpheus-en',
              'aura-helios-en',
              'aura-zeus-en'
            ],
            voiceSettings: {
              encoding: 'mp3',
              sampleRate: 24000
            },
            status: 'unverified',
            lastVerified: null,
            lastError: null
          }
        };
        logger.info(`Adding default TTS config for configuration ${config._id}`);
      } else if (!config.ttsConfig.deepgramTTS) {
        // Add deepgramTTS sub-config if ttsConfig exists but deepgramTTS doesn't
        updates['ttsConfig.deepgramTTS'] = {
          apiKey: '',
          isEnabled: false,
          defaultModel: 'aura-asteria-en',
          availableModels: [
            'aura-2-thalia-en',
            'aura-asteria-en',
            'aura-luna-en',
            'aura-stella-en',
            'aura-athena-en',
            'aura-hera-en',
            'aura-orion-en',
            'aura-arcas-en',
            'aura-perseus-en',
            'aura-angus-en',
            'aura-orpheus-en',
            'aura-helios-en',
            'aura-zeus-en'
          ],
          voiceSettings: {
            encoding: 'mp3',
            sampleRate: 24000
          },
          status: 'unverified',
          lastVerified: null,
          lastError: null
        };
        logger.info(`Adding deepgramTTS config to existing ttsConfig for configuration ${config._id}`);
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await Configuration.findByIdAndUpdate(config._id, { $set: updates }, { new: true });
        logger.info(`Successfully migrated configuration ${config._id}`);
      }

    } catch (error) {
      logger.error(`Error migrating configuration ${config._id}:`, error);
      throw error;
    }
  }

  /**
   * Rollback migration by removing TTS config
   */
  static async rollbackMigration(): Promise<void> {
    try {
      logger.info('Starting TTS configuration rollback...');
      
      // Find all configurations with TTS config
      const configurations = await Configuration.find({
        'ttsConfig': { $exists: true }
      });

      logger.info(`Found ${configurations.length} configurations to rollback`);

      for (const config of configurations) {
        await Configuration.findByIdAndUpdate(
          config._id, 
          { $unset: { ttsConfig: 1 } }, 
          { new: true }
        );
        logger.info(`Rolled back TTS config for configuration ${config._id}`);
      }

      logger.info('TTS configuration rollback completed successfully');
    } catch (error) {
      logger.error('Error during TTS configuration rollback:', error);
      throw error;
    }
  }

  /**
   * Validate migration results
   */
  static async validateMigration(): Promise<boolean> {
    try {
      logger.info('Validating TTS configuration migration...');
      
      const totalConfigs = await Configuration.countDocuments({});
      const configsWithTTS = await Configuration.countDocuments({
        'ttsConfig': { $exists: true },
        'ttsConfig.deepgramTTS': { $exists: true }
      });

      const isValid = totalConfigs === configsWithTTS;
      logger.info(`Migration validation: ${configsWithTTS}/${totalConfigs} configurations have TTS config`);
      
      return isValid;
    } catch (error) {
      logger.error('Error validating TTS migration:', error);
      return false;
    }
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lumimaoutreach')
    .then(async () => {
      switch (command) {
        case 'migrate':
          await TTSConfigMigration.migrateConfigurations();
          break;
        case 'rollback':
          await TTSConfigMigration.rollbackMigration();
          break;
        case 'validate':
          const isValid = await TTSConfigMigration.validateMigration();
          process.exit(isValid ? 0 : 1);
          break;
        default:
          logger.info('Usage: ts-node tts-config-migration.ts [migrate|rollback|validate]');
          break;
      }
      process.exit(0);
    })
    .catch(error => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

export default TTSConfigMigration;