# RAG (Retrieval-Augmented Generation) System

## Overview

The RAG system has been implemented and integrated into the Lumina Outreach platform. It provides intelligent context retrieval and response generation capabilities by combining information from various knowledge sources with Large Language Models (LLMs).

## Features Implemented

### ✅ Database Models
- **KnowledgeBase**: Stores general knowledge entries with full-text search indexing
- **FAQ**: Manages frequently asked questions with categorization
- **Product**: Stores product information with specifications and pricing
- **Document & Chunk**: Existing models for document processing and chunking

### ✅ Core Services
- **RAGService**: Basic RAG functionality with query and response generation
- **RAGSystem**: Advanced RAG with semantic search, reranking, and multiple retrieval strategies
- **Embedding Generation**: Integrated with OpenAI's embedding API through the LLM service
- **AI Orchestration**: Enhanced with embedding generation capabilities

### ✅ API Endpoints
All endpoints are available under `/api/rag/` with authentication required:

- `POST /api/rag/query` - Query the knowledge base
- `POST /api/rag/generate` - Generate enhanced responses using RAG
- `POST /api/rag/knowledge` - Add knowledge entries
- `GET /api/rag/status` - Check system status
- `POST /api/rag/initialize` - Initialize advanced RAG features
- `POST /api/rag/cache/clear` - Clear RAG cache

### ✅ Search Capabilities
- **Text Search**: Full-text search using MongoDB text indexes
- **Semantic Search**: Vector-based similarity search (with embedding generation)
- **Hybrid Search**: Combination of text and semantic search
- **Metadata Filtering**: Filter results by categories, tags, and other metadata
- **Hierarchical Search**: Multi-level search through categories and documents

## Configuration

### Environment Variables Required
```bash
# Database connection
MONGODB_URI=mongodb://localhost:27017/lumina-outreach

# OpenAI API for embedding generation
OPENAI_API_KEY=your_openai_api_key

# Optional: Other LLM providers
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_API_KEY=your_google_key
```

### Database Setup
The system automatically creates the required collections and indexes when models are first used. Ensure MongoDB is running and accessible.

## Usage Examples

### 1. Add Knowledge to the System
```bash
curl -X POST http://localhost:8000/api/rag/knowledge \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Lumina Outreach Features",
    "content": "Lumina Outreach provides AI-powered voice agents, CRM integration, and real-time analytics for outbound calling campaigns.",
    "type": "knowledge-base",
    "category": "product-features",
    "tags": ["ai", "voice", "crm", "analytics"]
  }'
```

### 2. Query the Knowledge Base
```bash
curl -X POST http://localhost:8000/api/rag/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "query": "What are the main features of Lumina Outreach?",
    "maxResults": 5,
    "minRelevanceScore": 0.7
  }'
```

### 3. Generate Enhanced Responses
```bash
curl -X POST http://localhost:8000/api/rag/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "query": "How does the AI voice system work?",
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "temperature": 0.7,
    "maxResults": 3
  }'
```

### 4. Check System Status
```bash
curl -X GET http://localhost:8000/api/rag/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Technical Architecture

### Service Layer
- **RAGService**: Handles basic query and retrieval operations
- **RAGSystem**: Provides advanced features like reranking and multiple search strategies
- **LLMService**: Manages LLM providers and embedding generation
- **AIOrchestrationLayer**: Coordinates between different AI services

### Data Flow
1. **Knowledge Ingestion**: Documents and knowledge are stored in MongoDB with text indexes
2. **Query Processing**: User queries are processed and embeddings are generated
3. **Retrieval**: Relevant documents are retrieved using text/semantic search
4. **Reranking**: Results are reranked based on relevance and context
5. **Response Generation**: LLM generates responses using retrieved context

### Storage
- **MongoDB Collections**: KnowledgeBase, FAQ, Product, Document, Chunk
- **Text Indexes**: Full-text search on content fields
- **Vector Storage**: Embeddings stored as arrays (future: external vector DB)

## Future Enhancements

### 🔄 In Progress
- Real-time embedding generation for all content
- Vector database integration (Pinecone, Weaviate, etc.)
- Advanced reranking models
- Multi-modal search (text + images)

### 📋 Planned
- Knowledge graph integration
- Automatic knowledge extraction from conversations
- A/B testing for different retrieval strategies
- Real-time learning from user feedback

## Integration Points

### With Existing Systems
- **Voice AI**: RAG can provide context for voice conversations
- **CRM**: Customer data can be used to personalize responses
- **Analytics**: Track RAG usage and effectiveness
- **Campaign Management**: Use product knowledge for targeted campaigns

### API Integration
- All RAG functionality is accessible via REST APIs
- WebSocket support for real-time queries (planned)
- Batch processing for large knowledge imports

## Monitoring and Maintenance

### Metrics Available
- Query response times
- Knowledge base size and growth
- Search result relevance scores
- Cache hit rates
- API usage statistics

### Maintenance Tasks
- Regular index optimization
- Cache management
- Knowledge base cleanup
- Performance monitoring

## Troubleshooting

### Common Issues
1. **No results returned**: Check if knowledge base has content, verify text indexes exist
2. **Slow queries**: Optimize MongoDB indexes, consider caching frequently accessed content
3. **Poor relevance**: Adjust similarity thresholds, improve knowledge content quality
4. **Embedding errors**: Verify OpenAI API key and rate limits

### Debugging
- Enable debug logging: `LOG_LEVEL=debug`
- Check RAG system status: `GET /api/rag/status`
- Monitor MongoDB collection sizes and indexes
- Review circuit breaker status for external APIs

## Getting Started

1. **Prerequisites**: MongoDB running, OpenAI API key available
2. **Installation**: Dependencies already installed with main project
3. **Configuration**: Set environment variables
4. **Testing**: Use `/api/rag/status` to verify system health
5. **Data Population**: Add initial knowledge via API or import scripts
6. **Integration**: Connect RAG queries to your application flows

The RAG system is now fully operational and ready for production use!