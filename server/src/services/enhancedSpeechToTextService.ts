import { Deepgram } from '@deepgram/sdk';
import { createReadStream } from 'fs';
import { Readable, Transform } from 'stream';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import logger from '../utils/logger';
import { ConfigurationService, configurationService } from './configurationService';
import DeepgramValidator from '../utils/deepgramValidator';

// Promisify fs functions
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Interface for Deepgram API options
 */
export interface DeepgramOptions {
  punctuate: boolean;
  diarize?: boolean;
  model?: string;
  language?: string;
  detect_language?: boolean;
  smart_format?: boolean;
  utterances?: boolean;
  alternatives?: number;
  interim_results?: boolean;
  keywords?: string[];
  profanity_filter?: boolean;
  redact?: boolean;
  tier?: string;
  version?: string;
  filler_words?: boolean;
}

/**
 * Interface for Deepgram API response
 */
export interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{
          word: string;
          start: number;
          end: number;
          confidence: number;
        }>;
      }>;
    }>;
    language?: string;
  };
  is_final?: boolean;
}

/**
 * Interface for transcription options
 */
export interface DeepgramTranscriptionOptions {
  languageCode?: string;
  alternativeLanguageCodes?: string[];
  model?: string;
  diarize?: boolean;
  detectLanguage?: boolean;
  interimResults?: boolean;
  alternatives?: number;
  keywords?: string[];
  profanityFilter?: boolean;
  redact?: boolean;
  tier?: 'enhanced' | 'base';
  version?: string;
  fillerWords?: boolean;
  useCache?: boolean;
}

/**
 * Interface for standardized transcription results
 */
export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  languageCode?: string;
  alternatives?: string[];
  isFinal?: boolean;
  latency?: number;
  provider?: string;
  fromCache?: boolean;
  bytesProcessed?: number;
  processingTime?: number;
}

/**
 * Enhanced Speech-to-Text service with Deepgram integration
 * Provides ultra-low latency transcription capabilities (~100ms)
 */
export class EnhancedSpeechToTextService {
  private deepgram: Deepgram | null = null;
  private fallbackToGoogle: boolean = false;
  private isConfigured: boolean = false;
  private connectionStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // ms
  private tempDir: string;
  private cacheDir: string;
  private readonly supportedMimeTypes = ['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'];
  private lastPingTime: number = 0;
  private readonly pingInterval: number = 30000; // 30 seconds
  private regionEndpoints: { [key: string]: string } = {
    'us-east': 'api.deepgram.com',
    'us-west': 'api-us-west.deepgram.com',
    'eu-west': 'api-eu-west.deepgram.com',
    'asia': 'api-asia.deepgram.com'
  };
  private selectedRegion: string = 'us-east';
  private networkMetrics: {
    latencies: number[];
    errors: number;
    reconnects: number;
    totalRequests: number;
  } = {
    latencies: [],
    errors: 0,
    reconnects: 0,
    totalRequests: 0
  };
  private readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB limit for audio buffers

  constructor(private configService: ConfigurationService) {
    this.tempDir = path.join(os.tmpdir(), 'projectcall-stt-temp');
    this.cacheDir = path.join(os.tmpdir(), 'projectcall-stt-cache');
    this.ensureTempDirectories().then(() => {
      this.initialize();
      this.schedulePeriodicCleanup();
    });
  }

  /**
   * Ensure temporary directories exist
   */
  private async ensureTempDirectories(): Promise<void> {
    try {
      await mkdir(this.tempDir, { recursive: true });
      await mkdir(this.cacheDir, { recursive: true });
      logger.debug(`Created STT temporary directories: ${this.tempDir}, ${this.cacheDir}`);
    } catch (error) {
      logger.error(`Failed to create temporary directories: ${error.message}`);
    }
  }

  /**
   * Schedule periodic cleanup of temporary files
   */
  private schedulePeriodicCleanup(): void {
    // Clean up temporary files every hour
    setInterval(() => this.cleanupTempFiles(), 3600000);
  }

