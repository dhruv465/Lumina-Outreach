#!/usr/bin/env node

/**
 * RAG System Test Script
 * 
 * This script tests the RAG (Retrieval-Augmented Generation) system
 * by adding sample knowledge and testing queries.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

async function testRAGSystem() {
  console.log('🧪 Testing RAG System...\n');

  try {
    // Import services after env is loaded
    const mongoose = require('mongoose');
    
    // Connect to database
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lumina-outreach-test';
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Import models
    const { KnowledgeBase } = require('./dist/models/KnowledgeBase');
    const { FAQ } = require('./dist/models/FAQ');
    const { Product } = require('./dist/models/Product');

    // Import services
    const { getLLMService } = require('./dist/services');
    const { getRAGService } = require('./dist/services/ragService');

    console.log('🧠 Initializing services...');
    
    // Initialize LLM service with minimal config
    const llmService = getLLMService();
    const ragService = getRAGService(llmService);
    
    console.log('✅ Services initialized\n');

    // Test 1: Add sample knowledge base entries
    console.log('📚 Adding sample knowledge to RAG system...');
    
    const sampleKnowledge = [
      {
        title: 'Lumina Outreach Overview',
        content: 'Lumina Outreach is an intelligent communication system with AI-powered outreach capabilities. It includes a CRM dashboard, manages leads, executes outbound calls, handles conversations intelligently, and provides detailed performance analytics.',
        type: 'knowledge-base',
        category: 'product-overview',
        tags: ['lumina', 'outreach', 'ai', 'crm', 'analytics'],
        source: 'test'
      },
      {
        title: 'AI Voice Capabilities',
        content: 'The system includes advanced emotion detection with cultural context, multiple voice personalities with adaptation, bilingual conversation support (English/Hindi), real-time personality adaptation based on customer emotions, and natural conversation flow management.',
        type: 'knowledge-base',
        category: 'features',
        tags: ['ai', 'voice', 'emotion', 'bilingual', 'conversation'],
        source: 'test'
      },
      {
        title: 'Technology Stack',
        content: 'Frontend: React.js, TypeScript, ShadCN UI, Chart.js/D3.js. Backend: Node.js, Express.js, TypeScript, MongoDB. APIs: Twilio for telephony, ElevenLabs for voice synthesis, Various LLM APIs (OpenAI, Anthropic, etc.).',
        type: 'knowledge-base',
        category: 'technical',
        tags: ['technology', 'stack', 'react', 'nodejs', 'mongodb', 'twilio'],
        source: 'test'
      }
    ];

    // Clear existing test data
    await KnowledgeBase.deleteMany({ source: 'test' });
    
    // Add sample knowledge
    for (const knowledge of sampleKnowledge) {
      const entry = new KnowledgeBase(knowledge);
      await entry.save();
      console.log(`  ✅ Added: ${knowledge.title}`);
    }

    // Test 2: Add sample FAQ
    console.log('\n❓ Adding sample FAQ entries...');
    
    const sampleFAQs = [
      {
        question: 'What is Lumina Outreach?',
        answer: 'Lumina Outreach is a comprehensive intelligent communication platform that provides AI-powered outreach capabilities with an integrated CRM dashboard.',
        category: 'general',
        tags: ['overview', 'product'],
        source: 'test'
      },
      {
        question: 'What languages does the voice AI support?',
        answer: 'The voice AI system supports bilingual conversations in English and Hindi, with advanced emotion detection and cultural context awareness.',
        category: 'features',
        tags: ['voice', 'language', 'bilingual'],
        source: 'test'
      }
    ];

    await FAQ.deleteMany({ source: 'test' });
    
    for (const faq of sampleFAQs) {
      const entry = new FAQ(faq);
      await entry.save();
      console.log(`  ✅ Added FAQ: ${faq.question}`);
    }

    // Test 3: Test RAG query
    console.log('\n🔍 Testing RAG queries...');
    
    const testQueries = [
      'What is Lumina Outreach?',
      'What technologies are used in the system?',
      'Does the system support multiple languages?',
      'What are the voice AI capabilities?'
    ];

    for (const query of testQueries) {
      console.log(`\n🤔 Query: "${query}"`);
      
      try {
        const result = await ragService.query(query, {
          maxResults: 3,
          minRelevanceScore: 0.1, // Lower threshold for testing
          includeMetadata: true
        });
        
        console.log(`  📊 Found ${result.results.length} relevant documents`);
        
        if (result.results.length > 0) {
          result.results.forEach((doc, index) => {
            console.log(`    ${index + 1}. Source: ${doc.metadata.source} (${doc.metadata.model || 'unknown'})`);
            console.log(`       Score: ${doc.metadata.relevanceScore.toFixed(2)}`);
            console.log(`       Content: ${doc.content.substring(0, 100)}...`);
          });
        } else {
          console.log('    ⚠️  No relevant documents found');
        }
      } catch (error) {
        console.log(`    ❌ Query failed: ${error.message}`);
      }
    }

    // Test 4: Test enhanced prompt generation (if available)
    console.log('\n🚀 Testing RAG-enhanced response generation...');
    
    try {
      const enhancedResponse = await ragService.generateResponse(
        'What is Lumina Outreach and what are its main features?',
        {
          maxResults: 5,
          minRelevanceScore: 0.1,
          temperature: 0.7
        }
      );
      
      console.log('  📝 Enhanced Response Generated:');
      console.log(`     Query: ${enhancedResponse.query}`);
      console.log(`     Sources used: ${enhancedResponse.sources.length}`);
      console.log(`     Response: ${enhancedResponse.response.substring(0, 200)}...`);
      
      if (enhancedResponse.sources.length > 0) {
        console.log('     📚 Sources:');
        enhancedResponse.sources.forEach((source, index) => {
          console.log(`       ${index + 1}. ${source.source} (score: ${source.relevanceScore.toFixed(2)})`);
        });
      }
    } catch (error) {
      console.log(`    ⚠️  Enhanced generation not available: ${error.message}`);
    }

    // Test 5: Check RAG system status
    console.log('\n📊 Checking RAG system status...');
    
    const hasAvailableSources = await ragService.hasAvailableSources();
    console.log(`  Sources available: ${hasAvailableSources ? '✅ Yes' : '❌ No'}`);

    // Get counts
    const [kbCount, faqCount] = await Promise.all([
      KnowledgeBase.countDocuments({ isActive: true }),
      FAQ.countDocuments({ isActive: true })
    ]);
    
    console.log(`  Knowledge Base entries: ${kbCount}`);
    console.log(`  FAQ entries: ${faqCount}`);

    console.log('\n🎉 RAG System test completed successfully!');
    
  } catch (error) {
    console.error('❌ RAG System test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    try {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
      console.log('📡 Disconnected from MongoDB');
    } catch (error) {
      console.error('Error disconnecting from MongoDB:', error.message);
    }
  }
}

// Run the test
if (require.main === module) {
  testRAGSystem()
    .then(() => {
      console.log('✅ Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testRAGSystem };