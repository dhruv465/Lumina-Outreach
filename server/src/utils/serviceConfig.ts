import Configuration from '../models/Configuration';
import logger from './logger';

interface ServiceConfig {
  deepgramApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  elevenLabsApiKey?: string;
}

let cachedConfig: ServiceConfig | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches service configurations from the database and caches them.
 * @returns {Promise<ServiceConfig>} A promise that resolves to the service configuration object.
 */
export async function getServiceConfig(): Promise<ServiceConfig> {
  const now = Date.now();
  if (cachedConfig && (now - cacheTimestamp < CACHE_DURATION)) {
    logger.info('Returning cached service configuration');
    return cachedConfig;
  }

  try {
    logger.info('Fetching service configuration from database');
    const configDoc = await Configuration.findOne({});
    
    const newConfig: ServiceConfig = {};

    if (configDoc) {
        if (configDoc.deepgramConfig && configDoc.deepgramConfig.isEnabled) {
            newConfig.deepgramApiKey = configDoc.deepgramConfig.apiKey;
        }
        if (configDoc.elevenLabsConfig && configDoc.elevenLabsConfig.isEnabled) {
            newConfig.elevenLabsApiKey = configDoc.elevenLabsConfig.apiKey;
        }
        // Note: OpenAI and Anthropic keys are not in the Configuration model.
        // The LLMService will need to rely on environment variables as a fallback.
    } else {
        logger.warn('No service configuration document found in the database. Services may rely on environment variables.');
    }

    cachedConfig = newConfig;
    cacheTimestamp = now;
    
    logger.info('Service configuration fetched and cached successfully');
    return newConfig;
  } catch (error: any) {
    logger.error('Failed to fetch service configuration from database', { error: error.message });
    // Return the cached config if available, otherwise throw
    if (cachedConfig) {
      logger.warn('Returning stale service configuration due to fetch error');
      return cachedConfig;
    }
    throw new Error('Could not fetch service configuration.');
  }
}
