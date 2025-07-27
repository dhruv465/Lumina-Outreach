# AudioProcessingPipelineManager - Enhanced Timeout and Error Handling

## Overview

This document describes the enhanced timeout and error handling capabilities added to the AudioProcessingPipelineManager as part of task 5.2. The enhancements specifically address Twilio WebSocket protocol compliance requirements and provide comprehensive error recovery mechanisms.

## Requirements Addressed

- **Requirement 3.2**: WHEN WebSocket control frame fragmentation is detected THEN the system SHALL reconstruct frames properly before transmission
- **Requirement 3.4**: WHEN Twilio WebSocket protocol violations occur THEN the system SHALL handle them without crashing the call session  
- **Requirement 2.2**: WHEN Twilio protocol errors are detected THEN the system SHALL log detailed error information including Twilio error codes and SIDs

## Key Features

### 1. Configurable Processing Timeouts

The `configureProcessingTimeouts()` method allows fine-grained control over timeout settings for each processing stage:

```typescript
pipelineManager.configureProcessingTimeouts({
  speech_to_text: {
    timeout: 10000,
    maxRetries: 3,
    recoveryStrategy: 'exponential_backoff',
    twilioCompliant: true
  },
  llm_processing: {
    timeout: 25000,
    maxRetries: 2,
    recoveryStrategy: 'circuit_breaker',
    twilioCompliant: true
  }
});
```

**Twilio-Specific Optimizations:**
- Gentler backoff multiplier (1.5 vs 2.0) for Twilio compliance
- Shorter maximum backoff delay (15s vs 30s) for faster recovery
- Lower critical threshold (30s vs 60s) for earlier escalation

### 2. Twilio Protocol Error Handling

The `handleTwilioProcessingError()` method provides specialized handling for Twilio WebSocket protocol errors:

```typescript
const result = await pipelineManager.handleTwilioProcessingError(
  'session123',
  'websocket_send',
  error,
  {
    callSid: 'CA1234567890abcdef1234567890abcdef',
    streamSid: 'MZ1234567890abcdef1234567890abcdef',
    errorCode: 'WEBSOCKET_PROTOCOL_ERROR',
    errorMessage: 'The WebSocket control frame was fragmented',
    protocolViolation: true,
    frameFragmented: true
  }
);
```

**Features:**
- Detailed logging with Twilio error codes and SIDs (Requirement 2.2)
- Frame fragmentation detection and reconstruction events (Requirement 3.2)
- Protocol violation handling without session crashes (Requirement 3.4)
- Enhanced user feedback with Twilio-specific context

### 3. Custom Recovery Mechanisms

The `createTimeoutRecoveryMechanism()` method allows custom recovery logic for specific processing stages:

```typescript
pipelineManager.createTimeoutRecoveryMechanism('llm_processing', {
  onTimeout: async (context) => {
    // Custom timeout recovery logic
    return {
      success: true,
      message: 'Custom timeout recovery executed'
    };
  },
  onError: async (error) => {
    // Custom error recovery logic
    return {
      success: true,
      message: 'Custom error recovery executed'
    };
  }
});
```

### 4. Error Classification System

The `classifyProcessingError()` method provides intelligent error classification:

```typescript
const classification = pipelineManager.classifyProcessingError(error, stage, context);
// Returns:
// {
//   type: 'protocol_error' | 'timeout' | 'network_error' | ...,
//   severity: 'low' | 'medium' | 'high' | 'critical',
//   recoverable: boolean,
//   twilioSpecific: boolean,
//   requiresProtocolFix: boolean
// }
```

**Error Types:**
- `protocol_error`: Twilio WebSocket protocol violations
- `timeout`: Processing timeouts
- `network_error`: Connection issues
- `rate_limit`: Rate limiting errors
- `resource_exhaustion`: Memory/CPU issues
- `authentication_error`: Auth failures
- `validation_error`: Input validation errors

### 5. Recovery Strategy Execution

The `executeErrorRecoveryStrategy()` method implements various recovery strategies:

**Available Strategies:**
- `immediate_retry`: Retry immediately without delay
- `exponential_backoff`: Retry with exponentially increasing delays
- `circuit_breaker`: Prevent cascading failures
- `fallback_service`: Use alternative service
- `graceful_degradation`: Continue with reduced functionality
- `user_notification`: Notify user with guidance
- `session_reset`: Reset the session to recover

```typescript
const result = await pipelineManager.executeErrorRecoveryStrategy(
  error,
  'exponential_backoff',
  context
);
```

## Event System

The enhanced pipeline manager emits several new events for monitoring and integration:

### Frame Fragmentation Detection (Requirement 3.2)
```typescript
pipelineManager.on('frameFragmentationDetected', (event) => {
  console.log('Frame fragmentation detected:', event.sessionId);
  // Trigger frame reconstruction logic
});
```

