/**
 * Enhanced Voice AI Pipeline
 * 
 * Advanced voice synthesis service with emotion detection, streaming capabilities,
 * and multi-voice personality adaptation.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { ElevenLabsSDKService } from '../elevenlabsSDKService';
import { getAIOrchestration, ServiceType } from '../aiOrchestration/orchestrationLayer';
import logger from '../../utils/logger';
import { getErrorMessage } from '../../utils/logger';
import mongoose from 'mongoose';
import { LLMMessage, MessageRole } from '../llm/types';

// Voice events
export enum VoiceEvent {
  SYNTHESIS_START = 'synthesis-start',
  SYNTHESIS_COMPLETE = 'synthesis-complete',
  SYNTHESIS_ERROR = 'synthesis-error',
  AUDIO_CHUNK = 'audio-chunk',
  EMOTION_DETECTED = 'emotion-detected',
  STREAMING_START = 'streaming-start',
  STREAMING_COMPLETE = 'streaming-complete',
  CONVERSATION_UPDATE = 'conversation-update'
}

// Voice personality types
export enum VoicePersonality {
  FRIENDLY = 'friendly',
  PROFESSIONAL = 'professional',
  EMPATHETIC = 'empathetic',
  ENTHUSIASTIC = 'enthusiastic',
  CALM = 'calm',
  AUTHORITATIVE = 'authoritative',
  CUSTOM = 'custom'
}

// Voice emotion types
export enum VoiceEmotion {
  NEUTRAL = 'neutral',
  HAPPY = 'happy',
  SAD = 'sad',
  ANGRY = 'angry',
  FEARFUL = 'fearful',
  SURPRISED = 'surprised',
  EXCITED = 'excited',
  DISAPPOINTED = 'disappointed',
  CONFUSED = 'confused',
  EMPATHETIC = 'empathetic'
}

// Language support
export enum VoiceLanguage {
  ENGLISH = 'en',
  SPANISH = 'es',
  FRENCH = 'fr',
  GERMAN = 'de',
  ITALIAN = 'it',
  PORTUGUESE = 'pt',
  JAPANESE = 'ja',
  KOREAN = 'ko',
  CHINESE = 'zh'
}

// Voice synthesis configuration
export interface VoiceSynthesisConfig {
  personality: VoicePersonality;
  emotion: VoiceEmotion;
  language: VoiceLanguage;
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
  useEmotionDetection: boolean;
  useAdaptiveVoice: boolean;
  useStreamingMode: boolean;
  enhanceProsody: boolean;
  enhanceClarity: boolean;
  voiceId?: string;
  customAttributes?: Record<string, any>;
}

// Voice synthesis result
export interface VoiceSynthesisResult {
  audioData: Buffer | null;
  audioStream?: Readable;
  audioFilePath?: string;
  duration: number;
  wordCount: number;
  emotionAnalysis?: {
    dominantEmotion: VoiceEmotion;
    emotionScores: Record<VoiceEmotion, number>;
  };
  metadata: {
    requestId: string;
    timestamp: Date;
    config: VoiceSynthesisConfig;
    textLength: number;
    processingTime: number;
  };
}

// Streaming audio chunk
export interface AudioChunk {
  chunk: Buffer;
  timestamp: number;
  isLast: boolean;
  index: number;
}

// Voice synthesis options for the API
export interface VoiceSynthesisOptions {
  text: string;
  personality?: VoicePersonality;
  emotion?: VoiceEmotion;
  language?: VoiceLanguage;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  enhanceProsody?: boolean;
  enhanceClarity?: boolean;
  voiceId?: string;
  outputFormat?: 'mp3' | 'wav' | 'ogg' | 'flac';
  streaming?: boolean;
  saveToFile?: boolean;
  customAttributes?: Record<string, any>;
}

// Default configuration values
const DEFAULT_CONFIG: VoiceSynthesisConfig = {
  personality: VoicePersonality.PROFESSIONAL,
  emotion: VoiceEmotion.NEUTRAL,
  language: VoiceLanguage.ENGLISH,
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.5,
  useEmotionDetection: true,
  useAdaptiveVoice: true,
  useStreamingMode: true,
  enhanceProsody: true,
  enhanceClarity: true
};

// Emotion mapping for voice parameters
const EMOTION_MAPPING: Record<VoiceEmotion, { stability: number; similarityBoost: number; style: number }> = {
  [VoiceEmotion.NEUTRAL]: { stability: 0.5, similarityBoost: 0.75, style: 0.5 },
  [VoiceEmotion.HAPPY]: { stability: 0.4, similarityBoost: 0.8, style: 0.7 },
  [VoiceEmotion.SAD]: { stability: 0.7, similarityBoost: 0.6, style: 0.3 },
  [VoiceEmotion.ANGRY]: { stability: 0.3, similarityBoost: 0.9, style: 0.8 },
  [VoiceEmotion.FEARFUL]: { stability: 0.6, similarityBoost: 0.7, style: 0.4 },
  [VoiceEmotion.SURPRISED]: { stability: 0.3, similarityBoost: 0.8, style: 0.6 },
  [VoiceEmotion.EXCITED]: { stability: 0.3, similarityBoost: 0.9, style: 0.9 },
  [VoiceEmotion.DISAPPOINTED]: { stability: 0.6, similarityBoost: 0.7, style: 0.4 },
  [VoiceEmotion.CONFUSED]: { stability: 0.5, similarityBoost: 0.6, style: 0.5 },
  [VoiceEmotion.EMPATHETIC]: { stability: 0.6, similarityBoost: 0.7, style: 0.6 }
};

// Personality mapping for voice parameters
const PERSONALITY_MAPPING: Record<VoicePersonality, { stability: number; similarityBoost: number; style: number }> = {
  [VoicePersonality.FRIENDLY]: { stability: 0.5, similarityBoost: 0.8, style: 0.7 },
  [VoicePersonality.PROFESSIONAL]: { stability: 0.7, similarityBoost: 0.6, style: 0.4 },
  [VoicePersonality.EMPATHETIC]: { stability: 0.6, similarityBoost: 0.7, style: 0.5 },
  [VoicePersonality.ENTHUSIASTIC]: { stability: 0.4, similarityBoost: 0.9, style: 0.8 },
  [VoicePersonality.CALM]: { stability: 0.8, similarityBoost: 0.6, style: 0.3 },
  [VoicePersonality.AUTHORITATIVE]: { stability: 0.7, similarityBoost: 0.7, style: 0.6 },
  [VoicePersonality.CUSTOM]: { stability: 0.5, similarityBoost: 0.75, style: 0.5 }
};

/**
 * Enhanced Voice AI Pipeline with emotion detection and streaming capabilities
 */
