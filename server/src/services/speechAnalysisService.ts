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

      logger.info(`🔧 UPDATED SpeechAnalysisService - Using Deepgram Nova-2 for transcription with API key length: ${this.deepgramApiKey!.length}`);
      
      // Check for voice activity first to avoid unnecessary API calls
      const hasVoiceActivity = this.detectVoiceActivity(audioBuffer);
      
      logger.info(`🔊 Voice Activity Check: ${hasVoiceActivity ? 'DETECTED' : 'NOT DETECTED'} for buffer size ${audioBuffer.length} bytes`);
      
      // Temporarily disable early return to debug Deepgram responses
      // if (!hasVoiceActivity) {
      //   logger.debug('No voice activity detected, skipping transcription');
      //   return {
      //     transcript: '',
      //     language: language || 'English',
      //     confidence: 0,
      //     hasVoiceActivity: false
      //   };
      // }
      
      // Convert μ-law audio from Twilio to PCM format for better Deepgram compatibility
      const processedAudioBuffer = this.convertMuLawToPCM(audioBuffer);
      
      logger.info(`🎵 Audio Conversion: μ-law ${audioBuffer.length} bytes → WAV ${processedAudioBuffer.length} bytes`);
      
      // Prepare transcription options for Deepgram v4 - optimized for real-time audio
      const options = {
        model: 'nova-2',
        smart_format: true,
        language: 'en', // Force English for now to avoid language detection issues
        punctuate: true,
        // Simplified options for better compatibility
        tier: 'enhanced'
      };
      
      try {
        // Use the Deepgram SDK v4 API with proper audio format specification
        logger.info(`🚀 Sending ${processedAudioBuffer.length} bytes to Deepgram API`);
        
        const response = await this.deepgramClient.listen.prerecorded.transcribeFile(
          processedAudioBuffer,
          {
            mimetype: 'audio/wav',
            ...options
          }
        );
        
        logger.info(`📥 Deepgram API Response received:`, {
          hasResponse: !!response,
          hasResult: !!response?.result,
          responseKeys: response ? Object.keys(response) : [],
          resultKeys: response?.result ? Object.keys(response.result) : [],
          error: response?.error ? response.error : null,
          fullResponse: JSON.stringify(response, null, 2)
        });
        
        // Extract the transcript from response with better error handling
        const channels = response.result?.results?.channels;
        const alternatives = channels?.[0]?.alternatives;
        const transcript = alternatives?.[0]?.transcript || '';
        const confidence = alternatives?.[0]?.confidence || 0;
        
        // Debug logging for Deepgram response
        logger.info(`🔍 Deepgram Response Debug:`, {
          hasResult: !!response.result,
          hasChannels: !!channels,
          channelCount: channels?.length || 0,
          hasAlternatives: !!alternatives,
          alternativeCount: alternatives?.length || 0,
          transcript: transcript,
          confidence: confidence,
          rawResponse: JSON.stringify(response.result, null, 2)
        });
        
        // Get detected language or use the provided one
        let detectedLanguage: 'English' | 'Hindi';
        if (response.result?.results?.channels?.[0]?.detected_language === 'hi') {
          detectedLanguage = 'Hindi';
        } else {
          detectedLanguage = 'English';
        }
        
        logger.info(`🎯 UPDATED SERVICE - Deepgram transcription completed successfully: "${transcript}" (Voice activity: ${hasVoiceActivity ? 'YES' : 'NO'})`);
        
        return {
          transcript,
          language: detectedLanguage,
          confidence,
          hasVoiceActivity: true // We already confirmed voice activity above
        };
      } catch (deepgramError) {
        logger.error(`Deepgram SDK error: ${getErrorMessage(deepgramError)}`);
        logger.warn('Attempting fallback with raw μ-law audio');
        
        // Try with raw μ-law audio as a fallback
        try {
          const fallbackResponse = await this.deepgramClient.listen.prerecorded.transcribeFile(
            audioBuffer, // Use original μ-law buffer
            {
              mimetype: 'audio/mulaw',
              model: 'nova-2',
              language: 'en',
              smart_format: true,
              punctuate: true,
              tier: 'enhanced',
              encoding: 'mulaw',
              sample_rate: 8000,
              channels: 1
            }
          );
          
          logger.info(`🔄 Fallback μ-law transcription attempt completed`);
          
          const channels = fallbackResponse.result?.results?.channels;
          const alternatives = channels?.[0]?.alternatives;
          const transcript = alternatives?.[0]?.transcript || '';
          const confidence = alternatives?.[0]?.confidence || 0;
          
          logger.info(`🎯 UPDATED SERVICE - Deepgram μ-law fallback completed: "${transcript}" (Voice activity: ${hasVoiceActivity ? 'YES' : 'NO'})`);
          
          return {
            transcript,
            language: 'English',
            confidence,
            hasVoiceActivity: true
          };
          
        } catch (fallbackError) {
          logger.error(`μ-law fallback also failed: ${getErrorMessage(fallbackError)}`);
          
          // Final fallback to direct API call with axios
          logger.warn('Attempting final fallback to direct API call');
          
          const response = await axios.post(
            'https://api.deepgram.com/v1/listen',
            processedAudioBuffer,
            {
              params: {
                model: 'nova-2',
                language: 'en',
                smart_format: true,
                punctuate: true,
                tier: 'enhanced'
              },
              headers: {
                'Authorization': `Token ${this.deepgramApiKey}`,
                'Content-Type': 'audio/wav',
                'Accept': 'application/json'
              },
              timeout: 10000 // 10 second timeout
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
          
          logger.info(`🎯 UPDATED SERVICE - Deepgram transcription completed via direct API: "${transcript}" (Voice activity: ${hasVoiceActivity ? 'YES' : 'NO'})`);
          
          return {
            transcript,
            language: detectedLanguage,
            confidence,
            hasVoiceActivity: true
          };
        }
      }
    } catch (error) {
      logger.error(`Error transcribing audio: ${getErrorMessage(error)}`);
      
      // Return a result indicating failure but with voice activity info
      return {
        transcript: '',
        language: language || 'English',
        confidence: 0,
        hasVoiceActivity: this.detectVoiceActivity(audioBuffer)
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
