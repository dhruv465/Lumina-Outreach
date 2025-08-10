import { EnhancedVoiceAIService } from '../services/enhancedVoiceAIService';
import Configuration from '../models/Configuration';
import Campaign from '../models/Campaign';
import logger from './logger';
import { getErrorMessage } from './logger';
import fs from 'fs';
import path from 'path';
import { getPreferredVoiceId } from './voiceUtils';
import cloudinaryService from './cloudinaryService';

/**
 * Utility to synthesize voice using ElevenLabs with proper fallback handling
 * @param twiml Twilio TwiML response object to add the synthesized speech to
 * @param text Text to synthesize
 * @param options Additional options for voice synthesis
 * @returns Promise resolving to true if ElevenLabs was used, false if fallback was used
 */
export async function synthesizeVoiceResponse(
  twiml: any,
  text: string,
  options: {
    voiceId?: string;
    language?: string;
    elevenLabsApiKey?: string;
    llmApiKey?: string; // Changed from openAIApiKey to be more generic
    campaignId?: string;
    fallbackBehavior?: 'silent' | 'empty-audio' | 'tts';
  }
): Promise<boolean> {
  const {
    voiceId: requestedVoiceId,
    language = 'en',
    elevenLabsApiKey,
    llmApiKey, // Use the more generic llmApiKey
    campaignId,
    fallbackBehavior = 'empty-audio'
  } = options;

  try {
    // Skip if text is empty
    if (!text || text.trim() === '') {
      logger.error('Empty text provided to synthesizeVoiceResponse');
      // NO HARDCODED MESSAGES - throw error to force proper configuration
      throw new Error('Empty text provided for voice synthesis. Please ensure your campaign script has content.');
    }

    // Log the request for debugging
    logger.info(`Synthesizing voice response: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    
    // Check if we should use a fallback audio file
    const shouldUseFallback = await checkShouldUseFallback(text);
    if (shouldUseFallback) {
      logger.info('Using pre-generated fallback audio for common phrase');
      twiml.play(shouldUseFallback);
      return true;
    }

    // Get configuration for voice synthesis
    const config = await Configuration.findOne();
    
    // Exit early if no configuration found
    if (!config) {
      logger.debug('No configuration found, using TTS fallback');
      twiml.say({ voice: 'alice', language: language === 'hi' ? 'hi-IN' : 'en-US' }, text);
      return false;
    }

    // Resolve voice ID - try campaign-specific voice first if campaignId is provided
    let finalVoiceId = requestedVoiceId || await getPreferredVoiceId();
    
    if (campaignId) {
      try {
        const campaign = await Campaign.findById(campaignId);
        if (campaign?.voiceConfiguration?.voiceId) {
          finalVoiceId = campaign.voiceConfiguration.voiceId;
          logger.debug(`Using campaign voice ID for synthesis: ${finalVoiceId}`);
        }
      } catch (error) {
        logger.error(`Error fetching campaign voice: ${getErrorMessage(error)}`);
      }
    }
    
    // Use TTS service factory for auto-detection and synthesis
    const { synthesizeSpeechWithProvider } = await import('./ttsServiceFactory');
    const speechResponse = await synthesizeSpeechWithProvider(
      config,
      text,
      finalVoiceId,
      language
    );

    // Check if synthesis was successful
    if (speechResponse.audioContent && speechResponse.method === 'tts') {
      // Process audio safely using helper function
      const audioResult = await processAudioForTwiML(
        speechResponse.audioContent,
        text,
        language
      );

      if (audioResult.method === 'cloudinary') {
        // Use Cloudinary URL
        twiml.play(prepareUrlForTwilioPlay(audioResult.url));
        logger.info(`Used TTS provider for voice synthesis: ${speechResponse.audioContent.length} bytes`);
        return true;
      } else if (audioResult.method === 'tts') {
        // Use chunked TTS fallback
        const isChunked = audioResult.url.startsWith('USE_CHUNKED_AUDIO:');
        if (isChunked) {
          // Extract the full text from the marker
          const fullText = audioResult.url.substring('USE_CHUNKED_AUDIO:'.length);
          const hasCloudinaryError = fullText.startsWith('[CLOUDINARY_ERROR]');
          const cleanText = hasCloudinaryError ? fullText.substring('[CLOUDINARY_ERROR]'.length).trim() : fullText;
          
          // Use smaller chunks for Cloudinary errors
          const maxChunkLength = hasCloudinaryError ? 150 : 250;
          const chunks = splitTextIntoChunks(cleanText, maxChunkLength);
          
          // Add each chunk as a separate say command
          for (const chunk of chunks) {
            if (chunk.trim()) {
              twiml.say({
                voice: 'alice',
                language: language === 'hi' ? 'hi-IN' : 'en-US'
              }, chunk);
            }
          }
          return false; // Indicates TTS was used as fallback
        } else {
          // Regular TTS
          twiml.say({ voice: 'alice', language: language === 'hi' ? 'hi-IN' : 'en-US' }, audioResult.url);
          return false;
        }
      }
    } else {
      throw new Error('TTS synthesis failed or returned empty content');
    }
  } catch (error) {
    logger.error(`Error in voice synthesis: ${getErrorMessage(error)}`, {
      errorDetails: error instanceof Error ? error.stack : 'Unknown error',
      params: {
        textLength: text?.length || 0,
        requestedVoiceId,
        language,
        campaignId: campaignId || 'none'
      }
    });
    
    // Use fallback behavior
    if (fallbackBehavior === 'silent') {
      // Use TTS instead of silent for better user experience
      logger.info('Using TTS fallback instead of silent for better user experience');
      twiml.say({ voice: 'alice', language: language === 'hi' ? 'hi-IN' : 'en-US' }, text);
    } else if (fallbackBehavior === 'tts') {
      // Use Twilio's built-in TTS as a last resort
      logger.info(`Using Twilio TTS fallback for voice synthesis: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
      twiml.say({ voice: 'alice', language: language === 'hi' ? 'hi-IN' : 'en-US' }, text);
    } else {
      // Default to TTS instead of empty audio
      logger.info('Using TTS fallback instead of empty audio for voice synthesis');
      twiml.say({ voice: 'alice', language: language === 'hi' ? 'hi-IN' : 'en-US' }, text);
    }
    
    return false;
  }
}

