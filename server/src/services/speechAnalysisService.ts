import axios from 'axios';
import { logger } from '../index';
import { createClient } from '@deepgram/sdk';
import { getErrorMessage } from '../utils/logger';
import { ModelCompatibilityService, ModelValidationResult, ModelPreferences } from './modelCompatibilityService';
import { deepgramErrorHandler, ErrorClassificationResult } from './deepgramErrorHandler';
import { DeepgramErrorType } from '../types/deepgram';

export interface SpeechAnalysis {
  transcript: string;
  confidence: number;
  language: 'English' | 'Hindi';
  intent: {
    category: string;
    confidence: number;
    entities: any[];
  };
  sentiment: 'positive' | 'negative' | 'neutral';
  speechFeatures: {
    pace: number;
    volume: number;
    tone: string;
  };
}

export interface ConversationContext {
  currentTurn: number;
  customerProfile: {
    name?: string;
    mood: string;
    interests: string[];
    objections: string[];
    engagement_level: number;
  };
  callObjective: string;
  progress: {
    stage: string;
    completed_objectives: string[];
    next_steps: string[];
  };
}

export class SpeechAnalysisService {
  private openAIApiKey: string;
  private googleSpeechKey?: string;
  private deepgramApiKey?: string;
  private deepgramClient?: any;
  private modelCompatibilityService?: ModelCompatibilityService;
  private currentModel: string = 'nova-2';
  private fallbackModels: string[] = ['nova', 'base', 'base-general'];
  private modelValidationCache: Map<string, { isValid: boolean; timestamp: number }> = new Map();
  private readonly VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(openAIApiKey: string, googleSpeechKey?: string, deepgramApiKey?: string) {
    this.openAIApiKey = openAIApiKey;
    this.googleSpeechKey = googleSpeechKey;
    this.deepgramApiKey = deepgramApiKey;
    
    if (deepgramApiKey) {
      this.initializeDeepgram(deepgramApiKey);
      this.initializeModelCompatibilityService(deepgramApiKey);
    }
  }

  /**
   * Initialize Deepgram client with proper validation
   */
  private initializeDeepgram(apiKey: string): void {
    try {
      if (!apiKey || apiKey.length < 10) {
        logger.warn('Invalid Deepgram API key provided - must be at least 10 characters');
        return;
      }
      
      this.deepgramClient = createClient(apiKey);
      logger.info(`Deepgram client initialized successfully with API key (length: ${apiKey.length})`);
      
      // Validate the client by making a test connection (optional)
      // Note: We don't make actual API calls here to avoid unnecessary costs
    } catch (error) {
      logger.error(`Failed to initialize Deepgram client: ${getErrorMessage(error)}`);
      this.deepgramClient = undefined;
    }
  }

