/**
 * Twilio WebSocket Enhanced Integration - Usage Examples
 * 
 * This file demonstrates how to use the enhanced Twilio WebSocket integration
 * that prevents malformed message errors and provides robust connection management.
 */

import { TwilioWebSocketManager } from '../utils/TwilioWebSocketManager';
import { EnhancedWebSocketManager } from '../utils/enhancedWebSocketManager';
import WebSocket from 'ws';

/**
 * Example 1: Using the Enhanced Integration (Recommended)
 * 
 * This is the preferred method for new code that creates robust
 * WebSocket connections with automatic reconnection and protocol compliance.
 */
async function createEnhancedTwilioConnection() {
  try {
    // Create an enhanced connection - this handles all the complexity internally
    const twilioManager = await TwilioWebSocketManager.createEnhancedConnection(
      'call-123',           // Call ID for tracking
      'wss://stream.twilio.com/v1/stream', // Twilio WebSocket URL
      'connection-456'      // Optional connection ID
    );

    // Send audio data to Twilio - protocol compliance is handled automatically
    const audioBuffer = Buffer.from('audio data here');
    const success = twilioManager.sendAudioToTwilio(audioBuffer, 'stream-sid-789');
    
    if (success) {
      console.log('Audio sent successfully with protocol compliance');
    }

    // Send custom Twilio messages with automatic validation
    const customMessage = {
      event: 'start',
      streamSid: 'stream-sid-789',
      start: {
        mediaFormat: {
          encoding: 'audio/x-wav',
          sampleRate: 8000,
          channels: 1
        }
      }
    };

    const messageSuccess = twilioManager.sendTwilioMessage(customMessage);
    if (messageSuccess) {
      console.log('Custom message sent with proper framing');
    }

    return twilioManager;
  } catch (error) {
    console.error('Enhanced connection failed:', error);
    throw error;
  }
}

/**
 * Example 2: Backward Compatibility (Legacy Code Support)
 * 
 * This method supports existing code that already has WebSocket instances.
 * It wraps them with enhanced capabilities while maintaining the same API.
 */
function createLegacyCompatibleConnection() {
  // Existing code that creates a raw WebSocket
  const ws = new WebSocket('wss://stream.twilio.com/v1/stream');
  
  // Wrap it with enhanced capabilities (backward compatible)
  const twilioManager = TwilioWebSocketManager.fromWebSocket(ws, 'legacy-connection');
  
  // Use the same API as before, but with enhanced protocol compliance
  ws.on('open', () => {
    console.log('Legacy WebSocket opened with enhanced capabilities');
    
    // This now uses enhanced message validation and framing
    const testMessage = {
      event: 'media',
      streamSid: 'test-stream',
      media: {
        track: 'inbound',
        chunk: '1',
        timestamp: Date.now().toString(),
        payload: Buffer.from('test').toString('base64')
      }
    };
    
    twilioManager.sendTwilioMessage(testMessage);
  });

  return twilioManager;
}

/**
 * Example 3: Connection Health Monitoring
 * 
 * The enhanced integration provides comprehensive health monitoring
 * and automatic recovery capabilities.
 */
async function monitorConnectionHealth() {
  const twilioManager = await TwilioWebSocketManager.createEnhancedConnection(
    'monitored-call',
    'wss://stream.twilio.com/v1/stream'
  );

  // Monitor connection health
  setInterval(() => {
    const health = twilioManager.getConnectionHealth();
    console.log('Connection Health:', {
      isHealthy: health.isHealthy,
      quality: health.connectionQuality,
      latency: health.latency,
      errorCount: health.errorCount
    });

    // Get detailed metrics
    const heartbeatHealth = twilioManager.getHeartbeatHealth();
    console.log('Heartbeat Status:', {
      isAlive: twilioManager.isHeartbeatAlive(),
      quality: heartbeatHealth.quality,
      issues: heartbeatHealth.issues.length
    });

    // Check if reconnection is recommended
    const reconnectionDecision = twilioManager.getReconnectionDecision();
    if (reconnectionDecision.shouldReconnect) {
      console.log('Reconnection recommended:', reconnectionDecision.reason);
    }
  }, 10000); // Check every 10 seconds
}