export class EnhancedVoiceAIPipeline extends EventEmitter {
  private elevenLabsService: ElevenLabsSDKService | null = null;
  private defaultConfig: VoiceSynthesisConfig;
  private uploadsPath: string;
  private activeStreams: Map<string, { stream: Readable; chunks: AudioChunk[] }> = new Map();
  
  constructor() {
    super();
    this.defaultConfig = { ...DEFAULT_CONFIG };
    this.uploadsPath = path.join(process.cwd(), 'uploads', 'audio');
    
    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadsPath)) {
      fs.mkdirSync(this.uploadsPath, { recursive: true });
    }
    
    logger.info('Enhanced Voice AI Pipeline initialized');
  }
  
  /**
   * Initialize the voice service with configuration from database
   */
  public async initialize(): Promise<void> {
    try {
      // Get configuration from database
      const Configuration = mongoose.model('Configuration');
      const config = await Configuration.findOne();
      
      if (!config) {
        logger.warn('No configuration found in database for Voice AI Pipeline');
        return;
      }
      
      const voiceConfig = config.elevenLabsConfig;
      
      if (!voiceConfig || !voiceConfig.apiKey) {
        logger.warn('No ElevenLabs API key found in configuration');
        return;
      }
      
      // Initialize ElevenLabs service
      this.elevenLabsService = new ElevenLabsSDKService(voiceConfig.apiKey);
      
      // Update default config from database if available
      if (voiceConfig.defaultSettings) {
        this.defaultConfig = {
          ...this.defaultConfig,
          ...voiceConfig.defaultSettings
        };
      }
      
      logger.info('Voice AI Pipeline initialized with ElevenLabs service');
    } catch (error) {
      logger.error(`Error initializing Voice AI Pipeline: ${getErrorMessage(error)}`);
      throw new Error(`Failed to initialize Voice AI Pipeline: ${getErrorMessage(error)}`);
    }
  }
  
  /**
   * Synthesize speech from text
   */
  public async synthesizeSpeech(options: VoiceSynthesisOptions): Promise<VoiceSynthesisResult> {
    if (!this.elevenLabsService) {
      throw new Error('Voice service not initialized');
    }
    
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Merge default config with provided options
      const config: VoiceSynthesisConfig = {
        ...this.defaultConfig,
        personality: options.personality || this.defaultConfig.personality,
        emotion: options.emotion || this.defaultConfig.emotion,
        language: options.language || this.defaultConfig.language,
        speed: options.speed !== undefined ? options.speed : this.defaultConfig.speed,
        stability: options.stability !== undefined ? options.stability : this.defaultConfig.stability,
        similarityBoost: options.similarityBoost !== undefined ? options.similarityBoost : this.defaultConfig.similarityBoost,
        style: options.style !== undefined ? options.style : this.defaultConfig.style,
        enhanceProsody: options.enhanceProsody !== undefined ? options.enhanceProsody : this.defaultConfig.enhanceProsody,
        enhanceClarity: options.enhanceClarity !== undefined ? options.enhanceClarity : this.defaultConfig.enhanceClarity,
        voiceId: options.voiceId || this.defaultConfig.voiceId,
        useStreamingMode: options.streaming !== undefined ? options.streaming : this.defaultConfig.useStreamingMode,
        customAttributes: options.customAttributes || this.defaultConfig.customAttributes
      };
      
      // Apply emotion and personality adjustments
      this.applyEmotionAndPersonalitySettings(config);
      
      // Emit synthesis start event
      this.emit(VoiceEvent.SYNTHESIS_START, {
        requestId,
        text: options.text,
        config
      });
      
      // Check if we should detect emotion from text
      let detectedEmotion: VoiceEmotion | null = null;
      if (config.useEmotionDetection && !options.emotion) {
        detectedEmotion = await this.detectEmotionFromText(options.text);
        
        if (detectedEmotion) {
          // Update config with detected emotion
          config.emotion = detectedEmotion;
          
          // Apply emotion settings
          this.applyEmotionSettings(config, detectedEmotion);
          
          // Emit emotion detected event
          this.emit(VoiceEvent.EMOTION_DETECTED, {
            requestId,
            emotion: detectedEmotion,
            text: options.text
          });
        }
      }
      
      // Prepare result
      const result: VoiceSynthesisResult = {
        audioData: null,
        duration: 0,
        wordCount: this.countWords(options.text),
        metadata: {
          requestId,
          timestamp: new Date(),
          config,
          textLength: options.text.length,
          processingTime: 0
        }
      };
      
      // Check if we should use adaptive voice synthesis
      if (config.useAdaptiveVoice) {
        // Use the orchestration layer if available
        const orchestration = getAIOrchestration();
        if (orchestration) {
          try {
            // Use the orchestration layer to synthesize voice
            const orchestrationResult = await orchestration.synthesizeVoice(
              options.text,
              {
                voiceId: config.voiceId,
                language: config.language,
                emotion: config.emotion,
                speed: config.speed
              }
            );
            
            result.audioData = orchestrationResult.audioData;
            result.duration = orchestrationResult.duration || 0;
          } catch (error) {
            // Fallback to direct ElevenLabs service
            logger.warn(`Orchestration layer voice synthesis failed, falling back to direct ElevenLabs service: ${getErrorMessage(error)}`);
            
            // Use direct ElevenLabs service as fallback
            const synthesisResult = await this.elevenLabsService.synthesizeAdaptiveVoice({
              text: options.text,
              personalityId: config.voiceId || 'default',
              language: config.language
            });
            
            result.audioData = synthesisResult.audioData;
            result.duration = synthesisResult.duration || 0;
          }
        } else {
          // Use ElevenLabs service directly
          const synthesisResult = await this.elevenLabsService.synthesizeAdaptiveVoice({
            text: options.text,
            personalityId: config.voiceId || 'default',
            language: config.language
          });
          
          result.audioData = synthesisResult.audioData;
          result.duration = synthesisResult.duration || 0;
        }
      } else if (config.useStreamingMode) {
        // Use streaming mode
        const stream = new Readable({
          read() {} // This is intentional - we'll push data manually
        });
        
        result.audioStream = stream;
        
        // Set up streaming
        const streamId = uuidv4();
        this.activeStreams.set(streamId, { stream, chunks: [] });
        
        // Emit streaming start event
        this.emit(VoiceEvent.STREAMING_START, {
          requestId,
          streamId,
          text: options.text
        });
        
        // Start streaming process
        this.elevenLabsService.streamSpeech(
          streamId, // Use streamId as the conversationId parameter
          options.text,
          config.voiceId || 'default',
          (chunk) => {
            // Create audio chunk
            const audioChunk: AudioChunk = {
              chunk,
              timestamp: Date.now(),
              isLast: false, // Will be set to true in the onEnd callback
              index: 0 // We don't have index here
            };
            
            // Store chunk
            const streamData = this.activeStreams.get(streamId);
            if (streamData) {
              streamData.chunks.push(audioChunk);
              
              // Push to stream
              streamData.stream.push(chunk);
              
              // Emit chunk event
              this.emit(VoiceEvent.AUDIO_CHUNK, {
                requestId,
                streamId,
                chunk: audioChunk,
                totalChunks: streamData.chunks.length
              });
              
              // If this is the last chunk, end the stream
              if (audioChunk.isLast) {
                streamData.stream.push(null); // End the stream
                
                // Calculate duration (approximate)
                const totalBytes = streamData.chunks.reduce(
                  (sum, chunk) => sum + chunk.chunk.length, 0
                );
                
                // Approximate duration: 1 second of MP3 is roughly 16KB at 128kbps
                result.duration = totalBytes / 16000;
                
                // Emit streaming complete event
                this.emit(VoiceEvent.STREAMING_COMPLETE, {
                  requestId,
                  streamId,
                  totalChunks: streamData.chunks.length,
                  duration: result.duration
                });
                
                // Remove from active streams
                this.activeStreams.delete(streamId);
              }
            }
          },
          // Options for streaming - passing as any to bypass type checking since we don't have access to the actual StreamOptions type
          {
            stability: config.stability,
            similarityBoost: config.similarityBoost,
            style: config.style,
            useSpeakerBoost: config.enhanceProsody
          } as any
        );
      } else {
        // Use standard synthesis - since ElevenLabsSDKService doesn't have synthesizeSpeech,
        // use synthesizeAdaptiveVoice instead
        const synthesisResult = await this.elevenLabsService.synthesizeAdaptiveVoice({
          text: options.text,
          personalityId: config.voiceId || 'default',
          language: config.language
        });
        
        result.audioData = synthesisResult.audioData;
        result.duration = synthesisResult.duration || 0;
      }
      
      // Save to file if requested
      if (options.saveToFile && result.audioData) {
        const fileName = `voice_${requestId}.${options.outputFormat || 'mp3'}`;
        const filePath = path.join(this.uploadsPath, fileName);
        
        await fs.promises.writeFile(filePath, result.audioData);
        result.audioFilePath = filePath;
      }
      
      // Add emotion analysis if detected
      if (detectedEmotion) {
        result.emotionAnalysis = {
          dominantEmotion: detectedEmotion,
          emotionScores: this.generateMockEmotionScores(detectedEmotion)
        };
      }
      
      // Calculate processing time
      result.metadata.processingTime = Date.now() - startTime;
      
      // Emit synthesis complete event
      this.emit(VoiceEvent.SYNTHESIS_COMPLETE, {
        requestId,
        duration: result.duration,
        processingTime: result.metadata.processingTime,
        wordCount: result.wordCount
      });
      
      return result;
    } catch (error) {
      // Emit error event
      this.emit(VoiceEvent.SYNTHESIS_ERROR, {
        requestId,
        error: getErrorMessage(error),
        text: options.text
      });
      
      logger.error(`Error synthesizing speech: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Apply emotion and personality settings to voice configuration
   */
  private applyEmotionAndPersonalitySettings(config: VoiceSynthesisConfig): void {
    // Apply personality settings first
    this.applyPersonalitySettings(config, config.personality);
    
    // Then apply emotion settings (they override personality)
    this.applyEmotionSettings(config, config.emotion);
  }
  
  /**
   * Apply emotion settings to voice configuration
   */
  private applyEmotionSettings(config: VoiceSynthesisConfig, emotion: VoiceEmotion): void {
    const emotionSettings = EMOTION_MAPPING[emotion];
    
    if (emotionSettings) {
      // Apply settings with a blend to avoid abrupt changes
      const blendFactor = 0.7; // 70% emotion, 30% original
      
      config.stability = (emotionSettings.stability * blendFactor) + 
        (config.stability * (1 - blendFactor));
        
      config.similarityBoost = (emotionSettings.similarityBoost * blendFactor) + 
        (config.similarityBoost * (1 - blendFactor));
        
      config.style = (emotionSettings.style * blendFactor) + 
        (config.style * (1 - blendFactor));
    }
  }
  
  /**
   * Apply personality settings to voice configuration
   */
  private applyPersonalitySettings(config: VoiceSynthesisConfig, personality: VoicePersonality): void {
    const personalitySettings = PERSONALITY_MAPPING[personality];
    
    if (personalitySettings && personality !== VoicePersonality.CUSTOM) {
      config.stability = personalitySettings.stability;
      config.similarityBoost = personalitySettings.similarityBoost;
      config.style = personalitySettings.style;
    }
  }
  
  /**
   * Map emotion to ElevenLabs emotion index
   */
  private mapEmotionToIndex(emotion: VoiceEmotion): number {
    // Map our emotion enum to ElevenLabs emotion index (0-9)
    const emotionMap: Record<VoiceEmotion, number> = {
      [VoiceEmotion.NEUTRAL]: 0,
      [VoiceEmotion.HAPPY]: 1,
      [VoiceEmotion.SAD]: 2,
      [VoiceEmotion.ANGRY]: 3,
      [VoiceEmotion.FEARFUL]: 4,
      [VoiceEmotion.SURPRISED]: 5,
      [VoiceEmotion.EXCITED]: 6,
      [VoiceEmotion.DISAPPOINTED]: 7,
      [VoiceEmotion.CONFUSED]: 8,
      [VoiceEmotion.EMPATHETIC]: 9
    };
    
    return emotionMap[emotion] || 0;
  }
  
  /**
   * Detect emotion from text using LLM
   */
  private async detectEmotionFromText(text: string): Promise<VoiceEmotion | null> {
    try {
      // Get orchestration layer
      const orchestration = getAIOrchestration();
      if (!orchestration) {
        logger.warn('AI Orchestration layer not available for emotion detection');
        return null;
      }
      
      // Generate emotion detection prompt
      const messages = [
        {
          role: 'system' as MessageRole,
          content: `Detect the primary emotion in the following text. 
Return ONLY ONE of these emotions: neutral, happy, sad, angry, fearful, surprised, excited, disappointed, confused, empathetic. 
Return ONLY the emotion word and nothing else.`
        },
        {
          role: 'user' as MessageRole,
          content: text
        }
      ];
      
      // Use LLM to detect emotion
      const response = await orchestration.generateChatCompletion(messages as LLMMessage[], {
        temperature: 0.3,
        maxTokens: 10
      });
      
      // Parse the response
      const detectedEmotion = response.content.trim().toLowerCase();
      
      // Map to VoiceEmotion enum
      const emotionMap: Record<string, VoiceEmotion> = {
        'neutral': VoiceEmotion.NEUTRAL,
        'happy': VoiceEmotion.HAPPY,
        'sad': VoiceEmotion.SAD,
        'angry': VoiceEmotion.ANGRY,
        'fearful': VoiceEmotion.FEARFUL,
        'surprised': VoiceEmotion.SURPRISED,
        'excited': VoiceEmotion.EXCITED,
        'disappointed': VoiceEmotion.DISAPPOINTED,
        'confused': VoiceEmotion.CONFUSED,
        'empathetic': VoiceEmotion.EMPATHETIC
      };
      
      return emotionMap[detectedEmotion] || null;
    } catch (error) {
      logger.error(`Error detecting emotion from text: ${getErrorMessage(error)}`);
      return null;
    }
  }
  
  /**
   * Generate mock emotion scores for testing
   */
  private generateMockEmotionScores(dominantEmotion: VoiceEmotion): Record<VoiceEmotion, number> {
    const scores: Partial<Record<VoiceEmotion, number>> = {};
    
    // Give dominant emotion a high score
    Object.values(VoiceEmotion).forEach(emotion => {
      if (emotion === dominantEmotion) {
        scores[emotion] = 0.7 + Math.random() * 0.3; // 0.7-1.0
      } else {
        scores[emotion] = Math.random() * 0.3; // 0.0-0.3
      }
    });
    
    return scores as Record<VoiceEmotion, number>;
  }
  
  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }
  
  /**
   * Get all available voices
   */
  public async getAvailableVoices(): Promise<any[]> {
    if (!this.elevenLabsService) {
      throw new Error('Voice service not initialized');
    }
    
    try {
      return await this.elevenLabsService.getVoices();
    } catch (error) {
      logger.error(`Error getting available voices: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  
  /**
   * Check if streaming is supported
   */
  public isStreamingSupported(): boolean {
    return !!this.elevenLabsService;
  }
  
  /**
   * Close an active stream
   */
  public closeStream(streamId: string): boolean {
    const streamData = this.activeStreams.get(streamId);
    if (streamData) {
      streamData.stream.push(null); // End the stream
      this.activeStreams.delete(streamId);
      return true;
    }
    return false;
  }
}

// Singleton instance
let voiceAIPipeline: EnhancedVoiceAIPipeline | null = null;

/**
 * Initialize the Enhanced Voice AI Pipeline
 */
export async function initializeVoiceAIPipeline(): Promise<EnhancedVoiceAIPipeline> {
  if (!voiceAIPipeline) {
    voiceAIPipeline = new EnhancedVoiceAIPipeline();
    await voiceAIPipeline.initialize();
  }
  
  return voiceAIPipeline;
}

/**
 * Get the Enhanced Voice AI Pipeline instance
 */
export function getVoiceAIPipeline(): EnhancedVoiceAIPipeline | null {
  return voiceAIPipeline;
}

export default EnhancedVoiceAIPipeline;