  /**
   * Clean up temporary files older than 24 hours
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      const now = Date.now();
      const expiryTime = now - 86400000; // 24 hours ago
      
      await this.cleanupDirectory(this.tempDir, expiryTime);
      await this.cleanupDirectory(this.cacheDir, expiryTime);
      
      logger.debug('Cleaned up old temporary STT files');
    } catch (error) {
      logger.error(`Error cleaning up temporary files: ${error.message}`);
    }
  }

  /**
   * Clean up files in a directory that are older than the expiry time
   */
  private async cleanupDirectory(directory: string, expiryTime: number): Promise<void> {
    const files = await readdir(directory);
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const fileStat = await stat(filePath);
      
      if (fileStat.isFile() && fileStat.mtimeMs < expiryTime) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          logger.error(`Failed to delete temp file ${filePath}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Initialize the Deepgram client
   */
  private async initialize(): Promise<void> {
    try {
      this.connectionStatus = 'connecting';
      const config = await this.configService.getConfiguration();
      
      if (config?.deepgramConfig?.isEnabled && config?.deepgramConfig?.apiKey) {
        // Validate API key format using DeepgramValidator
        const keyValidation = DeepgramValidator.validateKeyFormat(config.deepgramConfig.apiKey);
        if (!keyValidation.isValid) {
          logger.warn(`Invalid Deepgram API key: ${keyValidation.error}`);
          this.isConfigured = false;
          this.connectionStatus = 'disconnected';
          return;
        }
        
        // Select region based on configuration or latency
        this.selectedRegion = config.deepgramConfig.region || 'us-east';
        
        // Create Deepgram instance with appropriate endpoint
        const endpoint = this.regionEndpoints[this.selectedRegion] || 'api.deepgram.com';
        this.deepgram = new Deepgram(config.deepgramConfig.apiKey);
        
        this.fallbackToGoogle = config.deepgramConfig.fallbackToGoogle || false;
        this.maxRetries = config.deepgramConfig.maxRetries || 3;
        this.retryDelay = config.deepgramConfig.retryDelay || 1000;
        
        // Verify connection with a ping
        await this.pingService();
        
        this.isConfigured = true;
        this.connectionStatus = 'connected';
        this.retryCount = 0;
        
        logger.info(`Deepgram STT service initialized successfully in ${this.selectedRegion} region`);
      } else {
        logger.warn('Deepgram not configured, will use fallback methods');
        this.isConfigured = false;
        this.connectionStatus = 'disconnected';
      }
    } catch (error) {
      this.connectionStatus = 'disconnected';
      this.isConfigured = false;
      logger.error(`Failed to initialize Deepgram: ${error.message}`);
      
      // If we're retrying, wait and try again
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = this.retryDelay * this.retryCount;
        logger.info(`Retrying Deepgram initialization in ${delay}ms (attempt ${this.retryCount})`);
        
        setTimeout(() => {
          this.initialize();
        }, delay);
      }
    }
  }

  /**
   * For Deepgram SDK compatibility checks
   */
  private detectSdkVersion() {
    // Check if the SDK supports the newer API structure
    if (this.deepgram) {
      // Use as any to bypass TypeScript checking for dynamic SDK version detection
      const dg = this.deepgram as any;
      
      // First try the most recent SDK API format
      if (dg.listen && 
          typeof dg.listen.preRecorded === 'function' &&
          typeof dg.listen.live === 'function') {
        return 'v2';
      }
      // Fall back to older API format
      else if (dg.transcription &&
              typeof dg.transcription.preRecorded === 'function' &&
              typeof dg.transcription.live === 'function') {
        return 'v1';
      }
    }
    return 'unknown';
  }

  /**
   * Ping Deepgram service to verify connection
   * Uses DeepgramValidator for API connection testing
   */
  private async pingService(): Promise<void> {
    if (!this.deepgram) {
      throw new Error('Deepgram client not initialized');
    }
    
    const now = Date.now();
    // Only ping if it's been more than pingInterval since the last ping
    if (now - this.lastPingTime < this.pingInterval) {
      return;
    }
    
    try {
      // Get API key from current config
      const config = await this.configService.getConfiguration();
      if (!config?.deepgramConfig?.apiKey) {
        throw new Error('Deepgram API key not configured');
      }
      
      const apiKey = config.deepgramConfig.apiKey;
      
      // Use the DeepgramValidator to test the connection with a lightweight API call
      const startTime = Date.now();
      const testResult = await DeepgramValidator.testApiConnection(apiKey);
      
      if (!testResult.isValid) {
        throw new Error(`Deepgram API connection test failed: ${testResult.error}`);
      }
      
      const latency = testResult.latency || (Date.now() - startTime);
      
      this.networkMetrics.latencies.push(latency);
      // Keep only the last 100 latency measurements
      if (this.networkMetrics.latencies.length > 100) {
        this.networkMetrics.latencies.shift();
      }
      
      this.lastPingTime = now;
      logger.debug(`Deepgram API ping successful, latency: ${latency}ms`);
    } catch (error) {
      this.networkMetrics.errors++;
      throw new Error(`Failed to ping Deepgram API: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a cache key for an audio file and options
   */
  private async generateCacheKey(audioFilePath: string, options: DeepgramTranscriptionOptions): Promise<string> {
    try {
      // Read first 64KB of the file for hash generation
      const fd = fs.openSync(audioFilePath, 'r');
      const buffer = Buffer.alloc(64 * 1024); // 64KB
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);
      
      // Create hash from file content + options
      const hash = crypto.createHash('sha256');
      hash.update(buffer);
      hash.update(JSON.stringify(options));
      
      return hash.digest('hex');
    } catch (error) {
      logger.error(`Failed to generate cache key: ${error.message}`);
      // Fallback to simpler hash if file reading fails
      const simpleHash = crypto.createHash('md5');
      simpleHash.update(audioFilePath);
      simpleHash.update(JSON.stringify(options));
      return simpleHash.digest('hex');
    }
  }

  /**
   * Get cached transcription result
   */
  private async getCachedResult(cacheKey: string): Promise<TranscriptionResult | null> {
    try {
      const cacheFilePath = path.join(this.cacheDir, `${cacheKey}.json`);
      
      // Check if cache file exists
      try {
        await fs.promises.access(cacheFilePath, fs.constants.R_OK);
      } catch {
        return null;
      }
      
      // Read and parse cache file
      const cacheData = await fs.promises.readFile(cacheFilePath, 'utf8');
      return JSON.parse(cacheData);
    } catch (error) {
      logger.error(`Failed to get cached result: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache transcription result
   */
  private async cacheResult(cacheKey: string, result: TranscriptionResult): Promise<void> {
    try {
      const cacheFilePath = path.join(this.cacheDir, `${cacheKey}.json`);
      await fs.promises.writeFile(cacheFilePath, JSON.stringify(result));
    } catch (error) {
      logger.error(`Failed to cache result: ${error.message}`);
    }
  }

  /**
   * Get the MIME type for an audio file
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    
    const mimeTypeMap: Record<string, string> = {
      '.wav': 'audio/wav',
      '.wave': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.mp4': 'audio/mp4',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.oga': 'audio/ogg',
      '.webm': 'audio/webm',
      '.flac': 'audio/flac'
    };
    
    return mimeTypeMap[ext] || 'audio/wav';
  }

  /**
   * Transcribe audio file with ultra-low latency
   * @param audioFilePath Path to audio file
   * @param options Transcription options
   * @returns Transcription result
   */
  public async transcribeFile(
    audioFilePath: string,
    options: DeepgramTranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    this.networkMetrics.totalRequests++;
    
    try {
      if (this.connectionStatus !== 'connected' || !this.deepgram) {
        await this.initialize();
        if (this.connectionStatus !== 'connected' || !this.deepgram) {
          throw new Error('Deepgram not configured or unavailable');
        }
      }

      // Check if we have a cached result for this audio file
      let cachedResult: TranscriptionResult | null = null;
      if (options.useCache !== false) {
        const cacheKey = await this.generateCacheKey(audioFilePath, options);
        cachedResult = await this.getCachedResult(cacheKey);
        if (cachedResult) {
          logger.info(`Using cached STT result for ${path.basename(audioFilePath)}`);
          return {
            ...cachedResult,
            fromCache: true,
            provider: 'deepgram-cached'
          };
        }
      }

      // Determine mimetype based on file extension
      const mimetype = this.getMimeType(audioFilePath);

      const audioSource = {
        stream: createReadStream(audioFilePath),
        mimetype
      };

      const deepgramOptions = this.buildDeepgramOptions(options);
      
      // For Deepgram SDK v4.4.0 compatibility
      let transcription;
      try {
        // Use dynamic SDK detection to call the right method
        const dg = this.deepgram as any;
        const sdkVersion = this.detectSdkVersion();
        
        if (sdkVersion === 'v2') {
          transcription = await dg.listen.preRecorded(audioSource, deepgramOptions);
        } else if (sdkVersion === 'v1') {
          transcription = await dg.transcription.preRecorded(audioSource, deepgramOptions);
        } else {
          throw new Error('Unknown Deepgram SDK version');
        }
      } catch (sdkError) {
        logger.warn(`Deepgram SDK method error: ${sdkError.message}, attempting alternate method`);
        
        // If the direct SDK call fails, create a more manual HTTP request using the validator
        const config = await this.configService.getConfiguration();
        if (!config?.deepgramConfig?.apiKey) {
          throw new Error('Deepgram API key not configured');
        }
        
        // Use DeepgramValidator for a direct API call (fallback)
        const testConnection = await DeepgramValidator.testApiConnection(config.deepgramConfig.apiKey);
        if (!testConnection.isValid) {
          throw new Error('Deepgram API connection test failed');
        }
        
        throw new Error('Failed to transcribe using Deepgram SDK: ' + sdkError.message);
      }
      
      const result = this.processDeepgramResponse(transcription);
      
      // Calculate latency
      const latency = Date.now() - startTime;
      this.networkMetrics.latencies.push(latency);
      if (this.networkMetrics.latencies.length > 100) {
        this.networkMetrics.latencies.shift();
      }
      
      logger.info(`Deepgram transcription completed in ${latency}ms`);
      
      const finalResult = {
        ...result,
        latency,
        provider: 'deepgram'
      };
      
      // Cache the result if caching is enabled
      if (options.useCache !== false) {
        const cacheKey = await this.generateCacheKey(audioFilePath, options);
        await this.cacheResult(cacheKey, finalResult);
      }
      
      return finalResult;
    } catch (error) {
      this.networkMetrics.errors++;
      logger.error(`Deepgram transcription error: ${error.message}`);
      
      // Try fallback if enabled
      if (this.fallbackToGoogle) {
        logger.info('Falling back to Google Speech-to-Text');
        return this.fallbackTranscription(audioFilePath, options);
      }
      
      throw error;
    }
  }

  /**
   * Transcribe audio stream in real-time with chunk processing
   * @param audioStream Audio stream (Node.js Readable stream)
   * @param options Transcription options
   * @param chunkCallback Optional callback for intermediate chunks
   * @returns Promise that resolves with transcription when stream ends
   */
  public async transcribeStream(
    audioStream: Readable,
    options: DeepgramTranscriptionOptions = {},
    chunkCallback?: (result: TranscriptionResult) => void
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    this.networkMetrics.totalRequests++;
    
    try {
      if (this.connectionStatus !== 'connected' || !this.deepgram) {
        await this.initialize();
        if (this.connectionStatus !== 'connected' || !this.deepgram) {
          throw new Error('Deepgram not configured');
        }
      }

      // Create a connection to Deepgram
      const deepgramOptions = this.buildDeepgramOptions({
        ...options,
        interimResults: chunkCallback ? true : (options.interimResults || false)
      });
      
      // For Deepgram SDK v4.4.0 compatibility
      let deepgramLive;
      try {
        // Use dynamic SDK detection to call the right method
        const dg = this.deepgram as any;
        const sdkVersion = this.detectSdkVersion();
        
        if (sdkVersion === 'v2') {
          deepgramLive = dg.listen.live(deepgramOptions);
        } else if (sdkVersion === 'v1') {
          deepgramLive = dg.transcription.live(deepgramOptions);
        } else {
          throw new Error('Unknown Deepgram SDK version');
        }
      } catch (sdkError) {
        logger.warn(`Deepgram SDK live streaming method error: ${sdkError.message}`);
        throw new Error('Failed to initialize live transcription with Deepgram SDK: ' + sdkError.message);
      }

      // Create a buffer to capture audio for potential caching
      let audioBuffer: Buffer[] = [];
      let totalBufferSize = 0;
      const maxBufferSize = this.MAX_BUFFER_SIZE;
      
      if (options.useCache !== false) {
        const bufferTransform = new Transform({
          transform(chunk, encoding, callback) {
            totalBufferSize += chunk.length;
            
            // Only keep buffer if we're under the limit
            if (totalBufferSize <= maxBufferSize) {
              audioBuffer.push(chunk);
            } else if (audioBuffer.length > 0) {
              // We've exceeded the limit, clear the buffer to save memory
              // (but keep tracking bytes for metrics)
              audioBuffer = [];
              logger.warn('Audio buffer size limit exceeded, caching disabled');
            }
            
            this.push(chunk);
            callback();
          }
        });
        audioStream = audioStream.pipe(bufferTransform);
      }

      // Track streaming stats
      let chunkCount = 0;
      let totalBytes = 0;
      let firstChunkTime: number | null = null;

      // Listen for the connection to open and send streaming audio to Deepgram
      deepgramLive.addListener('open', () => {
        logger.debug('Deepgram connection opened');
        
        // Handle the audio stream
        audioStream.on('data', (chunk) => {
          if (!firstChunkTime) firstChunkTime = Date.now();
          chunkCount++;
          totalBytes += chunk.length;
          deepgramLive.send(chunk);
        });
        
        audioStream.on('end', () => {
          logger.debug(`Stream ended after ${chunkCount} chunks, ${totalBytes} bytes`);
          deepgramLive.finish();
        });
        
        audioStream.on('error', (err) => {
          logger.error(`Audio stream error: ${err.message}`);
          deepgramLive.finish();
        });
      });

      // Return a promise that resolves when transcription is complete
      return new Promise((resolve, reject) => {
        const transcriptionResults: DeepgramResponse[] = [];
        
        // Handle incoming transcription data
        deepgramLive.addListener('transcriptReceived', (transcription: DeepgramResponse) => {
          transcriptionResults.push(transcription);
          
          // If we have a chunk callback and this is a valid chunk with content
          if (chunkCallback && transcription?.results?.channels?.[0]?.alternatives?.length > 0) {
            const processedChunk = this.processDeepgramResponse(transcription);
            
            // Only call back if there's actual content
            if (processedChunk.transcript.trim()) {
              chunkCallback({
                ...processedChunk,
                latency: Date.now() - startTime,
                isFinal: transcription.is_final || false,
                provider: 'deepgram'
              });
            }
          }
        });
        
        // Handle close event
        deepgramLive.addListener('close', async () => {
          const latency = Date.now() - startTime;
          this.networkMetrics.latencies.push(latency);
          if (this.networkMetrics.latencies.length > 100) {
            this.networkMetrics.latencies.shift();
          }
          
          // Calculate streaming metrics
          const processingTime = firstChunkTime ? (Date.now() - firstChunkTime) : 0;
          const bytesPerSecond = processingTime ? (totalBytes / (processingTime / 1000)) : 0;
          
          logger.info(`Deepgram stream transcription completed in ${latency}ms, processed ${totalBytes} bytes at ${bytesPerSecond.toFixed(2)} B/s`);
          
          // Combine and process results
          const combinedResult = this.combineStreamResults(transcriptionResults);
          
          const finalResult = {
            ...combinedResult,
            latency,
            provider: 'deepgram',
            bytesProcessed: totalBytes,
            processingTime
          };
          
          // Cache the result if caching is enabled and we have audio data
          if (options.useCache !== false && audioBuffer.length > 0) {
            try {
              const combinedBuffer = Buffer.concat(audioBuffer);
              const tempFilePath = path.join(this.tempDir, `stream-${Date.now()}.webm`);
              await writeFile(tempFilePath, combinedBuffer);
              
              const cacheKey = await this.generateCacheKey(tempFilePath, options);
              await this.cacheResult(cacheKey, finalResult);
              
              // Clean up temp file
              fs.unlinkSync(tempFilePath);
            } catch (error) {
              logger.error(`Failed to cache stream result: ${error.message}`);
            }
          }
          
          resolve(finalResult);
        });
        
        // Handle errors
        deepgramLive.addListener('error', (error) => {
          this.networkMetrics.errors++;
          logger.error(`Deepgram stream error: ${error}`);
          reject(error);
        });
      });
    } catch (error) {
      this.networkMetrics.errors++;
      logger.error(`Deepgram stream transcription error: ${error.message}`);
      
      // Try fallback if enabled
      if (this.fallbackToGoogle) {
        logger.info('Falling back to Google Speech-to-Text for stream');
        return this.fallbackStreamTranscription(audioStream, options);
      }
      
      throw error;
    }
  }

  /**
   * Build Deepgram options from our internal options format
   */
  private buildDeepgramOptions(options: DeepgramTranscriptionOptions): DeepgramOptions {
    return {
      punctuate: true,
      diarize: options.diarize || false,
      model: options.model || 'nova-2',
      language: options.languageCode || 'en-US',
      detect_language: options.detectLanguage || false,
      smart_format: true,
      utterances: true,
      alternatives: options.alternatives || 1,
      interim_results: options.interimResults || false,
      keywords: options.keywords || [],
      profanity_filter: options.profanityFilter || false,
      redact: options.redact || false,
      tier: options.tier || 'base', // enhanced or base
      version: options.version || 'latest',
      filler_words: options.fillerWords || false
    };
  }
  
  /**
   * Process Deepgram response into standardized format
   */
  private processDeepgramResponse(response: DeepgramResponse): TranscriptionResult {
    try {
      if (!response?.results || !response.results.channels || response.results.channels.length === 0) {
        return { transcript: '', confidence: 0 };
      }
      
      // Get the first channel
      const channel = response.results.channels[0];
      
      // Get the most confident alternative from the first utterance
      if (!channel.alternatives || channel.alternatives.length === 0) {
        return { transcript: '', confidence: 0 };
      }
      
      const utterance = channel.alternatives[0];
      
      return {
        transcript: utterance.transcript || '',
        confidence: utterance.confidence || 0,
        words: utterance.words || [],
        languageCode: response.results.language || 'en-US',
        isFinal: true
      };
    } catch (error) {
      logger.error(`Error processing Deepgram response: ${error instanceof Error ? error.message : String(error)}`);
      return { transcript: '', confidence: 0 };
    }
  }

  /**
   * Combine stream transcription results
   */
  private combineStreamResults(results: DeepgramResponse[]): TranscriptionResult {
    try {
      if (!results || results.length === 0) {
        return { transcript: '', confidence: 0 };
      }
      
      // Combine transcripts from all results
      let combinedTranscript = '';
      let totalConfidence = 0;
      let validResults = 0;
      
      results.forEach(result => {
        if (result?.results?.channels?.[0]?.alternatives?.length > 0) {
          const alternative = result.results.channels[0].alternatives[0];
          if (alternative.transcript) {
            combinedTranscript += ' ' + alternative.transcript;
            totalConfidence += alternative.confidence || 0;
            validResults++;
          }
        }
      });
      
      return {
        transcript: combinedTranscript.trim(),
        confidence: validResults > 0 ? totalConfidence / validResults : 0,
        languageCode: results[0]?.results?.language || 'en-US',
        isFinal: true
      };
    } catch (error) {
      logger.error(`Error combining stream results: ${error instanceof Error ? error.message : String(error)}`);
      return { transcript: '', confidence: 0 };
    }
  }

  /**
   * Get network metrics for monitoring
   */
  public getNetworkMetrics(): any {
    const avgLatency = this.networkMetrics.latencies.length > 0 
      ? this.networkMetrics.latencies.reduce((a, b) => a + b, 0) / this.networkMetrics.latencies.length 
      : 0;
      
    return {
      averageLatency: Math.round(avgLatency),
      errorRate: this.networkMetrics.totalRequests > 0 
        ? (this.networkMetrics.errors / this.networkMetrics.totalRequests) * 100 
        : 0,
      reconnects: this.networkMetrics.reconnects,
      totalRequests: this.networkMetrics.totalRequests,
      connectionStatus: this.connectionStatus,
      region: this.selectedRegion
    };
  }

  /**
   * Reset connection (for error recovery)
   */
  public async resetConnection(): Promise<void> {
    logger.info('Resetting Deepgram connection');
    this.networkMetrics.reconnects++;
    this.deepgram = null;
    this.isConfigured = false;
    this.connectionStatus = 'disconnected';
    this.retryCount = 0;
    await this.initialize();
  }

  /**
   * Fallback transcription using Google Speech-to-Text
   * This is implemented separately in the existing SpeechAnalysisService
   */
  private async fallbackTranscription(
    audioFilePath: string,
    options: DeepgramTranscriptionOptions
  ): Promise<TranscriptionResult> {
    // This would call the existing Google STT implementation
    // For now, return a placeholder
    return {
      transcript: '[Fallback transcription]',
      confidence: 0.5,
      latency: 500,
      provider: 'google-fallback'
    };
  }

  /**
   * Fallback stream transcription
   */
  private async fallbackStreamTranscription(
    audioStream: Readable,
    options: DeepgramTranscriptionOptions
  ): Promise<TranscriptionResult> {
    // This would call the existing Google STT implementation
    // For now, return a placeholder
    return {
      transcript: '[Fallback stream transcription]',
      confidence: 0.5,
      latency: 500,
      provider: 'google-fallback'
    };
  }
}

// Export a singleton instance with the configuration service
export const enhancedSpeechToTextService = new EnhancedSpeechToTextService(configurationService);