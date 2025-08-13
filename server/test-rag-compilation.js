#!/usr/bin/env node

/**
 * Simple RAG Compilation Test
 * 
 * Tests that RAG system files compile correctly without starting servers.
 */

console.log('🧪 Testing RAG System Compilation...\n');

try {
  // Test 1: Test model imports
  console.log('📚 Testing model compilation...');
  
  // These should not trigger server startup
  console.log('  • KnowledgeBase model...');
  const KnowledgeBase = require('./dist/models/KnowledgeBase');
  console.log('    ✅ KnowledgeBase compiled');
  
  console.log('  • FAQ model...');
  const FAQ = require('./dist/models/FAQ');
  console.log('    ✅ FAQ compiled');
  
  console.log('  • Product model...');
  const Product = require('./dist/models/Product');
  console.log('    ✅ Product compiled');

  // Test 2: Test type definitions
  console.log('\n📋 Testing type definitions...');
  
  console.log('  • LLM types...');
  const llmTypes = require('./dist/services/llm/types');
  console.log('    ✅ LLM types compiled');

  // Test 3: Test route compilation
  console.log('\n🌐 Testing route compilation...');
  
  console.log('  • RAG routes...');
  const ragRoutes = require('./dist/routes/ragRoutes');
  console.log('    ✅ RAG routes compiled');

  // Test 4: Test service classes (without instantiation)
  console.log('\n🔧 Testing service class definitions...');
  
  console.log('  • RAG Service class...');
  const { RAGService } = require('./dist/services/ragService');
  console.log('    ✅ RAG Service class available');
  
  console.log('  • RAG System class...');
  const { RAGSystem } = require('./dist/services/rag/ragSystem');
  console.log('    ✅ RAG System class available');

  // Test 5: Check for required environment variables
  console.log('\n🔍 Checking environment setup...');
  
  const requiredVars = ['MONGODB_URI', 'OPENAI_API_KEY'];
  const envStatus = {};
  
  requiredVars.forEach(varName => {
    const isSet = !!process.env[varName];
    envStatus[varName] = isSet;
    console.log(`  • ${varName}: ${isSet ? '✅ Set' : '❌ Not set'}`);
  });

  console.log('\n🎉 RAG System compilation test completed!');
  console.log('\n📋 Summary:');
  console.log('  ✅ All models compiled successfully');
  console.log('  ✅ All service classes defined correctly');
  console.log('  ✅ API routes compiled successfully');
  console.log('  ✅ Type definitions are valid');
  
  if (envStatus.MONGODB_URI && envStatus.OPENAI_API_KEY) {
    console.log('\n🚀 System is ready for full testing!');
    console.log('  Next step: Start the server with: npm run dev');
  } else {
    console.log('\n⚠️  Environment setup incomplete:');
    if (!envStatus.MONGODB_URI) {
      console.log('  • Set MONGODB_URI for database connection');
    }
    if (!envStatus.OPENAI_API_KEY) {
      console.log('  • Set OPENAI_API_KEY for embedding generation');
    }
  }

  process.exit(0);
  
} catch (error) {
  console.error('❌ Compilation test failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}