  /**
   * Initialize Model Compatibility Service for handling model fallbacks
   */
  private initializeModelCompatibilityService(apiKey: string): void {
    try {
      this.modelCompatibilityService = new ModelCompatibilityService(apiKey);
      logger.info('Model Compatibility Service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize Model Compatibility Service: ${getErrorMessage(error)}`);
      this.modelCompatibilityService = undefined;
    }
  }

  /**
   * Check if Deepgram is properly configured and ready to use
   */
  public isDeepgramConfigured(): boolean {
    return !!(this.deepgramApiKey && this.deepgramClient && this.deepgramApiKey.length > 10);
  }

  /**
   * Update API keys for the service
   */
  public updateApiKeys(openAIApiKey?: string, googleSpeechKey?: string, deepgramApiKey?: string): void {
    if (openAIApiKey) {
      this.openAIApiKey = openAIApiKey;
    }
    if (googleSpeechKey !== undefined) {
      this.googleSpeechKey = googleSpeechKey;
    }
    if (deepgramApiKey) {
      this.deepgramApiKey = deepgramApiKey;
      this.initializeDeepgram(deepgramApiKey);
      this.initializeModelCompatibilityService(deepgramApiKey);
      // Clear validation cache when API key changes
      this.modelValidationCache.clear();
    }
    logger.info('SpeechAnalysisService API keys updated');
  }

  /**
   * Get current OpenAI API key
   */
  public getOpenAIApiKey(): string {
    return this.openAIApiKey;
  }

  /**
   * Get current Google Speech API key
   */
  public getGoogleSpeechKey(): string | undefined {
    return this.googleSpeechKey;
  }

  /**
   * Get current Deepgram API key
   */
  public getDeepgramApiKey(): string | undefined {
    return this.deepgramApiKey;
  }

  /**
   * Validate model access with caching to avoid repeated API calls
   */
  private async validateModelAccess(model: string): Promise<boolean> {
    if (!this.modelCompatibilityService || !this.deepgramApiKey) {
      return false;
    }

    const cacheKey = `${model}-${this.deepgramApiKey.slice(-8)}`;
    const cached = this.modelValidationCache.get(cacheKey);
    
    // Return cached result if still valid
    if (cached && (Date.now() - cached.timestamp) < this.VALIDATION_CACHE_TTL) {
      logger.debug(`Using cached validation result for model ${model}: ${cached.isValid}`);
      return cached.isValid;
    }

    try {
      const validation = await this.modelCompatibilityService.validateModelAccess(this.deepgramApiKey, model);
      
      // Cache the result
      this.modelValidationCache.set(cacheKey, {
        isValid: validation.isValid,
        timestamp: Date.now()
      });

      logger.info(`Model ${model} validation result: ${validation.isValid}`, {
        tier: validation.tier,
        alternatives: validation.suggestedAlternatives
      });

      return validation.isValid;
    } catch (error) {
      logger.warn(`Model validation failed for ${model}: ${getErrorMessage(error)}`);
      
      // Cache negative result for shorter time
      this.modelValidationCache.set(cacheKey, {
        isValid: false,
        timestamp: Date.now()
      });
      
      return false;
    }
  }

  /**
   * Select the best available model based on preferences and account capabilities
   */
  private async selectBestAvailableModel(preferredModel?: string): Promise<string> {
    if (!this.modelCompatibilityService || !this.deepgramApiKey) {
      logger.warn('Model compatibility service not available, using fallback model');
      return 'base';
    }

    try {
      // Get all compatible models for the account
      const compatibleModels = await this.modelCompatibilityService.getCompatibleModels(this.deepgramApiKey);
      
      if (compatibleModels.length === 0) {
        logger.warn('No compatible models found, using ultimate fallback');
        return 'base';
      }

      // Define preferences for speech analysis use case
      const preferences: ModelPreferences = {
        preferredModels: preferredModel ? [preferredModel, ...this.fallbackModels] : [this.currentModel, ...this.fallbackModels],
        useCase: 'phone', // Optimized for phone call transcription
        language: 'en',
        realtime: true
      };

      const selectedModel = this.modelCompatibilityService.selectBestModel(compatibleModels, preferences);
      
      logger.info(`Selected best available model: ${selectedModel}`, {
        compatibleModels: compatibleModels.length,
        preferredModel,
        fallbackUsed: selectedModel !== (preferredModel || this.currentModel)
      });

      return selectedModel;
    } catch (error) {
      logger.error(`Error selecting best model: ${getErrorMessage(error)}`);
      return 'base'; // Ultimate fallback
    }
  }

  /**
   * Handle model compatibility errors and implement fallback logic
   */
  private async handleModelCompatibilityError(error: any, currentModel: string): Promise<string> {
    if (!this.modelCompatibilityService) {
      logger.warn('Model compatibility service not available for error handling');
      return this.fallbackModels[0] || 'base';
    }

    try {
      // Classify the error to determine appropriate response
      const classification: ErrorClassificationResult = deepgramErrorHandler.classifyError(error);
      
      logger.warn('Handling model compatibility error', {
        currentModel,
        errorType: classification.errorType,
        isRecoverable: classification.isRecoverable,
        suggestedAction: classification.suggestedAction
      });

      // Use model compatibility service to get fallback model
      const fallbackModel = this.modelCompatibilityService.handleModelFallback(currentModel, error);
      
      // Validate the fallback model before using it
      const isFallbackValid = await this.validateModelAccess(fallbackModel);
      
      if (isFallbackValid) {
        logger.info(`Successfully selected fallback model: ${fallbackModel}`, {
          originalModel: currentModel,
          errorType: classification.errorType
        });
        return fallbackModel;
      } else {
        // If suggested fallback is also invalid, try our predefined fallback chain
        for (const model of this.fallbackModels) {
          const isValid = await this.validateModelAccess(model);
          if (isValid) {
            logger.info(`Using predefined fallback model: ${model}`, {
              originalModel: currentModel,
              suggestedFallback: fallbackModel
            });
            return model;
          }
        }
        
        // Ultimate fallback
        logger.warn('All fallback models failed validation, using ultimate fallback: base');
        return 'base';
      }
    } catch (fallbackError) {
      logger.error(`Error in fallback handling: ${getErrorMessage(fallbackError)}`);
      return 'base'; // Ultimate fallback
    }
  }

  /**
   * Ensure consistent user experience during model transitions
   */
  private logModelTransition(fromModel: string, toModel: string, reason: string): void {
    if (fromModel !== toModel) {
      logger.info('Model transition occurred', {
        fromModel,
        toModel,
        reason,
        timestamp: new Date().toISOString(),
        userImpact: 'Transcription continues with alternative model'
      });
      
      // This could be extended to emit events for UI notifications
      // or to update user-facing status indicators
    }
  }

  /**
   * Detect if there is voice activity in the audio buffer
   * This is an enhanced energy-based voice activity detection with proper μ-law decoding
   */
  detectVoiceActivity(audioBuffer: Buffer): boolean {
    try {
      // Enhanced energy-based voice activity detection
      // This implementation properly handles Twilio's μ-law audio format
      
      if (audioBuffer.length === 0) {
        return false;
      }
      
      // μ-law to linear conversion table (standard ITU-T G.711)
      const MULAW_DECODE_TABLE = [
        -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
        -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
        -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
        -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
        -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
        -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
        -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
        -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
        -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
        -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
        -876, -844, -812, -780, -748, -716, -684, -652,
        -620, -588, -556, -524, -492, -460, -428, -396,
        -372, -356, -340, -324, -308, -292, -276, -260,
        -244, -228, -212, -196, -180, -164, -148, -132,
        -120, -112, -104, -96, -88, -80, -72, -64,
        -56, -48, -40, -32, -24, -16, -8, 0,
        32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
        23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
        15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
        11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
        7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
        5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
        3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
        2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
        1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
        1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
        876, 844, 812, 780, 748, 716, 684, 652,
        620, 588, 556, 524, 492, 460, 428, 396,
        372, 356, 340, 324, 308, 292, 276, 260,
        244, 228, 212, 196, 180, 164, 148, 132,
        120, 112, 104, 96, 88, 80, 72, 64,
        56, 48, 40, 32, 24, 16, 8, 0
      ];
      
      // Calculate energy using proper μ-law decoding
      let sumSquares = 0;
      let sampleCount = 0;
      let maxAbsValue = 0;
      
      // Process as μ-law audio (Twilio's format)
      for (let i = 0; i < audioBuffer.length; i++) {
        // Get the μ-law encoded byte
        const mulawByte = audioBuffer[i];
        
        // Convert μ-law to linear PCM using lookup table
        const linearSample = MULAW_DECODE_TABLE[mulawByte];
        
        // Track maximum absolute value for peak detection
        const absValue = Math.abs(linearSample);
        if (absValue > maxAbsValue) {
          maxAbsValue = absValue;
        }
        
        // Accumulate squared values for RMS calculation
        sumSquares += linearSample * linearSample;
        sampleCount++;
      }
      
      if (sampleCount === 0) {
        return false;
      }
      
      // Calculate RMS energy
      const rmsEnergy = Math.sqrt(sumSquares / sampleCount);
      
      // Use a more reasonable threshold for actual speech detection
      // After μ-law decoding, typical speech energy is much higher
      const threshold = 1000; // Adjusted for decoded μ-law values
      
      const hasActivity = rmsEnergy > threshold;
      
      // Always log energy levels for debugging until we get the threshold right
      logger.debug(`🔊 UPDATED VAD - Voice activity detection: RMS energy = ${rmsEnergy.toFixed(2)}, max peak = ${maxAbsValue}, threshold = ${threshold}, hasActivity = ${hasActivity}, buffer size = ${audioBuffer.length}`);
      
      return hasActivity;
    } catch (error) {
      logger.warn(`Error detecting voice activity: ${getErrorMessage(error)}`);
      return false; // Default to no voice activity on error
    }
  }

  // Speech-to-Text with Language Detection using Deepgram with Model Compatibility
  async transcribeAudio(
    audioBuffer: Buffer,
    language?: 'English' | 'Hindi'
  ): Promise<{ transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean }> {
    const startTime = Date.now();
    let modelUsed = this.currentModel;
    let fallbackUsed = false;

    try {
      // Check if Deepgram is properly configured
      if (!this.isDeepgramConfigured()) {
        const errorMsg = `Deepgram is not properly configured. API key: ${this.deepgramApiKey ? 'SET' : 'NOT SET'}, Client: ${this.deepgramClient ? 'SET' : 'NOT SET'}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Check for voice activity first to avoid unnecessary API calls
      const hasVoiceActivity = this.detectVoiceActivity(audioBuffer);
      
      logger.info(`🔊 Voice Activity Check: ${hasVoiceActivity ? 'DETECTED' : 'NOT DETECTED'} for buffer size ${audioBuffer.length} bytes`);
      
      // Select the best available model for transcription
      const selectedModel = await this.selectBestAvailableModel();
      modelUsed = selectedModel;
      
      if (selectedModel !== this.currentModel) {
        fallbackUsed = true;
        this.logModelTransition(this.currentModel, selectedModel, 'Model compatibility check');
      }

      logger.info(`🔧 Using Deepgram model: ${selectedModel} for transcription (fallback: ${fallbackUsed})`);
      
      // Convert μ-law audio from Twilio to PCM format for better Deepgram compatibility
      const processedAudioBuffer = this.convertMuLawToPCM(audioBuffer);
      
      logger.info(`🎵 Audio Conversion: μ-law ${audioBuffer.length} bytes → WAV ${processedAudioBuffer.length} bytes`);
      
      // Attempt transcription with error handling and fallback
      return await this.attemptTranscriptionWithFallback(
        processedAudioBuffer,
        audioBuffer,
        selectedModel,
        language,
        hasVoiceActivity,
        startTime
      );

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Error transcribing audio after ${duration}ms: ${getErrorMessage(error)}`);
      
      // Return a result indicating failure but with voice activity info
      return {
        transcript: '',
        language: language || 'English',
        confidence: 0,
        hasVoiceActivity: this.detectVoiceActivity(audioBuffer),
        modelUsed,
        fallbackUsed
      };
    }
  }

  /**
   * Attempt transcription with automatic model fallback on errors
   */
  private async attemptTranscriptionWithFallback(
    processedAudioBuffer: Buffer,
    originalAudioBuffer: Buffer,
    initialModel: string,
    language?: 'English' | 'Hindi',
    hasVoiceActivity: boolean = true,
    startTime: number = Date.now()
  ): Promise<{ transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean }> {
    let currentModel = initialModel;
    let fallbackUsed = initialModel !== this.currentModel;
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      
      try {
        logger.info(`🚀 Transcription attempt ${attempt}/${maxAttempts} with model: ${currentModel}`);
        
        // Prepare transcription options optimized for the selected model
        const options = {
          model: currentModel,
          smart_format: true,
          language: 'en', // Force English for now to avoid language detection issues
          punctuate: true,
          tier: this.getTierForModel(currentModel)
        };
        
        // Attempt transcription with current model
        const response = await this.deepgramClient.listen.prerecorded.transcribeFile(
          processedAudioBuffer,
          {
            mimetype: 'audio/wav',
            ...options
          }
        );
        
        // Extract and validate response
        const result = this.extractTranscriptionResult(response, language, hasVoiceActivity, currentModel, fallbackUsed);
        
        const duration = Date.now() - startTime;
        logger.info(`🎯 Transcription successful with model ${currentModel} after ${duration}ms: "${result.transcript}"`);
        
        return result;

      } catch (error) {
        logger.warn(`Transcription attempt ${attempt} failed with model ${currentModel}: ${getErrorMessage(error)}`);
        
        // Classify the error to determine if we should try fallback
        const classification = deepgramErrorHandler.classifyError(error);
        
        if (attempt === maxAttempts || !classification.isRecoverable) {
          // If this is the last attempt or error is not recoverable, try format fallback
          if (attempt < maxAttempts) {
            logger.info('Attempting format fallback with μ-law audio');
            return await this.attemptFormatFallback(originalAudioBuffer, currentModel, language, hasVoiceActivity, fallbackUsed);
          }
          throw error;
        }

        // Handle model compatibility error and get fallback model
        const fallbackModel = await this.handleModelCompatibilityError(error, currentModel);
        
        if (fallbackModel === currentModel) {
          // If no different fallback model is available, try format fallback
          logger.info('No different model available, attempting format fallback');
          return await this.attemptFormatFallback(originalAudioBuffer, currentModel, language, hasVoiceActivity, fallbackUsed);
        }

        // Update model for next attempt
        this.logModelTransition(currentModel, fallbackModel, `Error: ${classification.errorType}`);
        currentModel = fallbackModel;
        fallbackUsed = true;
        
        // Add delay between attempts to avoid rate limiting
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          logger.info(`Waiting ${delay}ms before retry attempt ${attempt + 1}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // This should not be reached, but TypeScript requires it
    throw new Error('All transcription attempts failed');
  }

  /**
   * Attempt transcription with different audio formats as fallback
   */
  private async attemptFormatFallback(
    originalAudioBuffer: Buffer,
    model: string,
    language?: 'English' | 'Hindi',
    hasVoiceActivity: boolean = true,
    fallbackUsed: boolean = false
  ): Promise<{ transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean }> {
    
    try {
      logger.info('🔄 Attempting μ-law format fallback');
      
      const fallbackResponse = await this.deepgramClient.listen.prerecorded.transcribeFile(
        originalAudioBuffer, // Use original μ-law buffer
        {
          mimetype: 'audio/mulaw',
          model: model,
          language: 'en',
          smart_format: true,
          punctuate: true,
          tier: this.getTierForModel(model),
          encoding: 'mulaw',
          sample_rate: 8000,
          channels: 1
        }
      );
      
      const result = this.extractTranscriptionResult(fallbackResponse, language, hasVoiceActivity, model, fallbackUsed);
      logger.info(`🎯 μ-law format fallback successful: "${result.transcript}"`);
      
      return result;
      
    } catch (formatError) {
      logger.error(`μ-law format fallback failed: ${getErrorMessage(formatError)}`);
      
      // Final fallback to direct API call
      logger.warn('Attempting final direct API fallback');
      
      try {
        const response = await axios.post(
          'https://api.deepgram.com/v1/listen',
          originalAudioBuffer,
          {
            params: {
              model: model,
              language: 'en',
              smart_format: true,
              punctuate: true,
              tier: this.getTierForModel(model)
            },
            headers: {
              'Authorization': `Token ${this.deepgramApiKey}`,
              'Content-Type': 'audio/mulaw',
              'Accept': 'application/json'
            },
            timeout: 10000 // 10 second timeout
          }
        );
      
        const result = this.extractTranscriptionResultFromAxios(response.data, language, hasVoiceActivity, model, fallbackUsed);
        logger.info(`🎯 Direct API fallback successful: "${result.transcript}"`);
        
        return result;
        
      } catch (directApiError) {
        logger.error(`Direct API fallback failed: ${getErrorMessage(directApiError)}`);
        throw directApiError;
      }
    }
  }

  /**
   * Extract transcription result from Deepgram SDK response
   */
  private extractTranscriptionResult(
    response: any,
    language?: 'English' | 'Hindi',
    hasVoiceActivity: boolean = true,
    modelUsed: string = this.currentModel,
    fallbackUsed: boolean = false
  ): { transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean } {
    
    const channels = response.result?.results?.channels;
    const alternatives = channels?.[0]?.alternatives;
    const transcript = alternatives?.[0]?.transcript || '';
    const confidence = alternatives?.[0]?.confidence || 0;
    
    // Get detected language or use the provided one
    let detectedLanguage: 'English' | 'Hindi';
    if (response.result?.results?.channels?.[0]?.detected_language === 'hi') {
      detectedLanguage = 'Hindi';
    } else {
      detectedLanguage = 'English';
    }
    
    return {
      transcript,
      language: detectedLanguage,
      confidence,
      hasVoiceActivity,
      modelUsed,
      fallbackUsed
    };
  }

  /**
   * Extract transcription result from direct API response
   */
  private extractTranscriptionResultFromAxios(
    responseData: any,
    language?: 'English' | 'Hindi',
    hasVoiceActivity: boolean = true,
    modelUsed: string = this.currentModel,
    fallbackUsed: boolean = false
  ): { transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean } {
    
    const transcript = responseData?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence = responseData?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;
    
    // Get detected language or use the provided one
    let detectedLanguage: 'English' | 'Hindi';
    if (responseData?.results?.channels?.[0]?.detected_language === 'hi') {
      detectedLanguage = 'Hindi';
    } else {
      detectedLanguage = 'English';
    }
    
    return {
      transcript,
      language: detectedLanguage,
      confidence,
      hasVoiceActivity,
      modelUsed,
      fallbackUsed
    };
  }

  /**
   * Get appropriate tier setting for a given model
   */
  private getTierForModel(model: string): string {
    // Map models to their appropriate tier settings
    const tierMap: { [key: string]: string } = {
      'nova-2': 'enhanced',
      'nova-2-general': 'enhanced',
      'nova-2-meeting': 'enhanced',
      'nova-2-phonecall': 'enhanced',
      'nova': 'base',
      'nova-general': 'base',
      'base': 'base',
      'base-general': 'base'
    };
    
    return tierMap[model] || 'base';
  }

  /**
   * Update the preferred model and validate its availability
   */
  public async updatePreferredModel(model: string): Promise<{ success: boolean; actualModel: string; message: string }> {
    try {
      logger.info(`Updating preferred model from ${this.currentModel} to ${model}`);
      
      // Validate the new model
      const isValid = await this.validateModelAccess(model);
      
      if (isValid) {
        this.currentModel = model;
        logger.info(`Successfully updated preferred model to ${model}`);
        return {
          success: true,
          actualModel: model,
          message: `Model updated to ${model}`
        };
      } else {
        // Find the best available alternative
        const alternativeModel = await this.selectBestAvailableModel(model);
        this.currentModel = alternativeModel;
        
        logger.warn(`Requested model ${model} not available, using ${alternativeModel} instead`);
        return {
          success: false,
          actualModel: alternativeModel,
          message: `Requested model ${model} not available. Using ${alternativeModel} instead.`
        };
      }
    } catch (error) {
      logger.error(`Error updating preferred model: ${getErrorMessage(error)}`);
      return {
        success: false,
        actualModel: this.currentModel,
        message: `Failed to update model: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Get current model status and compatibility information
   */
  public async getModelStatus(): Promise<{
    currentModel: string;
    isValid: boolean;
    compatibleModels: string[];
    accountTier?: string;
    lastValidation?: Date;
  }> {
    try {
      const isCurrentModelValid = await this.validateModelAccess(this.currentModel);
      
      let compatibleModels: string[] = [];
      let accountTier: string | undefined;
      
      if (this.modelCompatibilityService && this.deepgramApiKey) {
        compatibleModels = await this.modelCompatibilityService.getCompatibleModels(this.deepgramApiKey);
        const capabilities = await this.modelCompatibilityService.getAccountCapabilities(this.deepgramApiKey);
        accountTier = capabilities.tier;
      }
      
      return {
        currentModel: this.currentModel,
        isValid: isCurrentModelValid,
        compatibleModels,
        accountTier,
        lastValidation: new Date()
      };
    } catch (error) {
      logger.error(`Error getting model status: ${getErrorMessage(error)}`);
      return {
        currentModel: this.currentModel,
        isValid: false,
        compatibleModels: [],
        lastValidation: new Date()
      };
    }
  }

  /**
   * Validate current configuration and suggest improvements
   */
  public async validateConfiguration(): Promise<{
    isValid: boolean;
    issues: string[];
    recommendations: string[];
    modelStatus: any;
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    try {
      // Check basic configuration
      if (!this.isDeepgramConfigured()) {
        issues.push('Deepgram is not properly configured');
        recommendations.push('Check API key and client initialization');
      }
      
      // Get model status
      const modelStatus = await this.getModelStatus();
      
      if (!modelStatus.isValid) {
        issues.push(`Current model ${modelStatus.currentModel} is not accessible`);
        
        if (modelStatus.compatibleModels.length > 0) {
          recommendations.push(`Consider using one of these compatible models: ${modelStatus.compatibleModels.slice(0, 3).join(', ')}`);
        } else {
          recommendations.push('Check your Deepgram account status and API key permissions');
        }
      }
      
      // Check if using optimal model for account tier
      if (modelStatus.accountTier && modelStatus.compatibleModels.length > 0) {
        const optimalModel = modelStatus.compatibleModels[0]; // First model is typically the best available
        if (this.currentModel !== optimalModel && modelStatus.compatibleModels.includes(optimalModel)) {
          recommendations.push(`Consider upgrading to ${optimalModel} for better transcription quality`);
        }
      }
      
      const isValid = issues.length === 0;
      
      logger.info('Configuration validation completed', {
        isValid,
        issuesCount: issues.length,
        recommendationsCount: recommendations.length,
        currentModel: this.currentModel
      });
      
      return {
        isValid,
        issues,
        recommendations,
        modelStatus
      };
    } catch (error) {
      logger.error(`Configuration validation failed: ${getErrorMessage(error)}`);
      
      return {
        isValid: false,
        issues: [`Validation failed: ${getErrorMessage(error)}`],
        recommendations: ['Check service configuration and try again'],
        modelStatus: { currentModel: this.currentModel, isValid: false, compatibleModels: [] }
      };
    }
  }

  /**
   * Convert μ-law audio to PCM format with proper WAV header for Deepgram
   * Twilio sends audio in μ-law format, but Deepgram works better with PCM WAV
   */
  private convertMuLawToPCM(muLawBuffer: Buffer): Buffer {
    try {
      // Use the same μ-law decode table as in voice activity detection
      const MULAW_DECODE_TABLE = [
        -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
        -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
        -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
        -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
        -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
        -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
        -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
        -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
        -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
        -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
        -876, -844, -812, -780, -748, -716, -684, -652,
        -620, -588, -556, -524, -492, -460, -428, -396,
        -372, -356, -340, -324, -308, -292, -276, -260,
        -244, -228, -212, -196, -180, -164, -148, -132,
        -120, -112, -104, -96, -88, -80, -72, -64,
        -56, -48, -40, -32, -24, -16, -8, 0,
        32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
        23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
        15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
        11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
        7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
        5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
        3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
        2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
        1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
        1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
        876, 844, 812, 780, 748, 716, 684, 652,
        620, 588, 556, 524, 492, 460, 428, 396,
        372, 356, 340, 324, 308, 292, 276, 260,
        244, 228, 212, 196, 180, 164, 148, 132,
        120, 112, 104, 96, 88, 80, 72, 64,
        56, 48, 40, 32, 24, 16, 8, 0
      ];
      
      // Convert each μ-law byte to 16-bit PCM using the lookup table
      const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);
      
      for (let i = 0; i < muLawBuffer.length; i++) {
        const muLawByte = muLawBuffer[i];
        const pcmSample = MULAW_DECODE_TABLE[muLawByte];
        pcmBuffer.writeInt16LE(pcmSample, i * 2);
      }
      
      // Create a proper WAV file with header for Deepgram
      return this.createWavFile(pcmBuffer, 8000, 1, 16);
    } catch (error) {
      logger.warn(`Error converting μ-law to PCM: ${getErrorMessage(error)}, using original buffer`);
      return muLawBuffer; // Return original buffer if conversion fails
    }
  }

  /**
   * Create a proper WAV file with header from PCM data
   * This creates a standard WAV file that Deepgram should accept
   */
  private createWavFile(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize; // Total file size minus 8 bytes for RIFF header
    
    const header = Buffer.alloc(44);
    let offset = 0;
    
    // RIFF header
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(fileSize, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;
    
    // fmt chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4; // fmt chunk size (16 for PCM)
    header.writeUInt16LE(1, offset); offset += 2; // audio format (1 = PCM)
    header.writeUInt16LE(channels, offset); offset += 2; // number of channels
    header.writeUInt32LE(sampleRate, offset); offset += 4; // sample rate
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, offset); offset += 4; // byte rate
    header.writeUInt16LE(channels * bitsPerSample / 8, offset); offset += 2; // block align
    header.writeUInt16LE(bitsPerSample, offset); offset += 2; // bits per sample
    
    // data chunk
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset);
    
    // Combine header and PCM data
    const wavFile = Buffer.concat([header, pcmData]);
    
    logger.debug(`📄 Created WAV file: ${wavFile.length} bytes (header: 44, data: ${dataSize})`);
    
    return wavFile;
  }

  // Comprehensive Speech Analysis
  async analyzeSpeech(audioText: string, audioFeatures?: any): Promise<SpeechAnalysis> {
    try {
      const analysisPrompt = `Analyze this customer speech comprehensively. Return JSON with:
      
      {
        "transcript": "${audioText}",
        "confidence": 0.9,
        "language": "English or Hindi",
        "intent": {
          "category": "question, objection, interest, concern, request, complaint, compliment",
          "confidence": 0.8,
          "entities": ["extracted entities"]
        },
        "sentiment": "positive, negative, or neutral",
        "speechFeatures": {
          "pace": 1.0,
          "volume": 0.8,
          "tone": "formal, casual, urgent, calm"
        }
      }
      
      Customer speech: "${audioText}"`;

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are an expert speech analysis AI. Analyze customer speech for intent, sentiment, and communication patterns. Always return valid JSON.'
            },
            {
              role: 'user',
              content: analysisPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openAIApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const analysis = JSON.parse(response.data.choices[0].message.content);
      
      // Enhance with audio features if provided
      if (audioFeatures) {
        analysis.speechFeatures = {
          ...analysis.speechFeatures,
          ...audioFeatures
        };
      }

      logger.info('Speech analysis completed:', analysis);
      return analysis;
    } catch (error) {
      logger.error('Error analyzing speech:', error);
      return this.getFallbackAnalysis(audioText);
    }
  }

  // Intent Analysis and Classification
  async analyzeIntent(transcript: string, conversationHistory: any[]): Promise<{
    intent: string;
    confidence: number;
    entities: any[];
    suggestedAction: string;
  }> {
    try {
      const intentPrompt = `Analyze customer intent from this conversation:
      
      Recent history: ${JSON.stringify(conversationHistory.slice(-3))}
      Current message: "${transcript}"
      
      Classify intent as one of:
      - information_request
      - price_inquiry  
      - objection_handling
      - interest_expression
      - scheduling_request
      - complaint
      - technical_question
      - competitor_comparison
      - budget_concern
      - decision_making
      
      Return JSON with intent, confidence (0-1), entities, and suggestedAction.`;

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are an expert intent classification system for sales conversations.'
            },
            {
              role: 'user',
              content: intentPrompt
            }
          ],
          temperature: 0.2,
          max_tokens: 300
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openAIApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      logger.error('Error analyzing intent:', error);
      return {
        intent: 'information_request',
        confidence: 0.5,
        entities: [],
        suggestedAction: 'provide_information'
      };
    }
  }

