/**
 * Fallback TTS Service - Provides reliable voice synthesis during service outages
 * 
 * This service implements multiple fallback strategies for TTS to ensure
 * calls can continue even when primary voice providers are unavailable.
 */

import logger from '../utils/logger';
import { getCallResilienceService } from './callResilienceService';

export interface TTSFallbackConfig {
  enableTwilioFallback: boolean;
  enableBrowserTTS: boolean;
  enablePrerecordedMessages: boolean;
  fallbackTimeout: number;
  cacheEnabled: boolean;
  maxCacheSize: number;
}

export interface TTSRequest {
  text: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  pitch?: number;
}

export interface TTSResponse {
  audioData: Buffer;
  format: 'mp3' | 'wav' | 'mulaw';
  sampleRate: number;
  channels: number;
  duration: number;
  provider: string;
}

export interface PrerecordedMessage {
  id: string;
  text: string;
  audioData: Buffer;
  language: string;
  voiceType: 'male' | 'female' | 'neutral';
}

export class FallbackTTSService {
  private config: TTSFallbackConfig;
  private audioCache: Map<string, TTSResponse> = new Map();
  private prerecordedMessages: Map<string, PrerecordedMessage> = new Map();
  
  constructor(config: Partial<TTSFallbackConfig> = {}) {
    this.config = {
      enableTwilioFallback: true,
      enableBrowserTTS: false,
      enablePrerecordedMessages: true,
      fallbackTimeout: 3000,
      cacheEnabled: true,
      maxCacheSize: 100,
      ...config
    };
    
    this.initializePrerecordedMessages();
  }
  
  /**
   * Initialize prerecorded fallback messages
   */
  private initializePrerecordedMessages(): void {
    const commonMessages = [
      {
        id: 'greeting',
        text: 'Hello! How can I help you today?',
        language: 'en',
        voiceType: 'neutral' as const
      },
      {
        id: 'technical_difficulty',
        text: 'I apologize, but I\'m experiencing some technical difficulties. Please hold on for a moment.',
        language: 'en',
        voiceType: 'neutral' as const
      },
      {
        id: 'please_repeat',
        text: 'I\'m sorry, I didn\'t catch that. Could you please repeat?',
        language: 'en',
        voiceType: 'neutral' as const
      },
      {
        id: 'hold_please',
        text: 'Please hold on for a moment while I process your request.',
        language: 'en',
        voiceType: 'neutral' as const
      },
      {
        id: 'goodbye',
        text: 'Thank you for your time. Have a great day!',
        language: 'en',
        voiceType: 'neutral' as const
      },
      {
        id: 'callback_offer',
        text: 'Would you like me to call you back when the technical issue is resolved?',
        language: 'en',
        voiceType: 'neutral' as const
      }
    ];
    
    // In a real implementation, these would load actual audio files
    // For now, we'll create placeholder entries
    commonMessages.forEach(msg => {
      this.prerecordedMessages.set(msg.id, {
        id: msg.id,
        text: msg.text,
        audioData: this.generatePlaceholderAudio(msg.text),
        language: msg.language,
        voiceType: msg.voiceType
      });
    });
    
    logger.info(`Initialized ${this.prerecordedMessages.size} prerecorded fallback messages`);
  }
  
  /**
   * Generate placeholder audio (in real implementation, load from files)
   */
  private generatePlaceholderAudio(text: string): Buffer {
    // This is a placeholder - in real implementation, you would:
    // 1. Load prerecorded audio files from disk
    // 2. Use a local TTS engine
    // 3. Generate silence with appropriate duration
    
    const estimatedDuration = text.length * 100; // ~100ms per character
    const sampleRate = 8000; // 8kHz for telephony
    const samples = Math.floor(estimatedDuration * sampleRate / 1000);
    
    // Generate silence (zeros)
    return Buffer.alloc(samples * 2); // 16-bit samples
  }
  
  /**
   * Main TTS synthesis with fallback chain
   */
  public async synthesize(request: TTSRequest, callId: string): Promise<TTSResponse> {
    const cacheKey = this.generateCacheKey(request);
    
    // Check cache first
    if (this.config.cacheEnabled && this.audioCache.has(cacheKey)) {
      logger.debug(`Using cached TTS for call ${callId}`);
      return this.audioCache.get(cacheKey)!;
    }
    
    // Try fallback methods in order
    const fallbackMethods = [
      () => this.tryTwilioTTS(request, callId),
      () => this.tryPrerecordedMessage(request, callId),
      () => this.generateSilence(request, callId)
    ];
    
    for (const method of fallbackMethods) {
      try {
        const result = await Promise.race([
          method(),
          this.createTimeoutPromise(this.config.fallbackTimeout)
        ]);
        
        if (result) {
          // Cache successful result
          if (this.config.cacheEnabled) {
            this.cacheResponse(cacheKey, result);
          }
          
          return result;
        }
      } catch (error) {
        logger.warn(`Fallback TTS method failed for call ${callId}:`, error);
        continue;
      }
    }
    
    // If all methods fail, return emergency silence
    logger.error(`All TTS fallback methods failed for call ${callId}, returning emergency silence`);
    return this.generateEmergencySilence(request, callId);
  }
  