/**
 * Check if we should use a pre-generated fallback audio for common phrases
 * @param text The text to check
 * @returns Path to fallback audio if available, false otherwise
 */
async function checkShouldUseFallback(text: string): Promise<string | false> {
  // NO HARDCODED FALLBACK PHRASES - system must be fully dynamic
  // All phrases must be configured through the system configuration UI
  return false; // Never use hardcoded fallback audio files
}

/**
 * Process audio buffer for TwiML responses
 * Ensures audio is properly handled either via Cloudinary or as base64
 * Takes size into account to prevent exceeding TwiML 64KB size limit
 * 
 * This function solves a critical issue where large audio files are base64-encoded
 * directly in TwiML responses, which can cause Twilio to reject the response if
 * it exceeds the 64KB limit. This commonly happens when ElevenLabs returns large audio
 * files or when the system falls back to alternative synthesis methods.
 * 
 * The function works by:
 * 1. Always trying to upload audio to Cloudinary first (best option)
 * 2. Only using base64 encoding for small files (<48KB) that won't risk exceeding the limit
 * 3. Falling back to TTS for large files when Cloudinary is unavailable
 * 
 * TWILIO LIMITS:
 * - Maximum TwiML response size: 64KB (65,536 bytes)
 * - Safe limit for base64 audio: 48KB (75% of max to allow for TwiML structure)
 * - Base64 encoding increases size by ~33%, so a 48KB audio file becomes ~64KB when encoded
 * 
 * This ensures we never exceed Twilio's TwiML size limit while still providing
 * high-quality voice synthesis when possible.
 */
