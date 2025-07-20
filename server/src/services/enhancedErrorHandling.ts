/**
 * Enhanced Error Handling and Logging for Deepgram Model Compatibility
 * 
 * This module provides improved error messages, detailed logging, and admin notifications
 * for Deepgram model compatibility issues.
 * 
 * Requirements addressed:
 * - 2.1: Detailed error logging with error codes and messages
 * - 2.2: Specific guidance for permission errors and model suggestions
 * - 2.3: Model validation failure suggestions
 */

import logger from '../utils/logger';
import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';
import { 
  DeepgramErrorType, 
  DeepgramAccountTier, 
  DEEPGRAM_MODEL_REGISTRY 
} from '../types/deepgram';

/**
 * Enhanced error details interface
 */
export interface EnhancedErrorDetails {
  errorCode?: string | number;
  errorMessage: string;
  errorType: DeepgramErrorType;
  modelName?: string;
  accountTier?: DeepgramAccountTier;
  suggestedModels?: string[];
  context?: string;
  timestamp: string;
  source?: string;
  requestId?: string;
  additionalInfo?: Record<string, any>;
}

/**
 * Model compatibility error context
 */
export interface ModelErrorContext {
  modelName: string;
  accountTier?: DeepgramAccountTier;
  operation: string;
  requestId?: string;
  source?: string;
}

/**
 * Enhanced error handling service for model compatibility issues
 */
export class EnhancedErrorHandlingService {
  /**
   * Log detailed model validation error with enhanced context
   */
  public logModelValidationError(
    error: any, 
    context: ModelErrorContext
  ): void {
    const errorType = this.classifyModelError(error);
    const errorDetails: EnhancedErrorDetails = {
      errorCode: error?.code || error?.status || error?.statusCode,
      errorMessage: this.getErrorMessage(error),
      errorType,
      modelName: context.modelName,
      accountTier: context.accountTier,
      suggestedModels: this.getSuggestedModels(context.modelName, errorType),
      context: 'model-validation-error',
      timestamp: new Date().toISOString(),
      source: context.source || 'model-compatibility-service',
      requestId: context.requestId,
      additionalInfo: {
        operation: context.operation,
        modelTier: DEEPGRAM_MODEL_REGISTRY.models[context.modelName]?.tier || 'unknown'
      }
    };

    // Log with appropriate level based on error type
    if (errorType === DeepgramErrorType.AUTHENTICATION_ERROR) {
      logger.error('Deepgram authentication error during model validation', errorDetails);
    } else if (errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      logger.warn('Deepgram permission error during model validation', errorDetails);
    } else {
      logger.info('Deepgram model validation error', errorDetails);
    }

    // Create admin notification
    this.createModelValidationAlert(errorDetails);
  }

  /**
   * Log model fallback event with detailed context
   */
  public logModelFallbackEvent(
    originalModel: string,
    fallbackModel: string,
    error: any,
    context: ModelErrorContext
  ): void {
    const errorType = this.classifyModelError(error);
    const originalModelInfo = DEEPGRAM_MODEL_REGISTRY.models[originalModel];
    const fallbackModelInfo = DEEPGRAM_MODEL_REGISTRY.models[fallbackModel];
    
    const fallbackDetails = {
      originalModel,
      originalModelTier: originalModelInfo?.tier || 'unknown',
      fallbackModel,
      fallbackModelTier: fallbackModelInfo?.tier || 'unknown',
      errorType,
      errorMessage: this.getErrorMessage(error),
      errorCode: error?.code || error?.status || error?.statusCode,
      reason: this.getFallbackReason(errorType),
      accountTier: context.accountTier,
      operation: context.operation,
      context: 'model-fallback-event',
      timestamp: new Date().toISOString(),
      source: context.source || 'model-compatibility-service',
      requestId: context.requestId,
      serviceImpact: this.getServiceImpact(originalModelInfo?.tier, fallbackModelInfo?.tier)
    };

    // Log fallback event
    logger.warn('Deepgram model fallback occurred', fallbackDetails);

    // Create admin notification for fallback
    this.createModelFallbackAlert(fallbackDetails);
  }

