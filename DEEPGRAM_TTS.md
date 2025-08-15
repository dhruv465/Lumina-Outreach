# Deepgram TTS Integration Guide

## Overview

This document describes the Deepgram Text-to-Speech (TTS) integration in the Project-Call system. Deepgram TTS provides high-quality, low-latency voice synthesis and is integrated as a first-class provider alongside ElevenLabs TTS.

## Features

- **Multi-provider TTS support** with dynamic provider selection
- **Automatic fallback** from ElevenLabs to Deepgram (or vice versa)
- **Voice model auto-detection** based on voice ID patterns
- **Comprehensive metrics tracking** for success rates, latency, and fallback usage
- **Real-time verification** of API keys and service health
- **Flexible configuration** via API and UI

## Configuration

### TTS Configuration Structure

```typescript
ttsConfig: {
  provider: 'elevenlabs' | 'deepgram',  // Primary provider (legacy field)
  primaryProvider: 'elevenlabs',         // Primary provider (preferred)
  fallbackProviders: ['deepgram'],       // Fallback providers in order
  autoFallback: true,                    // Enable automatic fallback
  deepgramTTS: {
    apiKey: string,                      // Deepgram API key
    isEnabled: boolean,                  // Enable/disable Deepgram TTS
    defaultModel: 'aura-asteria-en',     // Default voice model
    availableModels: string[],           // List of available models
    voiceSettings: {
      encoding: 'mp3',                   // Audio encoding format
      sampleRate: 24000                  // Sample rate for non-MP3 formats
    },
    status: 'verified' | 'failed' | 'unverified',  // Verification status
    lastVerified: Date,                  // Last verification timestamp
    lastError: string                    // Last error message (if any)
  }
}
```

### Available Voice Models

Deepgram TTS supports the following voice models:

- `aura-2-thalia-en` - Female, conversational
- `aura-asteria-en` - Female, clear
- `aura-luna-en` - Female, warm
- `aura-stella-en` - Female, professional
- `aura-athena-en` - Female, authoritative
- `aura-hera-en` - Female, mature
- `aura-orion-en` - Male, deep
- `aura-arcas-en` - Male, friendly
- `aura-perseus-en` - Male, confident
- `aura-angus-en` - Male, casual
- `aura-orpheus-en` - Male, smooth
- `aura-helios-en` - Male, energetic
- `aura-zeus-en` - Male, commanding

## API Endpoints

### Configuration Management

#### Update TTS Configuration
```http
PUT /api/configuration
Content-Type: application/json

{
  "ttsConfig": {
    "primaryProvider": "deepgram",
    "fallbackProviders": ["elevenlabs"],
    "autoFallback": true,
    "deepgramTTS": {
      "apiKey": "your-deepgram-api-key",
      "isEnabled": true,
      "defaultModel": "aura-asteria-en"
    }
  }
}
```

#### Verify Deepgram TTS API Key
```http
POST /api/configuration/verify/deepgram-tts
```

Response:
```json
{
  "success": true,
  "status": "verified",
  "message": "Deepgram TTS API verified successfully. Latency: 150ms, Audio size: 2048 bytes",
  "latency": 150,
  "availableModels": ["aura-asteria-en", "aura-luna-en", ...],
  "lastVerified": "2024-01-15T10:30:00Z",
  "currentStatus": "verified"
}
```

### Speech Synthesis

#### Synthesize Speech
```http
POST /api/tts-provider/synthesize
Content-Type: application/json

{
  "text": "Hello, this is a test message.",
  "voiceId": "aura-asteria-en",  // Auto-selects Deepgram
  "language": "en",
  "encoding": "mp3"
}
```

#### Test TTS Provider
```http
POST /api/tts-provider/test
Content-Type: application/json

{
  "provider": "deepgram",
  "text": "This is a test message."
}
```

Response:
```json
{
  "success": true,
  "message": "TTS provider deepgram test successful",
  "provider": "deepgram",
  "audioSize": 2048,
  "metadata": {
    "provider": "deepgram",
    "model": "aura-asteria-en",
    "encoding": "mp3",
    "duration": 2.5,
    "fallbackUsed": false
  }
}
```

## Provider Selection Logic

### Automatic Provider Detection

The system automatically selects the appropriate TTS provider based on:

1. **Voice ID Pattern**: If the `voiceId` starts with `aura-`, Deepgram is automatically selected
2. **Primary Provider**: Configuration setting for the preferred provider
3. **Fallback Providers**: Used when the primary provider fails

### Fallback Mechanism

When `autoFallback` is enabled:

1. **Primary Attempt**: Try the primary provider first
2. **Fallback Chain**: If primary fails, try each fallback provider in order
3. **Metrics Recording**: Track which providers were tried and why fallback occurred
4. **Error Handling**: Provide detailed error information for troubleshooting

## Metrics and Monitoring

### TTS Metrics

The system tracks comprehensive metrics for all TTS operations:

