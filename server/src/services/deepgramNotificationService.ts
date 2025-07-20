/**
 * Deepgram Notification Service
 * 
 * Provides admin notifications for Deepgram model compatibility issues.
 * 
 * Requirements addressed:
 * - 2.1: Detailed error logging with error codes and messages
 * - 2.2: Specific guidance for permission errors
 * - 2.3: Admin notifications for model compatibility problems
 */

import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';
import logger from '../utils/logger';
import { 
  DeepgramErrorType, 
  DeepgramAccountTier,
  DEEPGRAM_MODEL_REGISTRY
} from '../types/deepgram';

/**
 * Notification context for model events
 */
export interface ModelNotificationContext {
  requestId?: string;
  source?: string;
  operation?: string;
  timestamp?: string;
  additionalInfo?: Record<string, any>;
}

/**
 * Deepgram notification service for model compatibility issues
 */
export class DeepgramNotificationService {
  /**
   * Create admin notification for model validation failure
   */
  public static notifyModelValidationFailure(
    model: string,
    errorType: DeepgramErrorType,
    errorMessage: string,
    suggestedAlternatives: string[],
    context?: ModelNotificationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
    const alertLevel = this.getAlertLevelForErrorType(errorType);
    
    let alertTitle = `Model validation failed: ${model}`;
    if (errorType === DeepgramErrorType.AUTHENTICATION_ERROR) {
      alertTitle = 'CRITICAL: Deepgram authentication failure';
    } else if (errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      alertTitle = `Model permission denied: ${model}`;
    }
    
    alertSystem.createAlert(
      alertLevel,
      'deepgram-model-compatibility' as AlertType,
      alertTitle,
      {
        model,
        modelTier: modelInfo?.tier || 'unknown',
        errorType,
        errorMessage,
        suggestedAlternatives,
        guidance: this.getErrorGuidance(errorType),
        actionRequired: this.getActionRequired(errorType),
        timestamp: context?.timestamp || new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'deepgram-notification-service',
        operation: context?.operation || 'model-validation',
        ...context?.additionalInfo
      },
      context?.source || 'deepgram-notification-service'
    );
    
    // Log notification creation
    logger.info(`Created admin notification for model validation failure: ${model}`, {
      model,
      errorType,
      alertLevel,
      requestId: context?.requestId,
      context: 'model-validation-notification'
    });
  }

