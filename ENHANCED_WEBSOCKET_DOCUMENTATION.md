# Enhanced WebSocket Manager - RFC 6455 Compliant Implementation

This document describes the comprehensive enhancements made to the `EnhancedWebSocketManager` class to provide production-level WebSocket management with strict RFC 6455 compliance, Twilio integration optimizations, and advanced monitoring capabilities.

## Overview

The `EnhancedWebSocketManager` is a production-ready WebSocket connection manager that addresses the following requirements:

1. **Strict RFC 6455 WebSocket Protocol Compliance**
2. **Proper Control Frame Handling** to prevent fragmentation issues
3. **Sophisticated Reconnection Logic** with exponential backoff
4. **Comprehensive Metrics Collection** for monitoring connection health
5. **Memory-Efficient Buffer Management** for audio data
6. **Specialized Twilio Integration** handling
7. **Proper Error Classification** and recovery mechanisms

## Key Features

### 🔒 RFC 6455 Protocol Compliance

- **Frame Validation**: Validates incoming and outgoing WebSocket frames for protocol compliance
- **Opcode Support**: Proper handling of TEXT, BINARY, CLOSE, PING, and PONG opcodes
- **Frame Size Limits**: Enforces maximum frame sizes to prevent protocol violations
- **Fragmentation Prevention**: Ensures complete frame transmission (no fragmentation) for Twilio compatibility
- **Strict Mode**: Optional strict protocol compliance mode that drops invalid frames

```typescript
const manager = new EnhancedWebSocketManager(callId, url, {
  enableFrameValidation: true,
  strictProtocolCompliance: true,
  maxFrameSize: 64 * 1024, // 64KB for Twilio compatibility
  maxMessageSize: 1024 * 1024 // 1MB max message
});
```

### 🔄 Enhanced Error Classification System

The manager classifies errors into specific types for better recovery strategies:

- **NETWORK**: Connection issues (ECONNREFUSED, timeouts, etc.)
- **PROTOCOL**: RFC 6455 violations, invalid frames, opcodes
- **APPLICATION**: Application-specific errors
- **TWILIO_SPECIFIC**: Twilio error codes (31924, 31951, etc.)
- **BUFFER_OVERFLOW**: Memory management issues
- **TIMEOUT**: Heartbeat and pong timeouts
- **AUTHENTICATION**: Auth failures (non-recoverable)

Each error includes:
- **Type classification**
- **Severity level** (low, medium, high, critical)
- **Recoverability assessment**
- **Retry count tracking**

```typescript
manager.on('error', ({ original, classified }) => {
  console.log(`Error type: ${classified.type}, severity: ${classified.severity}`);
  console.log(`Recoverable: ${classified.recoverable}`);
});
```

### 📊 Comprehensive Production Metrics

Enhanced metrics for monitoring and alerting in production environments:

#### Connection Metrics
- Total connections established
- Active connections count
- Connection uptime tracking
- Reconnection attempts and delays
- Last connection/disconnection timestamps
- Disconnection reason classification
- Connection quality assessment (excellent, good, poor, failed)

#### Message Metrics
- Messages sent/received counts
- Bytes sent/received tracking
- Average message processing time
- Message validation failures

#### Error Metrics by Category
- Protocol errors count
- Network errors count  
- Application errors count
- Frame validation errors
- Compression errors
- Fragmentation errors

#### Performance Metrics
- Connection latency (from ping/pong)
- Heartbeat miss detection
- Buffer overflow incidents

```typescript
const metrics = manager.getMetrics();
console.log('Connection Quality:', metrics.connectionQuality);
console.log('Messages Sent:', metrics.messagesSent);
console.log('Protocol Errors:', metrics.protocolErrors);
console.log('Connection Uptime:', metrics.connectionUptime);
```

### 🧠 Adaptive Buffer Management

Intelligent buffer management system with memory pressure detection:

#### Memory Pressure Levels
- **Low**: Normal operation, no cleanup needed
- **Medium**: Moderate memory usage, gentle cleanup
- **High**: High memory usage, moderate cleanup
- **Critical**: Memory critical, aggressive cleanup

#### Cleanup Strategies
- **Gentle**: Keep 80% of buffer (high connection quality)
- **Moderate**: Keep 25% of buffer (standard cleanup)
- **Aggressive**: Keep 10% of buffer (poor connection quality)
- **Critical**: Keep 5% of buffer (emergency situations)

#### Adaptive Decision Making
The cleanup strategy is determined by:
- Current memory pressure level
- Connection quality assessment
- Historical cleanup patterns
- Buffer overflow frequency

```typescript
const bufferStats = manager.getBufferStats();
console.log('Memory Pressure:', bufferStats.memoryPressure);
console.log('Cleanup Cycles:', bufferStats.cleanupCycles);
console.log('Average Message Size:', bufferStats.averageMessageSize);
```

### 🔄 Intelligent Reconnection Logic

Enhanced reconnection system with smart decision making:

#### Exponential Backoff
- Starts with configurable base delay (default 500ms)
- Exponential increase: `delay = baseDelay * 2^(attempt-1)`
- Maximum delay cap to prevent excessive wait times
- Jitter addition to prevent thundering herd

#### Smart Reconnection Decisions
- **Normal closure (1000)**: No reconnection
- **Authentication errors**: No reconnection (not recoverable)
- **Protocol violations**: Configurable retry behavior
- **Network issues**: Always retry with backoff
- **Twilio-specific errors**: Retry with specialized handling