  /**
   * Log successful model validation with detailed context
   */
  public logModelValidationSuccess(
    model: string,
    accountTier: DeepgramAccountTier | undefined,
    validationDuration: number,
    context: ModelErrorContext
  ): void {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
    
    const successDetails = {
      model,
      modelTier: modelInfo?.tier || 'unknown',
      accountTier,
      validationDuration,
      operation: context.operation,
      context: 'model-validation-success',
      timestamp: new Date().toISOString(),
      source: context.source || 'model-compatibility-service',
      requestId: context.requestId,
      features: modelInfo?.features || []
    };

    // Log success event
    logger.info('Deepgram model validation successful', successDetails);
  }

  /**
   * Generate detailed user-friendly error message with guidance
   */
  public generateDetailedErrorMessage(
    error: any, 
    modelName: string, 
    accountTier?: DeepgramAccountTier
  ): string {
    const errorType = this.classifyModelError(error);
    const errorMessage = this.getErrorMessage(error);
    const suggestedModels = this.getSuggestedModels(modelName, errorType);
    
    switch (errorType) {
      case DeepgramErrorType.INSUFFICIENT_PERMISSIONS:
        return this.generatePermissionErrorGuidance(errorMessage, modelName, suggestedModels, accountTier);
      
      case DeepgramErrorType.INVALID_MODEL:
        return this.generateInvalidModelErrorGuidance(errorMessage, modelName, suggestedModels);
      
      case DeepgramErrorType.AUTHENTICATION_ERROR:
        return this.generateAuthenticationErrorGuidance(errorMessage);
      
      case DeepgramErrorType.QUOTA_EXCEEDED:
        return this.generateQuotaExceededErrorGuidance(errorMessage, accountTier);
      
      default:
        return this.generateGenericErrorGuidance(errorMessage, modelName);
    }
  }

  /**
   * Create admin notification for model validation issues
   */
  private createModelValidationAlert(errorDetails: EnhancedErrorDetails): void {
    // Determine alert level based on error type
    let alertLevel = AlertLevel.INFO;
    let alertTitle = `Deepgram model validation issue: ${errorDetails.modelName}`;
    
    if (errorDetails.errorType === DeepgramErrorType.AUTHENTICATION_ERROR) {
      alertLevel = AlertLevel.CRITICAL;
      alertTitle = 'CRITICAL: Deepgram authentication failure';
    } else if (errorDetails.errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      alertLevel = AlertLevel.WARNING;
      alertTitle = `Model permission denied: ${errorDetails.modelName}`;
    } else if (errorDetails.errorType === DeepgramErrorType.QUOTA_EXCEEDED) {
      alertLevel = AlertLevel.WARNING;
      alertTitle = 'Deepgram quota exceeded';
    }

    // Create alert with detailed information
    alertSystem.createAlert(
      alertLevel,
      'deepgram-model-compatibility' as AlertType,
      alertTitle,
      {
        modelName: errorDetails.modelName,
        errorType: errorDetails.errorType,
        errorMessage: errorDetails.errorMessage,
        errorCode: errorDetails.errorCode,
        suggestedModels: errorDetails.suggestedModels,
        accountTier: errorDetails.accountTier,
        guidance: this.getErrorTypeGuidance(errorDetails.errorType),
        actionRequired: this.getActionRequired(errorDetails.errorType),
        timestamp: errorDetails.timestamp,
        requestId: errorDetails.requestId
      },
      errorDetails.source || 'enhanced-error-handling'
    );
  }

  /**
   * Create admin notification for model fallback events
   */
  private createModelFallbackAlert(fallbackDetails: any): void {
    const isTierDowngrade = fallbackDetails.originalModelTier !== fallbackDetails.fallbackModelTier;
    const alertLevel = isTierDowngrade ? AlertLevel.WARNING : AlertLevel.INFO;
    
    alertSystem.createAlert(
      alertLevel,
      'deepgram-model-fallback' as AlertType,
      `Model fallback: ${fallbackDetails.originalModel} → ${fallbackDetails.fallbackModel}`,
      {
        originalModel: fallbackDetails.originalModel,
        originalTier: fallbackDetails.originalModelTier,
        fallbackModel: fallbackDetails.fallbackModel,
        fallbackTier: fallbackDetails.fallbackModelTier,
        errorType: fallbackDetails.errorType,
        errorMessage: fallbackDetails.errorMessage,
        reason: fallbackDetails.reason,
        serviceImpact: fallbackDetails.serviceImpact,
        accountTier: fallbackDetails.accountTier,
        recommendation: isTierDowngrade 
          ? 'Consider upgrading Deepgram account to restore premium model access'
          : 'Monitor service performance with fallback model',
        timestamp: fallbackDetails.timestamp,
        requestId: fallbackDetails.requestId
      },
      fallbackDetails.source || 'enhanced-error-handling'
    );
  }

