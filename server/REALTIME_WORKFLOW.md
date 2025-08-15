# Real-Time AI Voice Agent Call Workflow

This document describes the implementation of the end-to-end real-time, interruption-friendly call workflow for the AI voice agent using Twilio Media Streams, streaming STT/TTS, barge-in handling, and a lightweight per-call state machine.

## Overview

The enhanced real-time call workflow provides ultra-low latency voice interactions with sophisticated interruption handling and provider fallback mechanisms. The system is designed for production-grade reliability and performance.

## Architecture Components

### 1. Real-Time Call State Machine (`realTimeCallStateMachine.ts`)

**Purpose**: Manages the complete lifecycle of AI voice agent calls with state-driven workflow control.

**Key Features**:
- **Comprehensive State Management**: 11 distinct call states (initializing, connecting, greeting, listening, processing, speaking, interrupted, waiting_for_response, ending, ended, error)
- **Event-Driven Transitions**: 12 event types triggering state changes
- **Barge-in Coordination**: Seamless integration with interruption detection
- **Performance Metrics**: Real-time latency and response time tracking
- **Timeout Management**: Configurable silence and response timeouts

**States**:
```typescript
enum CallState {
  INITIALIZING = 'initializing',
  CONNECTING = 'connecting', 
  GREETING = 'greeting',
  LISTENING = 'listening',
  PROCESSING = 'processing',
  SPEAKING = 'speaking',
  INTERRUPTED = 'interrupted',
  WAITING_FOR_RESPONSE = 'waiting_for_response',
  ENDING = 'ending',
  ENDED = 'ended',
  ERROR = 'error'
}
```

**Events**:
```typescript
enum CallEvent {
  CALL_CONNECTED = 'call_connected',
  MEDIA_STREAM_STARTED = 'media_stream_started',
  USER_STARTED_SPEAKING = 'user_started_speaking',
  USER_STOPPED_SPEAKING = 'user_stopped_speaking',
  SPEECH_DETECTED = 'speech_detected',
  TRANSCRIPTION_RECEIVED = 'transcription_received',
  AI_RESPONSE_GENERATED = 'ai_response_generated',
  TTS_STARTED = 'tts_started',
  TTS_COMPLETED = 'tts_completed',
  BARGE_IN_DETECTED = 'barge_in_detected',
  CALL_ENDED = 'call_ended',
  ERROR_OCCURRED = 'error_occurred',
  SILENCE_TIMEOUT = 'silence_timeout',
  RESPONSE_TIMEOUT = 'response_timeout'
}
```

### 2. Enhanced Barge-in Detection (`enhancedBargeInDetectionService.ts`)

**Purpose**: Provides sophisticated voice activity detection and interruption management for natural conversation flow.

**Key Features**:
- **Advanced Audio Analysis**: Real-time energy level calculation and speech detection
- **Configurable Sensitivity**: Four sensitivity levels (low, medium, high, custom)
- **Rate Limiting**: Prevents excessive barge-in triggers
- **Grace Periods**: Configurable delays before enabling barge-in
- **Confidence Scoring**: Machine learning-style confidence calculation

**Configuration Options**:
```typescript
interface BargeInConfig {
  energyThreshold: number;      // Minimum energy level for speech
  silenceThreshold: number;     // Maximum energy for silence
  minSpeechDuration: number;    // Minimum duration to confirm speech (ms)
  maxSilenceDuration: number;   // Maximum silence before stopping detection (ms)
  bargeInEnabled: boolean;      // Enable/disable barge-in
  bargeInGracePeriod: number;   // Grace period before allowing barge-in (ms)
  maxBargeInPerMinute: number;  // Rate limiting
  sensitivity: 'low' | 'medium' | 'high' | 'custom';
}
```

### 3. Optimized Real-Time Audio Pipeline (`optimizedRealTimeAudioPipeline.ts`)

**Purpose**: Handles end-to-end audio processing with ultra-low latency optimization and provider fallback.

**Key Features**:
- **Multi-Provider Support**: Seamless switching between Deepgram/OpenAI STT and ElevenLabs/Deepgram TTS
- **Chunked Processing**: Efficient audio chunk aggregation and processing
- **Parallel Processing**: Concurrent STT and TTS operations where possible
- **Automatic Fallback**: Robust error handling with provider switching
- **Phone-Quality Audio**: Optimized for 8kHz, 16-bit mono audio streams

