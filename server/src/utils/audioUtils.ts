import { logger } from "../index";
import { getErrorMessage } from "./logger";

// This is a standard ITU-T G.711 lookup table for µ-law decoding.
// It correctly converts an 8-bit µ-law sample into a 16-bit linear PCM sample.
const MULAW_DECODE_TABLE = [
  -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956, -23932,
  -22908, -21884, -20860, -19836, -18812, -17788, -16764, -15996, -15484,
  -14972, -14460, -13948, -13436, -12924, -12412, -11900, -11388, -10876,
  -10364, -9852, -9340, -8828, -8316, -7932, -7676, -7420, -7164, -6908, -6652,
  -6396, -6140, -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092, -3900,
  -3772, -3644, -3516, -3388, -3260, -3132, -3004, -2876, -2748, -2620, -2492,
  -2364, -2236, -2108, -1980, -1884, -1820, -1756, -1692, -1628, -1564, -1500,
  -1436, -1372, -1308, -1244, -1180, -1116, -1052, -988, -924, -876, -844, -812,
  -780, -748, -716, -684, -652, -620, -588, -556, -524, -492, -460, -428, -396,
  -372, -356, -340, -324, -308, -292, -276, -260, -244, -228, -212, -196, -180,
  -164, -148, -132, -120, -112, -104, -96, -88, -80, -72, -64, -56, -48, -40,
  -32, -24, -16, -8, 0, 32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
  23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764, 15996, 15484, 14972,
  14460, 13948, 13436, 12924, 12412, 11900, 11388, 10876, 10364, 9852, 9340,
  8828, 8316, 7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140, 5884, 5628, 5372,
  5116, 4860, 4604, 4348, 4092, 3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
  2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980, 1884, 1820, 1756, 1692, 1628,
  1564, 1500, 1436, 1372, 1308, 1244, 1180, 1116, 1052, 988, 924, 876, 844, 812,
  780, 748, 716, 684, 652, 620, 588, 556, 524, 492, 460, 428, 396, 372, 356,
  340, 324, 308, 292, 276, 260, 244, 228, 212, 196, 180, 164, 148, 132, 120,
  112, 104, 96, 88, 80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 0,
];

/**
 * Decodes 8kHz µ-law audio from Twilio into 8kHz Linear16 PCM audio for Deepgram.
 * This is the ONLY function you need for this conversion. It performs the necessary
 * decoding and does NOT incorrectly resample the audio.
 *
 * @param muLawBuffer The raw audio buffer from Twilio's media stream.
 * @returns A new Buffer containing 16-bit Linear PCM audio at the correct 8kHz sample rate.
 */
export function decodeTwilioAudio(muLawBuffer: Buffer): Buffer {
  // If the input buffer is empty, return an empty buffer to avoid errors.
  if (!muLawBuffer || muLawBuffer.length === 0) {
    return Buffer.alloc(0);
  }

  try {
    // Each 8-bit µ-law sample becomes a 16-bit PCM sample, so the output buffer will be twice the size.
    const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);

    for (let i = 0; i < muLawBuffer.length; i++) {
      const muLawByte = muLawBuffer[i];
      // Use the lookup table to get the 16-bit PCM value.
      const pcmSample = MULAW_DECODE_TABLE[muLawByte];
      // Write the 16-bit sample into our new buffer in Little Endian format (standard for PCM).
      pcmBuffer.writeInt16LE(pcmSample, i * 2);
    }

    // Return the correctly formatted 8kHz Linear16 PCM buffer.
    return pcmBuffer;
  } catch (error) {
    logger.error(`Error in decodeTwilioAudio: ${getErrorMessage(error)}`);
    // Return an empty buffer if a critical error occurs.
    return Buffer.alloc(0);
  }
}

/**
 * Convert 16-bit PCM audio to μ-law format with proper resampling.
 * Downsamples from 24kHz to 8kHz (Deepgram output → Twilio input) using linear interpolation
 * to avoid harsh audio artifacts.
 */
