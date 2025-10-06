import axios from 'axios';
import { logger } from '../index';
import { createClient } from '@deepgram/sdk';
import { getErrorMessage } from '../utils/logger';
import { ModelCompatibilityService, ModelValidationResult, ModelPreferences } from './modelCompatibilityService';
import { deepgramErrorHandler, ErrorClassificationResult } from './deepgramErrorHandler';
import { convertMuLawToPCM, detectVoiceActivity } from '../utils/audioUtils';
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

  private initializeDeepgram(apiKey: string): void {
    try {
      if (!apiKey || apiKey.length < 10) {
        logger.warn('Invalid Deepgram API key provided - must be at least 10 characters');
        return;
      }
      
      this.deepgramClient = createClient(apiKey);
      logger.info(`Deepgram client initialized successfully with API key (length: ${apiKey.length})`);
    } catch (error) {
      logger.error(`Failed to initialize Deepgram client: ${getErrorMessage(error)}`);
      this.deepgramClient = undefined;
    }
  }

  private initializeModelCompatibilityService(apiKey: string): void {
    try {
      this.modelCompatibilityService = new ModelCompatibilityService(apiKey);
      logger.info('Model Compatibility Service initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize Model Compatibility Service: ${getErrorMessage(error)}`);
      this.modelCompatibilityService = undefined;
    }
  }

  public isDeepgramConfigured(): boolean {
    return !!(this.deepgramApiKey && this.deepgramClient && this.deepgramApiKey.length > 10);
  }

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
      this.modelValidationCache.clear();
    }
    logger.info('SpeechAnalysisService API keys updated');
  }

  public getOpenAIApiKey(): string {
    return this.openAIApiKey;
  }

  public getGoogleSpeechKey(): string | undefined {
    return this.googleSpeechKey;
  }

  public getDeepgramApiKey(): string | undefined {
    return this.deepgramApiKey;
  }

  private async validateModelAccess(model: string): Promise<boolean> {
    if (!this.modelCompatibilityService || !this.deepgramApiKey) {
      return false;
    }

    const cacheKey = `${model}-${this.deepgramApiKey.slice(-8)}`;
    const cached = this.modelValidationCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.VALIDATION_CACHE_TTL) {
      logger.debug(`Using cached validation result for model ${model}: ${cached.isValid}`);
      return cached.isValid;
    }

    try {
      const validation = await this.modelCompatibilityService.validateModelAccess(this.deepgramApiKey, model);
      
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
      
      this.modelValidationCache.set(cacheKey, {
        isValid: false,
        timestamp: Date.now()
      });
      
      return false;
    }
  }

  private async selectBestAvailableModel(preferredModel?: string): Promise<string> {
    if (!this.modelCompatibilityService || !this.deepgramApiKey) {
      logger.warn('Model compatibility service not available, using fallback model');
      return 'base';
    }

    try {
      const compatibleModels = await this.modelCompatibilityService.getCompatibleModels(this.deepgramApiKey);
      
      if (compatibleModels.length === 0) {
        logger.warn('No compatible models found, using ultimate fallback');
        return 'base';
      }

      const preferences: ModelPreferences = {
        preferredModels: preferredModel ? [preferredModel, ...this.fallbackModels] : [this.currentModel, ...this.fallbackModels],
        useCase: 'phone',
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
      return 'base';
    }
  }

  private async handleModelCompatibilityError(error: any, currentModel: string): Promise<string> {
    if (!this.modelCompatibilityService) {
      logger.warn('Model compatibility service not available for error handling');
      return this.fallbackModels[0] || 'base';
    }

    try {
      const classification: ErrorClassificationResult = deepgramErrorHandler.classifyError(error);
      
      logger.warn('Handling model compatibility error', {
        currentModel,
        errorType: classification.errorType,
        isRecoverable: classification.isRecoverable,
        suggestedAction: classification.suggestedAction
      });

      const fallbackModel = this.modelCompatibilityService.handleModelFallback(currentModel, error);
      
      const isFallbackValid = await this.validateModelAccess(fallbackModel);
      
      if (isFallbackValid) {
        logger.info(`Successfully selected fallback model: ${fallbackModel}`, {
          originalModel: currentModel,
          errorType: classification.errorType
        });
        return fallbackModel;
      } else {
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
        
        logger.warn('All fallback models failed validation, using ultimate fallback: base');
        return 'base';
      }
    } catch (fallbackError) {
      logger.error(`Error in fallback handling: ${getErrorMessage(fallbackError)}`);
      return 'base';
    }
  }

  private logModelTransition(fromModel: string, toModel: string, reason: string): void {
    if (fromModel !== toModel) {
      logger.info('Model transition occurred', {
        fromModel,
        toModel,
        reason,
        timestamp: new Date().toISOString(),
        userImpact: 'Transcription continues with alternative model'
      });
    }
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    language?: 'English' | 'Hindi'
  ): Promise<{ transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean }> {
    const startTime = Date.now();
    let modelUsed = this.currentModel;
    let fallbackUsed = false;

    try {
      if (!this.isDeepgramConfigured()) {
        const errorMsg = `Deepgram is not properly configured. API key: ${this.deepgramApiKey ? 'SET' : 'NOT SET'}, Client: ${this.deepgramClient ? 'SET' : 'NOT SET'}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      const hasVoiceActivity = detectVoiceActivity(audioBuffer);
      
      logger.info(`🔊 Voice Activity Check: ${hasVoiceActivity ? 'DETECTED' : 'NOT DETECTED'} for buffer size ${audioBuffer.length} bytes`);
      
      const selectedModel = await this.selectBestAvailableModel();
      modelUsed = selectedModel;
      
      if (selectedModel !== this.currentModel) {
        fallbackUsed = true;
        this.logModelTransition(this.currentModel, selectedModel, 'Model compatibility check');
      }

      logger.info(`🔧 Using Deepgram model: ${selectedModel} for transcription (fallback: ${fallbackUsed})`);
      
      const processedAudioBuffer = convertMuLawToPCM(audioBuffer);
      
      logger.info(`🎵 Audio Conversion: μ-law ${audioBuffer.length} bytes → WAV ${processedAudioBuffer.length} bytes`);
      
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
      
      return {
        transcript: '',
        language: language || 'English',
        confidence: 0,
        hasVoiceActivity: detectVoiceActivity(audioBuffer),
        modelUsed,
        fallbackUsed
      };
    }
  }

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
        
        const options = {
          model: currentModel,
          smart_format: true,
          language: 'en',
          punctuate: true,
          tier: this.getTierForModel(currentModel)
        };
        
        const response = await this.deepgramClient.listen.prerecorded.transcribeFile(
          processedAudioBuffer,
          {
            mimetype: 'audio/wav',
            ...options
          }
        );
        
        const result = this.extractTranscriptionResult(response, language, hasVoiceActivity, currentModel, fallbackUsed);
        
        const duration = Date.now() - startTime;
        logger.info(`🎯 Transcription successful with model ${currentModel} after ${duration}ms: "${result.transcript}"`);
        
        return result;

      } catch (error) {
        logger.warn(`Transcription attempt ${attempt} failed with model ${currentModel}: ${getErrorMessage(error)}`);
        
        const classification = deepgramErrorHandler.classifyError(error);
        
        if (attempt === maxAttempts || !classification.isRecoverable) {
          if (attempt < maxAttempts) {
            logger.info('Attempting format fallback with μ-law audio');
            return await this.attemptFormatFallback(originalAudioBuffer, currentModel, language, hasVoiceActivity, fallbackUsed);
          }
          throw error;
        }

        const fallbackModel = await this.handleModelCompatibilityError(error, currentModel);
        
        if (fallbackModel === currentModel) {
          logger.info('No different model available, attempting format fallback');
          return await this.attemptFormatFallback(originalAudioBuffer, currentModel, language, hasVoiceActivity, fallbackUsed);
        }

        this.logModelTransition(currentModel, fallbackModel, `Error: ${classification.errorType}`);
        currentModel = fallbackModel;
        fallbackUsed = true;
        
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          logger.info(`Waiting ${delay}ms before retry attempt ${attempt + 1}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error('All transcription attempts failed');
  }

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
        originalAudioBuffer,
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
            timeout: 10000
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

  private extractTranscriptionResultFromAxios(
    responseData: any,
    language?: 'English' | 'Hindi',
    hasVoiceActivity: boolean = true,
    modelUsed: string = this.currentModel,
    fallbackUsed: boolean = false
  ): { transcript: string; language: string; confidence: number; hasVoiceActivity: boolean; modelUsed?: string; fallbackUsed?: boolean } {
    
    const transcript = responseData?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence = responseData?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;
    
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

  private getTierForModel(model: string): string {
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

  public async updatePreferredModel(model: string): Promise<{ success: boolean; actualModel: string; message: string }> {
    try {
      logger.info(`Updating preferred model from ${this.currentModel} to ${model}`);
      
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

  public async validateConfiguration(): Promise<{
    isValid: boolean;
    issues: string[];
    recommendations: string[];
    modelStatus: any;
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    try {
      if (!this.isDeepgramConfigured()) {
        issues.push('Deepgram is not properly configured');
        recommendations.push('Check API key and client initialization');
      }
      
      const modelStatus = await this.getModelStatus();
      
      if (!modelStatus.isValid) {
        issues.push(`Current model ${modelStatus.currentModel} is not accessible`);
        
        if (modelStatus.compatibleModels.length > 0) {
          recommendations.push(`Consider using one of these compatible models: ${modelStatus.compatibleModels.slice(0, 3).join(', ')}`);
        } else {
          recommendations.push('Check your Deepgram account status and API key permissions');
        }
      }
      
      if (modelStatus.accountTier && modelStatus.compatibleModels.length > 0) {
        const optimalModel = modelStatus.compatibleModels[0];
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

  private detectLanguage(text: string): 'English' | 'Hindi' {
    const hindiPattern = /[\u0900-\u097F]/;
    const englishPattern = /[a-zA-Z]/;
    
    const hindiMatches = (text.match(hindiPattern) || []).length;
    const englishMatches = (text.match(englishPattern) || []).length;
    
    if (hindiMatches > englishMatches) {
      return 'Hindi';
    }
    return 'English';
  }

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

  async trackConversationQuality(
    conversationHistory: Array<{ role: string; content: string; timestamp: Date }>,
    currentResponse: string
  ): Promise<{
    qualityTrend: 'improving' | 'declining' | 'stable';
    recommendations: string[];
    alertLevel: 'low' | 'medium' | 'high';
  }> {
    try {
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

  /**
   * Analyze speech from audio data or file path
   * @param audioData Buffer or file path
   * @param context Optional conversation context
   * @returns Speech analysis result
   */
  public async analyzeSpeech(audioData: Buffer | string, context?: any): Promise<SpeechAnalysis> {
    try {
      let audioBuffer: Buffer;
      
      // Handle both Buffer and file path inputs
      if (typeof audioData === 'string') {
        // File path provided
        const fs = require('fs');
        audioBuffer = fs.readFileSync(audioData);
      } else {
        // Buffer provided
        audioBuffer = audioData;
      }

      // Convert audio to PCM if needed
      const pcmBuffer = convertMuLawToPCM(audioBuffer);
      
      // Use Deepgram for transcription
      if (this.deepgramClient) {
        const response = await this.deepgramClient.listen.prerecorded.transcribeFile(
          pcmBuffer,
          {
            mimetype: 'audio/wav',
            model: this.currentModel,
            language: 'en',
            punctuate: true,
            smart_format: true
          }
        );

        const transcript = response.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        const confidence = response.result?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

        // Analyze the transcript for intent and sentiment
        const analysis = await this.analyzeTranscript(transcript, context);
        
        return {
          transcript,
          confidence,
          language: this.detectLanguage(transcript),
          intent: analysis.intent,
          sentiment: analysis.sentiment,
          speechFeatures: analysis.speechFeatures
        };
      } else {
        // Fallback analysis
        return this.getFallbackAnalysis('Audio transcription not available');
      }
    } catch (error) {
      logger.error(`Speech analysis failed: ${getErrorMessage(error)}`);
      return this.getFallbackAnalysis('Speech analysis failed');
    }
  }

  /**
   * Analyze transcript for intent and sentiment
   */
  private async analyzeTranscript(transcript: string, context?: any): Promise<{
    intent: { category: string; confidence: number; entities: any[] };
    sentiment: 'positive' | 'negative' | 'neutral';
    speechFeatures: { pace: number; volume: number; tone: string };
  }> {
    // Simple intent detection
    const lowerTranscript = transcript.toLowerCase();
    let intent = { category: 'information_request', confidence: 0.5, entities: [] };
    
    if (lowerTranscript.includes('buy') || lowerTranscript.includes('purchase')) {
      intent = { category: 'purchase_intent', confidence: 0.8, entities: [] };
    } else if (lowerTranscript.includes('price') || lowerTranscript.includes('cost')) {
      intent = { category: 'pricing_inquiry', confidence: 0.7, entities: [] };
    } else if (lowerTranscript.includes('help') || lowerTranscript.includes('support')) {
      intent = { category: 'support_request', confidence: 0.8, entities: [] };
    }

    // Simple sentiment analysis
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'love', 'like'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'dislike', 'problem'];
    
    const positiveCount = positiveWords.filter(word => lowerTranscript.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerTranscript.includes(word)).length;
    
    if (positiveCount > negativeCount) {
      sentiment = 'positive';
    } else if (negativeCount > positiveCount) {
      sentiment = 'negative';
    }

    return {
      intent,
      sentiment,
      speechFeatures: {
        pace: 1.0,
        volume: 0.5,
        tone: sentiment
      }
    };
  }
}

export default SpeechAnalysisService;