  // Context-Aware Conversation Management
  async updateConversationContext(
    context: ConversationContext,
    newAnalysis: SpeechAnalysis,
    agentResponse?: string
  ): Promise<ConversationContext> {
    try {
      const updatePrompt = `Update conversation context based on new customer input:
      
      Current Context: ${JSON.stringify(context)}
      New Customer Input Analysis: ${JSON.stringify(newAnalysis)}
      Agent Response: ${agentResponse || 'None yet'}
      
      Update and return the conversation context with:
      - Updated customer profile (mood, interests, objections, engagement_level)
      - Progress tracking (stage, completed_objectives, next_steps)
      - Incremented turn counter
      
      Return complete updated context as JSON.`;

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a conversation context manager. Track customer state and conversation progress accurately.'
            },
            {
              role: 'user',
              content: updatePrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 600
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openAIApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const updatedContext = JSON.parse(response.data.choices[0].message.content);
      logger.info('Conversation context updated:', updatedContext);
      
      return updatedContext;
    } catch (error) {
      logger.error('Error updating conversation context:', error);
      // Fallback: manual context update
      return {
        ...context,
        currentTurn: context.currentTurn + 1,
        customerProfile: {
          ...context.customerProfile,
          mood: newAnalysis.sentiment,
          engagement_level: Math.min(context.customerProfile.engagement_level + 0.1, 1.0)
        }
      };
    }
  }