```typescript
// The manager automatically handles reconnection decisions
// based on error classification and close codes
manager.on('disconnected', (code, reason) => {
  // Reconnection logic is automatically triggered
  // based on intelligent assessment of the disconnection
});
```

### 🎯 Twilio Integration Optimizations

Specialized handling for Twilio Media Streams:

#### Message Validation
- **JSON Structure Validation**: Ensures proper Twilio message format
- **Size Limits**: Enforces Twilio's 64KB message size limit
- **Required Fields**: Validates presence of required Twilio fields

#### Protocol Compliance
- **No Compression**: Disables compression to prevent fragmentation
- **Complete Frames**: Ensures `fin: true` for all messages
- **Proper Masking**: Automatic masking for client connections

#### Twilio Error Handling
- Recognition of Twilio error codes (31924, 31951, 31003, etc.)
- Specialized recovery strategies for Twilio-specific issues
- Enhanced logging for Twilio debugging

```typescript
// Send Twilio-compliant messages with validation
const success = manager.sendTwilioMessage(JSON.stringify({
  event: 'start',
  start: { streamSid: 'ST123...' }
}));

// Binary audio data is also validated
const audioSuccess = manager.sendTwilioMessage(audioBuffer);
```

### 🎮 Health Monitoring

Continuous connection health assessment:

#### Ping/Pong Monitoring
- Configurable ping intervals
- Latency measurement and tracking
- Pong timeout detection
- Quality assessment based on latency

#### Heartbeat Management
- Message-based heartbeat tracking
- Configurable heartbeat intervals
- Miss detection and recovery
- Connection quality updates

#### Quality Grading
- **Excellent**: Latency < 100ms
- **Good**: Latency < 300ms  
- **Poor**: Latency >= 300ms or frequent misses
- **Failed**: Connection lost or critical errors

## Configuration Options

```typescript
interface ConnectionConfig {
  // Basic connection settings
  maxReconnectAttempts: number;     // Default: 5
  reconnectDelay: number;           // Default: 500ms
  heartbeatInterval: number;        // Default: 5000ms
  connectionTimeout: number;        // Default: 15000ms
  maxHeartbeatMisses: number;       // Default: 2
  pingInterval: number;             // Default: 10000ms
  pongTimeout: number;              // Default: 3000ms
  
  // RFC 6455 compliance options
  enableFrameValidation: boolean;   // Default: true
  strictProtocolCompliance: boolean; // Default: true
  maxFrameSize: number;             // Default: 64KB
  maxMessageSize: number;           // Default: 1MB
  
  // Enhanced error handling
  errorClassificationEnabled: boolean; // Default: true
  retryOnProtocolErrors: boolean;   // Default: false
}
```

## Usage Example

```typescript
import { EnhancedWebSocketManager } from './utils/enhancedWebSocketManager';

// Create manager with production configuration
const manager = new EnhancedWebSocketManager('call-123', 'wss://stream.twilio.com', {
  enableFrameValidation: true,
  strictProtocolCompliance: true,
  errorClassificationEnabled: true,
  maxReconnectAttempts: 5,
  heartbeatInterval: 15000
});

// Set up event handlers
manager.on('connected', () => {
  console.log('Connected with enhanced monitoring');
});

manager.on('error', ({ original, classified }) => {
  console.error(`${classified.type} error (${classified.severity}):`, classified.message);
});

manager.on('qualityChanged', (quality) => {
  console.log('Connection quality:', quality);
});

// Connect and start using
await manager.connect();

// Send Twilio messages with validation
manager.sendTwilioMessage(JSON.stringify({ event: 'start' }));

// Monitor metrics
const metrics = manager.getMetrics();
const bufferStats = manager.getBufferStats();
```

## Monitoring and Alerting

The enhanced metrics enable comprehensive monitoring:

### Key Metrics to Monitor
- `connectionQuality`: Overall connection health
- `protocolErrors`: Protocol violations requiring attention
- `frameValidationErrors`: Frame format issues
- `memoryPressure`: Buffer management health
- `reconnectAttempts`: Connection stability
- `connectionUptime`: Service availability

### Alerting Thresholds
- **Critical**: `connectionQuality === 'failed'`
- **Warning**: `protocolErrors > 10` or `memoryPressure === 'high'`
- **Info**: `reconnectAttempts > 3`

## Benefits

1. **Production Reliability**: Comprehensive error handling and recovery
2. **Twilio Compatibility**: Specialized handling for Twilio Media Streams
3. **Performance Monitoring**: Detailed metrics for optimization
4. **Memory Efficiency**: Adaptive buffer management prevents memory leaks
5. **Protocol Compliance**: Strict RFC 6455 adherence prevents issues
6. **Operational Visibility**: Rich logging and metrics for debugging

## Migration Guide

Existing code using the basic WebSocketManager can be migrated by:

1. **Update Imports**:
   ```typescript
   import { EnhancedWebSocketManager } from './utils/enhancedWebSocketManager';
   ```

2. **Add Configuration**:
   ```typescript
   const manager = new EnhancedWebSocketManager(callId, url, {
     enableFrameValidation: true,
     strictProtocolCompliance: true
   });
   ```

3. **Update Event Handlers**:
   ```typescript
   manager.on('error', ({ original, classified }) => {
     // Handle classified errors
   });
   ```

4. **Use Enhanced Methods**:
   ```typescript
   manager.sendTwilioMessage(data); // Instead of generic send()
   ```

The enhanced manager is backward compatible with existing event handlers while providing additional capabilities for production use.