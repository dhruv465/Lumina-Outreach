/**
 * Cloudinary Service for handling audio file uploads
 * Used to store and retrieve audio files for Twilio voice responses
 */
// Lazy-load Cloudinary at runtime to guard against module-load crashes
// (some transitive deps like `q` may throw during require/import).
// We'll attempt to import on first use and fail gracefully if unavailable.
let cloudinary: any | null = null;
let _cloudinaryLoadAttempted = false;
import streamifier from 'streamifier';
import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from './logger';
import { getErrorMessage } from './logger';

// DON'T initialize here - will be initialized in initCloudinary()
// This prevents issues with environment variables not being loaded yet

// Cache to prevent duplicate uploads
const urlCache = new Map<string, { url: string, timestamp: number }>();
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clean expired items from cache
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of urlCache.entries()) {
    if (now - value.timestamp > CACHE_EXPIRY) {
      urlCache.delete(key);
    }
  }
}

// Clean cache periodically
setInterval(cleanCache, CACHE_EXPIRY / 24); // Clean every hour

/**
 * Generate a cache key for audio content
 * @param buffer Audio buffer or file content
 */
function generateCacheKey(buffer: Buffer): string {
  // Simple hash function for buffers
  let hash = 0;
  for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
    hash = ((hash << 5) - hash) + buffer[i];
    hash |= 0; // Convert to 32bit integer
  }
  return `audio_${buffer.length}_${hash}`;
}

/**
 * Upload audio buffer to Cloudinary
 * @param audioBuffer Buffer containing audio data
 * @param folder Optional folder name in Cloudinary
 * @param contentType Optional content type (default: 'audio/mpeg')
 * @returns Promise resolving to the Cloudinary URL
 */