**Configuration**:
```typescript
interface AudioPipelineConfig {
  sampleRate: number;           // 8000 for phone quality
  channels: number;             // 1 for mono
  bitDepth: number;             // 16 for phone quality
  frameSize: number;            // 20ms frames
  bufferSize: number;           // Buffer size for processing
  enableChunkedProcessing: boolean;
  maxProcessingLatency: number; // 500ms max for ultra-low latency
  enableParallelProcessing: boolean;
  primarySTTProvider: 'deepgram' | 'openai';
  primaryTTSProvider: 'elevenlabs' | 'deepgram';
  enableProviderFallback: boolean;
  fallbackTimeout: number;      // 2 seconds
}
```

### TTS Provider Selection and Fallback

**Purpose**: Intelligent TTS provider selection with automatic fallback for maximum reliability.

**Provider Selection Logic**:
1. **Voice-Based Auto-Detection**: 
   - Aura-series voice IDs (`aura-asteria-en`, `aura-zeus-en`, etc.) automatically route to Deepgram TTS
   - Other voice IDs use the configured primary provider

2. **Primary Provider Configuration**:
   - ElevenLabs: High-quality voice synthesis with personality adaptation
   - Deepgram TTS: Low-latency, reliable voice synthesis with multiple voice models

3. **Fallback Decision Tree**:
   ```
   Request → Voice ID Check → Auto-detect Provider?
                          ↓ No
   Primary Provider → Success? → Return Audio
                   ↓ No (Error)
   Fallback Provider → Success? → Return Audio + Fallback Flag
                    ↓ No (Error)
   Twilio Built-in TTS (Last Resort)
   ```

**Error Classification and Handling**:
- **Authentication Errors (401/403)**: Immediate fallback to secondary provider
- **Rate Limiting (429)**: Temporary fallback with retry logic
- **Network Timeouts**: Quick fallback to ensure call continuity
- **Model Unavailable**: Fallback with alternative voice model

**Latency Targets**:
- **Primary Provider**: < 200ms synthesis time
- **Fallback Provider**: < 300ms total including failover
- **Emergency Fallback**: < 100ms (Twilio built-in TTS)

**Metrics and Monitoring**:
- Success/failure rates per provider
- Average latency per provider
- Fallback frequency and reasons
- Request correlation tracking for debugging

### 4. Enhanced Real-Time Controller (`enhancedRealTimeController.ts`)

**Purpose**: Integrates all services with Twilio Media Streams for seamless WebSocket communication.

**Key Features**:
- **Twilio Media Streams Integration**: Direct WebSocket handling for real-time audio
- **Service Orchestration**: Coordinates state machine, barge-in detection, and audio pipeline
- **Error Recovery**: Comprehensive error handling and graceful degradation
- **Greeting Management**: Automated initial greeting with fallback mechanisms

## Workflow Process

### 1. Call Initialization
```
1. Twilio initiates call → WebSocket connection established
2. State machine creates session → INITIALIZING state
3. Audio pipeline initializes → Provider configurations loaded  
4. Barge-in detection starts → Audio analysis begins
5. Transition to CONNECTING → Awaiting media stream
```

### 2. Media Stream Setup
```
1. Twilio sends 'start' event → Stream SID received
2. Transition to GREETING → Initial greeting preparation
3. Generate greeting audio → TTS synthesis
4. Send audio to Twilio → Base64 encoded payload
5. Transition to SPEAKING → Agent speaking state
```

### 3. Real-Time Conversation Loop
```
1. LISTENING state → Waiting for user input
2. Audio chunks received → Barge-in detection active
3. Speech detected → Transition to PROCESSING
4. STT processing → Transcription with fallback
5. AI response generation → LLM processing
6. TTS synthesis → Audio generation with fallback
7. Audio transmission → Send to Twilio
8. Transition to SPEAKING → Agent response playing
9. Response complete → Return to LISTENING
```

### 4. Barge-in Handling
```
1. User starts speaking while agent speaking → Barge-in detected
2. Cancel ongoing TTS → Immediate interruption
3. Transition to INTERRUPTED → Stop agent audio
4. Process user speech → Continue with STT
5. Generate new response → AI processes interruption
6. Resume normal flow → Return to conversation loop
```

## API Endpoints

### Health and Monitoring
- `GET /api/realtime/health` - System health check
- `GET /api/realtime/sessions` - Active call sessions
- `GET /api/realtime/performance` - System-wide metrics
- `GET /api/realtime/config` - Configuration status

### Call Management
- `GET /api/realtime/calls/:callId/metrics` - Call-specific metrics
- `GET /api/realtime/calls/:callId/state-history` - State transition history
- `POST /api/realtime/calls/:callId/transition` - Manual state transition (debug)

### Barge-in Control
- `POST /api/realtime/calls/:callId/barge-in` - Manual barge-in trigger (testing)
- `PUT /api/realtime/calls/:callId/barge-in/config` - Update barge-in settings