  /**
   * Classify error type for model compatibility issues
   */
  private classifyModelError(error: any): DeepgramErrorType {
    const errorMessage = this.getErrorMessage(error).toLowerCase();
    const statusCode = error?.status || error?.statusCode || error?.response?.status;

    // Authentication errors
    if (statusCode === 401 || 
        errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('authentication')) {
      return DeepgramErrorType.AUTHENTICATION_ERROR;
    }

    // Permission errors
    if (statusCode === 403 || 
        errorMessage.includes('permission') || 
        errorMessage.includes('forbidden') ||
        errorMessage.includes('access denied') ||
        errorMessage.includes('insufficient')) {
      return DeepgramErrorType.INSUFFICIENT_PERMISSIONS;
    }

    // Invalid model errors
    if (errorMessage.includes('invalid model') || 
        errorMessage.includes('model not found') ||
        errorMessage.includes('unknown model') ||
        errorMessage.includes('unsupported model')) {
      return DeepgramErrorType.INVALID_MODEL;
    }

    // Quota exceeded errors
    if (statusCode === 429 || 
        errorMessage.includes('quota') || 
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests')) {
      return DeepgramErrorType.QUOTA_EXCEEDED;
    }

    // Default to network error
    return DeepgramErrorType.NETWORK_ERROR;
  }

  /**
   * Get suggested models based on error type and current model
   */
  private getSuggestedModels(currentModel: string, errorType: DeepgramErrorType): string[] {
    const currentModelInfo = DEEPGRAM_MODEL_REGISTRY.models[currentModel];
    
    if (!currentModelInfo) {
      // For unknown models, suggest reliable defaults
      return ['nova', 'base'];
    }
    
    if (errorType === DeepgramErrorType.INSUFFICIENT_PERMISSIONS) {
      // For permission errors, suggest models from lower tiers
      if (currentModelInfo.tier === 'premium') {
        return ['nova', 'nova-general', 'base'];
      } else if (currentModelInfo.tier === 'basic') {
        return ['base', 'base-general'];
      }
      return ['base'];
    }
    
    if (errorType === DeepgramErrorType.INVALID_MODEL) {
      // For invalid model errors, suggest similar models in the same use case
      const useCase = currentModelInfo.useCases[0] || 'general';
      const similarModels = Object.keys(DEEPGRAM_MODEL_REGISTRY.models).filter(model => {
        const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[model];
        return modelInfo.useCases.includes(useCase);
      });
      
      // Sort by tier (premium first, then basic, then free)
      return similarModels.sort((a, b) => {
        const tierOrder = { premium: 0, basic: 1, free: 2 };
        const aTier = DEEPGRAM_MODEL_REGISTRY.models[a]?.tier || 'free';
        const bTier = DEEPGRAM_MODEL_REGISTRY.models[b]?.tier || 'free';
        return tierOrder[aTier] - tierOrder[bTier];
      });
    }
    
    // Default fallback suggestions
    return ['nova', 'base'];
  }

  /**
   * Generate detailed guidance for permission errors
   */
  private generatePermissionErrorGuidance(
    errorMessage: string, 
    modelName: string, 
    suggestedModels: string[],
    accountTier?: DeepgramAccountTier
  ): string {
    const modelInfo = DEEPGRAM_MODEL_REGISTRY.models[modelName];
    const modelTier = modelInfo?.tier || 'unknown';
    
    let guidance = `Permission Error: Unable to access the "${modelName}" model.\n\n`;
    
    guidance += `This error occurs because your Deepgram account (${accountTier || 'current tier'}) `;
    guidance += `does not have permission to use the ${modelTier} tier model "${modelName}".\n\n`;
    
    guidance += "Recommended actions:\n";
    guidance += `1. Try using a compatible model: ${suggestedModels.join(', ')}\n`;
    
    if (modelTier === 'premium') {
      guidance += "2. Upgrade your Deepgram account to access premium models\n";
      guidance += "3. Contact Deepgram support to request access to premium features\n";
    }
    
    guidance += "4. Verify your API key has the necessary permissions\n";
    guidance += "5. Check your account tier and available models at https://console.deepgram.com\n\n";
    
    guidance += "Technical details:\n";
    guidance += `Error message: ${errorMessage}\n`;
    guidance += `Model requested: ${modelName} (${modelTier} tier)\n`;
    guidance += `Account tier: ${accountTier || 'unknown'}\n`;
    
    return guidance;
  }

