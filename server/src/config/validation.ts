/**
 * Configuration Validation Utilities
 * 
 * Validates environment variables and configuration settings before service initialization
 */
import { logger } from '../index';

export interface GoogleConfig {
  apiKey: string;
  modelName: string;
}

export interface ElevenLabsConfig {
  apiKey: string;
}

export interface DatabaseConfig {
  uri: string;
  name: string;
}

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate Google/Gemini configuration
 */
export function validateGoogleConfig(): GoogleConfig {
  const apiKey = process.env.GOOGLE_API_KEY;
  const modelName = process.env.GOOGLE_MODEL_NAME || 'gemini-1.5-flash';
  
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('GOOGLE_API_KEY environment variable is required');
  }
  
  if (!modelName || modelName.trim() === '') {
    logger.warn('GOOGLE_MODEL_NAME not set, using default: gemini-1.5-flash');
  }
  
  logger.info(`Google configuration validated - Model: ${modelName}`);
  return { apiKey, modelName };
}

/**
 * Validate ElevenLabs configuration - now optional for dynamic configuration
 * @deprecated Environment-based validation deprecated in favor of dynamic database configuration
 */
export function validateElevenLabsConfig(): ElevenLabsConfig {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  
  // ElevenLabs configuration is now optional since it's managed dynamically via database
  if (apiKey) {
    logger.info('ElevenLabs environment configuration found (will be overridden by database config)');
  } else {
    logger.info('No ElevenLabs environment configuration - using dynamic database configuration');
  }
  
  return { apiKey };
}

/**
 * Validate database configuration
 */
export function validateDatabaseConfig(): DatabaseConfig {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lumina_outreach';
  const name = process.env.DATABASE_NAME || 'lumina_outreach';
  
  if (!uri || uri.trim() === '') {
    throw new Error('MONGODB_URI environment variable is required');
  }
  
  logger.info(`Database configuration validated - URI: ${uri.replace(/\/\/.*@/, '//***@')}`);
  return { uri, name };
}

/**
 * Validate all critical configurations at startup
 * Updated to be more flexible with dynamic TTS/STT configuration
 */
export function validateAllConfigurations(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    validateDatabaseConfig();
  } catch (error) {
    errors.push(`Database: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  try {
    validateGoogleConfig();
  } catch (error) {
    errors.push(`Google/Gemini: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // ElevenLabs and other TTS/STT API keys are now managed dynamically
  // so we don't treat them as critical startup errors
  try {
    validateElevenLabsConfig();
  } catch (error) {
    warnings.push(`ElevenLabs (environment): ${error instanceof Error ? error.message : String(error)} - Will use database configuration`);
  }
  
  // Check optional configurations - these are now informational only
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || openaiKey.trim() === '') {
    warnings.push('OpenAI: Environment variable not configured - Will use database configuration');
  }
  
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.trim() === '') {
    warnings.push('Anthropic: Environment variable not configured - Will use database configuration');
  }
  
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioSid || !twilioToken) {
    warnings.push('Twilio: Environment variables not configured - Will use database configuration');
  }
  
  const isValid = errors.length === 0;
  
  if (isValid) {
    logger.info('Critical configurations validated successfully - TTS/STT will be configured dynamically');
  } else {
    logger.error(`Configuration validation failed with ${errors.length} critical errors`);
  }
  
  if (warnings.length > 0) {
    logger.info(`Configuration validation completed with ${warnings.length} informational warnings (services will use database configuration)`);
  }
  
  return { isValid, errors, warnings };
}

/**
 * Get environment variables with defaults - Updated for dynamic configuration
 * Note: TTS/STT API keys should be managed through database configuration
 */
export function getRequiredEnvVars() {
  return {
    // Database - Required
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/lumina_outreach',
    DATABASE_NAME: process.env.DATABASE_NAME || 'lumina_outreach',
    
    // Google/Gemini - Required for core functionality
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
    GOOGLE_MODEL_NAME: process.env.GOOGLE_MODEL_NAME || 'gemini-1.5-flash',
    
    // TTS/STT API Keys - Optional environment variables (managed dynamically)
    // These are provided for backward compatibility but should not be relied upon
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
    
    // Server
    PORT: process.env.PORT || '3000',
    NODE_ENV: process.env.NODE_ENV || 'development'
  };
}
