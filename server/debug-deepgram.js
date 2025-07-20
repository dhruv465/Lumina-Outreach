#!/usr/bin/env node

/**
 * Deepgram Debug Script
 * 
 * This script helps debug Deepgram transcription issues by:
 * 1. Testing the API key
 * 2. Testing with a sample audio file
 * 3. Checking audio format handling
 */

const { createClient } = require('@deepgram/sdk');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Load environment variables
require('dotenv').config();

async function debugDeepgram() {
  console.log('🔍 Deepgram Debug Script Starting...\n');
  
  // Connect to MongoDB to fetch the API key
  let apiKey;
  try {
    console.log('📡 Connecting to database to fetch Deepgram API key...');
    
    // Use the same connection string as your main app
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI environment variable not found');
      console.log('Please set MONGODB_URI in your .env file');
      return;
    }
    await mongoose.connect(mongoUri);
    
    // Define Configuration schema (simplified)
    const configSchema = new mongoose.Schema({
      deepgramConfig: {
        apiKey: String,
        isEnabled: Boolean,
        status: String,
        lastVerified: Date
      }
    }, { collection: 'configurations' });
    
    const Configuration = mongoose.model('Configuration', configSchema);
    
    // Fetch configuration
    const config = await Configuration.findOne();
    if (!config || !config.deepgramConfig || !config.deepgramConfig.apiKey) {
      console.error('❌ Deepgram API key not found in database configuration');
      console.log('Please configure Deepgram in your application settings');
      await mongoose.disconnect();
      return;
    }
    
    apiKey = config.deepgramConfig.apiKey;
    console.log(`✅ API Key found in database (length: ${apiKey.length})`);
    console.log(`📊 Deepgram enabled: ${config.deepgramConfig.isEnabled}`);
    console.log(`📊 Status: ${config.deepgramConfig.status}`);
    
  } catch (dbError) {
    console.error('❌ Database connection failed:', dbError.message);
    console.log('Make sure MongoDB is running and accessible');
    return;
  }
  
  console.log(`✅ API Key found (length: ${apiKey.length})`);
  
  // Initialize Deepgram client
  const deepgram = createClient(apiKey);
  
  try {
    // Test 1: Simple API validation with a test URL
    console.log('\n📡 Testing API connection with sample audio...');
    
    const testResponse = await deepgram.listen.prerecorded.transcribeUrl(
      { url: 'https://res.cloudinary.com/dvfrcaw1c/video/upload/v1711698492/test-samples/test-sample-en.mp3' },
      {
        model: 'nova-2',
        language: 'en',
        smart_format: true,
        punctuate: true
      }
    );
    
    const transcript = testResponse.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    const confidence = testResponse.result?.results?.channels?.[0]?.alternatives?.[0]?.confidence;
    
    console.log(`✅ API Test Successful!`);
    console.log(`📝 Transcript: "${transcript}"`);
    console.log(`🎯 Confidence: ${confidence}`);
    
    // Test 2: Create a simple μ-law audio buffer (simulating Twilio)
    console.log('\n🎵 Testing μ-law audio processing...');
    
    // Create a simple test audio buffer with some variation (simulating speech)
    const testAudioBuffer = Buffer.alloc(1600); // 200ms at 8kHz
    for (let i = 0; i < testAudioBuffer.length; i++) {
      // Create a simple sine wave pattern in μ-law format
      const sample = Math.sin(i * 0.1) * 50 + 127; // Sine wave around μ-law silence (127)
      testAudioBuffer[i] = Math.max(0, Math.min(255, Math.floor(sample)));
    }
    
    // Test voice activity detection
    const hasVoiceActivity = detectVoiceActivity(testAudioBuffer);
    console.log(`🔊 Voice Activity Detected: ${hasVoiceActivity}`);
    
    // Convert to PCM and create WAV
    const pcmBuffer = convertMuLawToPCM(testAudioBuffer);
    const wavBuffer = createWavFile(pcmBuffer, 8000, 1, 16);
    
    console.log(`📊 Original μ-law buffer: ${testAudioBuffer.length} bytes`);
    console.log(`📊 Converted PCM buffer: ${pcmBuffer.length} bytes`);
    console.log(`📊 WAV file buffer: ${wavBuffer.length} bytes`);
    
    // Test 3: Try transcribing the converted audio
    console.log('\n🎤 Testing transcription with converted audio...');
    
    try {
      const transcriptionResponse = await deepgram.listen.prerecorded.transcribeFile(
        wavBuffer,
        {
          mimetype: 'audio/wav',
          model: 'nova-2',
          language: 'en',
          smart_format: true,
          punctuate: true,
          encoding: 'linear16',
          sample_rate: 8000,
          channels: 1
        }
      );
      
      const convertedTranscript = transcriptionResponse.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      const convertedConfidence = transcriptionResponse.result?.results?.channels?.[0]?.alternatives?.[0]?.confidence;
      
      console.log(`📝 Converted Audio Transcript: "${convertedTranscript || 'EMPTY'}"`);
      console.log(`🎯 Converted Audio Confidence: ${convertedConfidence || 0}`);
      
      if (!convertedTranscript || convertedTranscript.trim() === '') {
        console.log('⚠️  Empty transcript - this is expected for synthetic test audio');
        console.log('   Real speech audio should produce transcripts');
      }
      
    } catch (transcriptionError) {
      console.error('❌ Transcription test failed:', transcriptionError.message);
    }
    
    console.log('\n✅ Debug script completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. If API test passed, your Deepgram key is working');
    console.log('   2. Check your server logs for actual voice activity detection');
    console.log('   3. Ensure audio buffers from Twilio have sufficient voice activity');
    console.log('   4. Monitor the RMS energy levels in voice activity detection logs');
    
  } catch (error) {
    console.error('❌ Debug script failed:', error.message);
    console.error('Full error:', error);
  } finally {
    // Always disconnect from database
    try {
      await mongoose.disconnect();
      console.log('📡 Database connection closed');
    } catch (disconnectError) {
      console.warn('⚠️  Error closing database connection:', disconnectError.message);
    }
  }
}

