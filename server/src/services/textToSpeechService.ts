import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import logger from '../utils/logger';
import Configuration from '../models/Configuration';
import { getCircuitBreakerService } from './circuitBreakerService';

/**
 * Options for text-to-speech generation
 */
export interface TTSOptions {
  voiceId?: string;
  stability?: number;
  similarity?: number;
  speakerId?: string;
  modelId?: string;
  speed?: number;
}

/**
 * Service for converting text to speech using ElevenLabs API
 */
export class TextToSpeechService {
  private apiKey: string;
  private outputDir: string;
  private apiUrl: string;
  private defaultVoiceId: string;
  private defaultModelId: string;
  private circuitBreakerName: string = 'elevenlabs-tts';

  constructor(apiKey: string = '') {
    // Initialize with provided API key or from environment variable
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
    
    // Create output directory for audio files
    this.outputDir = path.join(__dirname, '../../uploads/audio/tts');
    fs.mkdirSync(this.outputDir, { recursive: true });
    
    // API URL for ElevenLabs text-to-speech service
    this.apiUrl = process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1';
    
    // Default voice and model IDs
    this.defaultVoiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    this.defaultModelId = process.env.ELEVENLABS_DEFAULT_MODEL_ID || 'eleven_turbo_v2';
    
    // Initialize circuit breaker
    getCircuitBreakerService().getCircuit(this.circuitBreakerName, {
      resetTimeout: 30000, // 30 seconds
      errorThresholdPercentage: 50,
      timeout: 10000 // 10 seconds
    });
    
    logger.info('TextToSpeechService initialized');
  }

