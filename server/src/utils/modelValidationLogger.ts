/**
 * Model Validation Logger
 * 
 * Provides detailed logging utilities for Deepgram model validation and fallback events.
 * 
 * Requirements addressed:
 * - 2.1: Detailed error logging with error codes and messages
 * - 2.2: Specific guidance for permission errors
 * - 2.3: Model validation failure suggestions
 */

import logger from './logger';
import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';
import { 
  DeepgramErrorType, 
  DeepgramAccountTier,
  DEEPGRAM_MODEL_REGISTRY
} from '../types/deepgram';

/**
 * Log levels for model validation events
 */
export enum ModelValidationLogLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  DEBUG = 'debug'
}

/**
 * Model validation event types
 */
export enum ModelValidationEventType {
  VALIDATION_START = 'validation-start',
  VALIDATION_SUCCESS = 'validation-success',
  VALIDATION_FAILURE = 'validation-failure',
  FALLBACK_INITIATED = 'fallback-initiated',
  FALLBACK_SUCCESS = 'fallback-success',
  FALLBACK_FAILURE = 'fallback-failure',
  ACCOUNT_CAPABILITY_DETECTED = 'account-capability-detected',
  CONFIG_VALIDATION = 'config-validation'
}

/**
 * Model validation context
 */
export interface ModelValidationContext {
  requestId?: string;
  source?: string;
  operation?: string;
  duration?: number;
  additionalInfo?: Record<string, any>;
}

/**
 * Model validation logger class
 */
export class ModelValidationLogger {
  /**
   * Log model validation start
   */
  public static logValidationStart(
    model: string,
    apiKeyHash: string,
    context?: ModelValidationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
    
    logger.info('Deepgram model validation started', {
      model,
      modelTier: modelInfo?.tier || 'unknown',
      apiKeyHash,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'validate-model',
      eventType: ModelValidationEventType.VALIDATION_START,
      ...context?.additionalInfo
    });
  }

  /**
   * Log model validation success
   */
  public static logValidationSuccess(
    model: string,
    accountTier: DeepgramAccountTier | undefined,
    duration: number,
    context?: ModelValidationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
    
    logger.info('Deepgram model validation successful', {
      model,
      modelTier: modelInfo?.tier || 'unknown',
      accountTier,
      validationDuration: duration,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'validate-model',
      eventType: ModelValidationEventType.VALIDATION_SUCCESS,
      features: modelInfo?.features || [],
      ...context?.additionalInfo
    });
  }

  /**
   * Log model validation failure with detailed error information
   */
  public static logValidationFailure(
    model: string,
    error: any,
    suggestedAlternatives: string[],
    duration: number,
    context?: ModelValidationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
    const errorType = this.classifyError(error);
    const errorMessage = this.getErrorMessage(error);
    
    logger.warn('Deepgram model validation failed', {
      model,
      modelTier: modelInfo?.tier || 'unknown',
      errorType,
      errorMessage,
      errorCode: error?.code || error?.status || error?.statusCode,
      suggestedAlternatives,
      validationDuration: duration,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'validate-model',
      eventType: ModelValidationEventType.VALIDATION_FAILURE,
      guidance: this.getErrorGuidance(errorType),
      ...context?.additionalInfo
    });

    // Create admin alert for validation failures
    this.createModelValidationAlert(
      model, 
      errorType, 
      errorMessage, 
      suggestedAlternatives,
      context
    );
  }

  /**
   * Log model fallback initiation
   */
  public static logFallbackInitiated(
    currentModel: string,
    error: any,
    availableAlternatives: string[],
    context?: ModelValidationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[currentModel];
    const errorType = this.classifyError(error);
    
    logger.warn('Deepgram model fallback initiated', {
      currentModel,
      currentModelTier: modelInfo?.tier || 'unknown',
      errorType,
      errorMessage: this.getErrorMessage(error),
      errorCode: error?.code || error?.status || error?.statusCode,
      availableAlternatives,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'model-fallback',
      eventType: ModelValidationEventType.FALLBACK_INITIATED,
      ...context?.additionalInfo
    });
  }