  /**
   * Try Twilio's built-in TTS (SAY verb)
   */
  private async tryTwilioTTS(request: TTSRequest, callId: string): Promise<TTSResponse | null> {
    if (!this.config.enableTwilioFallback) {
      return null;
    }
    
    try {
      logger.info(`Using Twilio TTS fallback for call ${callId}`);
      
      // Generate TwiML for Twilio SAY verb
      const twimlContent = this.generateTwiMLSay(request.text, request.language, request.speed);
      
      // In a real implementation, you would:
      // 1. Send TwiML to Twilio via REST API
      // 2. Receive audio stream from Twilio
      // 3. Convert to appropriate format
      
      // For now, generate placeholder audio
      const audioData = this.generatePlaceholderAudio(request.text);
      
      return {
        audioData,
        format: 'mulaw',
        sampleRate: 8000,
        channels: 1,
        duration: this.estimateAudioDuration(request.text),
        provider: 'twilio_fallback'
      };
    } catch (error) {
      logger.error(`Twilio TTS fallback failed for call ${callId}:`, error);
      return null;
    }
  }
  
  /**
   * Generate TwiML for Twilio SAY verb
   */
  private generateTwiMLSay(text: string, language?: string, speed?: number): string {
    const lang = language || 'en';
    const rate = speed ? `${Math.max(0.5, Math.min(2.0, speed))}` : '1.0';
    
    return `
      <Response>
        <Say voice="alice" language="${lang}" rate="${rate}">
          ${this.escapeXML(text)}
        </Say>
      </Response>
    `.trim();
  }
  
