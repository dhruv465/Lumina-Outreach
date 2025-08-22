# Call Resilience & Monitoring System

## Overview

The Call Resilience & Monitoring System provides comprehensive error handling, fallback mechanisms, and real-time monitoring for live voice calls. This system ensures maximum call stability and minimal disruptions during voice conversations.

## Key Components

### 1. Call Resilience Service (`callResilienceService.ts`)

Manages error recovery, fallback activation, and connection health monitoring.

**Features:**
- Circuit breakers for external services (TTS, STT, LLM)
- Automatic fallback activation
- Connection health tracking
- Session cleanup and resource management

**Configuration:**
```typescript
interface CallResilienceConfig {
  maxRetries: number;          // Default: 3
  retryDelay: number;          // Default: 1000ms
  circuitBreakerThreshold: number; // Default: 5
  fallbackTimeout: number;     // Default: 5000ms
  heartbeatInterval: number;   // Default: 10000ms
  connectionTimeout: number;   // Default: 30000ms
  audioBufferMaxSize: number;  // Default: 10MB
  cleanupInterval: number;     // Default: 60000ms
}
```

### 2. Call Monitoring Service (`callMonitoringService.ts`)

Provides real-time health monitoring, issue tracking, and automated alerts.

**Features:**
- Real-time call health assessment
- Issue reporting and resolution tracking
- Automated alert rules
- Performance metrics collection
- Auto-recovery triggers

**Configuration:**
```typescript
interface MonitoringConfig {
  healthCheckInterval: number; // Default: 5000ms
  alertThresholds: {
    errorRate: number;         // Default: 0.1 (10%)
    responseTime: number;      // Default: 3000ms
    connectionStability: number; // Default: 0.8 (80%)
    audioLatency: number;      // Default: 500ms
  };
  retentionPeriod: number;     // Default: 24 hours
  enableRealTimeAlerts: boolean; // Default: true
  enableAutoRecovery: boolean;   // Default: true
}
```

### 3. Fallback TTS Service (`fallbackTTSService.ts`)

Provides multiple backup voice synthesis methods when primary TTS fails.

**Features:**
- Twilio built-in TTS fallback
- Prerecorded message fallback
- Silence generation as last resort
- Response caching
- Automatic provider switching

**Configuration:**
```typescript
interface TTSFallbackConfig {
  enableTwilioFallback: boolean;     // Default: true
  enableBrowserTTS: boolean;         // Default: false
  enablePrerecordedMessages: boolean; // Default: true
  fallbackTimeout: number;           // Default: 3000ms
  cacheEnabled: boolean;             // Default: true
  maxCacheSize: number;              // Default: 100
}
```

### 4. Enhanced WebSocket Manager (`enhancedWebSocketManager.ts`)

Manages WebSocket connections with automatic reconnection and health monitoring.

**Features:**
- Automatic reconnection with exponential backoff
- Connection quality assessment
- Audio buffer management
- Health metrics collection
- Graceful degradation

**Configuration:**
```typescript
interface ConnectionConfig {
  maxReconnectAttempts: number; // Default: 5
  reconnectDelay: number;       // Default: 1000ms
  heartbeatInterval: number;    // Default: 10000ms
  connectionTimeout: number;    // Default: 30000ms
  maxHeartbeatMisses: number;   // Default: 3
  pingInterval: number;         // Default: 15000ms
  pongTimeout: number;          // Default: 5000ms
}
```

## API Endpoints

### Health Monitoring

```http
GET /api/calls/:callId/health
```
Get comprehensive health status for a specific call.

```http
GET /api/monitoring/overview
```
Get system-wide monitoring overview.

```http
GET /api/monitoring/calls
```
Get health status for all active calls.

### Issue Management

```http
POST /api/calls/:callId/issues/:issueId/resolve
```
Mark a specific issue as resolved.

```http
POST /api/calls/:callId/actions/fallback
```
Manually activate fallback mode for a call.

### Fallback TTS

```http
GET /api/fallback/tts/test/:callId
```
Test fallback TTS capabilities.

```http
GET /api/fallback/tts/cache/stats
```
Get TTS fallback cache statistics.

```http
DELETE /api/fallback/tts/cache
```
Clear TTS fallback cache.

### System Health

```http
GET /api/health/system
```
Get overall system health status.

## Integration

### Server Integration

The resilience services are automatically integrated into the optimized stream controller:

```typescript
import { getCallResilienceService } from '../services/callResilienceService';
import { getCallMonitoringService } from '../services/callMonitoringService';

// Initialize services
const resilienceService = getCallResilienceService();
const monitoringService = getCallMonitoringService();

// Register call for monitoring
resilienceService.registerCall(callId);
monitoringService.registerCall(callId);
```