  /**
   * Log model fallback success
   */
  public static logFallbackSuccess(
    originalModel: string,
    fallbackModel: string,
    error: any,
    context?: ModelValidationContext
  ): void {
    const originalModelInfo = DEEPGRAM_MODEL_REGISTRY.models[originalModel];
    const fallbackModelInfo = DEEPGRAM_MODEL_REGISTRY.models[fallbackModel];
    const errorType = this.classifyError(error);
    
    const logData = {
      originalModel,
      originalTier: originalModelInfo?.tier || 'unknown',
      fallbackModel,
      fallbackTier: fallbackModelInfo?.tier || 'unknown',
      errorType,
      errorMessage: this.getErrorMessage(error),
      errorCode: error?.code || error?.status || error?.statusCode,
      reason: this.getFallbackReason(errorType),
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'model-fallback',
      eventType: ModelValidationEventType.FALLBACK_SUCCESS,
      serviceImpact: this.getServiceImpact(originalModelInfo?.tier, fallbackModelInfo?.tier),
      ...context?.additionalInfo
    };
    
    logger.info('Deepgram model fallback successful', logData);

    // Create admin alert for model fallback
    this.createModelFallbackAlert(
      originalModel,
      fallbackModel,
      errorType,
      this.getErrorMessage(error),
      context
    );
  }

  /**
   * Log model fallback failure
   */
  public static logFallbackFailure(
    originalModel: string,
    error: any,
    attemptedFallbacks: string[],
    context?: ModelValidationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[originalModel];
    const errorType = this.classifyError(error);
    
    const logData = {
      originalModel,
      originalTier: modelInfo?.tier || 'unknown',
      errorType,
      errorMessage: this.getErrorMessage(error),
      errorCode: error?.code || error?.status || error?.statusCode,
      attemptedFallbacks,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'model-fallback',
      eventType: ModelValidationEventType.FALLBACK_FAILURE,
      impact: 'Service degradation - unable to provide transcription',
      ...context?.additionalInfo
    };
    
    logger.error('Deepgram model fallback failed', logData);

    // Create critical alert for fallback failure
    this.createFallbackFailureAlert(
      originalModel,
      errorType,
      this.getErrorMessage(error),
      attemptedFallbacks,
      context
    );
  }

  /**
   * Log account capability detection
   */
  public static logAccountCapabilityDetection(
    tier: DeepgramAccountTier,
    availableModels: string[],
    features: Record<string, boolean>,
    detectionDuration: number,
    context?: ModelValidationContext
  ): void {
    logger.info('Deepgram account capabilities detected', {
      tier,
      modelCount: availableModels.length,
      availableModels,
      features,
      detectionDuration,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'detect-capabilities',
      eventType: ModelValidationEventType.ACCOUNT_CAPABILITY_DETECTED,
      ...context?.additionalInfo
    });

    // Create alert if account has limited capabilities
    if (tier === 'free' || availableModels.length <= 1) {
      this.createAccountCapabilityAlert(tier, availableModels, features);
    }
  }

  /**
   * Log configuration validation results
   */
  public static logConfigValidation(
    isValid: boolean,
    config: any,
    issues: any[],
    recommendations: any[],
    context?: ModelValidationContext
  ): void {
    const logLevel = isValid ? ModelValidationLogLevel.INFO : ModelValidationLogLevel.WARNING;
    const logMethod = logLevel === ModelValidationLogLevel.INFO ? logger.info : logger.warn;
    
    logMethod('Deepgram configuration validation', {
      isValid,
      primaryModel: config.primaryModel,
      fallbackModels: config.fallbackModels,
      accountTier: config.accountTier,
      issueCount: issues.length,
      recommendationCount: recommendations.length,
      timestamp: new Date().toISOString(),
      requestId: context?.requestId,
      source: context?.source || 'model-validation-logger',
      operation: context?.operation || 'validate-config',
      eventType: ModelValidationEventType.CONFIG_VALIDATION,
      ...context?.additionalInfo
    });

    // Log each issue separately for better visibility
    if (issues.length > 0) {
      issues.forEach((issue, index) => {
        logger.warn(`Deepgram config issue #${index + 1}`, {
          ...issue,
          timestamp: new Date().toISOString(),
          requestId: context?.requestId,
          source: context?.source || 'model-validation-logger'
        });
      });

      // Create alert for configuration issues
      this.createConfigValidationAlert(config, issues, recommendations);
    }
  }

  /**
   * Create admin alert for model validation failures
   */
  private static createModelValidationAlert(
    model: string,
    errorType: DeepgramErrorType,
    errorMessage: string,
    suggestedAlternatives: string[],
    context?: ModelValidationContext
  ): void {
    // Determine alert level based on error type
    let alertLevel = AlertLevel.INFO;
    let alertTitle = `Deepgram model validation issue: ${model}`;
    
    if (errorType === DeepgramErrorType.AUTHENTICATION_ERROR) {
      alertLevel = AlertLevel.CRITICAL;
      alertTitle = 'CRITICAL: Deepgram authentication failure';
    } else if (errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      alertLevel = AlertLevel.WARNING;
      alertTitle = `Model permission denied: ${model}`;
    }

    // Create alert with detailed information
    alertSystem.createAlert(
      alertLevel,
      'deepgram-model-compatibility' as AlertType,
      alertTitle,
      {
        model,
        modelTier: DEEPGRAM_MODEL_REGISTRY.models[model]?.tier || 'unknown',
        errorType,
        errorMessage,
        suggestedAlternatives,
        guidance: this.getErrorGuidance(errorType),
        actionRequired: this.getActionRequired(errorType),
        timestamp: new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'model-validation-logger'
      },
      context?.source || 'model-validation-logger'
    );
  }