  /**
   * Try prerecorded message
   */
  private async tryPrerecordedMessage(request: TTSRequest, callId: string): Promise<TTSResponse | null> {
    if (!this.config.enablePrerecordedMessages) {
      return null;
    }
    
    try {
      // Find best matching prerecorded message
      const match = this.findBestPrerecordedMatch(request.text);
      
      if (match) {
        logger.info(`Using prerecorded message "${match.id}" for call ${callId}`);
        
        return {
          audioData: match.audioData,
          format: 'wav',
          sampleRate: 8000,
          channels: 1,
          duration: this.estimateAudioDuration(match.text),
          provider: 'prerecorded'
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Prerecorded message fallback failed for call ${callId}:`, error);
      return null;
    }
  }
  
  /**
   * Find best matching prerecorded message
   */
  private findBestPrerecordedMatch(text: string): PrerecordedMessage | null {
    const normalizedText = text.toLowerCase().trim();
    
    // Direct matches first
    for (const message of this.prerecordedMessages.values()) {
      if (message.text.toLowerCase().includes(normalizedText) || 
          normalizedText.includes(message.text.toLowerCase())) {
        return message;
      }
    }
    
    // Fuzzy matching for common scenarios
    if (normalizedText.includes('hello') || normalizedText.includes('hi')) {
      return this.prerecordedMessages.get('greeting');
    }
    
    if (normalizedText.includes('technical') || normalizedText.includes('difficulty') || normalizedText.includes('problem')) {
      return this.prerecordedMessages.get('technical_difficulty');
    }
    
    if (normalizedText.includes('repeat') || normalizedText.includes('again')) {
      return this.prerecordedMessages.get('please_repeat');
    }
    
    if (normalizedText.includes('hold') || normalizedText.includes('wait')) {
      return this.prerecordedMessages.get('hold_please');
    }
    
    if (normalizedText.includes('goodbye') || normalizedText.includes('bye')) {
      return this.prerecordedMessages.get('goodbye');
    }
    
    if (normalizedText.includes('callback') || normalizedText.includes('call back')) {
      return this.prerecordedMessages.get('callback_offer');
    }
    
    // Default to technical difficulty message
    return this.prerecordedMessages.get('technical_difficulty');
  }
  
  /**
   * Generate silence as last resort
   */
  private async generateSilence(request: TTSRequest, callId: string): Promise<TTSResponse> {
    logger.info(`Generating silence fallback for call ${callId}`);
    
    const duration = Math.min(this.estimateAudioDuration(request.text), 5000); // Max 5 seconds
    const sampleRate = 8000;
    const samples = Math.floor(duration * sampleRate / 1000);
    
    return {
      audioData: Buffer.alloc(samples * 2), // 16-bit silence
      format: 'wav',
      sampleRate,
      channels: 1,
      duration,
      provider: 'silence'
    };
  }
  
  /**
   * Generate emergency silence (when everything fails)
   */
  private generateEmergencySilence(request: TTSRequest, callId: string): TTSResponse {
    logger.error(`Generating emergency silence for call ${callId}`);
    
    const resilienceService = getCallResilienceService();
    resilienceService.reportError(
      callId,
      new Error('All TTS fallback methods failed'),
      'tts_fallback'
    );
    
    return {
      audioData: Buffer.alloc(8000 * 2), // 1 second of silence
      format: 'wav',
      sampleRate: 8000,
      channels: 1,
      duration: 1000,
      provider: 'emergency_silence'
    };
  }
  
  /**
   * Estimate audio duration in milliseconds
   */
  private estimateAudioDuration(text: string): number {
    // Rough estimate: 150 words per minute, average 5 characters per word
    const wordsPerMinute = 150;
    const avgCharsPerWord = 5;
    const estimatedWords = text.length / avgCharsPerWord;
    const estimatedMinutes = estimatedWords / wordsPerMinute;
    
    return Math.max(1000, estimatedMinutes * 60 * 1000); // Minimum 1 second
  }
  
  /**
   * Generate cache key for TTS request
   */
  private generateCacheKey(request: TTSRequest): string {
    return `${request.text}_${request.voiceId || 'default'}_${request.language || 'en'}_${request.speed || 1.0}`;
  }
  
  /**
   * Cache TTS response
   */
  private cacheResponse(key: string, response: TTSResponse): void {
    // Implement LRU eviction if cache is full
    if (this.audioCache.size >= this.config.maxCacheSize) {
      const firstKey = this.audioCache.keys().next().value;
      this.audioCache.delete(firstKey);
    }
    
    this.audioCache.set(key, response);
  }
  
  /**
   * Create timeout promise
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    });
  }
  
  /**
   * Escape XML characters for TwiML
   */
  private escapeXML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  
  /**
   * Add custom prerecorded message
   */
  public addPrerecordedMessage(message: PrerecordedMessage): void {
    this.prerecordedMessages.set(message.id, message);
    logger.info(`Added prerecorded message: ${message.id}`);
  }
  
  /**
   * Remove prerecorded message
   */
  public removePrerecordedMessage(messageId: string): void {
    this.prerecordedMessages.delete(messageId);
    logger.info(`Removed prerecorded message: ${messageId}`);
  }
  
  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.audioCache.size,
      maxSize: this.config.maxCacheSize
    };
  }
  
  /**
   * Clear cache
   */
  public clearCache(): void {
    this.audioCache.clear();
    logger.info('TTS fallback cache cleared');
  }
  
  /**
   * Get available prerecorded messages
   */
  public getPrerecordedMessages(): Array<{ id: string; text: string; language: string }> {
    return Array.from(this.prerecordedMessages.values()).map(msg => ({
      id: msg.id,
      text: msg.text,
      language: msg.language
    }));
  }
  
  /**
   * Test fallback capabilities
   */
  public async testFallbacks(callId: string): Promise<{
    twilio: boolean;
    prerecorded: boolean;
    silence: boolean;
  }> {
    const testRequest: TTSRequest = {
      text: 'This is a test message',
      language: 'en'
    };
    
    const results = {
      twilio: false,
      prerecorded: false,
      silence: false
    };
    
    try {
      const twilioResult = await this.tryTwilioTTS(testRequest, callId);
      results.twilio = !!twilioResult;
    } catch (error) {
      logger.warn('Twilio TTS test failed:', error);
    }
    
    try {
      const prerecordedResult = await this.tryPrerecordedMessage(testRequest, callId);
      results.prerecorded = !!prerecordedResult;
    } catch (error) {
      logger.warn('Prerecorded message test failed:', error);
    }
    
    try {
      const silenceResult = await this.generateSilence(testRequest, callId);
      results.silence = !!silenceResult;
    } catch (error) {
      logger.warn('Silence generation test failed:', error);
    }
    
    return results;
  }
}

// Singleton instance
let fallbackTTSService: FallbackTTSService | null = null;

export function getFallbackTTSService(): FallbackTTSService {
  if (!fallbackTTSService) {
    fallbackTTSService = new FallbackTTSService();
  }
  return fallbackTTSService;
}

export default FallbackTTSService;