/**
 * Enhanced Deepgram Service with Error Classification and Recovery
 * 
 * This service wraps the existing DeepgramService with automatic error recovery,
 * model fallback, and retry logic with exponential backoff.
 * 
 * Requirements addressed:
 * - 2.1: Detailed error logging and classification
 * - 2.2: Model fallback and recovery strategies  
 * - 2.4: Retry logic with exponential backoff
 */

import { DeepgramService, DeepgramEvent, TranscriptResult } from './deepgramService';
import { deepgramRecoveryService, RecoveryResult } from './deepgramRecoveryService';
import { deepgramErrorHandler } from './deepgramErrorHandler';
import { DeepgramErrorType } from '../types/deepgram';
import { deepgramModelMetrics } from '../monitoring/deepgramModelMetrics';
import { AccountTier } from './modelCompatibilityService';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { EventEmitter } from 'events';

export interface EnhancedTranscriptResult extends TranscriptResult {
  fallbackUsed?: boolean;
  modelUsed?: string;
  recoveryAttempts?: number;
}

/**
 * Enhanced Deepgram Service with automatic error recovery and model fallback
 */
export class DeepgramServiceWithRecovery extends EventEmitter {
  private deepgramService: DeepgramService;
  private defaultModel: string = 'nova-2';

  constructor(apiKey: string) {
    super();
    this.deepgramService = new DeepgramService(apiKey);
    
    // Forward events from the underlying service
    this.deepgramService.on(DeepgramEvent.TRANSCRIPT_RECEIVED, (result) => {
      this.emit(DeepgramEvent.TRANSCRIPT_RECEIVED, result);
    });
    
    this.deepgramService.on(DeepgramEvent.TRANSCRIPT_FINAL, (result) => {
      this.emit(DeepgramEvent.TRANSCRIPT_FINAL, result);
    });
    
    this.deepgramService.on(DeepgramEvent.ERROR, (error) => {
      this.emit(DeepgramEvent.ERROR, error);
    });
    
    this.deepgramService.on(DeepgramEvent.CONNECTION_STATUS, (status) => {
      this.emit(DeepgramEvent.CONNECTION_STATUS, status);
    });
    
    this.deepgramService.on(DeepgramEvent.FALLBACK_USED, (info) => {
      this.emit(DeepgramEvent.FALLBACK_USED, info);
    });

    // Start metrics collection if not already started
    if (!deepgramModelMetrics['reportingInterval']) {
      deepgramModelMetrics.start();
    }

    logger.info('Enhanced Deepgram Service with recovery initialized');
  }

  /**
   * Transcribe audio with automatic error recovery and model fallback
   */
  public async transcribeAudioWithRecovery(
    audioBuffer: Buffer,
    options?: {
      language?: string;
      model?: string;
      detectLanguage?: boolean;
      maxFallbackAttempts?: number;
    }
  ): Promise<EnhancedTranscriptResult> {
    const startTime = Date.now();
    const initialModel = options?.model || this.defaultModel;
    
    logger.info('Starting audio transcription with recovery', {
      model: initialModel,
      audioSize: audioBuffer.length,
      options
    });

    // Create the transcription operation
    const transcriptionOperation = async (model: string) => {
      logger.debug(`Attempting transcription with model: ${model}`);
      
      const result = await this.deepgramService.transcribeAudio(audioBuffer, {
        ...options,
        model
      });
      
      return result;
    };

    // Execute with recovery
    const recoveryResult: RecoveryResult<any> = await deepgramRecoveryService.executeWithRecovery(
      transcriptionOperation,
      initialModel,
      this.deepgramService['apiKey'], // Access private property
      {
        maxFallbackAttempts: options?.maxFallbackAttempts || 3,
        allowTierDowngrade: true,
        preserveFeatures: false // For transcription, we can be flexible with features
      }
    );

    const duration = Date.now() - startTime;

    if (recoveryResult.success && recoveryResult.result) {
      const enhancedResult: EnhancedTranscriptResult = {
        ...recoveryResult.result,
        fallbackUsed: recoveryResult.fallbackUsed,
        modelUsed: recoveryResult.modelUsed,
        recoveryAttempts: recoveryResult.attemptsUsed,
        id: recoveryResult.result.id || `transcript-${Date.now()}`,
        callId: recoveryResult.result.callId || 'unknown'
      };

      // Record successful model usage metrics
      const modelTier = this.getModelTier(recoveryResult.modelUsed || initialModel);
      deepgramModelMetrics.recordModelUsage(
        recoveryResult.modelUsed || initialModel,
        modelTier,
        true,
        duration
      );

      logger.info('Audio transcription completed successfully', {
        model: recoveryResult.modelUsed,
        fallbackUsed: recoveryResult.fallbackUsed,
        attempts: recoveryResult.attemptsUsed,
        duration,
        confidence: enhancedResult.confidence
      });

      // Emit fallback event if fallback was used
      if (recoveryResult.fallbackUsed) {
        this.emit(DeepgramEvent.FALLBACK_USED, {
          originalModel: initialModel,
          fallbackModel: recoveryResult.modelUsed,
          reason: 'Model compatibility or permission issue'
        });
      }

      return enhancedResult;
    } else {
      const error = recoveryResult.error || new Error('Transcription failed');
      const errorType = deepgramErrorHandler.classifyError(error).errorType;
      
      // Record failed model usage metrics
      const modelTier = this.getModelTier(initialModel);
      deepgramModelMetrics.recordModelUsage(
        initialModel,
        modelTier,
        false,
        duration,
        errorType as any
      );
      
      logger.error('Audio transcription failed permanently', {
        initialModel,
        attempts: recoveryResult.attemptsUsed,
        duration,
        error: getErrorMessage(error)
      });

      throw error;
    }
  }

