#!/usr/bin/env node

/**
 * RAG API Test Script
 * 
 * Tests the RAG API endpoints when the server is running.
 * Usage: node test-rag-api.js [server_url] [auth_token]
 */

const axios = require('axios');

const SERVER_URL = process.argv[2] || 'http://localhost:8000';
const AUTH_TOKEN = process.argv[3] || 'test-token';

const api = axios.create({
  baseURL: SERVER_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`
  },
  timeout: 30000
});

async function testRAGAPI() {
  console.log('🌐 Testing RAG API Endpoints...');
  console.log(`   Server: ${SERVER_URL}`);
  console.log(`   Auth: Bearer ${AUTH_TOKEN.substring(0, 10)}...`);
  console.log('');

  let passedTests = 0;
  let totalTests = 0;

  // Helper function to run test
  async function runTest(name, testFn) {
    totalTests++;
    console.log(`🧪 ${name}...`);
    try {
      await testFn();
      console.log(`  ✅ PASSED`);
      passedTests++;
    } catch (error) {
      console.log(`  ❌ FAILED: ${error.message}`);
      if (error.response) {
        console.log(`     Status: ${error.response.status}`);
        console.log(`     Data: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }
    console.log('');
  }

  // Test 1: Check RAG system status
  await runTest('Check RAG System Status', async () => {
    const response = await api.get('/api/rag/status');
    if (response.status !== 200) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    console.log(`     Status: ${response.data.data.status}`);
    console.log(`     Has Sources: ${response.data.data.hasAvailableSources}`);
    console.log(`     Knowledge Base: ${response.data.data.statistics.knowledgeBase} entries`);
  });

  // Test 2: Add sample knowledge
  await runTest('Add Sample Knowledge', async () => {
    const knowledge = {
      title: 'Test Knowledge Entry',
      content: 'This is a test knowledge entry for the RAG system. It contains information about testing and validation.',
      type: 'knowledge-base',
      category: 'testing',
      tags: ['test', 'rag', 'api'],
      source: 'api-test'
    };

    const response = await api.post('/api/rag/knowledge', knowledge);
    if (response.status !== 201) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    console.log(`     Added: ${response.data.data.title}`);
    console.log(`     ID: ${response.data.data.id}`);
  });

  // Test 3: Query the knowledge base
  await runTest('Query Knowledge Base', async () => {
    const query = {
      query: 'What is a test knowledge entry?',
      maxResults: 3,
      minRelevanceScore: 0.1
    };

    const response = await api.post('/api/rag/query', query);
    if (response.status !== 200) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    console.log(`     Results: ${response.data.data.results.length}`);
    if (response.data.data.results.length > 0) {
      console.log(`     Top result score: ${response.data.data.results[0].metadata.relevanceScore}`);
    }
  });

  // Test 4: Generate enhanced response
  await runTest('Generate Enhanced Response', async () => {
    const request = {
      query: 'Explain what test knowledge entries are for',
      maxResults: 2,
      temperature: 0.7
    };

    const response = await api.post('/api/rag/generate', request);
    if (response.status !== 200) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    console.log(`     Sources used: ${response.data.data.sources.length}`);
    console.log(`     Response length: ${response.data.data.response.length} chars`);
  });

  // Test 5: Test with invalid data
  await runTest('Validate Request Validation', async () => {
    try {
      await api.post('/api/rag/knowledge', { title: '' }); // Invalid: empty title
      throw new Error('Should have failed validation');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log(`     Validation working: ${error.response.status}`);
      } else {
        throw error;
      }
    }
  });

  // Test 6: Clear cache (admin function)
  await runTest('Clear RAG Cache', async () => {
    const response = await api.post('/api/rag/cache/clear');
    if (response.status !== 200) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    console.log(`     Cache cleared successfully`);
  });

  // Summary
  console.log('📊 Test Summary:');
  console.log(`   Passed: ${passedTests}/${totalTests}`);
  console.log(`   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! RAG API is working correctly.');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check the error messages above.');
    process.exit(1);
  }
}

// Helper function to check if server is running
async function checkServerHealth() {
  try {
    const response = await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// Main execution
if (require.main === module) {
  (async () => {
    console.log('🔍 Checking if server is running...');
    
    const isHealthy = await checkServerHealth();
    if (!isHealthy) {
      console.log('❌ Server is not running or not healthy.');
      console.log('   Please start the server first: npm run dev');
      process.exit(1);
    }
    
    console.log('✅ Server is running and healthy.');
    console.log('');
    
    await testRAGAPI();
  })().catch((error) => {
    console.error('💥 Test execution failed:', error.message);
    process.exit(1);
  });
}

module.exports = { testRAGAPI };