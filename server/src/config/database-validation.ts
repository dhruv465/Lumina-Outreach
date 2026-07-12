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

  // Per-user providers are usable only after successful verification. Lazy
  // defaults intentionally contain empty, unverified keys and remain valid.
  if (config.llmConfig?.providers) {
    config.llmConfig.providers.forEach((provider: any) => {
      const providerLabel = provider.name === 'openai'
        ? 'OpenAI'
        : provider.name === 'anthropic'
          ? 'Anthropic'
          : provider.name === 'google'
            ? 'Google'
            : String(provider.name);
      const hasApiKey = typeof provider.apiKey === 'string' && provider.apiKey.trim() !== '';

      if (provider.status === 'verified' && !hasApiKey) {
        errors.push(`${providerLabel} LLM provider is verified but API key is missing`);
      } else if (provider.status === 'failed') {
        warnings.push(
          `${providerLabel} LLM verification failed: ${provider.lastError || 'Unknown error'}`,
        );
      } else if (provider.status === 'unverified' && hasApiKey) {
        warnings.push(`${providerLabel} LLM provider has not been verified`);
      }
    });
  }

  // Validate the current per-user Deepgram shape. Empty unverified defaults
  // are valid so a configuration can be created lazily.
  if (config.deepgramConfig) {
    if (config.deepgramConfig.isEnabled) {
      const hasApiKey = typeof config.deepgramConfig.apiKey === 'string'
        && config.deepgramConfig.apiKey.trim() !== '';

      if (config.deepgramConfig.status === 'verified' && !hasApiKey) {
        errors.push('Deepgram is verified but API key is missing');
      }
      if (config.deepgramConfig.status === 'verified' && !config.deepgramConfig.sttModel) {
        warnings.push('Deepgram STT model not configured - will use default');
      } else if (config.deepgramConfig.status === 'failed') {
        warnings.push(
          `Deepgram verification failed: ${config.deepgramConfig.lastError || 'Unknown error'}`,
        );
      } else if (config.deepgramConfig.status === 'unverified' && hasApiKey) {
        warnings.push('Deepgram configuration has not been verified');
      }
    } else {
      warnings.push('Deepgram is disabled - speech-to-text functionality will not be available');
    }
  } else {
    warnings.push('Deepgram configuration not found - speech-to-text functionality will not be available');
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

  // Check the current per-user Deepgram fields.
  const issues: string[] = [];
  
  if (deepgramConfig.status === 'failed') {
    issues.push(`Previous validation failed: ${deepgramConfig.lastError || 'Unknown error'}`);
  } else if (deepgramConfig.status !== 'verified') {
    issues.push('Deepgram configuration has not been verified');
  }
  
  if (!deepgramConfig.sttModel) {
    issues.push('STT model not configured');
  }

  return {
    isValid: issues.length === 0,
    error: issues.length > 0 ? `Deepgram configuration issues: ${issues.join(', ')}` : undefined,
    details: issues.length > 0 ? { issues } : undefined
  };
}