  /**
   * Create admin alert for model fallback events
   */
  private static createModelFallbackAlert(
    originalModel: string,
    fallbackModel: string,
    errorType: DeepgramErrorType,
    errorMessage: string,
    context?: ModelValidationContext
  ): void {
    const originalTier = DEEPGRAM_MODEL_REGISTRY.models[originalModel]?.tier || 'unknown';
    const fallbackTier = DEEPGRAM_MODEL_REGISTRY.models[fallbackModel]?.tier || 'unknown';
    const isTierDowngrade = originalTier !== fallbackTier;
    
    const alertLevel = isTierDowngrade ? AlertLevel.WARNING : AlertLevel.INFO;
    
    alertSystem.createAlert(
      alertLevel,
      'deepgram-model-fallback' as AlertType,
      `Model fallback: ${originalModel} → ${fallbackModel}`,
      {
        originalModel,
        originalTier,
        fallbackModel,
        fallbackTier,
        errorType,
        errorMessage,
        reason: this.getFallbackReason(errorType),
        serviceImpact: this.getServiceImpact(
          originalTier === 'unknown' ? undefined : originalTier, 
          fallbackTier === 'unknown' ? undefined : fallbackTier
        ),
        recommendation: isTierDowngrade 
          ? 'Consider upgrading Deepgram account to restore premium model access'
          : 'Monitor service performance with fallback model',
        timestamp: new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'model-validation-logger'
      },
      context?.source || 'model-validation-logger'
    );
  }

