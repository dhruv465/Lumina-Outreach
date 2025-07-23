/**
 * modelCompatibilityDiagnostic.ts
 * Tool for diagnosing model compatibility issues and generating reports
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { DeepgramModelMetrics } from '../monitoring/deepgramModelMetrics';
import { ModelCompatibilityService, AccountTier, DeepgramErrorType } from '../services/modelCompatibilityService';
import logger from '../utils/logger';
import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';

const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

interface DiagnosticResult {
  timestamp: string;
  accountTier: AccountTier;
  availableModels: string[];
  validationResults: {
    model: string;
    isAvailable: boolean;
    validationTime: number;
    error?: {
      type: DeepgramErrorType;
      message: string;
    };
  }[];
  recommendedConfiguration: {
    primaryModel: string;
    fallbackModels: string[];
    isOptimal: boolean;
    recommendations: string[];
  };
  overallStatus: 'healthy' | 'degraded' | 'critical';
  issues: {
    description: string;
    severity: 'low' | 'medium' | 'high';
    recommendation: string;
  }[];
}

/**
 * Run a comprehensive diagnostic check for model compatibility
 */
export async function runModelCompatibilityDiagnostic(
  modelCompatibilityService: ModelCompatibilityService
): Promise<DiagnosticResult> {
  const start = Date.now();
  const metrics = DeepgramModelMetrics.getInstance();
  logger.info('Starting model compatibility diagnostic check');
  
  try {
    // Get account capabilities which includes tier and available models
    const apiKey = process.env.DEEPGRAM_API_KEY || '';
    const accountCapabilities = await modelCompatibilityService.getAccountCapabilities(apiKey);
    const availableModels = await modelCompatibilityService.getCompatibleModels(apiKey);
    
    // Validate all available models
    const validationResults = [];
    const issues = [];
    
    for (const model of availableModels) {
      try {
        const validationStart = Date.now();
        const validationResult = await modelCompatibilityService.validateModelAccess(apiKey, model);
        const validationTime = Date.now() - validationStart;
        
        validationResults.push({
          model,
          isAvailable: validationResult.isValid,
          validationTime,
          error: validationResult.error
        });
        
        // Record validation in metrics
        metrics.recordModelValidation(model, validationResult.isValid, validationTime);
        
        if (!validationResult.isValid) {
          issues.push({
            description: `Model ${model} is configured but not available for use`,
            severity: 'medium',
            recommendation: `Check account permissions or use a different model`
          });
        }
      } catch (error) {
        // Simple error classification using proper enum values
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType: DeepgramErrorType = errorMessage.includes('unauthorized') || errorMessage.includes('authentication') ? DeepgramErrorType.AUTHENTICATION_ERROR : 
                         errorMessage.includes('not found') || errorMessage.includes('invalid') ? DeepgramErrorType.INVALID_MODEL : 
                         errorMessage.includes('quota') || errorMessage.includes('limit') ? DeepgramErrorType.QUOTA_EXCEEDED :
                         errorMessage.includes('network') || errorMessage.includes('connection') ? DeepgramErrorType.NETWORK_ERROR :
                         DeepgramErrorType.NETWORK_ERROR; // Default fallback
        
        validationResults.push({
          model,
          isAvailable: false,
          validationTime: Date.now() - start,
          error: {
            type: errorType,
            message: errorMessage
          }
        });
        
        // Record validation failure in metrics
        metrics.recordModelValidation(model, false, Date.now() - start, errorType);
        
        issues.push({
          description: `Error validating model ${model}: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'high',
          recommendation: `Check model configuration and API credentials`
        });
      }
    }
    
    // Get current configuration - use a simplified approach since getCurrentConfiguration doesn't exist
    const modelRegistry = modelCompatibilityService.getModelRegistry();
    const primaryModel = 'nova-2-general'; // Default model
    const fallbackModels = ['nova-general', 'base']; // Default fallbacks
    
    const primaryModelValid = validationResults.find(r => r.model === primaryModel)?.isAvailable || false;
    const fallbackModelsValid = fallbackModels.every(model => 
      validationResults.find(r => r.model === model)?.isAvailable || false
    );
    
    const isOptimal = primaryModelValid && fallbackModelsValid;
    
    // Generate recommendations
    const recommendations = [];
    
    if (!primaryModelValid) {
      const validModels = validationResults.filter(r => r.isAvailable).map(r => r.model);
      if (validModels.length > 0) {
        recommendations.push(`Primary model ${primaryModel} is not available. Consider using ${validModels[0]} instead.`);
      } else {
        recommendations.push(`Primary model ${primaryModel} is not available and no valid alternatives were found. Check account settings.`);
      }
    }
    
    if (fallbackModels.length === 0) {
      recommendations.push('No fallback models configured. Consider adding fallback models for better reliability.');
    } else if (!fallbackModelsValid) {
      const invalidFallbacks = fallbackModels.filter(model => 
        !validationResults.find(r => r.model === model)?.isAvailable
      );
      recommendations.push(`Some fallback models are not available: ${invalidFallbacks.join(', ')}. Consider removing or replacing them.`);
    }
    
    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    if (!primaryModelValid) {
      overallStatus = 'critical';
      issues.push({
        description: 'Primary model is not available',
        severity: 'high',
        recommendation: 'Configure an available model as the primary model'
      });
    } else if (!fallbackModelsValid || fallbackModels.length === 0) {
      overallStatus = 'degraded';
      issues.push({
        description: 'Fallback models are missing or invalid',
        severity: 'medium',
        recommendation: 'Configure valid fallback models for better reliability'
      });
    }
    
    // Generate diagnostic result
    const result: DiagnosticResult = {
      timestamp: new Date().toISOString(),
      accountTier: accountCapabilities.tier,
      availableModels,
      validationResults,
      recommendedConfiguration: {
        primaryModel: primaryModelValid ? primaryModel : validationResults.find(r => r.isAvailable)?.model || primaryModel,
        fallbackModels: fallbackModels.filter(model => 
          validationResults.find(r => r.model === model)?.isAvailable || false
        ),
        isOptimal,
        recommendations
      },
      overallStatus,
      issues
    };
    
    // Save diagnostic result
    await saveDiagnosticResult(result);
    
    // Create alert if there are critical issues
    if (overallStatus !== 'healthy') {
      const alertLevel = overallStatus === 'critical' ? AlertLevel.CRITICAL : AlertLevel.WARNING;
      const alertMessage = `Model compatibility diagnostic found ${issues.length} issues (Status: ${overallStatus})`;
      
      alertSystem.createAlert(
        alertLevel,
        'model-compatibility-diagnostic' as AlertType,
        alertMessage,
        {
          overallStatus,
          issueCount: issues.length,
          primaryModelValid,
          fallbackModelsValid,
          accountTier: accountCapabilities.tier,
          recommendations,
          timestamp: result.timestamp
        },
        'model-diagnostic'
      );
    }
    
    logger.info('Model compatibility diagnostic completed', {
      duration: Date.now() - start,
      overallStatus,
      issueCount: issues.length,
      accountTier: accountCapabilities.tier,
      context: 'model-diagnostic-complete'
    });
    
    return result;
  } catch (error) {
    logger.error('Error running model compatibility diagnostic:', error);
    
    // Create alert for diagnostic failure
    alertSystem.createAlert(
      AlertLevel.CRITICAL,
      'model-diagnostic-failure' as AlertType,
      'Failed to complete model compatibility diagnostic',
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      },
      'model-diagnostic'
    );
    
    throw error;
  }
}

/**
 * Save diagnostic result to file
 */
async function saveDiagnosticResult(result: DiagnosticResult): Promise<void> {
  try {
    const diagnosticsDir = path.resolve(process.cwd(), 'metrics/diagnostics');
    
    // Ensure directory exists
    if (!fs.existsSync(diagnosticsDir)) {
      await mkdirAsync(diagnosticsDir, { recursive: true });
    }
    
    const timestamp = new Date();
    const fileName = `model_diagnostic_${timestamp.getFullYear()}-${(timestamp.getMonth() + 1).toString().padStart(2, '0')}-${timestamp.getDate().toString().padStart(2, '0')}_${timestamp.getHours().toString().padStart(2, '0')}-${timestamp.getMinutes().toString().padStart(2, '0')}.json`;
    const filePath = path.join(diagnosticsDir, fileName);
    
    await writeFileAsync(filePath, JSON.stringify(result, null, 2));
    
    logger.info(`Model diagnostic result saved to ${filePath}`);
  } catch (error) {
    logger.error('Error saving diagnostic result:', error);
  }
}