```typescript
interface TTSMetric {
  timestamp: Date;
  provider: string;           // 'deepgram' | 'elevenlabs'
  success: boolean;           // Request success/failure
  latency: number;            // Response time in milliseconds
  audioSize?: number;         // Size of generated audio in bytes
  fallbackUsed?: boolean;     // Whether fallback was used
  fallbackReason?: string;    // Reason for fallback
  errorCode?: string;         // Error classification
  requestId?: string;         // Correlation ID for debugging
}
```

### Available Metrics

- **Success Rate**: Percentage of successful requests per provider
- **Average Latency**: Mean response time for each provider
- **Fallback Rate**: How often fallback is triggered
- **Error Classification**: Types of errors encountered
- **Request Volume**: Number of requests per provider over time

### Accessing Metrics

```http
GET /api/tts-provider/status
```

Returns current status and metrics for all TTS providers.

## Error Handling

### Error Classification

Errors are classified into categories for better troubleshooting:

- **Authentication Errors** (`HTTP_401`): Invalid API key
- **Authorization Errors** (`HTTP_403`): Insufficient permissions
- **Rate Limiting** (`HTTP_429`): Too many requests
- **Bad Request** (`HTTP_400`): Invalid parameters
- **Network Errors**: Connection timeouts or failures
- **Service Errors**: Provider-specific issues

### Common Issues and Solutions

#### API Key Issues
- **Problem**: "Authentication failed. Invalid API key."
- **Solution**: Verify your Deepgram API key in the configuration

#### Rate Limiting
- **Problem**: "Rate limit exceeded. Too many requests."
- **Solution**: Implement request throttling or upgrade your Deepgram plan

#### Network Timeouts
- **Problem**: Synthesis requests timing out
- **Solution**: Check network connectivity and consider fallback providers

#### Model Availability
- **Problem**: Specific voice model not available
- **Solution**: Use model verification endpoint to check available models

## Security Considerations

### API Key Management

- **Masking**: API keys are masked in logs (showing only first 6 characters)
- **Storage**: Keys are stored encrypted in the database
- **Transmission**: All API communications use HTTPS
- **Deletion**: Keys can be securely deleted via the API

### Input Validation

- **Text Length**: Input text is validated for reasonable length limits
- **Model Names**: Voice models are validated against known models
- **Encoding**: Audio encoding options are restricted to supported formats

## Performance Optimization

### Latency Targets

- **Target Latency**: < 200ms for synthesis requests
- **Monitoring**: Automatic latency tracking and alerting
- **Optimization**: Connection pooling and request optimization

### Audio Format Considerations

- **MP3**: Recommended for general use (smaller files, broad compatibility)
- **WAV/Linear16**: Better quality, larger files
- **Sample Rates**: 24kHz recommended for high quality, 16kHz for compatibility

## Testing

### Manual Testing

1. **Verify API Key**:
   ```bash
   curl -X POST http://localhost:8000/api/configuration/verify/deepgram-tts \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

2. **Test Synthesis**:
   ```bash
   curl -X POST http://localhost:8000/api/tts-provider/test \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -d '{"provider": "deepgram", "text": "Hello world"}'
   ```

### Integration Testing

Run the migration script to ensure proper configuration:

```bash
npm run migrate:tts
```

Validate the migration:

```bash
npm run migrate:tts:validate
```

## Migration from Single Provider

### Existing ElevenLabs Users

If you're currently using only ElevenLabs:

1. **Add Deepgram as Fallback**:
   ```json
   {
     "ttsConfig": {
       "primaryProvider": "elevenlabs",
       "fallbackProviders": ["deepgram"],
       "autoFallback": true
     }
   }
   ```

2. **Configure Deepgram TTS**:
   - Add your Deepgram API key
   - Enable the service
   - Test the configuration

3. **Monitor Metrics**:
   - Check fallback usage
   - Monitor latency and success rates
   - Adjust configuration as needed

### Migration Script

Run the TTS configuration migration to add default settings:

```bash
ts-node src/migrations/tts-config-migration.ts migrate
```

## Troubleshooting

### Common Commands

```bash
# Check TTS configuration
curl -X GET http://localhost:8000/api/tts-provider/config

# Test specific provider
curl -X POST http://localhost:8000/api/tts-provider/test \
  -d '{"provider": "deepgram"}'

# Verify API key
curl -X POST http://localhost:8000/api/configuration/verify/deepgram-tts

# Check metrics
curl -X GET http://localhost:8000/api/tts-provider/status
```

### Debug Information

Enable debug logging to see detailed TTS operations:

```bash
LOG_LEVEL=debug npm run dev
```

Look for log entries with correlation IDs to trace specific requests through the system.

## Support

For additional support:

1. Check the application logs for detailed error messages
2. Use the verification endpoints to test configuration
3. Monitor metrics for performance issues
4. Review Deepgram documentation for API-specific issues

## Version Compatibility

This integration is compatible with:
- Deepgram SDK v4.4.0+
- Node.js 18.0+
- ElevenLabs integration (maintains backward compatibility)