export async function processAudioForTwiML(
  audioBuffer: Buffer,
  fallbackText: string,
  language: string = 'en'
): Promise<{
  method: 'cloudinary' | 'base64' | 'tts';
  url: string;
  size: number;
}> {
  let tempFilePath: string | null = null;
  
  try {
    // First validate the audio format
    const { buffer: validatedBuffer, format, needsConversion } = await validateAudioFormat(audioBuffer);
    
    // If format needs conversion, log a warning
    if (needsConversion) {
      logger.warn('Audio format may not be optimal for Twilio playback');
    }
    
    // Use the validated buffer
    audioBuffer = validatedBuffer;
    
    // Get size of the audio buffer
    const audioSize = audioBuffer.length;
    const audioSizeKB = Math.round(audioSize / 1024 * 100) / 100;
    logger.info(`Processing audio for TwiML, size: ${audioSize} bytes (${audioSizeKB}KB), format: ${format}`);
    
    // Calculate the approximate base64 size
    const base64Size = Math.ceil(audioSize * 1.37); // Base64 encoding increases size by ~37%
    const base64SizeKB = Math.round(base64Size / 1024 * 100) / 100;
    
    if (base64Size > 60000) { // Close to 64KB limit for TwiML
      logger.warn(`⚠️ Audio would be ${base64SizeKB}KB when base64 encoded - too large for TwiML (limit: 64KB). Using alternative approach.`);
    }
    
    // Detailed logging for better debugging
    logger.info(`Audio stats - Size: ${audioSizeKB}KB | Approx. Base64 size: ${base64SizeKB}KB | Text length: ${fallbackText.length} chars`);
    
    // Safety check - if the audio size is suspiciously small (might be corrupt)
    if (audioSize < 1000) { // Less than 1KB is suspiciously small
      logger.warn(`⚠️ Audio size is suspiciously small (${audioSize} bytes), might be corrupted - using TTS fallback`);
      // Fall back to TTS for potentially corrupted audio
      return {
        method: 'tts',
        url: fallbackText, // Return the text to be used with TTS
        size: audioSize
      };
    }
    
    // Always try to split large audio files into smaller chunks
    if (audioSize > 30 * 1024) { // If audio is larger than 30KB, split it
      logger.info(`Audio file size (${audioSizeKB}KB) is large, splitting into chunks for better reliability`);
      
      try {
        // First try uploading to Cloudinary even for large files
        // This gives us the best audio quality while avoiding TwiML size limits
        if (cloudinaryService.isCloudinaryConfigured()) {
          // Create a temporary file to upload to Cloudinary
          tempFilePath = require('path').join(
            require('os').tmpdir(), 
            `twiml-audio-${Date.now()}.mp3`
          );
          
          // Write buffer to temp file
          require('fs').writeFileSync(tempFilePath, audioBuffer);
          
          // Upload to Cloudinary with auto-cleanup
          const cloudinaryUrl = await cloudinaryService.uploadAudioFile(tempFilePath, 'voice-recordings', true);
          tempFilePath = null; // Set to null since the file has been cleaned up by the upload function
          
          logger.info(`Successfully uploaded large audio (${audioSizeKB}KB) to Cloudinary, URL: ${cloudinaryUrl}`);
          
          // Format URL for Twilio
          const formattedUrl = prepareUrlForTwilioPlay(cloudinaryUrl);
          
          return {
            method: 'cloudinary',
            url: formattedUrl,
            size: audioSize
          };
        }
      } catch (cloudinaryError) {
        logger.error(`Failed to upload large audio to Cloudinary: ${getErrorMessage(cloudinaryError)}, falling back to chunked TTS`);
        
        // Add a special error prefix to the message to help with debugging
        return {
          method: 'tts',
          url: 'USE_CHUNKED_AUDIO:[CLOUDINARY_ERROR] ' + fallbackText, // Special marker with error indicator
          size: audioSize
        };
      }
      
      // If Cloudinary upload failed or not configured, use chunked TTS
      // For audio splitting, we return a special instruction to use TTS with a flag
      return {
        method: 'tts',
        url: 'USE_CHUNKED_AUDIO:' + fallbackText, // Special marker for chunked audio
        size: audioSize
      };
    }
    
    // For smaller files, use Cloudinary as usual
    if (cloudinaryService.isCloudinaryConfigured()) {
      try {
        // Create a temporary file to upload to Cloudinary
        tempFilePath = require('path').join(
          require('os').tmpdir(), 
          `twiml-audio-${Date.now()}.mp3`
        );
        
        // Write buffer to temp file
        require('fs').writeFileSync(tempFilePath, audioBuffer);
        
        // Upload to Cloudinary with auto-cleanup
        const cloudinaryUrl = await cloudinaryService.uploadAudioFile(tempFilePath, 'voice-recordings', true);
        tempFilePath = null; // Set to null since the file has been cleaned up by the upload function
        
        logger.info(`Successfully uploaded audio to Cloudinary, URL: ${cloudinaryUrl}`);
        
        // Format URL for Twilio
        const formattedUrl = prepareUrlForTwilioPlay(cloudinaryUrl);
        
        return {
          method: 'cloudinary',
          url: formattedUrl,
          size: audioSize
        };
      } catch (cloudinaryError) {
        logger.error(`Failed to upload to Cloudinary: ${getErrorMessage(cloudinaryError)}`);
        
        // Always use TTS fallback if Cloudinary fails - never use base64
        logger.warn(`Using TTS fallback instead of base64 encoding to avoid empty audio issues`);
        return {
          method: 'tts',
          url: fallbackText, // Return the text to be used with TTS
          size: audioSize
        };
      }
    } else {
      // Cloudinary not configured - this should not happen if environment is set up properly
      logger.error('CRITICAL: Cloudinary not configured for audio processing - check environment variables');
      
      // Always use TTS fallback if Cloudinary is not configured - never use base64
      return {
        method: 'tts',
        url: fallbackText, // Return the text to be used with TTS
        size: audioSize
      };
    }
  } catch (error) {
    logger.error(`Error in processAudioForTwiML: ${getErrorMessage(error)}`);
    return {
      method: 'tts',
      url: fallbackText, // Return the text to be used with TTS
      size: 0
    };
  } finally {
    // Ensure temp file is cleaned up if it exists and wasn't already handled
    if (tempFilePath) {
      try {
        if (require('fs').existsSync(tempFilePath)) {
          require('fs').unlinkSync(tempFilePath);
          logger.debug(`Cleaned up temporary file ${tempFilePath} in processAudioForTwiML finally block`);
        }
      } catch (cleanupError) {
        logger.warn(`Failed to clean up temp file ${tempFilePath} in finally block: ${getErrorMessage(cleanupError)}`);
      }
    }
  }
}