## Performance Metrics

### Latency Targets
- **STT Latency**: < 300ms (average)
- **TTS Latency**: < 500ms (average)  
- **Total Response Time**: < 800ms (end-to-end)
- **Barge-in Detection**: < 100ms (real-time)

### Key Performance Indicators
- **Response Latency**: Time from speech end to response start
- **Barge-in Accuracy**: Percentage of valid interruptions detected
- **Provider Uptime**: Availability of STT/TTS services
- **Audio Quality**: Clarity and naturalness metrics

## Configuration Requirements

### Environment Variables
```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
WEBHOOK_BASE_URL=https://your-domain.com

# Deepgram Configuration  
DEEPGRAM_API_KEY=your_deepgram_key

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_key

# OpenAI Configuration (optional)
OPENAI_API_KEY=your_openai_key
```

### Database Configuration
Ensure MongoDB configuration includes proper indexes for:
- Call records with Twilio SID lookup
- Campaign voice configurations
- Lead information for personalization

## Error Handling and Recovery

### Provider Fallback Strategy
1. **Primary Provider Failure**: Automatic switch to secondary provider
2. **Complete STT Failure**: Graceful degradation with error messaging
3. **Complete TTS Failure**: Fallback to Twilio's built-in TTS
4. **Network Issues**: Retry logic with exponential backoff

### State Recovery
- **WebSocket Disconnection**: Automatic reconnection with state preservation
- **Processing Timeouts**: Transition to error state with user notification
- **Invalid State Transitions**: Logging and correction mechanisms

## Testing and Validation

### Unit Tests
Run the test suite to validate core functionality:
```bash
cd server
npx ts-node src/tests/realTimeWorkflowTest.ts
```

### Integration Testing
1. **WebSocket Connection**: Test Twilio Media Streams integration
2. **State Transitions**: Validate all state machine transitions
3. **Barge-in Detection**: Test interruption accuracy and timing
4. **Provider Fallback**: Verify seamless provider switching
5. **Audio Quality**: Validate phone-quality audio processing

### Load Testing
- **Concurrent Calls**: Test with multiple simultaneous calls
- **Memory Usage**: Monitor for memory leaks during extended use
- **CPU Performance**: Ensure real-time processing under load

## Deployment Considerations

### Resource Requirements
- **CPU**: 2+ cores for real-time audio processing
- **Memory**: 4GB+ RAM for concurrent call handling
- **Network**: Low-latency connection to Twilio and provider APIs
- **Storage**: Minimal for call logs and temporary audio files

### Scaling Strategy
- **Horizontal Scaling**: Multiple server instances with load balancing
- **WebSocket Affinity**: Sticky sessions for WebSocket connections
- **Provider Rate Limits**: Distributed API key usage across instances
- **Monitoring**: Real-time metrics and alerting for performance issues

## Security Considerations

### Data Protection
- **Audio Data**: No persistent storage of audio content
- **Transcription**: Encrypted transmission and temporary storage
- **API Keys**: Secure environment variable management
- **WebSocket Security**: Proper authentication and rate limiting

### Compliance
- **GDPR**: Minimal data retention and user consent mechanisms
- **HIPAA**: Optional healthcare compliance features
- **Telecommunications**: Compliance with regional calling regulations

## Future Enhancements

### Planned Features
1. **Advanced Emotion Detection**: Real-time sentiment analysis
2. **Multi-Language Support**: Dynamic language switching
3. **Voice Cloning**: Personalized voice synthesis
4. **Advanced Analytics**: Machine learning insights
5. **WebRTC Integration**: Direct browser-to-browser calling

### Performance Optimizations
1. **Edge Deployment**: Reduce latency with edge computing
2. **Predictive Caching**: Pre-load common responses
3. **Adaptive Quality**: Dynamic audio quality adjustment
4. **Custom Models**: Fine-tuned STT/TTS models

## Troubleshooting

### Common Issues
1. **High Latency**: Check network connectivity and provider performance
2. **Poor Barge-in**: Adjust sensitivity settings and audio levels
3. **Provider Failures**: Verify API keys and service status
4. **Memory Leaks**: Monitor WebSocket connection cleanup
5. **Audio Quality**: Validate phone-quality audio processing

### Debug Tools
- **State History API**: Track state transitions for debugging
- **Real-time Metrics**: Monitor latency and performance
- **Manual Controls**: Test state transitions and barge-in manually
- **Comprehensive Logging**: Detailed logs for troubleshooting

---

This implementation provides a production-ready, real-time AI voice agent system with ultra-low latency, robust error handling, and sophisticated interruption capabilities. The modular architecture ensures maintainability and scalability for enterprise deployments.