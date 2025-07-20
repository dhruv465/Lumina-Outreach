#!/usr/bin/env node

/**
 * Test Deepgram Service
 * 
 * This script tests your actual Deepgram service implementation
 * using the same database configuration as your main application
 */

const path = require('path');

// Add the src directory to the module path so we can import TypeScript files
require('ts-node/register');

async function testDeepgramService() {
  console.log('🔍 Testing Deepgram Service...\n');
  
  try {
    // Import your actual services
    const { connectToDatabase } = require('./src/database/connection');
    const Configuration = require('./src/models/Configuration').default;
    const { SpeechAnalysisService } = require('./src/services/speechAnalysisService');
    
    // Connect to database
    console.log('📡 Connecting to database...');
    await connectToDatabase();
    
    // Get configuration
    const config = await Configuration.findOne();
    if (!config || !config.deepgramConfig || !config.deepgramConfig.apiKey) {
      console.error('❌ Deepgram not configured in database');
      return;
    }
    
    console.log(`✅ Found Deepgram config - enabled: ${config.deepgramConfig.isEnabled}`);
    
    // Create speech analysis service
    const speechService = new SpeechAnalysisService(
      '', // OpenAI key (not needed for this test)
      '', // Google Speech key (not needed for this test)
      config.deepgramConfig.apiKey
    );
    
    // Test 1: Check if Deepgram is configured
    const isConfigured = speechService.isDeepgramConfigured();
    console.log(`🔧 Deepgram configured: ${isConfigured}`);
    
    if (!isConfigured) {
      console.error('❌ Deepgram service not properly configured');
      return;
    }
    
    // Test 2: Create test audio buffer (simulating Twilio μ-law audio)
    console.log('\n🎵 Creating test audio buffer...');
    
    // Create a test buffer with some variation (simulating speech)
    const testAudioBuffer = Buffer.alloc(1600); // 200ms at 8kHz
    for (let i = 0; i < testAudioBuffer.length; i++) {
      // Create a pattern that should trigger voice activity detection
      const sample = Math.sin(i * 0.05) * 60 + 127; // Sine wave around μ-law silence
      testAudioBuffer[i] = Math.max(0, Math.min(255, Math.floor(sample)));
    }
    
    console.log(`📊 Test buffer created: ${testAudioBuffer.length} bytes`);
    
    // Test 3: Test transcription with the service
    console.log('\n🎤 Testing transcription...');
    
    try {
      const result = await speechService.transcribeAudio(testAudioBuffer, 'English');
      
      console.log(`📝 Transcript: "${result.transcript}"`);
      console.log(`🎯 Confidence: ${result.confidence}`);
      console.log(`🌍 Language: ${result.language}`);
      console.log(`🔊 Voice Activity: ${result.hasVoiceActivity}`);
      
      if (result.hasVoiceActivity && result.transcript.trim() === '') {
        console.log('⚠️  Voice activity detected but empty transcript');
        console.log('   This suggests the audio format conversion is working');
        console.log('   but the test audio doesn\'t contain recognizable speech');
        console.log('   This is expected for synthetic test data');
      } else if (!result.hasVoiceActivity) {
        console.log('⚠️  No voice activity detected in test audio');
        console.log('   You may need to adjust voice activity detection thresholds');
      } else if (result.transcript.trim() !== '') {
        console.log('✅ Transcription successful!');
      }
      
    } catch (transcriptionError) {
      console.error('❌ Transcription failed:', transcriptionError.message);
      console.error('Full error:', transcriptionError);
    }
    
    // Test 4: Create a silent buffer to test voice activity detection
    console.log('\n🔇 Testing with silent audio...');
    
    const silentBuffer = Buffer.alloc(800);
    silentBuffer.fill(127); // μ-law silence value
    
    try {
      const silentResult = await speechService.transcribeAudio(silentBuffer, 'English');
      console.log(`🔇 Silent audio - Voice Activity: ${silentResult.hasVoiceActivity}`);
      console.log(`🔇 Silent audio - Transcript: "${silentResult.transcript}"`);
      
      if (!silentResult.hasVoiceActivity) {
        console.log('✅ Voice activity detection working correctly for silence');
      } else {
        console.log('⚠️  Voice activity detected in silent audio - threshold may be too low');
      }
      
    } catch (silentError) {
      console.error('❌ Silent audio test failed:', silentError.message);
    }
    
    console.log('\n✅ Service test completed!');
    console.log('\n💡 What this tells us:');
    console.log('   - If voice activity detection works, the μ-law processing is correct');
    console.log('   - If transcription API calls succeed, your Deepgram key is valid');
    console.log('   - Empty transcripts with voice activity are normal for test audio');
    console.log('   - Real speech from Twilio should now produce actual transcripts');
    
  } catch (error) {
    console.error('❌ Service test failed:', error.message);
    console.error('Full error:', error);
  } finally {
    // Exit the process
    process.exit(0);
  }
}

// Run the test
testDeepgramService().catch(console.error);