/**
 * Validate and potentially convert audio format to ensure compatibility with Twilio
 * @param audioBuffer The raw audio buffer from ElevenLabs
 * @returns Validated/converted buffer and information about the format
 */
async function validateAudioFormat(audioBuffer: Buffer): Promise<{buffer: Buffer, format: string, needsConversion: boolean}> {
  // Check if buffer is valid
  if (!audioBuffer || audioBuffer.length < 100) {
    logger.warn('Audio buffer is too small or invalid');
    return { buffer: audioBuffer, format: 'unknown', needsConversion: false };
  }
  
  // Simple check for MP3 format (check for MP3 header magic bytes)
  // Most MP3 files start with ID3 tag (0x49 0x44 0x33) or directly with MP3 frame sync (0xFF 0xFB)
  const isMP3 = (
    // Check for ID3 header
    (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33) ||
    // Or check for MP3 frame sync
    (audioBuffer[0] === 0xFF && (audioBuffer[1] === 0xFB || audioBuffer[1] === 0xFA))
  );
  
  if (isMP3) {
    logger.info('Audio format validated as MP3');
    return { buffer: audioBuffer, format: 'mp3', needsConversion: false };
  } else {
    // Not an MP3 - this is unlikely as ElevenLabs should return MP3 when requested
    logger.warn('Audio from ElevenLabs is not in MP3 format, this may cause issues with Twilio playback');
    // We'd ideally convert here, but to keep it simple, we'll just return with a warning
    return { buffer: audioBuffer, format: 'unknown', needsConversion: true };
  }
}

/**
 * Split a large text into smaller chunks to avoid TwiML size limits
 * This tries to split on sentence boundaries to maintain natural speech
 * @param text Full text to split
 * @param maxChunkLength Maximum length of each chunk (default: 250 characters)
 * @returns Array of text chunks
 */
function splitTextIntoChunks(text: string, maxChunkLength: number = 250): string[] {
  if (!text) return [];

  // If text is already small enough, return it as a single chunk
  if (text.length <= maxChunkLength) {
    return [text];
  }
  const chunks: string[] = [];
  let currentPosition = 0;
  while (currentPosition < text.length) {
    // Determine end of current chunk (max length or earlier)
    let chunkEnd = Math.min(currentPosition + maxChunkLength, text.length);

    // Try to find a sentence end (., !, ?) followed by a space or end of text
    if (chunkEnd < text.length) {
      // Search backward from max chunk length for a good break point
      const sentenceEndMatch = text.substring(currentPosition, chunkEnd).match(/[.!?]\s+(?=[A-Z])/g);

      if (sentenceEndMatch && sentenceEndMatch.length > 0) {
        // Find the last sentence end within this chunk
        const lastIndex = text.substring(currentPosition, chunkEnd).lastIndexOf(sentenceEndMatch[sentenceEndMatch.length - 1]);
        if (lastIndex > 0) {
          // +2 to include the period and space
          chunkEnd = currentPosition + lastIndex + 2;
        }
      } else {
        // No sentence end found, try to break at a comma or space
        const commaIndex = text.substring(currentPosition, chunkEnd).lastIndexOf(', ');
        if (commaIndex > 0) {
          chunkEnd = currentPosition + commaIndex + 2; // Include the comma and space
        } else {
          // Last resort: break at the last space
          const spaceIndex = text.substring(currentPosition, chunkEnd).lastIndexOf(' ');
          if (spaceIndex > 0) {
            chunkEnd = currentPosition + spaceIndex + 1; // Include the space
          }
          // If no space found, we'll just break at maxChunkLength
        }
      }
    }

    // Add the chunk to our results
    chunks.push(text.substring(currentPosition, chunkEnd).trim());

    // Move to next position
    currentPosition = chunkEnd;
  }

  return chunks;
}

/**
 * Prepare a URL for Twilio <Play> tag with proper format parameters
 * @param url The Cloudinary or other audio URL
 * @returns URL with proper format parameters for Twilio
 */
export function prepareUrlForTwilioPlay(url: string): string {
  // Skip if the URL is already empty
  if (!url || url.trim() === '') {
    return url;
  }
  
  // Add content_type parameter for Twilio to properly recognize the audio format
  // This is especially important for Cloudinary URLs
  const formattedUrl = url.includes('?') 
    ? `${url}&content_type=audio/mpeg` 
    : `${url}?content_type=audio/mpeg`;
    
  logger.debug(`Formatted URL for Twilio Play: ${formattedUrl}`);
  return formattedUrl;
}
