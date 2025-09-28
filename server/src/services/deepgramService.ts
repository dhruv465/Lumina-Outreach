import { createClient, DeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { getErrorMessage } from '../utils/logger';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import Configuration from '../models/Configuration';
import { getCircuitBreakerService, CircuitBreakerOptions } from './circuitBreakerService';
import { 
  ModelCompatibilityService, 
  getModelCompatibilityService,
  initializeModelCompatibilityService,
  ModelValidationResult,
  ModelPreferences,
  DeepgramErrorType
} from './modelCompatibilityService';
import { deepgramModelMetrics } from '../monitoring/deepgramModelMetrics';

// Define DeepgramStreamOptions interface directly to avoid circular dependencies
export interface DeepgramStreamOptions {
  language?: string;
  model?: string;
  tier?: string;
  detectLanguage?: boolean;
  punctuate?: boolean;
  profanity_filter?: boolean;
  profanityFilter?: boolean;
  redact?: boolean;
  diarize?: boolean;
  multichannel?: boolean;
  alternatives?: number;
  numerals?: boolean;
  smart_format?: boolean;
  endpointing?: number;
  utteranceEndMs?: number;
  keywords?: string[];
  interim_results?: boolean;
  callback?: string;
}

// Add DeepgramConfig interface
export interface DeepgramConfig {
  apiKey?: string;
  language?: string;
  model?: string;
  primaryModel?: string;
  tier?: string;
  detectLanguage?: boolean;
  features?: {
    punctuate?: boolean;
    diarize?: boolean;
    interim_results?: boolean;
    endpointing?: number;
  };
}

export enum DeepgramEvent {
  TRANSCRIPT_RECEIVED = 'transcript-received',
  TRANSCRIPT_FINAL = 'transcript-final',
  ERROR = 'error',
  CONNECTION_STATUS = 'connection-status',
  FALLBACK_USED = 'fallback-used'
}

export interface TranscriptResult {
  id: string;
  callId: string;
  text: string;
  isFinal: boolean;
  confidence: number;
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  metadata: {
    startTime: number;
    endTime: number;
    processingLatency: number;
  };
}

export class DeepgramService extends EventEmitter {
  private apiKey: string;
  private client: DeepgramClient;
  private activeConnections: Map<string, any> = new Map();
  private warnedConnections: Set<string> = new Set();
  private defaultModel: string = 'nova-2';
  private fallbackModels: string[] = ['nova', 'base'];
  private modelCompatibilityService: ModelCompatibilityService;
  private defaultOptions: DeepgramStreamOptions = {
    language: 'en',
    model: 'nova-2',
    punctuate: true,
    endpointing: 150, 
    utteranceEndMs: 500
  };
  private readonly CIRCUIT_NAME = 'deepgram-api';
  private modelValidationCache: Map<string, { isValid: boolean; timestamp: number }> = new Map();
  private transcriptionCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly MODEL_VALIDATION_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    this.modelCompatibilityService = initializeModelCompatibilityService(apiKey);
    
    const circuitOptions: CircuitBreakerOptions = {
      resetTimeout: 10000,
      errorThresholdPercentage: 30,
      timeout: 5000
    };
    getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME, circuitOptions);
    
    logger.info('Deepgram Service initialized');
  }

  public updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.client = createClient(apiKey);
    this.modelCompatibilityService.updateApiKey(apiKey);
    this.clearModelValidationCache();
    logger.info('Deepgram API key updated');
    
    // Re-initialize optimal model with new API key
    this.initializeOptimalModel().catch(error => {
      logger.warn(`Failed to re-initialize optimal model after API key update: ${getErrorMessage(error)}`);
    });
  }

  /**
   * Initialize optimal model configuration based on account capabilities
   */
  private async initializeOptimalModel(): Promise<void> {
    try {
      const config = await Configuration.findOne();
      const deepgramConfig = (config?.deepgramConfig || {}) as DeepgramConfig;
      
      // Use auto-configuration service if available
      try {
        const { getDeepgramAutoConfigService } = await import('./deepgramAutoConfigService');
        const autoConfigService = getDeepgramAutoConfigService();
        
        // Initialize auto-config service if not already done
        await autoConfigService.initialize(this.apiKey);
        
        // Get optimal configuration
        const autoConfigResult = await autoConfigService.autoConfigureOptimalModel();
        
        if (autoConfigResult.success) {
          this.defaultModel = autoConfigResult.model;
          this.fallbackModels = autoConfigResult.fallbackModels;
          this.defaultOptions.model = autoConfigResult.model;
          
          logger.info(`Auto-configured optimal model: primary=${autoConfigResult.model}, fallbacks=[${autoConfigResult.fallbackModels.join(', ')}]`);
          return;
        } else {
          logger.warn(`Auto-configuration failed: ${autoConfigResult.error}, falling back to manual configuration`);
        }
      } catch (autoConfigError) {
        logger.warn(`Auto-configuration service unavailable: ${getErrorMessage(autoConfigError)}, using manual configuration`);
      }
      
      // Fallback to manual configuration
      const capabilities = await this.modelCompatibilityService.getAccountCapabilities(this.apiKey);
      
      // Set up model preferences
      const preferences: ModelPreferences = {
        preferredModels: [deepgramConfig.primaryModel || deepgramConfig.model || this.defaultModel],
        useCase: 'phone', // Default to phone use case for voice calls
        language: deepgramConfig.language || 'en',
        realtime: true
      };
      
      // Select best available model
      const bestModel = this.modelCompatibilityService.selectBestModel(
        capabilities.availableModels,
        preferences
      );
      
      // Update default model and fallback models
      this.defaultModel = bestModel;
      this.fallbackModels = capabilities.availableModels.filter(model => model !== bestModel);
      
      // Update default options
      this.defaultOptions.model = bestModel;
      
      logger.info(`Manually configured optimal model: primary=${bestModel}, fallbacks=[${this.fallbackModels.join(', ')}]`);
      
    } catch (error) {
      logger.warn(`Failed to initialize optimal model, using defaults: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Validate model access before use
   */
  public async validateAndSetModel(model: string): Promise<boolean> {
    const cacheKey = `${this.apiKey.slice(-8)}-${model}`;
    const validationStartTime = Date.now();
    
    // Check cache first
    const cached = this.modelValidationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.MODEL_VALIDATION_TTL) {
      return cached.isValid;
    }
    
    try {
      const validation = await this.modelCompatibilityService.validateModelAccess(this.apiKey, model);
      const validationTime = Date.now() - validationStartTime;
      
      // Record validation metrics
      deepgramModelMetrics.recordModelValidation(
        model,
        validation.isValid,
        validationTime,
        validation.error ? this.classifyErrorType(validation.error) : undefined
      );
      
      // Cache the result
      this.modelValidationCache.set(cacheKey, {
        isValid: validation.isValid,
        timestamp: Date.now()
      });
      
      if (validation.isValid) {
        this.defaultModel = model;
        this.defaultOptions.model = model;
        logger.info(`Model ${model} validated and set as default`);
        return true;
      } else {
        logger.warn(`Model ${model} validation failed: ${validation.error}`);
        return false;
      }
    } catch (error) {
      const validationTime = Date.now() - validationStartTime;
      const errorType = this.classifyErrorType(getErrorMessage(error));
      
      // Record failed validation metrics
      deepgramModelMetrics.recordModelValidation(model, false, validationTime, errorType);
      
      logger.error(`Error validating model ${model}: ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Get account capabilities
   */
  public async getAccountCapabilities() {
    const capabilities = await this.modelCompatibilityService.getAccountCapabilities(this.apiKey);
    
    // Record account tier detection metrics
    deepgramModelMetrics.recordAccountTierDetection(
      capabilities.tier,
      capabilities.availableModels,
      0 // Detection time is handled by the compatibility service
    );
    
    return capabilities;
  }

  /**
   * Auto-configure optimal model based on account capabilities
   */
  public async autoConfigureModel(): Promise<string> {
    try {
      const capabilities = await this.getAccountCapabilities();
      
      const preferences: ModelPreferences = {
        preferredModels: [this.defaultModel],
        useCase: 'phone',
        language: 'en',
        realtime: true
      };
      
      const optimalModel = this.modelCompatibilityService.selectBestModel(
        capabilities.availableModels,
        preferences
      );
      
      await this.validateAndSetModel(optimalModel);
      return optimalModel;
    } catch (error) {
      logger.error(`Error auto-configuring model: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Handle model fallback when current model fails
   */
  private async handleModelFallback(currentModel: string, error: any): Promise<string> {
    try {
      const fallbackModel = this.modelCompatibilityService.handleModelFallback(currentModel, error);
      
      // Validate the fallback model
      const isValid = await this.validateAndSetModel(fallbackModel);
      if (isValid) {
        this.emit(DeepgramEvent.FALLBACK_USED, {
          originalModel: currentModel,
          fallbackModel: fallbackModel,
          reason: getErrorMessage(error)
        });
        
        logger.info(`Successfully fell back from ${currentModel} to ${fallbackModel}`);
        return fallbackModel;
      } else {
        throw new Error(`Fallback model ${fallbackModel} is also not accessible`);
      }
    } catch (fallbackError) {
      logger.error(`Model fallback failed: ${getErrorMessage(fallbackError)}`);
      throw fallbackError;
    }
  }

  /**
   * Clear model validation cache
   */
  private clearModelValidationCache(): void {
    this.modelValidationCache.clear();
    logger.debug('Model validation cache cleared');
  }

  /**
   * Transcribe an audio file with high accuracy and automatic model fallback
   * @param audioBuffer Audio buffer to transcribe
   * @param options Transcription options
   * @returns Transcription result
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    options?: {
      language?: string;
      model?: string;
      detectLanguage?: boolean;
    }
  ): Promise<any> {
    const circuitBreaker = getCircuitBreakerService();
    
    // Define the main function to execute with circuit breaker
    const transcribeFunction = async () => {
      const startTime = Date.now();
      
      // Get configuration from database
      const config = await Configuration.findOne();
      const deepgramConfig = (config?.deepgramConfig || {}) as DeepgramConfig;
      
      // Determine the model to use
      let modelToUse = options?.model || deepgramConfig.model || this.defaultModel;
      
      // Create transcription options
      const transcriptionOptions = {
        language: options?.language || deepgramConfig.language || 'en',
        model: modelToUse,
        detect_language: options?.detectLanguage || deepgramConfig.detectLanguage || false,
        punctuate: true,
        smart_format: true
      };

      // Try to get cached result first if available
      const cacheKey = `transcribe:${Buffer.from(audioBuffer).toString('base64').slice(0, 50)}:${JSON.stringify(transcriptionOptions)}`;
      const cachedResult = this.transcriptionCache.get(cacheKey);
      if (cachedResult) {
        logger.info('Using cached transcription result');
        return cachedResult.data;
      }

      // Attempt transcription with model fallback support
      let lastError: any;
      const modelsToTry = [modelToUse, ...this.fallbackModels].filter((model, index, arr) => arr.indexOf(model) === index);
      
      for (let i = 0; i < modelsToTry.length; i++) {
        const currentModel = modelsToTry[i];
        
        try {
          // Validate model before use (skip validation for fallback attempts to save time)
          if (i === 0) {
            const isModelValid = await this.validateAndSetModel(currentModel);
            if (!isModelValid) {
              logger.warn(`Primary model ${currentModel} validation failed, trying fallback`);
              continue;
            }
          }
          
          // Update transcription options with current model
          transcriptionOptions.model = currentModel;
          
          logger.info(`Attempting transcription with model: ${currentModel}`);
          
          // Perform the transcription
          const response = await this.client.listen.prerecorded.transcribeFile(audioBuffer, {
            mimetype: 'audio/wav',
            options: transcriptionOptions
          });

          const endTime = Date.now();
          const latency = endTime - startTime;

          logger.info(`Deepgram transcription completed with model ${currentModel} in ${latency}ms`);

          // Extract result with corrected property access
          const channels = response.result?.results?.channels;
          const result = channels && channels.length > 0 && channels[0].alternatives && channels[0].alternatives.length > 0 
            ? channels[0].alternatives[0] 
            : null;
            
          const transcriptionResult = {
            transcript: result?.transcript || '', // Always ensure transcript is at least an empty string
            confidence: result?.confidence || 0,
            words: result?.words || [],
            language: transcriptionOptions.language,
            latency,
            modelUsed: currentModel,
            fallback: i > 0 // Mark as fallback if not the first model
          };
          
          // Record model usage metrics
          const capabilities = await this.getAccountCapabilities();
          deepgramModelMetrics.recordModelUsage(
            currentModel,
            capabilities.tier,
            true,
            latency
          );

          // Emit fallback event if we used a fallback model
          if (i > 0) {
            // Record fallback metrics
            const errorType = this.classifyErrorType(getErrorMessage(lastError));
            deepgramModelMetrics.recordModelFallback(
              modelToUse,
              currentModel,
              latency,
              errorType,
              true
            );

            // Enhanced logging for fallback usage
            logger.info(`Deepgram transcription fallback successful`, {
              originalModel: modelToUse,
              fallbackModel: currentModel,
              attemptNumber: i + 1,
              totalAttempts: modelsToTry.length,
              reason: getErrorMessage(lastError),
              latency,
              context: 'deepgram-transcription-fallback'
            });

            this.emit(DeepgramEvent.FALLBACK_USED, {
              originalModel: modelToUse,
              fallbackModel: currentModel,
              reason: getErrorMessage(lastError),
              attemptNumber: i + 1,
              totalAttempts: modelsToTry.length,
              latency
            });
          }
          
          // Cache result in memory
          this.transcriptionCache.set(cacheKey, {
            data: transcriptionResult,
            timestamp: Date.now()
          });
          
          return transcriptionResult;
          
        } catch (error) {
          lastError = error;
          const errorType = this.classifyErrorType(getErrorMessage(error));
          
          // Record failed model usage metrics
          try {
            const capabilities = await this.getAccountCapabilities();
            deepgramModelMetrics.recordModelUsage(
              currentModel,
              capabilities.tier,
              false,
              Date.now() - startTime,
              errorType
            );
          } catch (metricsError) {
            logger.debug(`Failed to record metrics: ${getErrorMessage(metricsError)}`);
          }
          
          logger.warn(`Transcription failed with model ${currentModel}: ${getErrorMessage(error)}`);
          
          // If this was a permission or model error, try fallback
          if (this.isModelCompatibilityError(error)) {
            if (i < modelsToTry.length - 1) {
              logger.info(`Trying fallback model due to compatibility error`);
              continue;
            }
          } else {
            // For non-compatibility errors, don't try fallback models
            throw error;
          }
        }
      }
      
      // If we get here, all models failed
      throw new Error(`Transcription failed with all available models. Last error: ${getErrorMessage(lastError)}`);
    };
    
    // Define fallback function for when circuit is open
    const fallbackFunction = async (error: Error) => {
      logger.warn(`Using fallback for transcription due to circuit breaker: ${error.message}`);
      this.emit(DeepgramEvent.FALLBACK_USED, { error: error.message });
      
      // Return a minimal result 
      return {
        transcript: '[Transcription temporarily unavailable]',
        confidence: 0,
        words: [],
        language: options?.language || 'en',
        latency: 0,
        fallback: true
      };
    };
    
    // Execute with circuit breaker
    return circuitBreaker.execute(
      this.CIRCUIT_NAME,
      transcribeFunction,
      fallbackFunction
    );
  }

  /**
   * Check if error is related to model compatibility (permissions, invalid model, etc.)
   */
  private isModelCompatibilityError(error: any): boolean {
    const errorMessage = getErrorMessage(error).toLowerCase();
    const statusCode = error?.status || error?.response?.status;
    
    return (
      statusCode === 403 || // Forbidden/insufficient permissions
      statusCode === 400 || // Bad request (invalid model)
      statusCode === 401 || // Unauthorized
      errorMessage.includes('insufficient') ||
      errorMessage.includes('permission') ||
      errorMessage.includes('invalid model') ||
      errorMessage.includes('model not found') ||
      errorMessage.includes('unauthorized')
    );
  }

  /**
   * Classify error type for metrics recording
   */
  private classifyErrorType(errorMessage: string): DeepgramErrorType {
    const message = errorMessage.toLowerCase();
    const statusMatch = errorMessage.match(/status:?\s*(\d+)/i);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : null;

    if (statusCode === 401 || message.includes('unauthorized') || message.includes('invalid api key')) {
      return DeepgramErrorType.AUTHENTICATION_ERROR;
    }

    if (statusCode === 403 || message.includes('insufficient') || message.includes('permission')) {
      return DeepgramErrorType.INSUFFICIENT_PERMISSIONS;
    }

    if (statusCode === 400 || message.includes('invalid model') || message.includes('model not found')) {
      return DeepgramErrorType.INVALID_MODEL;
    }

    if (statusCode === 429 || message.includes('quota') || message.includes('rate limit')) {
      return DeepgramErrorType.QUOTA_EXCEEDED;
    }

    if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return DeepgramErrorType.NETWORK_ERROR;
    }

    return DeepgramErrorType.NETWORK_ERROR; // Default fallback
  }

  /**
   * Create a real-time transcription stream with model validation and fallback support
   * @param callId Call ID for tracking
   * @param options Stream options
   * @returns Connection ID
   */
  public async createTranscriptionStream(
    callId: string,
    options?: DeepgramStreamOptions
  ): Promise<string> {
    // Define the main function to execute with circuit breaker
    const createStreamFunction = async () => {
      try {
        const connectionId = uuidv4();
        
        // Merge default options with provided options
        const streamOptions = {
          ...this.defaultOptions,
          ...options
        };

        // Validate model before creating stream
        let modelToUse = streamOptions.model || this.defaultModel;
        const isModelValid = await this.validateAndSetModel(modelToUse);
        
        if (!isModelValid) {
          // Try to find a compatible fallback model
          logger.warn(`Model ${modelToUse} is not valid, attempting fallback`);
          
          const modelsToTry = [this.defaultModel, ...this.fallbackModels].filter((model, index, arr) => arr.indexOf(model) === index);
          let fallbackFound = false;
          
          for (const fallbackModel of modelsToTry) {
            if (fallbackModel !== modelToUse) {
              const isFallbackValid = await this.validateAndSetModel(fallbackModel);
              if (isFallbackValid) {
                modelToUse = fallbackModel;
                streamOptions.model = fallbackModel;
                fallbackFound = true;
                
                // Enhanced logging for stream fallback
                logger.info(`Deepgram stream fallback successful`, {
                  callId,
                  originalModel: options?.model || this.defaultModel,
                  fallbackModel: fallbackModel,
                  reason: 'Model validation failed',
                  context: 'deepgram-stream-fallback'
                });

                this.emit(DeepgramEvent.FALLBACK_USED, {
                  callId,
                  originalModel: options?.model || this.defaultModel,
                  fallbackModel: fallbackModel,
                  reason: 'Model validation failed'
                });
                
                logger.info(`Using fallback model ${fallbackModel} for stream`);
                break;
              }
            }
          }
          
          if (!fallbackFound) {
            throw new Error(`No compatible models available for streaming`);
          }
        }

        logger.info(`Creating Deepgram transcription stream for call ${callId}`, {
          model: streamOptions.model,
          language: streamOptions.language
        });

        // Create live transcription with latest API
        const connection = this.client.listen.live({
          language: streamOptions.language,
          model: streamOptions.model,
          tier: streamOptions.tier || 'base',
          punctuate: streamOptions.punctuate !== false,
          diarize: streamOptions.diarize || false,
          multichannel: false,
          alternatives: 1,
          endpointing: streamOptions.endpointing !== undefined ? streamOptions.endpointing : this.defaultOptions.endpointing,
          utterance_end_ms: streamOptions.utteranceEndMs !== undefined ? streamOptions.utteranceEndMs : this.defaultOptions.utteranceEndMs,
          smart_format: true,
          encoding: 'linear16',
          sample_rate: 16000,
          interim_results: true,
          keywords: streamOptions.keywords || []
        });

        // Store connection for management with metadata
        this.activeConnections.set(connectionId, {
          connection,
          callId,
          model: streamOptions.model,
          createdAt: new Date()
        });

        // Emit connection status
        this.emit(DeepgramEvent.CONNECTION_STATUS, {
          connectionId,
          callId,
          status: 'connected',
          model: streamOptions.model
        });

        // Set up event handlers for the connection
        this.setupConnectionHandlers(connection, connectionId, callId, streamOptions.model);
        
        return connectionId;
      } catch (error) {
        logger.error(`Error creating Deepgram stream: ${getErrorMessage(error)}`);
        throw new Error(`Failed to create transcription stream: ${getErrorMessage(error)}`);
      }
    };
    
    try {
      // For streaming, we don't use the normal circuit breaker pattern
      // as we need to maintain the connection ID return value
      // Instead, we just check if the circuit is open before attempting
      const circuitBreaker = getCircuitBreakerService().getCircuit(this.CIRCUIT_NAME);
      
      if (circuitBreaker.status.state === 'open') {
        logger.warn(`Deepgram circuit is open, using degraded mode for stream`);
        this.emit(DeepgramEvent.FALLBACK_USED, { 
          callId,
          message: 'Using degraded transcription mode due to service issues'
        });
        
        // Return a special connection ID that indicates we're in fallback mode
        const fallbackId = `fallback-${uuidv4()}`;
        const fallbackEmitter = new EventEmitter();
        this.activeConnections.set(fallbackId, { 
          isFallback: true, 
          callId,
          connection: fallbackEmitter,
          createdAt: new Date()
        });
        return fallbackId;
      }
      
      return await createStreamFunction();
    } catch (error) {
      logger.error(`Failed to create transcription stream with circuit check: ${getErrorMessage(error)}`);
      
      // Try graceful degradation - return a fallback ID that provides minimal functionality
      const emergencyFallbackId = `emergency-${uuidv4()}`;
      const emergencyFallbackEmitter = new EventEmitter();
      this.activeConnections.set(emergencyFallbackId, { 
        isEmergencyFallback: true, 
        callId,
        connection: emergencyFallbackEmitter,
        createdAt: new Date()
      });
      
      this.emit(DeepgramEvent.FALLBACK_USED, {
        callId,
        message: 'Using emergency fallback mode - transcription may be limited',
        error: getErrorMessage(error)
      });
      
      return emergencyFallbackId;
    }
  }
  
  /**
   * Set up event handlers for a Deepgram connection
   * Extracted to a separate method for better code organization
   */
  private setupConnectionHandlers(connection: any, connectionId: string, callId: string, model?: string): void {
    // Handle transcript results
    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      // Only process if we have valid results
      if (data?.channel?.alternatives?.[0]) {
        const alt = data.channel.alternatives[0];
        
        // Create structured transcript result
        const result: TranscriptResult = {
          id: uuidv4(),
          callId,
          text: alt.transcript || '',
          isFinal: data.is_final || false,
          confidence: alt.confidence || 0,
          words: alt.words?.map((word: any) => ({ word: word.word, start: word.start, end: word.end, confidence: word.confidence })) || [],
          metadata: { startTime: data.start || 0, endTime: data.end || 0, processingLatency: data.audio_meta?.processing_latency_ms || 0 }
        };

        if (result.isFinal) {
          this.emit(DeepgramEvent.TRANSCRIPT_FINAL, result);
        } else {
          this.emit(DeepgramEvent.TRANSCRIPT_RECEIVED, result);
        }
      }
    });

    connection.on('error', (error) => {
      logger.error(`Deepgram stream error for call ${callId}: ${getErrorMessage(error)}`);
      this.emit(DeepgramEvent.ERROR, { connectionId, callId, error: getErrorMessage(error), model });
    });

    connection.on('close', () => {
      logger.info(`Deepgram stream closed for call ${callId}`);
      this.activeConnections.delete(connectionId);
      this.emit(DeepgramEvent.CONNECTION_STATUS, { connectionId, callId, status: 'disconnected' });
    });
  }

  public sendAudioToStream(connectionId: string, audioData: Buffer): void {
    const connectionData = this.activeConnections.get(connectionId);
    if (!connectionData) {
      if (!this.warnedConnections.has(connectionId)) {
        logger.warn(`No active Deepgram connection found for ID ${connectionId}`);
        this.warnedConnections.add(connectionId);
      }
      return;
    }

    const { connection } = connectionData;
    if (connection.readyState === WebSocket.OPEN) {
      connection.send(audioData);
    } else {
      if (!this.warnedConnections.has(connectionId)) {
        logger.warn(`Deepgram connection ${connectionId} is not open (state: ${connection.readyState})`);
        this.warnedConnections.add(connectionId);
      }
    }
  }

  public closeTranscriptionStream(connectionId: string): void {
    const connectionData = this.activeConnections.get(connectionId);
    if (connectionData) {
      connectionData.connection.close();
      this.activeConnections.delete(connectionId);
      this.warnedConnections.delete(connectionId);
      logger.info(`Closed Deepgram connection ${connectionId}`);
    }
  }

  public async validateApiKey(): Promise<boolean> {
    try {
      const compatibleModels = await this.modelCompatibilityService.getCompatibleModels(this.apiKey);
      return compatibleModels.length > 0;
    } catch (error) {
      logger.error(`Deepgram API key validation failed: ${getErrorMessage(error)}`);
      return false;
    }
  }
}

let deepgramServiceInstance: DeepgramService | null = null;

export function initializeDeepgramService(apiKey: string): DeepgramService {
  if (!deepgramServiceInstance) {
    deepgramServiceInstance = new DeepgramService(apiKey);
  } else {
    deepgramServiceInstance.updateApiKey(apiKey);
  }
  return deepgramServiceInstance;
}

export function getDeepgramService(): DeepgramService | null {
  return deepgramServiceInstance;
}