/**
 * Example 4: Error Handling and Recovery
 * 
 * The enhanced integration provides robust error handling and
 * automatic recovery from connection issues.
 */
async function handleConnectionErrors() {
  const twilioManager = await TwilioWebSocketManager.createEnhancedConnection(
    'error-handling-call',
    'wss://stream.twilio.com/v1/stream'
  );

  // Set up error event handlers
  twilioManager.getEnhancedManager().on('error', (error) => {
    console.error('Enhanced WebSocket error:', error);
    
    // The enhanced manager will automatically attempt reconnection
    // based on its configuration and health assessment
  });

  twilioManager.getEnhancedManager().on('reconnecting', (attempt) => {
    console.log(`Attempting reconnection #${attempt}`);
  });

  twilioManager.getEnhancedManager().on('connected', () => {
    console.log('Connection restored successfully');
  });

  // Manual reconnection if needed
  if (!twilioManager.getConnectionHealth().isHealthy) {
    const success = await twilioManager.attemptIntelligentReconnection(
      async () => {
        // Custom reconnection logic if needed
        console.log('Executing custom reconnection logic');
      },
      'Manual reconnection attempt'
    );

    if (success) {
      console.log('Manual reconnection successful');
    }
  }
}

/**
 * Example 5: Protocol Compliance Testing
 * 
 * Test various message formats to ensure protocol compliance.
 */
function testProtocolCompliance() {
  const mockWebSocket = {
    readyState: WebSocket.OPEN,
    send: (data, options) => {
      console.log('Sent with options:', {
        dataType: typeof data,
        binary: options?.binary,
        compress: options?.compress,
        fin: options?.fin
      });
    }
  } as any;

  const enhancedManager = new EnhancedWebSocketManager('test-call', 'ws://test');
  (enhancedManager as any).ws = mockWebSocket;
  (enhancedManager as any).metrics.activeConnections = 1;

  // Test valid JSON message
  const validJson = JSON.stringify({ event: 'test', data: 'valid' });
  console.log('Valid JSON result:', enhancedManager.sendTwilioMessage(validJson));

  // Test invalid JSON (should fail)
  const invalidJson = '{ invalid json }';
  console.log('Invalid JSON result:', enhancedManager.sendTwilioMessage(invalidJson));

  // Test oversized message (should fail)
  const oversizedMessage = JSON.stringify({ 
    event: 'test', 
    data: 'x'.repeat(70000) // Over 64KB limit
  });
  console.log('Oversized message result:', enhancedManager.sendTwilioMessage(oversizedMessage));

  // Test binary data
  const binaryData = Buffer.from('binary audio data');
  console.log('Binary data result:', enhancedManager.sendTwilioMessage(binaryData));
}

/**
 * Migration Guide for Existing Code
 * 
 * If you have existing Twilio WebSocket code, here's how to migrate:
 */

// OLD CODE:
// const ws = new WebSocket('wss://stream.twilio.com/v1/stream');
// const twilioManager = new TwilioWebSocketManager(ws);

// NEW ENHANCED CODE (Option 1 - Recommended):
// const twilioManager = await TwilioWebSocketManager.createEnhancedConnection(
//   callId, 
//   'wss://stream.twilio.com/v1/stream'
// );

// NEW ENHANCED CODE (Option 2 - Backward Compatible):
// const ws = new WebSocket('wss://stream.twilio.com/v1/stream');
// const twilioManager = TwilioWebSocketManager.fromWebSocket(ws);

export {
  createEnhancedTwilioConnection,
  createLegacyCompatibleConnection,
  monitorConnectionHealth,
  handleConnectionErrors,
  testProtocolCompliance
};