# Enhanced WebSocket Manager Integration

This document describes the integration of the `EnhancedWebSocketManager` into the main connection flow to prevent premature WebSocket connection closures.

## Problem Addressed

WebSocket connections were closing immediately after the opening message due to lack of robust connection management. The system lacked:
- Automatic reconnection logic
- Heartbeat and health-check strategies  
- Connection quality metrics
- Proper error handling and graceful degradation

## Solution Overview

The `EnhancedWebSocketManager` has been integrated into the main connection flow through several key integration points:

### 1. Enhanced WebSocket Factory (`utils/enhancedWebSocketFactory.ts`)

A centralized factory for creating enhanced WebSocket connections throughout the system:

```typescript
import { createEnhancedWebSocket, createPlainWebSocket } from './utils/enhancedWebSocketFactory';

// Create enhanced WebSocket manager
const manager = await createEnhancedWebSocket('wss://example.com', {
  callId: 'call-123',
  serviceName: 'my-service',
  maxReconnectAttempts: 5,
  heartbeatInterval: 15000
});

// Or create plain WebSocket with enhanced features
const ws = await createPlainWebSocket('wss://example.com', options);
```

### 2. TwilioWebSocketManager Integration

The `TwilioWebSocketManager` now provides a factory method for creating enhanced outbound connections:

```typescript
import { TwilioWebSocketManager } from './utils/TwilioWebSocketManager';

// Create enhanced Twilio connection
const twilioManager = await TwilioWebSocketManager.createEnhancedConnection(
  'call-id',
  'wss://twilio-endpoint',
  'connection-id'
);
```

### 3. Service Integration

Services that create outbound WebSocket connections have been updated to use enhanced connections:

- **ElevenLabs Conversational Service**: Uses enhanced connections for TTS streaming
- **SessionManager**: Provides `createEnhancedSession()` method for robust session handling
- **TwilioWebSocketServer**: Enhanced cleanup handling for all connections

### 4. Graceful Shutdown Integration

The main server graceful shutdown process now includes enhanced WebSocket cleanup:

```typescript
// In index.ts gracefulShutdown function
await enhancedWebSocketFactory.closeAllConnections();
```

## Enhanced Features

### Automatic Reconnection
- Configurable maximum reconnection attempts
- Exponential backoff with jitter
- Circuit breaker pattern for failed connections

### Health Monitoring  
- Regular heartbeat/ping-pong checks
- Connection quality assessment
- Latency monitoring and adaptive intervals

### Buffer Management
- Automatic audio buffer cleanup
- Configurable buffer size limits
- Memory usage optimization

### Error Handling
- Detailed error logging and metrics
- Graceful degradation on connection issues
- Integration with call resilience service

## Configuration Options

The enhanced manager supports comprehensive configuration:

```typescript
interface ConnectionConfig {
  maxReconnectAttempts: number;    // Default: 5
  reconnectDelay: number;          // Default: 1000ms
  heartbeatInterval: number;       // Default: 15000ms
  connectionTimeout: number;       // Default: 10000ms
  maxHeartbeatMisses: number;     // Default: 3
  pingInterval: number;           // Default: 20000ms
  pongTimeout: number;            // Default: 5000ms
}
```

## Usage Guidelines

### For New Services

When creating new services that need WebSocket connections:

```typescript
import { createPlainWebSocket } from '../utils/enhancedWebSocketFactory';

// In your service
const ws = await createPlainWebSocket(url, {
  callId: this.callId,
  serviceName: 'my-service-name',
  heartbeatInterval: 30000  // Adjust based on service needs
});
```

### For Existing Services  

Update existing services to use the enhanced factory:

1. Import the factory
2. Replace `new WebSocket()` calls with `createPlainWebSocket()`
3. Handle the async nature of connection creation
4. Configure appropriate options for your service

### Service-Specific Optimizations

- **Real-time audio services**: Shorter heartbeat intervals (15-20s)
- **TTS services**: Fewer reconnection attempts, longer timeouts
- **Session management**: Balanced settings for general-purpose use

## Testing

Run the integration test to verify enhanced WebSocket functionality:

```bash
cd server
npx ts-node test-enhanced-websocket-integration.ts
```

## Monitoring

The enhanced connections provide detailed metrics and logging:

- Connection quality assessment
- Reconnection attempt tracking
- Heartbeat miss counting
- Buffer usage statistics

Monitor these metrics in production to ensure optimal performance.

## Benefits

1. **Stability**: Connections remain open and stable during sessions
2. **Resilience**: Automatic recovery from network issues
3. **Monitoring**: Comprehensive connection health tracking
4. **Performance**: Optimized for real-time voice/audio applications
5. **Maintainability**: Centralized connection management