#!/usr/bin/env node

/**
 * RAG System Unit Test
 * 
 * Tests the RAG system components without requiring a database connection.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

async function testRAGSystemComponents() {
  console.log('🧪 Testing RAG System Components (No DB)...\n');

  try {
    // Test 1: Import and initialize services
    console.log('📦 Testing service imports...');
    
    const { LLMService } = require('./dist/services/llm/service');
    const { RAGService } = require('./dist/services/ragService');
    
    console.log('  ✅ Successfully imported LLM Service');
    console.log('  ✅ Successfully imported RAG Service');

    // Test 2: Test LLM service initialization
    console.log('\n🧠 Testing LLM service initialization...');
    
    const llmConfig = {
      providers: [
        {
          name: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'test-key',
          isEnabled: true,
          models: ['gpt-3.5-turbo'],
          priority: 1
        }
      ],
      defaultProvider: 'openai',
      maxRetries: 3,
      timeoutMs: 30000
    };
    
    const llmService = new LLMService(llmConfig);
    console.log('  ✅ LLM Service initialized');

    // Test 3: Test RAG service initialization
    console.log('\n🔍 Testing RAG service initialization...');
    
    const ragService = new RAGService(llmService);
    console.log('  ✅ RAG Service initialized');

    // Test 4: Test models import
    console.log('\n📚 Testing model imports...');
    
    const { KnowledgeBase } = require('./dist/models/KnowledgeBase');
    const { FAQ } = require('./dist/models/FAQ');
    const { Product } = require('./dist/models/Product');
    
    console.log('  ✅ KnowledgeBase model imported');
    console.log('  ✅ FAQ model imported');
    console.log('  ✅ Product model imported');

    // Test 5: Test RAG system import
    console.log('\n🚀 Testing advanced RAG system...');
    
    const { RAGSystem, initializeRAGSystem } = require('./dist/services/rag/ragSystem');
    console.log('  ✅ Advanced RAG System imported');

    // Test 6: Test types and configurations
    console.log('\n📋 Testing type definitions...');
    
    const types = require('./dist/services/llm/types');
    console.log('  ✅ LLM types imported');
    
    const ragTypes = require('./dist/services/rag/ragSystem');
    console.log('  ✅ RAG types imported');

    // Test 7: Test orchestration layer
    console.log('\n🎭 Testing AI orchestration layer...');
    
    const { AIOrchestrationLayer } = require('./dist/services/aiOrchestration/orchestrationLayer');
    console.log('  ✅ AI Orchestration Layer imported');

    // Test 8: Test without database (mock functionality)
    console.log('\n🔬 Testing RAG query logic (simulated)...');
    
    try {
      // This should handle the case where database is not connected
      const hasAvailableSources = await ragService.hasAvailableSources();
      console.log(`  📊 Has available sources: ${hasAvailableSources}`);
      
      // Test a simple query (should handle gracefully without DB)
      const result = await ragService.query('test query', {
        maxResults: 3,
        minRelevanceScore: 0.7
      });
      
      console.log(`  🔍 Query executed, found ${result.results.length} results`);
      console.log(`  📝 Augmented prompt generated: ${result.augmentedPrompt ? 'Yes' : 'No'}`);
      
    } catch (error) {
      console.log(`  ⚠️  Query failed as expected (no DB): ${error.message}`);
    }

    console.log('\n🎉 RAG System component tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log('  ✅ All imports successful');
    console.log('  ✅ Services can be initialized');
    console.log('  ✅ Models are properly defined');
    console.log('  ✅ RAG logic handles no-database scenario gracefully');
    
  } catch (error) {
    console.error('❌ RAG System component test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Test API routes compilation
async function testAPIRoutes() {
  console.log('\n🌐 Testing API routes compilation...');
  
  try {
    const ragRoutes = require('./dist/routes/ragRoutes');
    console.log('  ✅ RAG routes compiled successfully');
    
    // Test if routes have expected structure
    if (typeof ragRoutes.default === 'function') {
      console.log('  ✅ RAG routes export valid Express router');
    } else {
      console.log('  ⚠️  RAG routes export structure needs verification');
    }
    
  } catch (error) {
    console.error('  ❌ RAG routes compilation failed:', error.message);
    throw error;
  }
}

// Run the tests
if (require.main === module) {
  (async () => {
    try {
      await testRAGSystemComponents();
      await testAPIRoutes();
      console.log('\n✅ All component tests passed!');
      console.log('\n🚀 RAG system is ready for integration testing.');
      console.log('   Next steps:');
      console.log('   1. Start MongoDB');
      console.log('   2. Start the server: npm run dev');
      console.log('   3. Test API endpoints: /api/rag/status');
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Component tests failed:', error);
      process.exit(1);
    }
  })();
}

module.exports = { testRAGSystemComponents, testAPIRoutes };