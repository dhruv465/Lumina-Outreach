import { logger } from '../index';
import { getErrorMessage } from './logger';

/**
 * Convert μ-law audio to 16-bit PCM format, resampling from 8kHz to 48kHz.
 * Twilio sends audio in μ-law format (8kHz), we upsample to 48kHz for Deepgram Agent.
 */
export function convertMuLawToPCM(muLawBuffer: Buffer): Buffer {
    try {
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
      
      // Convert each μ-law byte to 16-bit PCM using the lookup table
      const pcm8kHzBuffer = Buffer.alloc(muLawBuffer.length * 2);
      
      for (let i = 0; i < muLawBuffer.length; i++) {
        const muLawByte = muLawBuffer[i];
        const pcmSample = MULAW_DECODE_TABLE[muLawByte];
        pcm8kHzBuffer.writeInt16LE(pcmSample, i * 2);
      }
      
      // Resample from 8kHz to 48kHz (6x upsampling) using linear interpolation
      const numSamples8k = Math.floor(pcm8kHzBuffer.length / 2);
      const numSamples48k = numSamples8k * 6;
      const pcm48kHzBuffer = Buffer.alloc(numSamples48k * 2);
      
      for (let i = 0; i < numSamples8k - 1; i++) {
        const sample1 = pcm8kHzBuffer.readInt16LE(i * 2);
        const sample2 = pcm8kHzBuffer.readInt16LE((i + 1) * 2);
        
        // Write 6 interpolated samples for each original sample
        for (let j = 0; j < 6; j++) {
          const ratio = j / 6;
          const interpolated = Math.round(sample1 * (1 - ratio) + sample2 * ratio);
          pcm48kHzBuffer.writeInt16LE(interpolated, (i * 6 + j) * 2);
        }
      }
      
      // Handle the last sample
      if (numSamples8k > 0) {
        const lastSample = pcm8kHzBuffer.readInt16LE((numSamples8k - 1) * 2);
        for (let j = 0; j < 6; j++) {
          pcm48kHzBuffer.writeInt16LE(lastSample, ((numSamples8k - 1) * 6 + j) * 2);
        }
      }

      // Return the raw 48kHz PCM buffer
      return pcm48kHzBuffer;
    } catch (error) {
      logger.warn(`Error converting μ-law to PCM and resampling: ${getErrorMessage(error)}, using original buffer`);
      return muLawBuffer; // Return original buffer if conversion fails
    }
}

/**
 * Create a proper WAV file with header from PCM data
 */
function createWavFile(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;
    
    const header = Buffer.alloc(44);
    let offset = 0;
    
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(fileSize, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;
    
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4;
    header.writeUInt16LE(1, offset); offset += 2;
    header.writeUInt16LE(channels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, offset); offset += 4;
    header.writeUInt16LE(channels * bitsPerSample / 8, offset); offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;
    
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset);
    
    const wavFile = Buffer.concat([header, pcmData]);
    
    logger.debug(`📄 Created WAV file: ${wavFile.length} bytes (header: 44, data: ${dataSize})`);
    
    return wavFile;
}

/**
 * Convert 16-bit PCM audio to μ-law format.
 * Downsamples from 24kHz to 8kHz (Deepgram output → Twilio input)
 */
export function convertPCMToMuLaw(pcmBuffer: Buffer, inputSampleRate: number = 24000): Buffer {
    // Downsample from inputSampleRate to 8kHz if needed
    let pcm8kHzBuffer = pcmBuffer;
    
    if (inputSampleRate === 24000) {
        // Downsample 24kHz → 8kHz (take every 3rd sample)
        const numSamples = Math.floor(pcmBuffer.length / 2);
        const downSampledLength = Math.floor(numSamples / 3);
        pcm8kHzBuffer = Buffer.alloc(downSampledLength * 2);
        
        for (let i = 0; i < downSampledLength; i++) {
            const sample = pcmBuffer.readInt16LE(i * 3 * 2);
            pcm8kHzBuffer.writeInt16LE(sample, i * 2);
        }
    } else if (inputSampleRate === 16000) {
        // Downsample 16kHz → 8kHz (take every 2nd sample)
        const numSamples = Math.floor(pcmBuffer.length / 2);
        const downSampledLength = Math.floor(numSamples / 2);
        pcm8kHzBuffer = Buffer.alloc(downSampledLength * 2);
        
        for (let i = 0; i < downSampledLength; i++) {
            const sample = pcmBuffer.readInt16LE(i * 2 * 2);
            pcm8kHzBuffer.writeInt16LE(sample, i * 2);
        }
    }
    
    // Convert PCM to μ-law
    const muLawBuffer = Buffer.alloc(Math.floor(pcm8kHzBuffer.length / 2));
    for (let i = 0; i < pcm8kHzBuffer.length - 1; i += 2) {
        const pcmSample = pcm8kHzBuffer.readInt16LE(i);
        const muLawSample = linearToMuLaw(pcmSample);
        muLawBuffer.writeUInt8(muLawSample, i / 2);
    }
    return muLawBuffer;
}

function linearToMuLaw(pcm_val: number): number {
    const MU_LAW_BIAS = 0x84;
    const MU_LAW_MAX_LINEAR = 32635;

    let sign = (pcm_val >> 8) & 0x80;
    if (sign !== 0) {
        pcm_val = -pcm_val;
    }

    pcm_val += MU_LAW_BIAS;

    if (pcm_val > MU_LAW_MAX_LINEAR) {
        pcm_val = MU_LAW_MAX_LINEAR;
    }

    let exponent = 0;
    if (pcm_val >= 8192) exponent = 7;
    else if (pcm_val >= 4096) exponent = 6;
    else if (pcm_val >= 2048) exponent = 5;
    else if (pcm_val >= 1024) exponent = 4;
    else if (pcm_val >= 512) exponent = 3;
    else if (pcm_val >= 256) exponent = 2;
    else if (pcm_val >= 128) exponent = 1;

    let mantissa = (pcm_val >> (exponent + 3)) & 0x0F;

    let mulaw_val = (exponent << 4) | mantissa;

    if (sign === 0) {
        mulaw_val = ~mulaw_val;
    }

    mulaw_val |= sign;

    return mulaw_val & 0xFF;
}

/**
 * Detect if there is voice activity in the audio buffer
 * This is an enhanced energy-based voice activity detection with proper μ-law decoding
 */
export function detectVoiceActivity(audioBuffer: Buffer): boolean {
    try {
      if (audioBuffer.length === 0) {
        return false;
      }
      
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
      
      let sumSquares = 0;
      let sampleCount = 0;
      let maxAbsValue = 0;
      
      for (let i = 0; i < audioBuffer.length; i++) {
        const mulawByte = audioBuffer[i];
        const linearSample = MULAW_DECODE_TABLE[mulawByte];
        const absValue = Math.abs(linearSample);
        if (absValue > maxAbsValue) {
          maxAbsValue = absValue;
        }
        sumSquares += linearSample * linearSample;
        sampleCount++;
      }
      
      if (sampleCount === 0) {
        return false;
      }
      
      const rmsEnergy = Math.sqrt(sumSquares / sampleCount);
      const threshold = 1000;
      const hasActivity = rmsEnergy > threshold;
      
      logger.debug(`🔊 VAD: RMS=${rmsEnergy.toFixed(2)}, Peak=${maxAbsValue}, Threshold=${threshold}, Active=${hasActivity}`);
      
      return hasActivity;
    } catch (error) {
      logger.warn(`Error detecting voice activity: ${getErrorMessage(error)}`);
      return false;
    }
}
