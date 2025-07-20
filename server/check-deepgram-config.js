#!/usr/bin/env node

/**
 * Check Deepgram Configuration
 * 
 * This script checks your current Deepgram configuration in the database
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function checkDeepgramConfig() {
  console.log('🔍 Checking Deepgram Configuration...\n');
  
  try {
    // Connect to database
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI environment variable not found');
      console.log('Please set MONGODB_URI in your .env file');
      return;
    }
    
    console.log('📡 Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to database');
    
    // Define Configuration schema (matching your model)
    const configSchema = new mongoose.Schema({
      deepgramConfig: {
        apiKey: String,
        isEnabled: Boolean,
        model: String,
        tier: String,
        lastVerified: Date,
        status: String,
        lastError: String
      }
    }, { collection: 'configurations' });
    
    const Configuration = mongoose.model('Configuration', configSchema);
    
    // Fetch configuration
    const config = await Configuration.findOne();
    
    if (!config) {
      console.log('❌ No configuration found in database');
      console.log('Please configure your system through the admin interface');
      return;
    }
    
    console.log('\n📊 Current Deepgram Configuration:');
    console.log('================================');
    
    if (!config.deepgramConfig) {
      console.log('❌ No Deepgram configuration found');
      console.log('Please configure Deepgram in your admin interface');
      return;
    }
    
    const dg = config.deepgramConfig;
    
    console.log(`🔑 API Key: ${dg.apiKey ? `SET (${dg.apiKey.length} chars)` : 'NOT SET'}`);
    console.log(`🔧 Enabled: ${dg.isEnabled ? '✅ YES' : '❌ NO'}`);
    console.log(`🤖 Model: ${dg.model || 'nova-2 (default)'}`);
    console.log(`⚡ Tier: ${dg.tier || 'enhanced (default)'}`);
    console.log(`📅 Last Verified: ${dg.lastVerified ? new Date(dg.lastVerified).toLocaleString() : 'Never'}`);
    console.log(`📊 Status: ${dg.status || 'Unknown'}`);
    
    if (dg.lastError) {
      console.log(`❌ Last Error: ${dg.lastError}`);
    }
    
    // Provide recommendations
    console.log('\n💡 Recommendations:');
    console.log('==================');
    
    if (!dg.apiKey) {
      console.log('❌ Set your Deepgram API key in the admin interface');
    } else if (dg.apiKey.length < 30) {
      console.log('⚠️  API key seems too short - verify it\'s correct');
    } else {
      console.log('✅ API key is set');
    }
    
    if (!dg.isEnabled) {
      console.log('❌ Enable Deepgram in the admin interface');
    } else {
      console.log('✅ Deepgram is enabled');
    }
    
    if (dg.status === 'failed') {
      console.log('❌ Last verification failed - check your API key');
    } else if (dg.status === 'verified') {
      console.log('✅ API key was successfully verified');
    } else {
      console.log('⚠️  API key verification status unknown');
    }
    
    // Test if we can create a Deepgram client
    if (dg.apiKey && dg.isEnabled) {
      console.log('\n🧪 Testing Deepgram Client Creation...');
      try {
        const { createClient } = require('@deepgram/sdk');
        const client = createClient(dg.apiKey);
        console.log('✅ Deepgram client created successfully');
        
        // Try a simple test call
        console.log('🔍 Testing API connection...');
        const testResponse = await client.listen.prerecorded.transcribeUrl(
          { url: 'https://res.cloudinary.com/dvfrcaw1c/video/upload/v1711698492/test-samples/test-sample-en.mp3' },
          { model: dg.model || 'nova-2', language: 'en' }
        );
        
        const transcript = testResponse.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        console.log(`✅ API test successful! Sample transcript: "${transcript}"`);
        
        // Update status in database
        await Configuration.updateOne(
          {},
          {
            $set: {
              'deepgramConfig.status': 'verified',
              'deepgramConfig.lastVerified': new Date(),
              'deepgramConfig.lastError': null
            }
          }
        );
        console.log('✅ Updated configuration status to verified');
        
      } catch (testError) {
        console.log(`❌ API test failed: ${testError.message}`);
        
        // Update status in database
        await Configuration.updateOne(
          {},
          {
            $set: {
              'deepgramConfig.status': 'failed',
              'deepgramConfig.lastVerified': new Date(),
              'deepgramConfig.lastError': testError.message
            }
          }
        );
        console.log('❌ Updated configuration status to failed');
      }
    }
    
    console.log('\n🎯 Next Steps:');
    console.log('=============');
    if (dg.apiKey && dg.isEnabled && dg.status === 'verified') {
      console.log('✅ Configuration looks good!');
      console.log('🎤 Make a test call and check server logs for:');
      console.log('   - "Voice activity detection: RMS energy = X"');
      console.log('   - "Deepgram transcription completed successfully: [speech]"');
    } else {
      console.log('🔧 Fix the configuration issues above');
      console.log('🔄 Restart your server after making changes');
    }
    
  } catch (error) {
    console.error('❌ Configuration check failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Database connection closed');
  }
}

// Run the check
checkDeepgramConfig().catch(console.error);