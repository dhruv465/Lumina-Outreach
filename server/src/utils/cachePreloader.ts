/**
 * Response Cache Preloader
 * 
 * This utility ensures the response cache is preloaded with common phrases
 * to minimize latency for the first interactions in a conversation.
 */

import { getSDKService } from '../services/elevenlabsSDKService';
import logger from '../utils/logger';
import { commonPhrases } from '../config/latencyOptimization';

const voiceCache: Map<string, Map<string, Buffer>> = new Map();

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const DEFAULT_PRELOAD_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Example voice ID from logs

async function processNext(voiceId: string, phrase: string) {
  try {
    const sdk = getSDKService();
    if (!sdk) {
      logger.warn('ElevenLabs SDK service not initialized; skipping preload.');
      return;
    }

    // ElevenLabsSDKService.generateSpeech expects (text, voiceId, options?)
    const audioBuffer = await sdk.generateSpeech(phrase, voiceId);
    let phrasesMap = voiceCache.get(voiceId);
    if (!phrasesMap) {
      phrasesMap = new Map();
      voiceCache.set(voiceId, phrasesMap);
    }
    phrasesMap.set(phrase, audioBuffer);
  } catch (error) {
    logger.warn(`Failed to preload phrase "${phrase}" for voice ID ${voiceId}: ${error.message}`);
  }
}



export async function preloadAllVoices() {
  logger.info('Starting preloading of all voices...');
  const phraseCategories = commonPhrases;

  for (const categoryName of Object.keys(phraseCategories)) {
    const phrases = phraseCategories[categoryName];
    logger.info(`Preloading phrases for category: ${categoryName} with voice ID: ${DEFAULT_PRELOAD_VOICE_ID}`);
    for (const phrase of phrases) {
      await processNext(DEFAULT_PRELOAD_VOICE_ID, phrase);
      await delay(500); // Increased delay between individual phrase preloads
    }
    await delay(1000); // Increased delay between categories
  }
  logger.info('Finished preloading of all voices.');
}

export function getPreloadedAudio(voiceId: string, phrase: string): Buffer | undefined {
  return voiceCache.get(voiceId)?.get(phrase);
}