  /**
   * Create critical alert for fallback failure
   */
  private static createFallbackFailureAlert(
    originalModel: string,
    errorType: DeepgramErrorType,
    errorMessage: string,
    attemptedFallbacks: string[],
    context?: ModelValidationContext
  ): void {
    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'deepgram-service-failure' as AlertType,
      'Deepgram transcription service failure - All fallbacks failed',
      {
        originalModel,
        originalTier: DEEPGRAM_MODEL_REGISTRY.models[originalModel]?.tier || 'unknown',
        errorType,
        errorMessage,
        attemptedFallbacks,
        impact: 'Voice transcription services are currently unavailable',
        urgency: 'Critical - immediate attention required',
        actionRequired: 'Investigate and resolve underlying API access issues',
        timestamp: new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'model-validation-logger'
      },
      context?.source || 'model-validation-logger'
    );
  }

  /**
   * Create alert for account capability limitations
   */
  private static createAccountCapabilityAlert(
    tier: DeepgramAccountTier,
    availableModels: string[],
    features: Record<string, boolean>
  ): void {
    // Create info alert for free tier accounts
    if (tier === 'free') {
      alertSystem.createAlert(
        AlertLevel.INFO,
        'deepgram-account-tier' as AlertType,
        'Deepgram free tier detected - Limited model access',
        {
          tier,
          availableModels,
          modelCount: availableModels.length,
          features,
          recommendation: 'Consider upgrading to access premium models and higher limits',
          impact: 'Limited to base models with reduced features',
          timestamp: new Date().toISOString()
        },
        'model-validation-logger'
      );
    }

    // Create warning if very few models are available
    if (availableModels.length <= 1) {
      alertSystem.createAlert(
        AlertLevel.WARNING,
        'deepgram-limited-models' as AlertType,
        `Very limited model access detected (${availableModels.length} models available)`,
        {
          tier,
          availableModels,
          modelCount: availableModels.length,
          concern: 'Limited fallback options available',
          recommendation: 'Verify account status and consider upgrading for better reliability',
          impact: 'Reduced service resilience due to limited model options',
          timestamp: new Date().toISOString()
        },
        'model-validation-logger'
      );
    }
  }

  /**
   * Create alert for configuration validation issues
   */
  private static createConfigValidationAlert(
    config: any,
    issues: any[],
    recommendations: any[]
  ): void {
    // Determine severity based on issue types
    const hasErrors = issues.some(issue => issue.type === 'error');
    const alertLevel = hasErrors ? AlertLevel.WARNING : AlertLevel.INFO;
    
    alertSystem.createAlert(
      alertLevel,
      'deepgram-config-validation' as AlertType,
      `Deepgram configuration validation ${hasErrors ? 'failed' : 'has warnings'}`,
      {
        primaryModel: config.primaryModel,
        fallbackModels: config.fallbackModels,
        accountTier: config.accountTier,
        issueCount: issues.length,
        issues: issues.map(issue => ({
          type: issue.type,
          field: issue.field,
          message: issue.message
        })),
        recommendations: recommendations.map(rec => ({
          field: rec.field,
          currentValue: rec.currentValue,
          recommendedValue: rec.recommendedValue
        })),
        actionRequired: hasErrors 
          ? 'Configuration must be fixed before saving'
          : 'Consider applying recommendations for optimal performance',
        timestamp: new Date().toISOString()
      },
      'model-validation-logger'
    );
  }

  /**
   * Classify error type
   */
  private static classifyError(error: any): DeepgramErrorType {
    const errorMessage = this.getErrorMessage(error).toLowerCase();
    const statusCode = error?.status || error?.statusCode || error?.response?.status;

    if (statusCode === 401 || errorMessage.includes('unauthorized') || errorMessage.includes('invalid api key')) {
      return DeepgramErrorType.AUTHENTICATION_ERROR;
    }

    if (statusCode === 403 || errorMessage.includes('permission') || errorMessage.includes('forbidden')) {
      return DeepgramErrorType.INSUFFICIENT_PERMISSIONS;
    }

    if (errorMessage.includes('invalid model') || errorMessage.includes('model not found')) {
      return DeepgramErrorType.INVALID_MODEL;
    }

    if (statusCode === 429 || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
      return DeepgramErrorType.QUOTA_EXCEEDED;
    }

    return DeepgramErrorType.NETWORK_ERROR;
  }

  /**
   * Get error message from various error types
   */
  private static getErrorMessage(error: any): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error?.response?.data?.message) {
      return error.response.data.message;
    }
    if (error?.response?.data?.error) {
      return error.response.data.error;
    }
    if (error?.message) {
      return error.message;
    }
    return 'Unknown error occurred';
  }

  /**
   * Get guidance based on error type
   */
  private static getErrorGuidance(errorType: DeepgramErrorType): string {
    switch (errorType) {
      case DeepgramErrorType.INSUFFICIENT_PERMISSIONS:
        return 'Use a compatible model or upgrade account tier';
      case DeepgramErrorType.INVALID_MODEL:
        return 'Update configuration to use a valid model';
      case DeepgramErrorType.QUOTA_EXCEEDED:
        return 'Wait for quota reset or upgrade plan';
      case DeepgramErrorType.AUTHENTICATION_ERROR:
        return 'Verify API key and account status';
      default:
        return 'Check network connection and Deepgram service status';
    }
  }

  /**
   * Get required action based on error type
   */
  private static getActionRequired(errorType: DeepgramErrorType): string {
    switch (errorType) {
      case DeepgramErrorType.AUTHENTICATION_ERROR:
        return 'Immediate attention required - API key issue';
      case DeepgramErrorType.INSUFFICIENT_PERMISSIONS:
        return 'Update configuration or upgrade account';
      case DeepgramErrorType.INVALID_MODEL:
        return 'Update model configuration';
      case DeepgramErrorType.QUOTA_EXCEEDED:
        return 'Monitor usage and consider rate limiting';
      default:
        return 'Monitor for recurring issues';
    }
  }

  /**
   * Get reason for model fallback based on error type
   */
  private static getFallbackReason(errorType: DeepgramErrorType): string {
    switch (errorType) {
      case DeepgramErrorType.INSUFFICIENT_PERMISSIONS:
        return 'Account does not have permission to use the requested model';
      case DeepgramErrorType.INVALID_MODEL:
        return 'The requested model is invalid or not found';
      case DeepgramErrorType.QUOTA_EXCEEDED:
        return 'Account has exceeded usage quota or rate limits';
      case DeepgramErrorType.AUTHENTICATION_ERROR:
        return 'Authentication failed with the Deepgram API';
      default:
        return 'Network or service error';
    }
  }

  /**
   * Get service impact description based on model tier change
   */
  private static getServiceImpact(originalTier?: DeepgramAccountTier, fallbackTier?: DeepgramAccountTier): string {
    if (!originalTier || !fallbackTier) {
      return 'Unknown impact on service quality';
    }
    
    if (originalTier === fallbackTier) {
      return 'Minimal impact expected - same tier model';
    }
    
    if (originalTier === 'premium' && fallbackTier === 'basic') {
      return 'Moderate impact - reduced accuracy and features';
    }
    
    if (originalTier === 'premium' && fallbackTier === 'free') {
      return 'Significant impact - substantially reduced accuracy and features';
    }
    
    if (originalTier === 'basic' && fallbackTier === 'free') {
      return 'Noticeable impact - reduced accuracy and language support';
    }
    
    return 'Service quality may be affected';
  }
}

export default ModelValidationLogger;