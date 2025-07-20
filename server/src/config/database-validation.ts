/**
 * Database-driven configuration validation utilities
 * Note: This system uses database-driven configuration, not environment variables for API keys
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  details?: any;
}

/**
 * Validate database connection configuration
 */
export function validateDatabaseConfig(): ValidationResult {
  const mongodbUri = process.env.MONGODB_URI;
  
  if (!mongodbUri) {
    return {
      isValid: false,
      error: 'MONGODB_URI environment variable is required for database connection'
    };
  }

  // Basic MongoDB URI validation
  if (!mongodbUri.startsWith('mongodb://') && !mongodbUri.startsWith('mongodb+srv://')) {
    return {
      isValid: false,
      error: 'MONGODB_URI must be a valid MongoDB connection string'
    };
  }

  return { isValid: true };
}

/**
 * Validate server configuration (environment-based)
 */
export function validateServerConfig(): ValidationResult {
  const port = process.env.PORT;
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    return {
      isValid: false,
      error: 'JWT_SECRET environment variable is required'
    };
  }

  if (jwtSecret.length < 32) {
    return {
      isValid: false,
      error: 'JWT_SECRET must be at least 32 characters long for security'
    };
  }

  // Validate port if provided
  if (port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return {
        isValid: false,
        error: 'PORT must be a valid number between 1 and 65535'
      };
    }
  }

  return { isValid: true };
}

/**
 * Validate webhook configuration 
 */
export function validateWebhookConfig(): ValidationResult {
  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
  
  if (!webhookBaseUrl) {
    return {
      isValid: false,
      error: 'WEBHOOK_BASE_URL environment variable is required for Twilio integration'
    };
  }

  // Basic URL validation
  try {
    new URL(webhookBaseUrl);
  } catch (error) {
    return {
      isValid: false,
      error: 'WEBHOOK_BASE_URL must be a valid URL'
    };
  }

  return { isValid: true };
}

/**
 * Validate essential startup configuration
 * This validates only environment variables required for basic server startup
 * API keys and service configurations are loaded from database
 */
export function validateStartupConfig(): ValidationResult {
  // Validate database connection
  const dbValidation = validateDatabaseConfig();
  if (!dbValidation.isValid) {
    return dbValidation;
  }

  // Validate server configuration
  const serverValidation = validateServerConfig();
  if (!serverValidation.isValid) {
    return serverValidation;
  }

  // Validate webhook configuration  
  const webhookValidation = validateWebhookConfig();
  if (!webhookValidation.isValid) {
    return webhookValidation;
  }

  return { isValid: true };
}

/**
 * Validate database-loaded configuration
 */
export function validateDatabaseLoadedConfig(config: any): ValidationResult {
  if (!config) {
    return {
      isValid: true, // No configuration is valid - services will operate without API keys
      details: 'No configuration found in database - services will initialize with empty credentials'
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate LLM providers if they exist
  if (config.llmConfig?.providers) {
    const enabledProviders = config.llmConfig.providers.filter((p: any) => p.isEnabled);
    
    enabledProviders.forEach((provider: any) => {
      if (provider.name === 'google' && (!provider.apiKey || provider.apiKey.trim() === '')) {
        errors.push(`Google LLM provider is enabled but API key is missing`);
      }
      if (provider.name === 'openai' && (!provider.apiKey || provider.apiKey.trim() === '')) {
        errors.push(`OpenAI LLM provider is enabled but API key is missing`);
      }
      if (provider.name === 'anthropic' && (!provider.apiKey || provider.apiKey.trim() === '')) {
        errors.push(`Anthropic LLM provider is enabled but API key is missing`);
      }
    });
  }

  // Validate ElevenLabs if enabled
  if (config.elevenLabsConfig?.isEnabled && (!config.elevenLabsConfig.apiKey || config.elevenLabsConfig.apiKey.trim() === '')) {
    errors.push('ElevenLabs is enabled but API key is missing');
  }

  // Validate Deepgram configuration
  if (config.deepgramConfig) {
    if (config.deepgramConfig.isEnabled) {
      if (!config.deepgramConfig.apiKey || config.deepgramConfig.apiKey.trim() === '') {
        errors.push('Deepgram is enabled but API key is missing');
      } else {
        // Check for model configuration issues
        if (!config.deepgramConfig.primaryModel) {
          warnings.push('Deepgram primary model not configured - will use default');
        }
        
        // Check validation status
        if (config.deepgramConfig.status === 'failed') {
          warnings.push(`Deepgram model validation failed: ${config.deepgramConfig.lastError || 'Unknown error'}`);
        } else if (config.deepgramConfig.status === 'unverified') {
          warnings.push('Deepgram configuration has not been validated');
        }
        
        // Check for account tier limitations
        if (config.deepgramConfig.accountTier === 'free') {
          warnings.push('Deepgram free tier detected - limited model access and features');
        }
        
        // Check for outdated validation
        if (config.deepgramConfig.lastModelValidation) {
          const lastValidation = new Date(config.deepgramConfig.lastModelValidation);
          const daysSinceValidation = (Date.now() - lastValidation.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceValidation > 7) {
            warnings.push(`Deepgram model validation is ${Math.floor(daysSinceValidation)} days old - consider re-validation`);
          }
        }
      }
    } else {
      warnings.push('Deepgram is disabled - speech-to-text functionality will not be available');
    }
  } else {
    warnings.push('Deepgram configuration not found - speech-to-text functionality will not be available');
  }

  // Validate Twilio if enabled
  if (config.twilioConfig?.isEnabled) {
    if (!config.twilioConfig.accountSid || config.twilioConfig.accountSid.trim() === '') {
      errors.push('Twilio is enabled but Account SID is missing');
    }
    if (!config.twilioConfig.authToken || config.twilioConfig.authToken.trim() === '') {
      errors.push('Twilio is enabled but Auth Token is missing');
    }
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: `Configuration validation failed: ${errors.join(', ')}`,
      details: { errors, warnings }
    };
  }

  // Return success with warnings if any
  return { 
    isValid: true,
    details: warnings.length > 0 ? { warnings } : undefined
  };
}

/**
 * Validate Deepgram-specific configuration for startup
 */
export function validateDeepgramStartupConfig(deepgramConfig: any): ValidationResult {
  if (!deepgramConfig) {
    return {
      isValid: false,
      error: 'Deepgram configuration not found',
      details: 'No Deepgram configuration exists in database'
    };
  }

  if (!deepgramConfig.isEnabled) {
    return {
      isValid: true,
      details: 'Deepgram is disabled - validation skipped'
    };
  }

  if (!deepgramConfig.apiKey || deepgramConfig.apiKey.trim() === '') {
    return {
      isValid: false,
      error: 'Deepgram API key is missing',
      details: 'API key is required for Deepgram functionality'
    };
  }

  // Check for known configuration issues
  const issues: string[] = [];
  
  if (deepgramConfig.status === 'failed') {
    issues.push(`Previous validation failed: ${deepgramConfig.lastError || 'Unknown error'}`);
  }
  
  if (!deepgramConfig.primaryModel) {
    issues.push('Primary model not configured');
  }
  
  if (deepgramConfig.accountTier === 'free' && deepgramConfig.primaryModel?.includes('nova-2')) {
    issues.push('Free tier account cannot access nova-2 models');
  }

  return {
    isValid: issues.length === 0,
    error: issues.length > 0 ? `Deepgram configuration issues: ${issues.join(', ')}` : undefined,
    details: issues.length > 0 ? { issues } : undefined
  };
}
