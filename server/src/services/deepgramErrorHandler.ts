/**
 * Deepgram Error Classification and Recovery Service
 * 
 * This service provides comprehensive error handling for Deepgram API interactions,
 * including error classification, recovery strategies, and retry logic with exponential backoff.
 * 
 * Requirements addressed:
 * - 2.1: Detailed error logging with error codes and messages
 * - 2.2: Specific guidance for permission errors and model suggestions
 * - 2.4: Retry logic with exponential backoff for failed requests
 */

import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { DeepgramErrorType, RecoveryStrategy, DEFAULT_MODEL_HIERARCHY, DEEPGRAM_MODEL_REGISTRY } from '../types/deepgram';
import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';

export interface DeepgramError {
  code?: string | number;
  message: string;
  status?: number;
  type?: string;
  details?: any;
  originalError?: any;
}

export interface ErrorClassificationResult {
  errorType: DeepgramErrorType;
  isRecoverable: boolean;
  suggestedAction: string;
  fallbackModels?: string[];
  retryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
}

export interface RecoveryContext {
  currentModel: string;
  apiKey: string;
  accountTier?: string;
  attemptNumber: number;
  previousErrors: DeepgramError[];
}

/**
 * Service for classifying Deepgram errors and implementing recovery strategies
 */
export class DeepgramErrorHandler {
  private readonly defaultRetryOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterEnabled: true
  };

  /**
   * Classify a Deepgram error and determine recovery strategy
   */
  public classifyError(error: any): ErrorClassificationResult {
    const deepgramError = this.normalizeError(error);
    
    // Enhanced logging with structured error information
    logger.error('Deepgram error classification initiated', {
      errorCode: deepgramError.code,
      errorMessage: deepgramError.message,
      httpStatus: deepgramError.status,
      errorType: deepgramError.type,
      originalError: deepgramError.originalError?.constructor?.name,
      timestamp: new Date().toISOString(),
      context: 'deepgram-error-classification'
    });

    let classification: ErrorClassificationResult;

    // Classify based on error patterns with enhanced error handling
    if (this.isPermissionError(deepgramError)) {
      classification = this.handlePermissionError(deepgramError);
    } else if (this.isInvalidModelError(deepgramError)) {
      classification = this.handleInvalidModelError(deepgramError);
    } else if (this.isQuotaExceededError(deepgramError)) {
      classification = this.handleQuotaExceededError(deepgramError);
    } else if (this.isAuthenticationError(deepgramError)) {
      classification = this.handleAuthenticationError(deepgramError);
    } else if (this.isNetworkError(deepgramError)) {
      classification = this.handleNetworkError(deepgramError);
    } else {
      // Default classification for unknown errors
      classification = {
        errorType: DeepgramErrorType.NETWORK_ERROR,
        isRecoverable: true,
        suggestedAction: 'Retry the request with exponential backoff. If the issue persists, check your network connection and Deepgram service status.',
        retryable: true,
        severity: 'low'
      };
    }

    // Log the classification result with detailed context
    logger.info('Deepgram error classified', {
      errorType: classification.errorType,
      severity: classification.severity,
      isRecoverable: classification.isRecoverable,
      retryable: classification.retryable,
      suggestedAction: classification.suggestedAction,
      fallbackModels: classification.fallbackModels,
      context: 'deepgram-error-classification'
    });

    // Create admin alerts for critical or high-severity errors
    this.createAdminAlertForError(deepgramError, classification);

    return classification;
  }

  /**
   * Get recovery strategy for a specific error type
   */
  public getRecoveryStrategy(
    errorType: DeepgramErrorType,
    context: RecoveryContext
  ): RecoveryStrategy {
    switch (errorType) {
      case DeepgramErrorType.INSUFFICIENT_PERMISSIONS:
        return {
          type: 'fallback_model',
          parameters: {
            fallbackModels: this.getFallbackModels(context.currentModel),
            preserveFeatures: true
          },
          maxAttempts: 3
        };

      case DeepgramErrorType.INVALID_MODEL:
        return {
          type: 'fallback_model',
          parameters: {
            fallbackModels: this.getFallbackModels(context.currentModel),
            validateModel: true
          },
          maxAttempts: 2
        };

      case DeepgramErrorType.QUOTA_EXCEEDED:
        return {
          type: 'retry',
          parameters: {
            delayMs: 60000, // Wait 1 minute for quota reset
            exponentialBackoff: false
          },
          maxAttempts: 2
        };

      case DeepgramErrorType.AUTHENTICATION_ERROR:
        return {
          type: 'fail',
          parameters: {
            reason: 'Invalid API key - manual intervention required'
          },
          maxAttempts: 0
        };

      case DeepgramErrorType.NETWORK_ERROR:
        return {
          type: 'retry',
          parameters: {
            exponentialBackoff: true,
            jitter: true
          },
          maxAttempts: 3
        };

      default:
        return {
          type: 'retry',
          parameters: {
            exponentialBackoff: true
          },
          maxAttempts: 2
        };
    }
  }

  /**
   * Execute recovery strategy with retry logic
   */
  public async executeRecovery<T>(
    operation: () => Promise<T>,
    context: RecoveryContext,
    options?: Partial<RetryOptions>
  ): Promise<T> {
    const retryOptions = { ...this.defaultRetryOptions, ...options };
    const errors: DeepgramError[] = [];
    
    // Log recovery attempt initiation
    logger.info('Deepgram recovery operation initiated', {
      model: context.currentModel,
      accountTier: context.accountTier,
      maxAttempts: retryOptions.maxAttempts,
      previousErrorCount: context.previousErrors.length,
      context: 'deepgram-recovery-operation'
    });
    
    for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt++) {
      try {
        logger.info(`Executing Deepgram operation attempt ${attempt}/${retryOptions.maxAttempts}`, {
          model: context.currentModel,
          attemptNumber: attempt,
          context: 'deepgram-recovery-attempt'
        });

        const result = await operation();
        
        // Log successful recovery if this wasn't the first attempt
        if (attempt > 1) {
          logger.info(`Deepgram operation recovered successfully on attempt ${attempt}`, {
            model: context.currentModel,
            previousErrors: errors.length,
            totalRecoveryTime: Date.now() - (context as any).startTime,
            context: 'deepgram-recovery-success'
          });

          // Create success alert for recovery after failures
          this.createRecoverySuccessAlert(context, attempt, errors);
        }
        
        return result;
      } catch (error) {
        const deepgramError = this.normalizeError(error);
        errors.push(deepgramError);
        
        const classification = this.classifyError(deepgramError);
        
        logger.warn(`Deepgram operation failed on attempt ${attempt}`, {
          model: context.currentModel,
          errorType: classification.errorType,
          isRecoverable: classification.isRecoverable,
          attemptsRemaining: retryOptions.maxAttempts - attempt,
          context: 'deepgram-recovery-attempt-failed'
        });

        // If this is the last attempt or error is not retryable, throw
        if (attempt === retryOptions.maxAttempts || !classification.retryable) {
          logger.error(`Deepgram operation failed permanently after ${attempt} attempts`, {
            model: context.currentModel,
            finalError: deepgramError.message,
            allErrors: errors.map(e => e.message),
            context: 'deepgram-recovery-failed'
          });

          // Create failure alert for permanent failures
          this.createRecoveryFailureAlert(context, errors, attempt);
          
          throw this.createRecoveryFailedError(errors, context);
        }

        // Calculate delay for next attempt
        const delay = this.calculateRetryDelay(attempt, retryOptions);
        
        logger.info(`Retrying Deepgram operation in ${delay}ms`, {
          attempt: attempt + 1,
          maxAttempts: retryOptions.maxAttempts,
          errorType: classification.errorType,
          delay: delay,
          context: 'deepgram-recovery-retry'
        });

        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw this.createRecoveryFailedError(errors, context);
  }

  /**
   * Normalize different error formats into a consistent structure
   */
  private normalizeError(error: any): DeepgramError {
    // Handle Deepgram SDK errors
    if (error?.response?.data) {
      return {
        code: error.response.status || error.code,
        message: error.response.data.message || error.response.data.error || error.message,
        status: error.response.status,
        type: error.response.data.type,
        details: error.response.data,
        originalError: error
      };
    }

    // Handle HTTP errors
    if (error?.status || error?.statusCode) {
      return {
        code: error.status || error.statusCode,
        message: error.message || 'HTTP Error',
        status: error.status || error.statusCode,
        originalError: error
      };
    }

    // Handle generic errors
    return {
      message: getErrorMessage(error),
      originalError: error
    };
  }

  /**
   * Check if error indicates insufficient permissions
   */
  private isPermissionError(error: DeepgramError): boolean {
    const permissionIndicators = [
      'insufficient permissions',
      'permission denied',
      'access denied',
      'forbidden',
      'not authorized',
      'invalid model for account'
    ];

    const message = error.message.toLowerCase();
    const hasPermissionKeyword = permissionIndicators.some(indicator => 
      message.includes(indicator)
    );

    return error.status === 403 || hasPermissionKeyword;
  }

  /**
   * Check if error indicates invalid model
   */
  private isInvalidModelError(error: DeepgramError): boolean {
    const modelIndicators = [
      'invalid model',
      'model not found',
      'unsupported model',
      'model not available',
      'unknown model'
    ];

    const message = error.message.toLowerCase();
    return modelIndicators.some(indicator => message.includes(indicator));
  }

  /**
   * Check if error indicates quota exceeded
   */
  private isQuotaExceededError(error: DeepgramError): boolean {
    const quotaIndicators = [
      'quota exceeded',
      'rate limit',
      'too many requests',
      'usage limit',
      'billing limit'
    ];

    const message = error.message.toLowerCase();
    const hasQuotaKeyword = quotaIndicators.some(indicator => 
      message.includes(indicator)
    );

    return error.status === 429 || hasQuotaKeyword;
  }

  /**
   * Check if error indicates authentication failure
   */
  private isAuthenticationError(error: DeepgramError): boolean {
    const authIndicators = [
      'invalid api key',
      'authentication failed',
      'unauthorized',
      'invalid token',
      'api key required'
    ];

    const message = error.message.toLowerCase();
    const hasAuthKeyword = authIndicators.some(indicator => 
      message.includes(indicator)
    );

    return error.status === 401 || hasAuthKeyword;
  }

  /**
   * Check if error is network-related
   */
  private isNetworkError(error: DeepgramError): boolean {
    const networkIndicators = [
      'network error',
      'connection failed',
      'timeout',
      'econnreset',
      'enotfound',
      'econnrefused',
      'socket hang up'
    ];

    const message = error.message.toLowerCase();
    return networkIndicators.some(indicator => message.includes(indicator)) ||
           error.code === 'ECONNRESET' ||
           error.code === 'ENOTFOUND' ||
           error.code === 'ECONNREFUSED' ||
           error.status === 0;
  }

  /**
   * Handle permission errors with specific guidance
   */
  private handlePermissionError(error: DeepgramError): ErrorClassificationResult {
    const fallbackModels = this.suggestFallbackModelsForPermissionError();
    
    // Enhanced error message with specific guidance
    const detailedGuidance = this.generatePermissionErrorGuidance(error, fallbackModels);
    
    // Log detailed permission error information
    logger.warn('Deepgram permission error detected', {
      errorCode: error.code,
      errorMessage: error.message,
      httpStatus: error.status,
      suggestedFallbacks: fallbackModels,
      guidance: detailedGuidance,
      context: 'deepgram-permission-error'
    });
    
    return {
      errorType: DeepgramErrorType.INSUFFICIENT_PERMISSIONS,
      isRecoverable: true,
      suggestedAction: detailedGuidance,
      fallbackModels,
      retryable: false, // Don't retry same model, use fallback instead
      severity: 'high'
    };
  }

  /**
   * Handle invalid model errors
   */
  private handleInvalidModelError(error: DeepgramError): ErrorClassificationResult {
    const fallbackModels = ['nova', 'base'];
    
    // Enhanced error message with model-specific guidance
    const detailedGuidance = this.generateInvalidModelErrorGuidance(error, fallbackModels);
    
    // Log detailed invalid model error information
    logger.warn('Deepgram invalid model error detected', {
      errorCode: error.code,
      errorMessage: error.message,
      httpStatus: error.status,
      suggestedFallbacks: fallbackModels,
      guidance: detailedGuidance,
      context: 'deepgram-invalid-model-error'
    });
    
    return {
      errorType: DeepgramErrorType.INVALID_MODEL,
      isRecoverable: true,
      suggestedAction: detailedGuidance,
      fallbackModels,
      retryable: false,
      severity: 'medium'
    };
  }

  /**
   * Handle quota exceeded errors
   */
  private handleQuotaExceededError(error: DeepgramError): ErrorClassificationResult {
    // Enhanced error message with quota-specific guidance
    const detailedGuidance = this.generateQuotaExceededErrorGuidance(error);
    
    // Log detailed quota exceeded error information
    logger.warn('Deepgram quota exceeded error detected', {
      errorCode: error.code,
      errorMessage: error.message,
      httpStatus: error.status,
      guidance: detailedGuidance,
      context: 'deepgram-quota-exceeded-error'
    });
    
    return {
      errorType: DeepgramErrorType.QUOTA_EXCEEDED,
      isRecoverable: true,
      suggestedAction: detailedGuidance,
      retryable: true,
      severity: 'medium'
    };
  }

  /**
   * Handle authentication errors
   */
  private handleAuthenticationError(error: DeepgramError): ErrorClassificationResult {
    // Enhanced error message with authentication-specific guidance
    const detailedGuidance = this.generateAuthenticationErrorGuidance(error);
    
    // Log detailed authentication error information
    logger.error('Deepgram authentication error detected', {
      errorCode: error.code,
      errorMessage: error.message,
      httpStatus: error.status,
      guidance: detailedGuidance,
      context: 'deepgram-authentication-error'
    });
    
    return {
      errorType: DeepgramErrorType.AUTHENTICATION_ERROR,
      isRecoverable: false,
      suggestedAction: detailedGuidance,
      retryable: false,
      severity: 'critical'
    };
  }

  /**
   * Handle network errors
   */
  private handleNetworkError(error: DeepgramError): ErrorClassificationResult {
    // Enhanced error message with network-specific guidance
    const detailedGuidance = this.generateNetworkErrorGuidance(error);
    
    // Log detailed network error information
    logger.warn('Deepgram network error detected', {
      errorCode: error.code,
      errorMessage: error.message,
      httpStatus: error.status,
      guidance: detailedGuidance,
      context: 'deepgram-network-error'
    });
    
    return {
      errorType: DeepgramErrorType.NETWORK_ERROR,
      isRecoverable: true,
      suggestedAction: detailedGuidance,
      retryable: true,
      severity: 'low'
    };
  }

  /**
   * Get fallback models for a given model
   */
  private getFallbackModels(currentModel: string): string[] {
    return DEFAULT_MODEL_HIERARCHY[currentModel] || ['nova', 'base'];
  }

  /**
   * Suggest fallback models for permission errors
   */
  private suggestFallbackModelsForPermissionError(): string[] {
    // For permission errors, suggest models available on free tier
    return ['base', 'base-general'];
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, options: RetryOptions): number {
    let delay = options.baseDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
    
    // Apply maximum delay limit
    delay = Math.min(delay, options.maxDelayMs);
    
    // Add jitter to prevent thundering herd
    if (options.jitterEnabled) {
      const jitter = Math.random() * 0.1 * delay; // Up to 10% jitter
      delay += jitter;
    }
    
    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a comprehensive error for recovery failure
   */
  private createRecoveryFailedError(errors: DeepgramError[], context: RecoveryContext): Error {
    const errorMessages = errors.map(e => e.message).join('; ');
    const lastError = errors[errors.length - 1];
    
    const recoveryError = new Error(
      `Deepgram operation failed permanently after ${errors.length} attempts. ` +
      `Model: ${context.currentModel}. Errors: ${errorMessages}`
    );
    
    // Attach additional context
    (recoveryError as any).deepgramErrors = errors;
    (recoveryError as any).context = context;
    (recoveryError as any).lastErrorType = this.classifyError(lastError).errorType;
    
    return recoveryError;
  }

  /**
   * Generate detailed guidance for permission errors
   */
  private generatePermissionErrorGuidance(error: DeepgramError, fallbackModels: string[]): string {
    const baseMessage = 'Model access denied due to insufficient permissions.';
    
    let guidance = `${baseMessage}\n\nRecommended actions:\n`;
    guidance += `1. Try using a compatible model: ${fallbackModels.join(', ')}\n`;
    guidance += `2. Upgrade your Deepgram account to access premium models\n`;
    guidance += `3. Check your account tier and available models at https://console.deepgram.com\n`;
    guidance += `4. Verify your API key has the necessary permissions\n`;
    
    if (error.code === 403) {
      guidance += `\nHTTP 403 Error Details: Your current account tier does not support the requested model. `;
      guidance += `Free accounts are limited to 'base' models, while premium models require a paid subscription.`;
    }
    
    return guidance;
  }

  /**
   * Generate detailed guidance for invalid model errors
   */
  private generateInvalidModelErrorGuidance(error: DeepgramError, fallbackModels: string[]): string {
    const baseMessage = 'The specified model is invalid or not supported.';
    
    let guidance = `${baseMessage}\n\nRecommended actions:\n`;
    guidance += `1. Use a supported model: ${fallbackModels.join(', ')}\n`;
    guidance += `2. Check the Deepgram documentation for current model names\n`;
    guidance += `3. Verify the model name spelling and format\n`;
    guidance += `4. Consider using 'nova' or 'base' as reliable fallback options\n`;
    
    if (error.message.toLowerCase().includes('deprecated')) {
      guidance += `\nModel Deprecation Notice: The requested model may have been deprecated. `;
      guidance += `Please update your configuration to use a current model.`;
    }
    
    return guidance;
  }

  /**
   * Generate detailed guidance for quota exceeded errors
   */
  private generateQuotaExceededErrorGuidance(error: DeepgramError): string {
    const baseMessage = 'API quota or rate limit exceeded.';
    
    let guidance = `${baseMessage}\n\nRecommended actions:\n`;
    guidance += `1. Wait for quota reset (typically hourly or daily)\n`;
    guidance += `2. Upgrade your Deepgram plan for higher limits\n`;
    guidance += `3. Implement request throttling in your application\n`;
    guidance += `4. Monitor your usage at https://console.deepgram.com\n`;
    
    if (error.code === 429) {
      guidance += `\nRate Limiting Details: You've exceeded the requests per minute limit. `;
      guidance += `Consider implementing exponential backoff or reducing request frequency.`;
    }
    
    return guidance;
  }

  /**
   * Generate detailed guidance for authentication errors
   */
  private generateAuthenticationErrorGuidance(error: DeepgramError): string {
    const baseMessage = 'Authentication failed with Deepgram API.';
    
    let guidance = `${baseMessage}\n\nRecommended actions:\n`;
    guidance += `1. Verify your API key is correct and active\n`;
    guidance += `2. Check if the API key has expired\n`;
    guidance += `3. Ensure the API key is properly configured in environment variables\n`;
    guidance += `4. Generate a new API key from https://console.deepgram.com\n`;
    guidance += `5. Verify your account is in good standing\n`;
    
    if (error.code === 401) {
      guidance += `\nHTTP 401 Error Details: The provided API key is invalid or missing. `;
      guidance += `Double-check your DEEPGRAM_API_KEY environment variable.`;
    }
    
    return guidance;
  }

  /**
   * Generate detailed guidance for network errors
   */
  private generateNetworkErrorGuidance(error: DeepgramError): string {
    const baseMessage = 'Network connectivity issue detected.';
    
    let guidance = `${baseMessage}\n\nRecommended actions:\n`;
    guidance += `1. Check your internet connection\n`;
    guidance += `2. Verify Deepgram service status at https://status.deepgram.com\n`;
    guidance += `3. Retry with exponential backoff\n`;
    guidance += `4. Check firewall and proxy settings\n`;
    guidance += `5. Consider implementing circuit breaker pattern\n`;
    
    if (error.message.toLowerCase().includes('timeout')) {
      guidance += `\nTimeout Details: The request timed out. This may indicate network latency issues `;
      guidance += `or temporary service unavailability. Consider increasing timeout values.`;
    }
    
    if (error.message.toLowerCase().includes('connection')) {
      guidance += `\nConnection Details: Unable to establish connection to Deepgram servers. `;
      guidance += `This may be due to network issues or DNS resolution problems.`;
    }
    
    return guidance;
  }

  /**
   * Create admin alerts for Deepgram errors
   */
  private createAdminAlertForError(error: DeepgramError, classification: ErrorClassificationResult): void {
    // Only create alerts for high severity or critical errors
    if (classification.severity === 'critical' || classification.severity === 'high') {
      const alertLevel = classification.severity === 'critical' ? AlertLevel.CRITICAL : AlertLevel.WARNING;
      
      alertSystem.createAlert(
        alertLevel,
        'deepgram-model-compatibility' as AlertType,
        `Deepgram ${classification.errorType}: ${error.message}`,
        {
          errorType: classification.errorType,
          errorCode: error.code,
          httpStatus: error.status,
          isRecoverable: classification.isRecoverable,
          suggestedAction: classification.suggestedAction,
          fallbackModels: classification.fallbackModels,
          originalError: error.originalError?.constructor?.name,
          timestamp: new Date().toISOString()
        },
        'deepgram-error-handler'
      );
    }

    // Create specific alerts for authentication errors (always critical)
    if (classification.errorType === DeepgramErrorType.AUTHENTICATION_ERROR) {
      alertSystem.createAlert(
        AlertLevel.CRITICAL,
        'deepgram-authentication' as AlertType,
        'Deepgram API authentication failure - Service may be unavailable',
        {
          errorMessage: error.message,
          errorCode: error.code,
          guidance: 'Check API key configuration and account status',
          actionRequired: 'Immediate attention required - Voice services affected',
          timestamp: new Date().toISOString()
        },
        'deepgram-error-handler'
      );
    }

    // Create specific alerts for permission errors affecting model access
    if (classification.errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      alertSystem.createAlert(
        AlertLevel.WARNING,
        'deepgram-model-access' as AlertType,
        'Deepgram model access denied - Automatic fallback initiated',
        {
          errorMessage: error.message,
          errorCode: error.code,
          fallbackModels: classification.fallbackModels,
          guidance: 'Consider upgrading Deepgram account or updating model configuration',
          impact: 'Voice quality may be reduced due to fallback model usage',
          timestamp: new Date().toISOString()
        },
        'deepgram-error-handler'
      );
    }
  }

  /**
   * Create alert for successful recovery after failures
   */
  private createRecoverySuccessAlert(context: RecoveryContext, successfulAttempt: number, errors: DeepgramError[]): void {
    alertSystem.createAlert(
      AlertLevel.INFO,
      'deepgram-recovery' as AlertType,
      `Deepgram service recovered after ${successfulAttempt} attempts`,
      {
        model: context.currentModel,
        accountTier: context.accountTier,
        successfulAttempt,
        totalErrors: errors.length,
        errorTypes: errors.map(e => this.classifyError(e).errorType),
        message: 'Service has recovered and is functioning normally',
        timestamp: new Date().toISOString()
      },
      'deepgram-error-handler'
    );
  }

  /**
   * Create alert for permanent recovery failures
   */
  private createRecoveryFailureAlert(context: RecoveryContext, errors: DeepgramError[], attempts: number): void {
    const lastError = errors[errors.length - 1];
    const lastClassification = this.classifyError(lastError);
    
    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'deepgram-service-failure' as AlertType,
      `Deepgram service permanently failed after ${attempts} attempts`,
      {
        model: context.currentModel,
        accountTier: context.accountTier,
        totalAttempts: attempts,
        totalErrors: errors.length,
        finalErrorType: lastClassification.errorType,
        finalErrorMessage: lastError.message,
        allErrorMessages: errors.map(e => e.message),
        suggestedAction: lastClassification.suggestedAction,
        impact: 'Voice transcription services are currently unavailable',
        actionRequired: 'Immediate intervention required',
        timestamp: new Date().toISOString()
      },
      'deepgram-error-handler'
    );
  }
}

// Export singleton instance
export const deepgramErrorHandler = new DeepgramErrorHandler();