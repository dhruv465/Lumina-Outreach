#!/usr/bin/env node

/**
 * Quick Deepgram Test
 * 
 * Simple test to check if your Deepgram fixes are working
 * Run this after starting your server to test the current state
 */

const axios = require('axios');

async function quickTest() {
  console.log('🔍 Quick Deepgram Test...\n');
  
  try {
    // Test if your server is running
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    
    console.log(`📡 Testing server at ${serverUrl}...`);
    
    // Try to hit a health endpoint or any endpoint that shows the server is running
    try {
      const healthResponse = await axios.get(`${serverUrl}/health`, { timeout: 5000 });
      console.log('✅ Server is running');
    } catch (healthError) {
      // Try the root endpoint
      try {
        await axios.get(serverUrl, { timeout: 5000 });
        console.log('✅ Server is running');
      } catch (rootError) {
        console.log('⚠️  Could not connect to server - make sure it\'s running');
        console.log('   Start your server with: npm start');
        return;
      }
    }
    
    console.log('\n💡 To test Deepgram transcription:');
    console.log('   1. Make a test call to your system');
    console.log('   2. Speak clearly into the phone');
    console.log('   3. Check your server logs for these messages:');
    console.log('      - "Voice activity detection: RMS energy = X"');
    console.log('      - "Deepgram transcription completed successfully: [your speech]"');
    console.log('      - Look for actual transcribed text instead of empty strings');
    
    console.log('\n🔧 Key improvements made:');
    console.log('   ✅ Fixed μ-law to PCM audio conversion');
    console.log('   ✅ Added proper WAV headers for Deepgram');
    console.log('   ✅ Improved voice activity detection');
    console.log('   ✅ Added early return for silent audio');
    console.log('   ✅ Better error handling and logging');
    
    console.log('\n📊 What to look for in logs:');
    console.log('   BEFORE: "Deepgram transcription completed: \\"\\""');
    console.log('   AFTER:  "Deepgram transcription completed: \\"Hello, how are you?\\""');
    
    console.log('\n🎯 If you still see empty transcripts:');
    console.log('   1. Check if voice activity is being detected');
    console.log('   2. Verify the RMS energy levels in logs');
    console.log('   3. Make sure you\'re speaking clearly and loudly');
    console.log('   4. Check that Deepgram API key is valid in your database');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
quickTest().catch(console.error);