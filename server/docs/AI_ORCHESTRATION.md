# AI Orchestration Layer for Project Call

> **IMPLEMENTATION STATUS**: BACKEND COMPLETE ✅ | FRONTEND PARTIAL ⚠️
> 
> The backend AI Orchestration Layer has been fully implemented as described in this document. All backend components are operational. However, the frontend knowledge management interface for the RAG system is still pending implementation (see [Future Enhancements](#future-enhancements)).

The AI Orchestration Layer is a centralized service that coordinates and manages all AI-related operations in the Project Call application. It provides a unified interface for LLM, Voice AI, Speech Analysis, and other AI capabilities, with built-in resilience, monitoring, and performance optimization.

## Architecture

The AI Orchestration Layer follows an event-driven architecture with the following components:

1. **AI Orchestration Service**: The core service that coordinates all AI operations and provides a unified interface.
2. **RAG Service**: Retrieval-Augmented Generation service that enhances LLM responses with relevant information from various sources.
3. **API Controller & Routes**: RESTful API endpoints for interacting with the AI services.
4. **Middleware**: Authentication, validation, and rate limiting for secure and efficient API usage.

## Key Features

- **Centralized Management**: All AI operations are coordinated through a single service.
- **Multi-Provider Support**: Support for multiple LLM providers (OpenAI, Anthropic, Google/Gemini) with dynamic routing.
- **Fallback Mechanisms**: Circuit breaker pattern for resilience in case of service failures.
- **Caching**: Performance optimization through response caching.
- **Monitoring & Observability**: Comprehensive metrics for monitoring AI operations.
- **Secure API Access**: Authentication, validation, and rate limiting for secure API access.
- **RAG Capabilities**: Context-aware responses through retrieval-augmented generation.

## API Endpoints

The AI Orchestration Layer exposes the following API endpoints:

### LLM Operations

- `POST /api/ai/llm`: Process an LLM request with multi-provider support.

### RAG Operations

- `POST /api/ai/rag`: Generate a response using the RAG service.

### Voice Operations

- `POST /api/ai/voice`: Synthesize speech using ElevenLabs integration.

### Speech Operations

- `POST /api/ai/speech`: Analyze speech audio for emotion, intent, and more.

### Emotion Detection

- `POST /api/ai/emotion`: Detect emotion in text.

### Intent & Objection Detection

- `POST /api/ai/intent`: Detect user intent in text.
- `POST /api/ai/objection`: Detect objections in text.

### Conversation Quality

- `POST /api/ai/quality`: Score conversation quality.

### Monitoring & Management

- `GET /api/ai/metrics`: Get metrics about AI service usage.
- `POST /api/ai/cache/clear`: Clear AI service cache.
- `POST /api/ai/config/update`: Update AI service configuration.

## Implementation Details

### AI Orchestration Service

The core orchestration service (`aiOrchestrationService.ts`) coordinates all AI-related operations:

- **Initialization**: Dynamic service initialization based on configuration from the database.
- **Request Processing**: Unified interface for processing requests with caching, fallback, and metrics.
- **Provider Management**: Dynamic routing of requests to the appropriate provider.
- **Monitoring**: Comprehensive metrics for monitoring AI operations.

### RAG Service

The RAG service (`ragService.ts`) enhances LLM responses with relevant information:

- **Source Management**: Configure and query multiple data sources (MongoDB, vector stores, etc.).
- **Query Processing**: Process queries with relevance scoring and augmented prompts.
- **Fallback Mechanisms**: Graceful degradation if RAG sources are unavailable.

#### Current Limitations

The RAG service is currently operational at the backend level, but lacks a frontend interface for users to:
- Upload their own documents/knowledge
- Manage and organize their knowledge base
- See what information was used to augment responses

This is identified as a critical enhancement for the next development phase, as outlined in the [Future Enhancements](#future-enhancements) section.

### API Controller & Routes

The API controller (`aiController.ts`) and routes (`aiRoutes.ts`) provide RESTful endpoints:

- **Request Validation**: Ensure requests contain the required data in the correct format.
- **Authentication**: Verify JWT tokens and ensure users have access to the requested resources.
- **Rate Limiting**: Prevent abuse and ensure fair usage of the system.

## Configuration

The AI Orchestration Layer is configured through the database using the `Configuration` model. It supports:

- **LLM Providers**: Configure API keys, base URLs, and default models.
- **Voice AI**: Configure ElevenLabs API key and voice settings.
- **Speech Analysis**: Configure speech-to-text and analysis settings.
- **RAG Sources**: Configure data sources for retrieval-augmented generation.

## Usage Examples

### LLM Request

```javascript
const response = await fetch('/api/ai/llm', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the capital of France?' }
    ],
    model: 'gpt-4',
    provider: 'openai',
    temperature: 0.7
  })
});

const result = await response.json();
console.log(result.data.content); // "The capital of France is Paris."
```

### RAG Request

```javascript
const response = await fetch('/api/ai/rag', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    query: 'What are our best-performing campaigns?',
    sources: ['mongodb'],
    maxResults: 5,
    minRelevanceScore: 0.7
  })
});

const result = await response.json();
console.log(result.data.response); // Context-aware response about campaigns
```

### Voice Synthesis

```javascript
const response = await fetch('/api/ai/voice', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    text: 'Hello, how can I help you today?',
    personalityId: 'professional',
    language: 'English'
  })
});

const result = await response.json();
console.log(result.data.audioUrl); // URL to the synthesized audio
```

## Error Handling

The AI Orchestration Layer provides comprehensive error handling:

- **Service Errors**: Handled with appropriate fallback mechanisms.
- **Validation Errors**: Detailed error messages for invalid requests.
- **Authentication Errors**: Appropriate error responses for authentication failures.
- **Rate Limiting**: Clear messages when rate limits are exceeded.

## Metrics

The AI Orchestration Layer provides comprehensive metrics:

- **Request Counts**: Total, successful, and failed requests.
- **Latency**: Average request latency.
- **Cache Hit Rate**: Percentage of requests served from cache.
- **Token Usage**: Number of tokens used for prompt and completion.
- **Cost Estimate**: Estimated cost of AI operations.
- **Provider Breakdown**: Metrics broken down by provider.

## Future Enhancements

### Knowledge Management Frontend (Priority)

While the RAG system is fully operational on the backend, a critical enhancement is needed to allow users to contribute their own knowledge to the system. The planned knowledge management frontend will include:

1. **Document Upload Interface**: Allow users to upload documents (PDFs, Word docs, text files) to populate their knowledge base.
2. **Knowledge Organization**: Enable categorization, tagging, and organization of knowledge items.
3. **Content Editing**: Provide ability to edit, update, and refine knowledge entries directly in the application.
4. **Relevance Feedback**: Allow users to provide feedback on the relevance of retrieved information to improve future retrievals.
5. **Knowledge Analytics**: Show metrics on knowledge usage, retrieval frequency, and effectiveness.

This frontend component is a priority for the next development phase, as it will significantly enhance the value of the RAG system by allowing personalized knowledge bases tailored to each user's specific domain and needs.

A detailed specification for the Knowledge Management Frontend has been created and is available at [KNOWLEDGE_MANAGEMENT_SPEC.md](./KNOWLEDGE_MANAGEMENT_SPEC.md).

### Other Planned Enhancements

- **Additional Providers**: Support for additional LLM and voice providers.
- **Enhanced RAG**: More sophisticated retrieval mechanisms and data sources.
- **Advanced Caching**: Tiered caching with different TTLs for different operations.
- **A/B Testing**: Support for A/B testing different providers and models.
- **Custom Models**: Support for custom fine-tuned models.