// Helper functions (simplified versions of the service methods)
function detectVoiceActivity(audioBuffer) {
  if (audioBuffer.length === 0) return false;
  
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
  
  for (let i = 0; i < audioBuffer.length; i++) {
    const muLawByte = audioBuffer[i];
    const linearSample = MULAW_DECODE_TABLE[muLawByte];
    sumSquares += linearSample * linearSample;
    sampleCount++;
  }
  
  if (sampleCount === 0) return false;
  
  const rmsEnergy = Math.sqrt(sumSquares / sampleCount);
  const threshold = 1000;
  
  console.log(`🔊 Voice Activity: RMS=${rmsEnergy.toFixed(2)}, threshold=${threshold}, detected=${rmsEnergy > threshold}`);
  
  return rmsEnergy > threshold;
}

function convertMuLawToPCM(muLawBuffer) {
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
  
  const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);
  
  for (let i = 0; i < muLawBuffer.length; i++) {
    const muLawByte = muLawBuffer[i];
    const pcmSample = MULAW_DECODE_TABLE[muLawByte];
    pcmBuffer.writeInt16LE(pcmSample, i * 2);
  }
  
  return pcmBuffer;
}

function createWavFile(pcmData, sampleRate, channels, bitsPerSample) {
  const dataSize = pcmData.length;
  const fileSize = 44 + dataSize - 8;
  
  const header = Buffer.alloc(44);
  let offset = 0;
  
  // RIFF header
  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(fileSize, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;
  
  // fmt chunk
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4;
  header.writeUInt16LE(1, offset); offset += 2;
  header.writeUInt16LE(channels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, offset); offset += 4;
  header.writeUInt16LE(channels * bitsPerSample / 8, offset); offset += 2;
  header.writeUInt16LE(bitsPerSample, offset); offset += 2;
  
  // data chunk
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);
  
  return Buffer.concat([header, pcmData]);
}

// Run the debug script
debugDeepgram().catch(console.error);