  /**
   * Update the API key
   */
  updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    logger.info('TextToSpeechService API key updated');
  }

  /**
   * Generate speech from text and return audio buffer
   */
  async generateSpeech(text: string, options?: TTSOptions): Promise<Buffer> {
    const circuitBreaker = getCircuitBreakerService();
    
    // Define the main function to execute with circuit breaker
    const generateFunction = async () => {
      try {
        if (!text) {
          throw new Error('Text is required for speech generation');
        }
        
        // For demo purposes, if no API key is set, use a simple fallback
        if (!this.apiKey) {
          logger.warn('No ElevenLabs API key found. Using fallback method.');
          return this.generateFallbackAudio(text);
        }
        
        // Prepare options
        const voiceId = options?.voiceId || this.defaultVoiceId;
        const modelId = options?.modelId || this.defaultModelId;
        
        // Prepare request payload
        const payload = {
          text,
          model_id: modelId,
          voice_settings: {
            stability: options?.stability !== undefined ? options.stability : 0.5,
            similarity_boost: options?.similarity !== undefined ? options.similarity : 0.75,
            style: 0.0,
            use_speaker_boost: options?.speakerId ? true : false,
            speaker_id: options?.speakerId || undefined
          }
        };
        
        if (options?.speed !== undefined) {
          payload.voice_settings['speed'] = options.speed;
        }
        
        // Call the ElevenLabs API
        const response = await axios.post(
          `${this.apiUrl}/text-to-speech/${voiceId}`,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': this.apiKey
            },
            responseType: 'arraybuffer'
          }
        );
        
        // Return audio buffer
        return Buffer.from(response.data);
      } catch (error) {
        logger.error(`Error generating speech: ${error.message}`);
        
        // Check if it's a rate limit error
        if (error.response && error.response.status === 429) {
          logger.warn('ElevenLabs API rate limit exceeded');
          throw new Error('ElevenLabs API rate limit exceeded');
        }
        
        // Use fallback method in case of error
        return this.generateFallbackAudio(text);
      }
    };
    
    // Define fallback function for when circuit is open
    const fallbackFunction = async () => {
      logger.warn('ElevenLabs circuit breaker open, using fallback audio');
      return this.generateFallbackAudio(text);
    };
    
    // Execute with circuit breaker
    return circuitBreaker.execute(
      this.circuitBreakerName,
      generateFunction,
      fallbackFunction
    );
  }

  /**
   * Generate speech from text and save to file
   */
  async generateSpeechFile(text: string, options?: TTSOptions): Promise<string> {
    try {
      // Generate audio buffer
      const audioBuffer = await this.generateSpeech(text, options);
      
      // Generate a unique filename for the audio
      const fileName = `${uuidv4()}.mp3`;
      const filePath = path.join(this.outputDir, fileName);
      
      // Write audio data to file
      fs.writeFileSync(filePath, audioBuffer);
      
      // Return URL to the audio file
      return `/uploads/audio/tts/${fileName}`;
    } catch (error) {
      logger.error(`Error generating speech file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stream speech generation for real-time audio
   */
  async streamSpeech(text: string, options?: TTSOptions): Promise<NodeJS.ReadableStream> {
    try {
      if (!text) {
        throw new Error('Text is required for speech generation');
      }
      
      // For demo purposes, if no API key is set, use a simple fallback
      if (!this.apiKey) {
        logger.warn('No ElevenLabs API key found. Using fallback method for streaming.');
        return this.generateFallbackStream(text);
      }
      
      // Prepare options
      const voiceId = options?.voiceId || this.defaultVoiceId;
      const modelId = options?.modelId || this.defaultModelId;
      
      // Prepare request payload
      const payload = {
        text,
        model_id: modelId,
        voice_settings: {
          stability: options?.stability !== undefined ? options.stability : 0.5,
          similarity_boost: options?.similarity !== undefined ? options.similarity : 0.75,
          style: 0.0,
          use_speaker_boost: options?.speakerId ? true : false,
          speaker_id: options?.speakerId || undefined
        },
        output_format: 'mp3_44100_128'
      };
      
      if (options?.speed !== undefined) {
        payload.voice_settings['speed'] = options.speed;
      }
      
      // Call the ElevenLabs streaming API
      const response = await axios.post(
        `${this.apiUrl}/text-to-speech/${voiceId}/stream`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey
          },
          responseType: 'stream'
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error(`Error streaming speech: ${error.message}`);
      return this.generateFallbackStream(text);
    }
  }

  /**
   * Fallback method that returns a dummy audio buffer
   */
  private async generateFallbackAudio(text: string): Promise<Buffer> {
    // In a real implementation, you might want to use a client-side TTS,
    // or provide a set of pre-recorded audio files
    
    // For now, just log the text and return a placeholder
    logger.info(`TTS fallback used for text: ${text.substring(0, 100)}...`);
    
    // Return a simple audio buffer (silence)
    const silenceBuffer = Buffer.alloc(1024, 0);
    return silenceBuffer;
  }

  /**
   * Fallback method that returns a dummy audio stream
   */
  private generateFallbackStream(text: string): NodeJS.ReadableStream {
    // Log the fallback usage
    logger.info(`TTS stream fallback used for text: ${text.substring(0, 100)}...`);
    
    // Create a simple readable stream with silence
    const { Readable } = require('stream');
    const silenceBuffer = Buffer.alloc(1024, 0);
    
    const stream = new Readable();
    stream.push(silenceBuffer);
    stream.push(null);
    
    return stream;
  }

  /**
   * Get available voices from ElevenLabs API
   */
  async getVoices(): Promise<any[]> {
    try {
      if (!this.apiKey) {
        logger.warn('No ElevenLabs API key found. Cannot get voices.');
        return [];
      }
      
      const response = await axios.get(
        `${this.apiUrl}/voices`,
        {
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey
          }
        }
      );
      
      return response.data.voices || [];
    } catch (error) {
      logger.error(`Error getting voices: ${error.message}`);
      return [];
    }
  }

  /**
   * Get available models from ElevenLabs API
   */
  async getModels(): Promise<any[]> {
    try {
      if (!this.apiKey) {
        logger.warn('No ElevenLabs API key found. Cannot get models.');
        return [];
      }
      
      const response = await axios.get(
        `${this.apiUrl}/models`,
        {
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey
          }
        }
      );
      
      return response.data.models || [];
    } catch (error) {
      logger.error(`Error getting models: ${error.message}`);
      return [];
    }
  }
}

// Singleton instance
let _textToSpeechService: TextToSpeechService | null = null;

/**
 * Get the singleton instance of TextToSpeechService
 */
export async function getTextToSpeechService(): Promise<TextToSpeechService> {
  if (!_textToSpeechService) {
    try {
      // Get API key from database
      const config = await Configuration.findOne();
      const elevenLabsApiKey = config?.elevenLabsConfig?.apiKey || '';
      
      if (!elevenLabsApiKey) {
        logger.warn('No ElevenLabs API key found in database, creating service with empty key');
      } else {
        logger.info('Creating TextToSpeechService with API key from database');
      }
      
      _textToSpeechService = new TextToSpeechService(elevenLabsApiKey);
    } catch (error) {
      logger.error(`Error initializing TextToSpeechService: ${error.message}`);
      // Create with empty key as fallback
      _textToSpeechService = new TextToSpeechService('');
    }
  }
  
  return _textToSpeechService;
}

export default TextToSpeechService;