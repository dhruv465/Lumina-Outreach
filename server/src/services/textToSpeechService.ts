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
/**
 * Service for converting text to speech using configurable TTS providers
 * Updated to use database configuration instead of environment variables
 */
export class TextToSpeechService {
  private outputDir: string;
  private apiUrl: string;
  private circuitBreakerName: string = 'tts-service';

  constructor() {
    // Create output directory for audio files
    this.outputDir = path.join(__dirname, '../../uploads/audio/tts');
    fs.mkdirSync(this.outputDir, { recursive: true });
    
    // Default API URL for ElevenLabs (can be overridden by database config)
    this.apiUrl = 'https://api.elevenlabs.io/v1';
    
    // Initialize circuit breaker
    getCircuitBreakerService().getCircuit(this.circuitBreakerName, {
      resetTimeout: 30000, // 30 seconds
      errorThresholdPercentage: 50,
      timeout: 10000 // 10 seconds
    });
    
    logger.info('TextToSpeechService initialized');
  }

  /**
   * Get current TTS configuration from database
   */
  private async getTTSConfig(): Promise<{
    apiKey: string;
    voiceId: string;
    modelId: string;
    isEnabled: boolean;
    provider: string;
  }> {
    try {
      const config = await Configuration.findOne();
      
      if (!config) {
        logger.warn('No configuration found in database for TTS');
        return {
          apiKey: '',
          voiceId: 'EXAVITQu4vr4xnSDxMaL', // Default fallback
          modelId: 'eleven_turbo_v2', // Default fallback
          isEnabled: false,
          provider: 'elevenlabs'
        };
      }
      
      // Get TTS provider configuration
      const ttsProvider = config.ttsConfig?.provider || 'elevenlabs';
      
      if (ttsProvider === 'elevenlabs') {
        const elevenLabsConfig = config.elevenLabsConfig;
        return {
          apiKey: elevenLabsConfig?.apiKey || '',
          voiceId: elevenLabsConfig?.selectedVoiceId || 
                   elevenLabsConfig?.availableVoices?.[0]?.voiceId || 
                   'EXAVITQu4vr4xnSDxMaL',
          modelId: elevenLabsConfig?.useFlashModel ? 'eleven_flash_v2_5' : 'eleven_turbo_v2',
          isEnabled: elevenLabsConfig?.isEnabled || false,
          provider: 'elevenlabs'
        };
      } else {
        // For other providers, return empty config for now
        return {
          apiKey: '',
          voiceId: '',
          modelId: '',
          isEnabled: false,
          provider: ttsProvider
        };
      }
    } catch (error) {
      logger.error(`Error getting TTS configuration: ${error.message}`);
      return {
        apiKey: '',
        voiceId: 'EXAVITQu4vr4xnSDxMaL',
        modelId: 'eleven_turbo_v2',
        isEnabled: false,
        provider: 'elevenlabs'
      };
    }
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
        
        // Get current configuration from database
        const ttsConfig = await this.getTTSConfig();
        
        // Check if TTS is enabled and properly configured
        if (!ttsConfig.isEnabled || !ttsConfig.apiKey) {
          logger.warn('TTS not enabled or API key not configured. Using fallback method.');
          return this.generateFallbackAudio(text);
        }
        
        // Only support ElevenLabs for now
        if (ttsConfig.provider !== 'elevenlabs') {
          logger.warn(`TTS provider ${ttsConfig.provider} not supported by this service. Using fallback.`);
          return this.generateFallbackAudio(text);
        }
        
        // Prepare options with database configuration
        const voiceId = options?.voiceId || ttsConfig.voiceId;
        const modelId = options?.modelId || ttsConfig.modelId;
        
        // Get voice settings from database configuration
        const config = await Configuration.findOne();
        const elevenLabsConfig = config?.elevenLabsConfig;
        
        // Prepare request payload
        const payload = {
          text,
          model_id: modelId,
          voice_settings: {
            stability: options?.stability !== undefined ? options.stability : (elevenLabsConfig?.voiceStability || 0.8),
            similarity_boost: options?.similarity !== undefined ? options.similarity : (elevenLabsConfig?.voiceClarity || 0.9),
            style: 0.0,
            use_speaker_boost: options?.speakerId ? true : false,
            speaker_id: options?.speakerId || undefined
          }
        };
        
        if (options?.speed !== undefined) {
          payload.voice_settings['speed'] = options.speed;
        } else if (elevenLabsConfig?.voiceSpeed !== undefined) {
          payload.voice_settings['speed'] = elevenLabsConfig.voiceSpeed;
        }
        
        // Call the ElevenLabs API with database API key
        const response = await axios.post(
          `${this.apiUrl}/text-to-speech/${voiceId}`,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': ttsConfig.apiKey
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
      logger.warn('TTS circuit breaker open, using fallback audio');
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
      
      // Get current configuration from database
      const ttsConfig = await this.getTTSConfig();
      
      // Check if TTS is enabled and properly configured
      if (!ttsConfig.isEnabled || !ttsConfig.apiKey) {
        logger.warn('TTS not enabled or API key not configured. Using fallback method for streaming.');
        return this.generateFallbackStream(text);
      }
      
      // Only support ElevenLabs for now
      if (ttsConfig.provider !== 'elevenlabs') {
        logger.warn(`TTS provider ${ttsConfig.provider} not supported by this service. Using fallback.`);
        return this.generateFallbackStream(text);
      }
      
      // Prepare options with database configuration
      const voiceId = options?.voiceId || ttsConfig.voiceId;
      const modelId = options?.modelId || ttsConfig.modelId;
      
      // Get voice settings from database configuration
      const config = await Configuration.findOne();
      const elevenLabsConfig = config?.elevenLabsConfig;
      
      // Prepare request payload
      const payload = {
        text,
        model_id: modelId,
        voice_settings: {
          stability: options?.stability !== undefined ? options.stability : (elevenLabsConfig?.voiceStability || 0.8),
          similarity_boost: options?.similarity !== undefined ? options.similarity : (elevenLabsConfig?.voiceClarity || 0.9),
          style: 0.0,
          use_speaker_boost: options?.speakerId ? true : false,
          speaker_id: options?.speakerId || undefined
        },
        output_format: 'mp3_44100_128'
      };
      
      if (options?.speed !== undefined) {
        payload.voice_settings['speed'] = options.speed;
      } else if (elevenLabsConfig?.voiceSpeed !== undefined) {
        payload.voice_settings['speed'] = elevenLabsConfig.voiceSpeed;
      }
      
      // Call the ElevenLabs streaming API with database API key
      const response = await axios.post(
        `${this.apiUrl}/text-to-speech/${voiceId}/stream`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ttsConfig.apiKey
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
   * Get available voices from ElevenLabs API using database configuration
   */
  async getVoices(): Promise<any[]> {
    try {
      // Get current configuration from database
      const ttsConfig = await this.getTTSConfig();
      
      if (!ttsConfig.apiKey) {
        logger.warn('No TTS API key found in database. Cannot get voices.');
        return [];
      }
      
      if (ttsConfig.provider !== 'elevenlabs') {
        logger.warn(`TTS provider ${ttsConfig.provider} not supported for voice retrieval.`);
        return [];
      }
      
      const response = await axios.get(
        `${this.apiUrl}/voices`,
        {
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ttsConfig.apiKey
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
   * Get available models from ElevenLabs API using database configuration
   */
  async getModels(): Promise<any[]> {
    try {
      // Get current configuration from database
      const ttsConfig = await this.getTTSConfig();
      
      if (!ttsConfig.apiKey) {
        logger.warn('No TTS API key found in database. Cannot get models.');
        return [];
      }
      
      if (ttsConfig.provider !== 'elevenlabs') {
        logger.warn(`TTS provider ${ttsConfig.provider} not supported for model retrieval.`);
        return [];
      }
      
      const response = await axios.get(
        `${this.apiUrl}/models`,
        {
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ttsConfig.apiKey
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
 * Updated to use database configuration
 */
export async function getTextToSpeechService(): Promise<TextToSpeechService> {
  if (!_textToSpeechService) {
    logger.info('Creating TextToSpeechService instance (database-driven configuration)');
    _textToSpeechService = new TextToSpeechService();
  }
  
  return _textToSpeechService;
}

/**
 * Reset the singleton instance (useful for testing or configuration updates)
 */
export function resetTextToSpeechService(): void {
  _textToSpeechService = null;
  logger.info('TextToSpeechService instance reset');
}

export default TextToSpeechService;