  // Bilingual Language Detection
  private detectLanguage(text: string): 'English' | 'Hindi' {
    // Simple language detection based on script
    const hindiPattern = /[\u0900-\u097F]/;
    const englishPattern = /[a-zA-Z]/;
    
    const hindiMatches = (text.match(hindiPattern) || []).length;
    const englishMatches = (text.match(englishPattern) || []).length;
    
    if (hindiMatches > englishMatches) {
      return 'Hindi';
    }
    return 'English';
  }

  // Fallback analysis for error cases
  private getFallbackAnalysis(audioText: string): SpeechAnalysis {
    return {
      transcript: audioText,
      confidence: 0.5,
      language: this.detectLanguage(audioText),
      intent: {
        category: 'information_request',
        confidence: 0.5,
        entities: []
      },
      sentiment: 'neutral',
      speechFeatures: {
        pace: 1.0,
        volume: 0.5,
        tone: 'neutral'
      }
    };
  }

  // Conversation Quality Tracking
  async trackConversationQuality(
    conversationHistory: Array<{ role: string; content: string; timestamp: Date }>,
    currentResponse: string
  ): Promise<{
    qualityTrend: 'improving' | 'declining' | 'stable';
    recommendations: string[];
    alertLevel: 'low' | 'medium' | 'high';
  }> {
    try {
      // Simple quality assessment based on conversation length and engagement
      const customerResponses = conversationHistory.filter(entry => entry.role === 'user');
      const avgResponseLength = customerResponses.reduce((sum, resp) => sum + resp.content.length, 0) / customerResponses.length || 0;
      
      let qualityTrend: 'improving' | 'declining' | 'stable' = 'stable';
      let alertLevel: 'low' | 'medium' | 'high' = 'low';
      
      if (avgResponseLength > 50) {
        qualityTrend = 'improving';
      } else if (avgResponseLength < 20) {
        qualityTrend = 'declining';
        alertLevel = 'medium';
      }
      
      const recommendations = [
        'Continue with current approach',
        'Monitor customer engagement',
        'Adjust conversation pace as needed'
      ];
      
      return {
        qualityTrend,
        recommendations,
        alertLevel
      };
    } catch (error) {
      logger.error('Error tracking conversation quality:', error);
      return {
        qualityTrend: 'stable',
        recommendations: ['Continue with current approach'],
        alertLevel: 'low'
      };
    }
  }
}

export default SpeechAnalysisService;