  /**
   * Create transcription stream with automatic model validation
   */
  public async createTranscriptionStreamWithRecovery(
    callId: string,
    options?: {
      language?: string;
      model?: string;
      tier?: string;
      detectLanguage?: boolean;
      punctuate?: boolean;
      diarize?: boolean;
      keywords?: string[];
      endpointing?: number;
      utteranceEndMs?: number;
    }
  ): Promise<{ connectionId: string; modelUsed: string; fallbackUsed: boolean }> {
    const initialModel = options?.model || this.defaultModel;
    
    logger.info('Creating transcription stream with recovery', {
      callId,
      model: initialModel,
      options
    });

    // First, validate the model access
    const isModelValid = await deepgramRecoveryService.validateModelAccess(
      initialModel,
      this.deepgramService['apiKey']
    );

    let modelToUse = initialModel;
    let fallbackUsed = false;

    if (!isModelValid) {
      logger.warn(`Model ${initialModel} not accessible, selecting fallback`, { callId });
      
      // Get recommended model based on available models
      // For now, we'll use a simple fallback hierarchy
      const fallbackModels = ['nova', 'base'];
      
      for (const fallbackModel of fallbackModels) {
        const isValid = await deepgramRecoveryService.validateModelAccess(
          fallbackModel,
          this.deepgramService['apiKey']
        );
        
        if (isValid) {
          modelToUse = fallbackModel;
          fallbackUsed = true;
          break;
        }
      }
      
      if (fallbackUsed) {
        logger.info(`Using fallback model ${modelToUse} for stream`, { callId });
        
        this.emit(DeepgramEvent.FALLBACK_USED, {
          callId,
          originalModel: initialModel,
          fallbackModel: modelToUse,
          reason: 'Model validation failed'
        });
      }
    }

    // Create the stream with the validated/fallback model
    const connectionId = await this.deepgramService.createTranscriptionStream(callId, {
      ...options,
      model: modelToUse
    });

    logger.info('Transcription stream created successfully', {
      callId,
      connectionId,
      modelUsed: modelToUse,
      fallbackUsed
    });

    return {
      connectionId,
      modelUsed: modelToUse,
      fallbackUsed
    };
  }

