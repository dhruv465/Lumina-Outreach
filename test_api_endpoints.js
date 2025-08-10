#!/usr/bin/env node

/**
 * Test script to validate API endpoints for Deepgram TTS voices
 */

const http = require('http');

console.log('🧪 Testing Deepgram TTS API Endpoints');
console.log('=' .repeat(50));

/**
 * Make HTTP request
 */
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * Test TTS provider voices endpoint
 */
async function testTTSProviderVoicesEndpoint() {
  console.log('\n📋 Testing /api/tts-provider/voices?provider=deepgram');
  console.log('-'.repeat(40));
  
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 8000,
      path: '/api/tts-provider/voices?provider=deepgram',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data.success) {
      console.log(`✅ Successfully fetched ${response.data.count} Deepgram voices`);
      console.log('Sample voices:');
      response.data.voices.slice(0, 3).forEach(voice => {
        console.log(`  - ${voice.name} (${voice.voiceId})`);
      });
      return true;
    } else {
      console.log(`❌ Request failed with status ${response.status}`);
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('💡 Make sure the server is running on port 8000');
    return false;
  }
}

/**
 * Test TTS provider status endpoint
 */
async function testTTSProviderStatusEndpoint() {
  console.log('\n🔍 Testing /api/tts-provider/status');
  console.log('-'.repeat(40));
  
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 8000,
      path: '/api/tts-provider/status',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ TTS provider status retrieved successfully');
      console.log(`Primary provider: ${response.data.config.primaryProvider || response.data.config.provider}`);
      
      if (response.data.providers.deepgram) {
        const deepgramStatus = response.data.providers.deepgram;
        console.log(`Deepgram status: ${deepgramStatus.available ? 'Available' : 'Not available'}`);
        console.log(`Is primary: ${deepgramStatus.isPrimary}`);
        console.log(`Is fallback: ${deepgramStatus.isFallback}`);
      }
      
      return true;
    } else {
      console.log(`❌ Request failed with status ${response.status}`);
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    return false;
  }
}

/**
 * Run endpoint tests
 */
async function runEndpointTests() {
  console.log('🚀 Starting API endpoint tests...\n');
  console.log('💡 This test requires the server to be running on localhost:8000');
  
  const results = [];
  
  results.push(await testTTSProviderVoicesEndpoint());
  results.push(await testTTSProviderStatusEndpoint());
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Endpoint Test Results');
  console.log('='.repeat(50));
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`✅ Passed: ${passed}/${total} tests`);
  
  if (passed === total) {
    console.log('\n🎉 All endpoint tests passed!');
    console.log('\n📋 Verified functionality:');
    console.log('1. ✅ TTS provider voices endpoint returns Deepgram voices');
    console.log('2. ✅ TTS provider status endpoint shows configuration');
  } else {
    console.log('\n⚠️  Some endpoint tests failed.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running: npm start');
    console.log('2. Check that the server is accessible on localhost:8000');
    console.log('3. Verify that authentication is not required for these endpoints');
  }
}

// Run the tests
runEndpointTests();