import axios from 'axios';
import { logger } from '../index';
import { createClient } from '@deepgram/sdk';
import { getErrorMessage } from '../utils/logger';

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

  constructor(openAIApiKey: string, googleSpeechKey?: string, deepgramApiKey?: string) {
    this.openAIApiKey = openAIApiKey;
    this.googleSpeechKey = googleSpeechKey;
    this.deepgramApiKey = deepgramApiKey;
    
    if (deepgramApiKey) {
      this.initializeDeepgram(deepgramApiKey);
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
   * Detect if there is voice activity in the audio buffer
   * This is a simple energy-based voice activity detection
   */
  detectVoiceActivity(audioBuffer: Buffer): boolean {
    try {
      // Simple energy-based voice activity detection
      // This is a basic implementation that checks if the audio buffer has enough energy
      
      // Convert buffer to 16-bit PCM samples
      const samples = [];
      for (let i = 0; i < audioBuffer.length; i += 2) {
        if (i + 1 < audioBuffer.length) {
          // Convert two bytes to a 16-bit sample
          const sample = audioBuffer.readInt16LE(i);
          samples.push(sample);
        }
      }
      
      // Calculate energy
      let energy = 0;
      for (const sample of samples) {
        energy += Math.abs(sample);
      }
      
      // Normalize energy
      const avgEnergy = energy / samples.length;
      
      // Threshold for voice activity detection
      const threshold = 500; // Adjust this threshold based on your audio characteristics
      
      return avgEnergy > threshold;
    } catch (error) {
      logger.warn(`Error detecting voice activity: ${getErrorMessage(error)}`);
      return false; // Default to no voice activity on error
    }
  }

  // Speech-to-Text with Language Detection using Deepgram Nova-2
  async transcribeAudio(
    audioBuffer: Buffer,
    language?: 'English' | 'Hindi'
  ): Promise<{ transcript: string; language: string; confidence: number; hasVoiceActivity: boolean }> {
    try {
      // Check if Deepgram is properly configured
      if (!this.isDeepgramConfigured()) {
        const errorMsg = `Deepgram is not properly configured. API key: ${this.deepgramApiKey ? 'SET' : 'NOT SET'}, Client: ${this.deepgramClient ? 'SET' : 'NOT SET'}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      logger.info(`Using Deepgram Nova-2 for transcription with API key length: ${this.deepgramApiKey!.length}`);
      
      // Prepare transcription options for Deepgram v4
      const options = {
        model: 'nova-2',
        smart_format: true,
        language: language ? (language === 'English' ? 'en' : 'hi') : undefined,
        detect_language: language ? false : true,
        punctuate: true,
        utterances: true,
        diarize: true,
        tier: 'enhanced'
      };
      
      try {
        // Use the Deepgram SDK v4 API - for audio files we need to use a different method
        const response = await this.deepgramClient.listen.prerecorded.transcribeFile(
          audioBuffer,
          options
        );
        
        // Extract the transcript from response
        const transcript = response.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        const confidence = response.result?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;
        
        // Get detected language or use the provided one
        let detectedLanguage: 'English' | 'Hindi';
        if (response.result?.results?.channels?.[0]?.detected_language === 'hi') {
          detectedLanguage = 'Hindi';
        } else {
          detectedLanguage = 'English';
        }
        
        // Check for voice activity using our detector
        const hasVoiceActivity = this.detectVoiceActivity(audioBuffer) || transcript.trim().length > 0;
        
        logger.info(`Deepgram transcription completed successfully: "${transcript}" (Voice activity: ${hasVoiceActivity ? 'YES' : 'NO'})`);
        
        return {
          transcript,
          language: detectedLanguage,
          confidence,
          hasVoiceActivity
        };
      } catch (deepgramError) {
        logger.error(`Deepgram SDK error: ${getErrorMessage(deepgramError)}`);
        logger.warn('Attempting fallback to direct API call');
        
        // Fallback to direct API call with axios
        const response = await axios.post(
          'https://api.deepgram.com/v1/listen',
          audioBuffer,
          {
            params: options,
            headers: {
              'Authorization': `Token ${this.deepgramApiKey}`,
              'Content-Type': 'audio/wav'
            }
          }
        );
        
        // Extract the transcript from response
        const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        const confidence = response.data?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;
        
        // Get detected language or use the provided one
        let detectedLanguage: 'English' | 'Hindi';
        if (response.data?.results?.channels?.[0]?.detected_language === 'hi') {
          detectedLanguage = 'Hindi';
        } else {
          detectedLanguage = 'English';
        }
        
        // Check for voice activity using our detector
        const hasVoiceActivity = this.detectVoiceActivity(audioBuffer) || transcript.trim().length > 0;
        
        logger.info(`Deepgram transcription completed via direct API: "${transcript}" (Voice activity: ${hasVoiceActivity ? 'YES' : 'NO'})`);
        
        return {
          transcript,
          language: detectedLanguage,
          confidence,
          hasVoiceActivity
        };
      }
    } catch (error) {
      logger.error(`Error transcribing audio: ${getErrorMessage(error)}`);
      throw new Error(`Failed to transcribe audio: ${getErrorMessage(error)}`);
    }
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