  /**
   * Validate API key and model access with detailed error reporting
   */
  public async validateConfiguration(model?: string): Promise<{
    isValid: boolean;
    model: string;
    issues: string[];
    recommendations: string[];
  }> {
    const testModel = model || this.defaultModel;
    const issues: string[] = [];
    const recommendations: string[] = [];

    logger.info(`Validating Deepgram configuration for model: ${testModel}`);

    try {
      // Test basic API key validity
      const isApiKeyValid = await this.deepgramService.validateApiKey();
      
      if (!isApiKeyValid) {
        issues.push('Invalid API key');
        recommendations.push('Check your Deepgram API key configuration');
        
        return {
          isValid: false,
          model: testModel,
          issues,
          recommendations
        };
      }

      // Test model access
      const isModelValid = await deepgramRecoveryService.validateModelAccess(
        testModel,
        this.deepgramService['apiKey']
      );

      if (!isModelValid) {
        issues.push(`Model ${testModel} is not accessible with current account`);
        
        // Get recommended models
        const recommendedModel = deepgramRecoveryService.getRecommendedModel(
          ['base', 'nova', 'nova-2'], // Available models (simplified)
          'general',
          false
        );
        
        recommendations.push(`Consider using model: ${recommendedModel}`);
        recommendations.push('Upgrade your Deepgram account for access to premium models');
      }

      const isValid = isApiKeyValid && isModelValid;
      
      logger.info('Configuration validation completed', {
        model: testModel,
        isValid,
        issuesCount: issues.length
      });

      return {
        isValid,
        model: testModel,
        issues,
        recommendations
      };
    } catch (error) {
      const classification = deepgramErrorHandler.classifyError(error);
      
      issues.push(`Configuration validation failed: ${getErrorMessage(error)}`);
      recommendations.push(classification.suggestedAction);
      
      logger.error('Configuration validation error', {
        model: testModel,
        errorType: classification.errorType,
        error: getErrorMessage(error)
      });

      return {
        isValid: false,
        model: testModel,
        issues,
        recommendations
      };
    }
  }

  /**
   * Get service statistics including error rates and fallback usage
   */
  public getServiceStats(): {
    activeConnections: number;
    errorClassificationEnabled: boolean;
    recoveryEnabled: boolean;
  } {
    return {
      activeConnections: this.deepgramService.getActiveConnectionIds().length,
      errorClassificationEnabled: true,
      recoveryEnabled: true
    };
  }

  // Delegate other methods to the underlying service
  public sendAudioToStream(connectionId: string, audioData: Buffer): void {
    return this.deepgramService.sendAudioToStream(connectionId, audioData);
  }

  public closeTranscriptionStream(connectionId: string): void {
    return this.deepgramService.closeTranscriptionStream(connectionId);
  }

  public getActiveConnectionIds(): string[] {
    return this.deepgramService.getActiveConnectionIds();
  }

  public closeAllConnections(): void {
    return this.deepgramService.closeAllConnections();
  }

  public updateApiKey(apiKey: string): void {
    return this.deepgramService.updateApiKey(apiKey);
  }

  /**
   * Helper method to determine model tier based on model name
   */
  private getModelTier(model: string): AccountTier {
    // Premium models
    if (model.startsWith('nova-2')) {
      return 'premium';
    }
    
    // Basic models
    if (model.startsWith('nova') && !model.startsWith('nova-2')) {
      return 'basic';
    }
    
    // Free models
    if (model.startsWith('base')) {
      return 'free';
    }
    
    // Default to free for unknown models
    return 'free';
  }
}

// Export factory function for creating enhanced service
export function createEnhancedDeepgramService(apiKey: string): DeepgramServiceWithRecovery {
  return new DeepgramServiceWithRecovery(apiKey);
}

// Singleton instance for use throughout the application
let _deepgramServiceWithRecovery: DeepgramServiceWithRecovery | null = null;

/**
 * Get the singleton instance of DeepgramServiceWithRecovery
 * This function will initialize the service with the API key from the database if not already initialized
 */
export async function getDeepgramServiceWithRecovery(): Promise<DeepgramServiceWithRecovery> {
  if (!_deepgramServiceWithRecovery) {
    try {
      // Get API key from database
      const Configuration = require('../models/Configuration').default;
      const config = await Configuration.findOne();
      const deepgramApiKey = config?.deepgramConfig?.apiKey || '';
      
      if (!deepgramApiKey) {
        logger.warn('No Deepgram API key found in database, creating service with empty key');
      } else {
        logger.info('Creating Deepgram service with recovery using API key from database');
      }
      
      _deepgramServiceWithRecovery = new DeepgramServiceWithRecovery(deepgramApiKey);
    } catch (error) {
      logger.error(`Error initializing Deepgram service with recovery: ${getErrorMessage(error)}`);
      // Create with empty key as fallback
      _deepgramServiceWithRecovery = new DeepgramServiceWithRecovery('');
    }
  }
  
  return _deepgramServiceWithRecovery;
}