### Protocol Violation Detection (Requirement 3.4)
```typescript
pipelineManager.on('protocolViolationDetected', (event) => {
  console.log('Protocol violation:', event.errorCode);
  // Handle without crashing session
});
```

### Custom Recovery Execution
```typescript
pipelineManager.on('customRecoveryExecuted', (event) => {
  console.log('Custom recovery completed:', event.result);
});
```

### Recovery Strategy Execution
```typescript
pipelineManager.on('recoveryStrategyExecuted', (event) => {
  console.log('Recovery strategy:', event.strategy, 'Result:', event.result);
});
```

### Session Reset Required
```typescript
pipelineManager.on('sessionResetRequired', (event) => {
  console.log('Session reset required for:', event.sessionId);
  // Initiate session reset
});
```

## User Feedback System

The enhanced error handling provides rich user feedback:

```typescript
interface UserFeedback {
  type: 'notification' | 'progress' | 'error' | 'recovery';
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  actionRequired: boolean;
  suggestedActions?: string[];
  estimatedResolutionTime?: number;
  progressPercentage?: number;
}
```

**Twilio-Enhanced Feedback:**
- Call ID references for support
- Error code information
- Protocol compliance status
- Frame reconstruction notifications

## Integration with Existing Timeout Handler

The enhancements seamlessly integrate with the existing `AudioProcessingTimeoutHandler`:

```typescript
// Access timeout handler for advanced configuration
const timeoutHandler = pipelineManager.getTimeoutHandler();

// Get timeout metrics
const metrics = pipelineManager.getTimeoutMetrics();

// Get session error history
const history = pipelineManager.getSessionErrorHistory('session123', 10);
```

## Usage Examples

### Basic Timeout Configuration
```typescript
// Configure timeouts for Twilio compliance
pipelineManager.configureProcessingTimeouts({
  websocket_send: {
    timeout: 5000,
    maxRetries: 3,
    recoveryStrategy: 'immediate_retry',
    twilioCompliant: true
  },
  websocket_receive: {
    timeout: 10000,
    maxRetries: 2,
    recoveryStrategy: 'session_reset',
    twilioCompliant: true
  }
});
```

### Handling Twilio Errors
```typescript
try {
  // Some WebSocket operation
} catch (error) {
  const result = await pipelineManager.handleTwilioProcessingError(
    sessionId,
    'websocket_send',
    error,
    {
      callSid: twilioCallSid,
      streamSid: twilioStreamSid,
      errorCode: 'WEBSOCKET_PROTOCOL_ERROR',
      protocolViolation: true,
      frameFragmented: true
    }
  );
  
  if (result.userFeedback) {
    // Display feedback to user
    showUserFeedback(result.userFeedback);
  }
}
```

### Custom Recovery Logic
```typescript
pipelineManager.createTimeoutRecoveryMechanism('llm_processing', {
  onTimeout: async (context) => {
    // Try alternative LLM provider
    const result = await tryAlternativeLLM(context);
    return {
      success: result.success,
      message: 'Switched to backup LLM provider',
      fallbackUsed: true
    };
  }
});
```

## Testing

The implementation includes comprehensive tests covering:

- Error classification for Twilio-specific errors
- Recovery strategy execution
- Timeout configuration with Twilio compliance
- User feedback enhancement
- Event emission for frame fragmentation and protocol violations

Run tests with:
```bash
npm test -- --testPathPattern="AudioProcessingPipelineManager.timeout.simple.test.ts"
```

## Performance Considerations

- **Memory Management**: Error history is automatically cleaned up to prevent memory leaks
- **CPU Usage**: Recovery strategies are designed to be lightweight and non-blocking
- **Network Efficiency**: Twilio-specific optimizations reduce unnecessary retries
- **Scalability**: Event-driven architecture supports multiple concurrent sessions

## Monitoring and Observability

The enhanced system provides detailed metrics and logging:

- Timeout occurrences by stage and error type
- Recovery success/failure rates
- User notification counts
- Processing time distributions
- Twilio-specific error patterns

## Future Enhancements

Potential areas for future improvement:

1. **Machine Learning**: Predictive error detection based on patterns
2. **Advanced Circuit Breakers**: Per-session circuit breaker states
3. **Dynamic Timeout Adjustment**: AI-driven timeout optimization
4. **Enhanced Fallback Services**: Multiple fallback service tiers
5. **Real-time Monitoring Dashboard**: Visual monitoring of error patterns

## Conclusion

The enhanced timeout and error handling system provides robust, Twilio-compliant error recovery mechanisms that ensure stable WebSocket connections and graceful handling of protocol violations. The system is designed to be extensible, observable, and maintainable while providing excellent user experience during error conditions.