export async function uploadAudioBuffer(
  audioBuffer: Buffer, 
  folder: string = 'voice-recordings',
  contentType: string = 'audio/mpeg'
): Promise<string> {
  try {
    // Ensure Cloudinary is available (lazy-load)
    if (!_cloudinaryLoadAttempted) {
      _cloudinaryLoadAttempted = true;
      try {
        const mod = await import('cloudinary');
        cloudinary = mod && (mod.v2 || mod.default?.v2) ? (mod.v2 || mod.default.v2) : mod;
      } catch (loadErr) {
        cloudinary = null;
        logger.error('Failed to load Cloudinary module dynamically', { error: getErrorMessage(loadErr) });
      }
    }

    if (!cloudinary) {
      throw new Error('Cloudinary module not available; upload disabled');
    }
    // Check cache first
    const cacheKey = generateCacheKey(audioBuffer);
    const cached = urlCache.get(cacheKey);
    if (cached) {
      logger.info(`Using cached Cloudinary URL for audio, size: ${audioBuffer.length} bytes`);
      return cached.url;
    }

    // Upload to Cloudinary
    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          resource_type: 'auto', // Use 'auto' to detect audio files properly
          folder, 
          public_id: `audio-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          // Ensure audio is processed correctly
          format: 'mp3',
          // Set content type explicitly
          type: 'upload',
          // Audio-specific settings for better playback with Twilio
          audio_codec: 'mp3',
          bit_rate: '128k',
          // Add content type to resource metadata
          context: `content_type=${contentType}`,
          // Auto-delete after 24 hours (via access control)
          access_control: [{ access_type: 'anonymous', start: new Date(), end: new Date(Date.now() + 86400000) }]
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      
      streamifier.createReadStream(audioBuffer).pipe(uploadStream);
    });

    logger.info(`Uploaded audio to Cloudinary, size: ${audioBuffer.length} bytes, URL: ${result.secure_url}`);
    
    // Cache the result
    urlCache.set(cacheKey, { url: result.secure_url, timestamp: Date.now() });
    
    return result.secure_url;
  } catch (error) {
    logger.error(`Error uploading audio to Cloudinary: ${error}`);
    throw error;
  }
}

/**
 * Upload audio file to Cloudinary
 * @param filePath Path to audio file
 * @param folder Optional folder name in Cloudinary
 * @param cleanupFile Whether to delete the source file after upload (default: false)
 * @returns Promise resolving to the Cloudinary URL
 */
export async function uploadAudioFile(
  filePath: string, 
  folder: string = 'voice-recordings',
  cleanupFile: boolean = false
): Promise<string> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    // Read file as buffer
    const audioBuffer = fs.readFileSync(filePath);
    
    // Check file type to set appropriate content type
    const isMP3 = filePath.toLowerCase().endsWith('.mp3') ||
                 (audioBuffer.length > 2 && 
                  ((audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33) || // ID3 tag
                   (audioBuffer[0] === 0xFF && (audioBuffer[1] === 0xFB || audioBuffer[1] === 0xFA)))); // MP3 frame
    
    const contentType = isMP3 ? 'audio/mpeg' : 'audio/mp3'; // Default to MP3 content type
    logger.info(`Uploading audio file with content type: ${contentType}, size: ${audioBuffer.length} bytes`);
    
  // Use the buffer upload method with explicit content type
  const cloudinaryUrl = await uploadAudioBuffer(audioBuffer, folder, contentType);
    
    // Clean up source file if requested
    if (cleanupFile) {
      try {
        fs.unlinkSync(filePath);
        logger.debug(`Cleaned up temporary file ${filePath} after Cloudinary upload`);
      } catch (cleanupError) {
        logger.warn(`Failed to clean up temp file ${filePath}: ${getErrorMessage(cleanupError)}`);
      }
    }
    
    return cloudinaryUrl;
  } catch (error) {
    logger.error(`Error uploading audio file to Cloudinary: ${error}`);
    throw error;
  }
}

/**
 * Check if Cloudinary is properly configured
 * @returns boolean indicating if Cloudinary is ready to use
 */
export function isCloudinaryConfigured(): boolean {
  // Check if environment variables are defined
  const envVarsExist = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
  
  // If Cloudinary hasn't loaded yet, be conservative and only rely on env vars
  if (!cloudinary) {
    return envVarsExist;
  }

  // Check if cloudinary configuration has the values
  try {
    const cloudinaryConfig = cloudinary.config();
    const configHasValues = !!(
      cloudinaryConfig.cloud_name &&
      cloudinaryConfig.api_key &&
      cloudinaryConfig.api_secret
    );
    return envVarsExist && configHasValues;
  } catch (err) {
    logger.warn('Cloudinary config check failed', { error: getErrorMessage(err) });
    return envVarsExist;
  }
}

/**
 * Initialize Cloudinary
 * Checks configuration and logs status
 */
export function initCloudinary(): void {
  // Attempt to lazy-load and configure Cloudinary asynchronously. Do not throw on failure.
  if (!_cloudinaryLoadAttempted) {
    _cloudinaryLoadAttempted = true;
    import('cloudinary')
      .then((mod) => {
        cloudinary = mod && (mod.v2 || mod.default?.v2) ? (mod.v2 || mod.default.v2) : mod;
        try {
          cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
          });
          logger.info(`Cloudinary service initialized successfully with cloud_name: ${process.env.CLOUDINARY_CLOUD_NAME}`);
          logger.info(`API key length: ${process.env.CLOUDINARY_API_KEY?.length || 0}, API secret length: ${process.env.CLOUDINARY_API_SECRET?.length || 0}`);
        } catch (err) {
          logger.warn('Cloudinary loaded but configuration failed', { error: getErrorMessage(err) });
        }
      })
      .catch((err) => {
        cloudinary = null;
        logger.warn('Cloudinary module failed to load during init; continuing without Cloudinary', { error: getErrorMessage(err) });
      });
  }
}

/**
 * Test Cloudinary connection with a small upload
 * @returns Promise resolving to true if connection works
 */
export async function testCloudinaryConnection(): Promise<boolean> {
  try {
    // Ensure Cloudinary module is loaded before testing
    if (!_cloudinaryLoadAttempted) {
      _cloudinaryLoadAttempted = true;
      try {
        const mod = await import('cloudinary');
        cloudinary = mod && (mod.v2 || mod.default?.v2) ? (mod.v2 || mod.default.v2) : mod;
      } catch (loadErr) {
        cloudinary = null;
        logger.warn('Cannot test Cloudinary connection - module failed to load', { error: getErrorMessage(loadErr) });
        return false;
      }
    }

    if (!isCloudinaryConfigured()) {
      logger.warn('Cannot test Cloudinary connection - not configured or module missing');
      return false;
    }
    
    // Create a tiny test buffer (1x1 transparent pixel)
    const testPixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    
    // Try to upload
    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: 'auto', folder: 'test' },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      
      streamifier.createReadStream(testPixel).pipe(uploadStream);
    });
    
    logger.info(`Cloudinary test successful - uploaded test file: ${result.public_id}`);
    return true;
  } catch (error) {
    logger.error(`Cloudinary test failed: ${error}`);
    return false;
  }
}

export default {
  uploadAudioBuffer,
  uploadAudioFile,
  isCloudinaryConfigured,
  initCloudinary,
  testCloudinaryConnection
};