  /**
   * Generate detailed guidance for invalid model errors
   */
  private generateInvalidModelErrorGuidance(
    errorMessage: string, 
    modelName: string, 
    suggestedModels: string[]
  ): string {
    let guidance = `Invalid Model Error: The model "${modelName}" is not valid or not found.\n\n`;
    
    guidance += "This error occurs when the requested model name is incorrect, deprecated, or not available.\n\n";
    
    guidance += "Recommended actions:\n";
    guidance += `1. Use a supported model: ${suggestedModels.slice(0, 3).join(', ')}\n`;
    guidance += "2. Check the Deepgram documentation for current model names\n";
    guidance += "3. Verify the model name spelling and format\n";
    guidance += "4. Update your configuration to use the latest model versions\n\n";
    
    if (errorMessage.toLowerCase().includes('deprecated')) {
      guidance += "Note: The requested model may have been deprecated by Deepgram. ";
      guidance += "Please update your configuration to use a current model.\n\n";
    }
    
    guidance += "Technical details:\n";
    guidance += `Error message: ${errorMessage}\n`;
    guidance += `Model requested: ${modelName}\n`;
    
    return guidance;
  }

  /**
   * Generate detailed guidance for authentication errors
   */
  private generateAuthenticationErrorGuidance(errorMessage: string): string {
    let guidance = "Authentication Error: Unable to authenticate with Deepgram API.\n\n";
    
    guidance += "This critical error indicates that your API key is invalid, expired, or missing.\n\n";
    
    guidance += "Recommended actions:\n";
    guidance += "1. Verify your API key is correct and active\n";
    guidance += "2. Generate a new API key from https://console.deepgram.com\n";
    guidance += "3. Check if the API key has expired or been revoked\n";
    guidance += "4. Ensure the API key is properly configured in environment variables\n";
    guidance += "5. Verify your account is in good standing\n\n";
    
    guidance += "Technical details:\n";
    guidance += `Error message: ${errorMessage}\n`;
    
    return guidance;
  }

  /**
   * Generate detailed guidance for quota exceeded errors
   */
  private generateQuotaExceededErrorGuidance(
    errorMessage: string,
    accountTier?: DeepgramAccountTier
  ): string {
    let guidance = "Quota Exceeded Error: Deepgram API usage limits reached.\n\n";
    
    guidance += "This error occurs when you've exceeded your account's rate limits or usage quotas.\n\n";
    
    guidance += "Recommended actions:\n";
    guidance += "1. Wait for quota reset (typically hourly or daily)\n";
    guidance += "2. Implement request throttling in your application\n";
    guidance += "3. Monitor your usage at https://console.deepgram.com\n";
    
    if (accountTier === 'free' || accountTier === 'basic') {
      guidance += "4. Upgrade your Deepgram plan for higher limits\n";
    }
    
    guidance += "\nTechnical details:\n";
    guidance += `Error message: ${errorMessage}\n`;
    guidance += `Account tier: ${accountTier || 'unknown'}\n`;
    
    return guidance;
  }

  /**
   * Generate generic error guidance
   */
  private generateGenericErrorGuidance(errorMessage: string, modelName: string): string {
    let guidance = `Deepgram API Error: Issue with model "${modelName}".\n\n`;
    
    guidance += "Recommended actions:\n";
    guidance += "1. Check your network connection\n";
    guidance += "2. Verify Deepgram service status at https://status.deepgram.com\n";
    guidance += "3. Try again with exponential backoff\n";
    guidance += "4. Consider using a different model\n\n";
    
    guidance += "Technical details:\n";
    guidance += `Error message: ${errorMessage}\n`;
    guidance += `Model requested: ${modelName}\n`;
    
    return guidance;
  }

  /**
   * Get error message from various error types
   */
  private getErrorMessage(error: any): string {
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
   * Get reason for model fallback based on error type
   */
  private getFallbackReason(errorType: DeepgramErrorType): string {
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
  private getServiceImpact(originalTier?: DeepgramAccountTier, fallbackTier?: DeepgramAccountTier): string {
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

  /**
   * Get guidance based on error type
   */
  private getErrorTypeGuidance(errorType: DeepgramErrorType): string {
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
  private getActionRequired(errorType: DeepgramErrorType): string {
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
}

// Export singleton instance
export const enhancedErrorHandling = new EnhancedErrorHandlingService();
export default enhancedErrorHandling;