export function convertPCMToMuLaw(
  pcmBuffer: Buffer,
  inputSampleRate: number = 24000
): Buffer {
  // Downsample from inputSampleRate to 8kHz if needed
  let pcm8kHzBuffer = pcmBuffer;

  if (inputSampleRate === 24000) {
    // Downsample 24kHz → 8kHz using linear interpolation for better quality
    const numInputSamples = Math.floor(pcmBuffer.length / 2);
    const ratio = 24000 / 8000; // 3.0
    const numOutputSamples = Math.floor(numInputSamples / ratio);
    pcm8kHzBuffer = Buffer.alloc(numOutputSamples * 2);

    for (let i = 0; i < numOutputSamples; i++) {
      // Calculate the position in the input buffer
      const srcPos = i * ratio;
      const srcIndex = Math.floor(srcPos);
      const fraction = srcPos - srcIndex;

      // Get the two samples to interpolate between
      const sample1 = srcIndex < numInputSamples ? pcmBuffer.readInt16LE(srcIndex * 2) : 0;
      const sample2 = (srcIndex + 1) < numInputSamples ? pcmBuffer.readInt16LE((srcIndex + 1) * 2) : sample1;

      // Linear interpolation
      const interpolatedSample = Math.round(sample1 * (1 - fraction) + sample2 * fraction);

      // Clamp to 16-bit range
      const clampedSample = Math.max(-32768, Math.min(32767, interpolatedSample));

      pcm8kHzBuffer.writeInt16LE(clampedSample, i * 2);
    }
  } else if (inputSampleRate === 16000) {
    // Downsample 16kHz → 8kHz using linear interpolation
    const numInputSamples = Math.floor(pcmBuffer.length / 2);
    const ratio = 16000 / 8000; // 2.0
    const numOutputSamples = Math.floor(numInputSamples / ratio);
    pcm8kHzBuffer = Buffer.alloc(numOutputSamples * 2);

    for (let i = 0; i < numOutputSamples; i++) {
      // For 2:1 ratio, we can use simple averaging
      const idx1 = i * 2;
      const idx2 = i * 2 + 1;

      const sample1 = idx1 < numInputSamples ? pcmBuffer.readInt16LE(idx1 * 2) : 0;
      const sample2 = idx2 < numInputSamples ? pcmBuffer.readInt16LE(idx2 * 2) : sample1;

      // Average the two samples
      const avgSample = Math.round((sample1 + sample2) / 2);

      pcm8kHzBuffer.writeInt16LE(avgSample, i * 2);
    }
  }

  // Convert PCM to μ-law
  const muLawBuffer = Buffer.alloc(Math.floor(pcm8kHzBuffer.length / 2));
  for (let i = 0; i < pcm8kHzBuffer.length; i += 2) {
    const pcmSample = pcm8kHzBuffer.readInt16LE(i);
    const muLawSample = linearToMuLaw(pcmSample);
    muLawBuffer.writeUInt8(muLawSample, i / 2);
  }
  return muLawBuffer;
}

function linearToMuLaw(pcm_val: number): number {
  const MU_LAW_BIAS = 33;
  const MU_LAW_MAX_LINEAR = 8159;

  let sign = (pcm_val >> 15) & 1;
  let magnitude = sign ? -pcm_val : pcm_val;

  if (magnitude > MU_LAW_MAX_LINEAR) {
    magnitude = MU_LAW_MAX_LINEAR;
  }

  magnitude += MU_LAW_BIAS;

  let exponent = 7;
  for (let i = 6; i >= 0; i--) {
    if ((magnitude & (1 << (i + 4))) === 0) {
      exponent = i;
      break;
    }
  }

  let mantissa = (magnitude >> (exponent + 4)) & 0x0f;
  let ulaw = (sign << 7) | (exponent << 4) | mantissa;

  return ~ulaw & 0xff;
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
      -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956, -23932,
      -22908, -21884, -20860, -19836, -18812, -17788, -16764, -15996, -15484,
      -14972, -14460, -13948, -13436, -12924, -12412, -11900, -11388, -10876,
      -10364, -9852, -9340, -8828, -8316, -7932, -7676, -7420, -7164, -6908,
      -6652, -6396, -6140, -5884, -5628, -5372, -5116, -4860, -4604, -4348,
      -4092, -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004, -2876,
      -2748, -2620, -2492, -2364, -2236, -2108, -1980, -1884, -1820, -1756,
      -1692, -1628, -1564, -1500, -1436, -1372, -1308, -1244, -1180, -1116,
      -1052, -988, -924, -876, -844, -812, -780, -748, -716, -684, -652, -620,
      -588, -556, -524, -492, -460, -428, -396, -372, -356, -340, -324, -308,
      -292, -276, -260, -244, -228, -212, -196, -180, -164, -148, -132, -120,
      -112, -104, -96, -88, -80, -72, -64, -56, -48, -40, -32, -24, -16, -8, 0,
      32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956, 23932, 22908,
      21884, 20860, 19836, 18812, 17788, 16764, 15996, 15484, 14972, 14460,
      13948, 13436, 12924, 12412, 11900, 11388, 10876, 10364, 9852, 9340, 8828,
      8316, 7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140, 5884, 5628, 5372,
      5116, 4860, 4604, 4348, 4092, 3900, 3772, 3644, 3516, 3388, 3260, 3132,
      3004, 2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980, 1884, 1820, 1756,
      1692, 1628, 1564, 1500, 1436, 1372, 1308, 1244, 1180, 1116, 1052, 988,
      924, 876, 844, 812, 780, 748, 716, 684, 652, 620, 588, 556, 524, 492, 460,
      428, 396, 372, 356, 340, 324, 308, 292, 276, 260, 244, 228, 212, 196, 180,
      164, 148, 132, 120, 112, 104, 96, 88, 80, 72, 64, 56, 48, 40, 32, 24, 16,
      8, 0,
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

    logger.debug(
      `🔊 VAD: RMS=${rmsEnergy.toFixed(
        2
      )}, Peak=${maxAbsValue}, Threshold=${threshold}, Active=${hasActivity}`
    );

    return hasActivity;
  } catch (error) {
    logger.warn(`Error detecting voice activity: ${getErrorMessage(error)}`);
    return false;
  }
}