  /**
   * Create admin notification for model fallback event
   */
  public static notifyModelFallback(
    originalModel: string,
    fallbackModel: string,
    errorType: DeepgramErrorType,
    errorMessage: string,
    context?: ModelNotificationContext
  ): void {
    const originalModelInfo = DEEPGRAM_MODEL_REGISTRY.models[originalModel];
    const fallbackModelInfo = DEEPGRAM_MODEL_REGISTRY.models[fallbackModel];
    const originalTier = originalModelInfo?.tier || 'unknown';
    const fallbackTier = fallbackModelInfo?.tier || 'unknown';
    
    // Determine alert level based on tier change
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
        timestamp: context?.timestamp || new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'deepgram-notification-service',
        operation: context?.operation || 'model-fallback',
        ...context?.additionalInfo
      },
      context?.source || 'deepgram-notification-service'
    );
    
    // Log notification creation
    logger.info(`Created admin notification for model fallback: ${originalModel} → ${fallbackModel}`, {
      originalModel,
      fallbackModel,
      errorType,
      alertLevel,
      requestId: context?.requestId,
      context: 'model-fallback-notification'
    });
  }

  /**
   * Create admin notification for account capability detection
   */
  public static notifyAccountCapabilities(
    tier: DeepgramAccountTier,
    availableModels: string[],
    features: Record<string, boolean>,
    context?: ModelNotificationContext
  ): void {
    // Only create alerts for free tier or limited model access
    if (tier !== 'free' && availableModels.length > 1) {
      return;
    }
    
    const alertLevel = tier === 'free' ? AlertLevel.INFO : AlertLevel.WARNING;
    const alertTitle = tier === 'free' 
      ? 'Deepgram free tier detected - Limited model access'
      : `Limited Deepgram model access (${availableModels.length} models available)`;
    
    alertSystem.createAlert(
      alertLevel,
      'deepgram-account-tier' as AlertType,
      alertTitle,
      {
        tier,
        availableModels,
        modelCount: availableModels.length,
        features,
        recommendation: 'Consider upgrading to access premium models and higher limits',
        impact: tier === 'free'
          ? 'Limited to base models with reduced features'
          : 'Reduced service resilience due to limited model options',
        timestamp: context?.timestamp || new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'deepgram-notification-service',
        operation: context?.operation || 'account-capability-detection',
        ...context?.additionalInfo
      },
      context?.source || 'deepgram-notification-service'
    );
    
    // Log notification creation
    logger.info(`Created admin notification for account capabilities: ${tier} tier`, {
      tier,
      modelCount: availableModels.length,
      alertLevel,
      requestId: context?.requestId,
      context: 'account-capability-notification'
    });
  }

  /**
   * Create admin notification for configuration validation issues
   */
  public static notifyConfigValidationIssues(
    config: any,
    issues: any[],
    recommendations: any[],
    context?: ModelNotificationContext
  ): void {
    // Only create alerts if there are actual errors (not just warnings)
    const hasErrors = issues.some(issue => issue.type === 'error');
    if (!hasErrors) {
      return;
    }
    
    alertSystem.createAlert(
      AlertLevel.WARNING,
      'deepgram-config-validation' as AlertType,
      'Deepgram configuration validation failed',
      {
        primaryModel: config.primaryModel,
        fallbackModels: config.fallbackModels,
        accountTier: config.accountTier,
        issueCount: issues.length,
        errorCount: issues.filter(issue => issue.type === 'error').length,
        warningCount: issues.filter(issue => issue.type === 'warning').length,
        issues: issues.map(issue => ({
          type: issue.type,
          field: issue.field,
          message: issue.message
        })),
        recommendations: recommendations.slice(0, 3).map(rec => ({
          field: rec.field,
          currentValue: rec.currentValue,
          recommendedValue: rec.recommendedValue
        })),
        actionRequired: 'Configuration must be fixed before saving',
        timestamp: context?.timestamp || new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'deepgram-notification-service',
        operation: context?.operation || 'config-validation',
        ...context?.additionalInfo
      },
      context?.source || 'deepgram-notification-service'
    );
    
    // Log notification creation
    logger.info(`Created admin notification for configuration validation issues`, {
      primaryModel: config.primaryModel,
      issueCount: issues.length,
      errorCount: issues.filter(issue => issue.type === 'error').length,
      requestId: context?.requestId,
      context: 'config-validation-notification'
    });
  }

  /**
   * Create critical alert for service failure
   */
  public static notifyServiceFailure(
    errorType: DeepgramErrorType,
    errorMessage: string,
    affectedModels: string[],
    context?: ModelNotificationContext
  ): void {
    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'deepgram-service-failure' as AlertType,
      'CRITICAL: Deepgram transcription service failure',
      {
        errorType,
        errorMessage,
        affectedModels,
        impact: 'Voice transcription services are currently unavailable',
        urgency: 'Critical - immediate attention required',
        actionRequired: 'Investigate and resolve underlying API access issues',
        timestamp: context?.timestamp || new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'deepgram-notification-service',
        operation: context?.operation || 'service-failure',
        ...context?.additionalInfo
      },
      context?.source || 'deepgram-notification-service'
    );
    
    // Log notification creation
    logger.error(`Created critical alert for Deepgram service failure`, {
      errorType,
      errorMessage,
      affectedModels,
      requestId: context?.requestId,
      context: 'service-failure-notification'
    });
  }

  /**
   * Create notification for service recovery
   */
  public static notifyServiceRecovery(
    recoveredModel: string,
    previousErrorType: DeepgramErrorType,
    attemptCount: number,
    context?: ModelNotificationContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[recoveredModel];
    
    alertSystem.createAlert(
      AlertLevel.INFO,
      'deepgram-service-recovery' as AlertType,
      `Deepgram service recovered using model: ${recoveredModel}`,
      {
        recoveredModel,
        modelTier: modelInfo?.tier || 'unknown',
        previousErrorType,
        attemptCount,
        message: `Service has recovered after ${attemptCount} attempts and is functioning normally`,
        timestamp: context?.timestamp || new Date().toISOString(),
        requestId: context?.requestId,
        source: context?.source || 'deepgram-notification-service',
        operation: context?.operation || 'service-recovery',
        ...context?.additionalInfo
      },
      context?.source || 'deepgram-notification-service'
    );
    
    // Log notification creation
    logger.info(`Created notification for Deepgram service recovery`, {
      recoveredModel,
      previousErrorType,
      attemptCount,
      requestId: context?.requestId,
      context: 'service-recovery-notification'
    });
  }

  /**
   * Get alert level based on error type
   */
  private static getAlertLevelForErrorType(errorType: DeepgramErrorType): AlertLevel {
    switch (errorType) {
      case DeepgramErrorType.AUTHENTICATION_ERROR:
        return AlertLevel.CRITICAL;
      case DeepgramErrorType.INSUFFICIENT_PERMISSIONS:
      case DeepgramErrorType.QUOTA_EXCEEDED:
        return AlertLevel.WARNING;
      case DeepgramErrorType.INVALID_MODEL:
        return AlertLevel.WARNING;
      default:
        return AlertLevel.INFO;
    }
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

export default DeepgramNotificationService;