### Client Integration

Use the React component to display call health:

```typescript
import CallResilienceMonitor from '../components/common/CallResilienceMonitor';

<CallResilienceMonitor
  callId={callId}
  onEndCall={handleEndCall}
  onReconnect={handleReconnect}
/>
```

## Alert Rules

The monitoring service includes predefined alert rules:

1. **High Error Rate** - Triggers when error rate > 10%
2. **Slow Response Time** - Triggers when response time > 3 seconds
3. **Connection Instability** - Triggers when stability < 80%
4. **High Audio Latency** - Triggers when latency > 500ms
5. **Service Failure** - Triggers when any service component fails
6. **Excessive Fallbacks** - Triggers when fallbacks used > 5 times
7. **Audio Quality Degradation** - Triggers when quality < 70%

### Custom Alert Rules

Add custom alert rules via API:

```typescript
POST /api/monitoring/alerts/rules

{
  "id": "custom_rule",
  "name": "Custom Alert Rule",
  "condition": "/* JavaScript function */",
  "severity": "high",
  "cooldown": 60000,
  "enabled": true
}
```

## Troubleshooting

### Common Issues

1. **High Error Rate**
   - Check network connectivity
   - Verify API keys and configurations
   - Review service health status

2. **Connection Instability**
   - Monitor WebSocket connection quality
   - Check firewall and proxy settings
   - Verify network bandwidth

3. **TTS Fallback Activation**
   - Check primary TTS service status
   - Verify API rate limits
   - Review audio processing pipeline

4. **Circuit Breaker Trips**
   - Monitor external service availability
   - Check error thresholds
   - Review retry configurations

### Debug Commands

```bash
# Check service health
curl http://localhost:8000/api/health/system

# Get call health
curl http://localhost:8000/api/calls/{callId}/health

# Test fallback TTS
curl http://localhost:8000/api/fallback/tts/test/{callId}

# Get monitoring overview
curl http://localhost:8000/api/monitoring/overview
```

## Performance Considerations

### Memory Usage

- Audio buffers are automatically cleaned when exceeding 40MB
- Call sessions expire after 1 hour of inactivity
- Response cache limited to 100 entries

### CPU Usage

- Health checks run every 5 seconds by default
- Circuit breaker evaluation is lightweight
- Monitoring data is collected asynchronously

### Network Impact

- Heartbeats sent every 10 seconds
- Monitoring data is minimal overhead
- Fallback activation adds minimal latency

## Best Practices

1. **Monitor Regularly**
   - Set up alerts for critical issues
   - Review monitoring dashboard daily
   - Track performance trends

2. **Configure Thresholds**
   - Adjust alert thresholds based on your requirements
   - Consider network conditions in your environment
   - Test fallback mechanisms regularly

3. **Optimize Performance**
   - Preload common TTS responses
   - Use connection pooling
   - Monitor resource usage

4. **Plan for Failures**
   - Test fallback scenarios
   - Have escalation procedures
   - Monitor external service dependencies

## Environment Variables

```bash
# Resilience Configuration
CALL_RESILIENCE_MAX_RETRIES=3
CALL_RESILIENCE_RETRY_DELAY=1000
CALL_RESILIENCE_CIRCUIT_BREAKER_THRESHOLD=5
CALL_RESILIENCE_FALLBACK_TIMEOUT=5000

# Monitoring Configuration
CALL_MONITORING_HEALTH_CHECK_INTERVAL=5000
CALL_MONITORING_ERROR_RATE_THRESHOLD=0.1
CALL_MONITORING_RESPONSE_TIME_THRESHOLD=3000
CALL_MONITORING_RETENTION_PERIOD=86400000

# WebSocket Configuration
WS_MAX_RECONNECT_ATTEMPTS=5
WS_RECONNECT_DELAY=1000
WS_HEARTBEAT_INTERVAL=10000
WS_CONNECTION_TIMEOUT=30000

# TTS Fallback Configuration
TTS_FALLBACK_ENABLE_TWILIO=true
TTS_FALLBACK_ENABLE_PRERECORDED=true
TTS_FALLBACK_TIMEOUT=3000
TTS_FALLBACK_CACHE_SIZE=100
```

## Testing

Run the test suite to verify resilience functionality:

```bash
npm test -- --testPathPattern=resilienceServices.test.ts
```

The test suite covers:
- Service registration and cleanup
- Error handling and recovery
- Fallback mechanisms
- Monitoring and alerting
- Integration scenarios
- Edge cases and error conditions