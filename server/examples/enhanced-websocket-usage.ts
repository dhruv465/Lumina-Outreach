/**
 * Enhanced WebSocket Manager Usage Example
 * 
 * Demonstrates how to use the new RFC 6455 compliant EnhancedWebSocketManager
 * with production-level monitoring and error handling capabilities.
 */

import { EnhancedWebSocketManager, ErrorType } from '../src/utils/enhancedWebSocketManager';

// Example usage of EnhancedWebSocketManager with Twilio integration
export class TwilioCallManager {
  private websocketManager: EnhancedWebSocketManager;
  private callId: string;
  
  constructor(callId: string, streamUrl: string) {
    this.callId = callId;
    
    // Initialize with production-ready configuration
    this.websocketManager = new EnhancedWebSocketManager(callId, streamUrl, {
      // RFC 6455 Compliance
      enableFrameValidation: true,
      strictProtocolCompliance: true,
      maxFrameSize: 64 * 1024, // 64KB for Twilio compatibility
      maxMessageSize: 1024 * 1024, // 1MB max message
      
      // Enhanced Error Handling
      errorClassificationEnabled: true,
      retryOnProtocolErrors: false, // Don't retry protocol violations
      
      // Connection Resilience
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 15000, // Frequent heartbeats for real-time audio
      connectionTimeout: 10000,
      maxHeartbeatMisses: 3,
      
      // Ping/Pong Monitoring
      pingInterval: 20000,
      pongTimeout: 5000
    });
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // Connection events
    this.websocketManager.on('connected', () => {
      console.log(`Call ${this.callId}: WebSocket connected with enhanced monitoring`);
      this.logConnectionMetrics();
    });
    
    this.websocketManager.on('disconnected', (code: number, reason: string) => {
      console.log(`Call ${this.callId}: WebSocket disconnected - Code: ${code}, Reason: ${reason}`);
      this.logConnectionMetrics();
    });
    
    // Enhanced error handling with classification
    this.websocketManager.on('error', ({ original, classified }) => {
      console.error(`Call ${this.callId}: Classified error:`, {
        type: classified.type,
        severity: classified.severity,
        recoverable: classified.recoverable,
        message: classified.message
      });
      
      this.handleClassifiedError(classified);
    });
    
    // Connection quality monitoring
    this.websocketManager.on('qualityChanged', (quality: string) => {
      console.log(`Call ${this.callId}: Connection quality changed to: ${quality}`);
      
      if (quality === 'poor' || quality === 'failed') {
        this.handlePoorConnectionQuality();
      }
    });
    
    // Message handling
    this.websocketManager.on('message', (data: any) => {
      this.handleIncomingMessage(data);
    });
  }
  
  public async startCall(): Promise<void> {
    try {
      await this.websocketManager.connect();
      
      // Send Twilio stream start message
      const startMessage = {
        event: 'start',
        sequenceNumber: 1,
        start: {
          streamSid: this.callId,
          accountSid: process.env.TWILIO_ACCOUNT_SID,
          tracks: ['inbound', 'outbound']
        }
      };
      
      const success = this.websocketManager.sendTwilioMessage(JSON.stringify(startMessage));
      if (!success) {
        throw new Error('Failed to send start message');
      }
      
      console.log(`Call ${this.callId}: Stream started successfully`);
    } catch (error) {
      console.error(`Call ${this.callId}: Failed to start call:`, error);
      throw error;
    }
  }
  
  public sendAudioData(audioBuffer: Buffer): boolean {
    // Send binary audio data with validation
    return this.websocketManager.sendTwilioMessage(audioBuffer);
  }
  
  public sendControlMessage(event: string, data: any): boolean {
    const message = {
      event,
      sequenceNumber: Date.now(),
      [event]: data
    };
    
    return this.websocketManager.sendTwilioMessage(JSON.stringify(message));
  }
  
  private handleIncomingMessage(data: any): void {
    try {
      if (Buffer.isBuffer(data)) {
        // Handle incoming audio data
        console.log(`Call ${this.callId}: Received audio data: ${data.length} bytes`);
        this.processAudioData(data);
      } else {
        // Handle control messages
        const message = JSON.parse(data.toString());
        console.log(`Call ${this.callId}: Received control message:`, message.event);
        this.processControlMessage(message);
      }
    } catch (error) {
      console.error(`Call ${this.callId}: Error processing message:`, error);
    }
  }
  
  private handleClassifiedError(error: any): void {
    switch (error.type) {
      case ErrorType.TWILIO_SPECIFIC:
        console.warn(`Call ${this.callId}: Twilio-specific error detected, checking for reconnection`);
        if (error.recoverable) {
          // Let the manager handle reconnection
          console.log(`Call ${this.callId}: Error is recoverable, awaiting reconnection`);
        }
        break;
        
      case ErrorType.PROTOCOL:
        console.error(`Call ${this.callId}: Protocol violation detected - may need manual intervention`);
        if (error.severity === 'critical') {
          this.escalateError(error);
        }
        break;
        
      case ErrorType.NETWORK:
        console.warn(`Call ${this.callId}: Network issue detected, monitoring for recovery`);
        break;
        
      case ErrorType.BUFFER_OVERFLOW:
        console.warn(`Call ${this.callId}: Buffer overflow detected, adaptive cleanup in progress`);
        break;
        
      default:
        console.log(`Call ${this.callId}: Unclassified error:`, error.message);
    }
  }
  
  private handlePoorConnectionQuality(): void {
    console.warn(`Call ${this.callId}: Poor connection quality detected`);
    
    // Get detailed metrics for analysis
    const metrics = this.websocketManager.getMetrics();
    const bufferStats = this.websocketManager.getBufferStats();
    
    console.log(`Call ${this.callId}: Connection metrics:`, {
      latency: metrics.latency,
      heartbeatMisses: metrics.heartbeatMisses,
      errorCount: metrics.errorCount,
      protocolErrors: metrics.protocolErrors,
      memoryPressure: bufferStats.memoryPressure
    });
    
    // Implement quality-based adaptive measures
    if (bufferStats.memoryPressure === 'high' || bufferStats.memoryPressure === 'critical') {
      console.log(`Call ${this.callId}: High memory pressure detected, reducing buffer usage`);
    }
  }
  
  private processAudioData(audioBuffer: Buffer): void {
    // Process incoming audio data
    console.log(`Call ${this.callId}: Processing ${audioBuffer.length} bytes of audio data`);
    
    // Check buffer stats periodically
    const bufferStats = this.websocketManager.getBufferStats();
    if (bufferStats.memoryPressure !== 'low') {
      console.log(`Call ${this.callId}: Memory pressure: ${bufferStats.memoryPressure}, cleanups: ${bufferStats.cleanupCycles}`);
    }
  }
  
  private processControlMessage(message: any): void {
    console.log(`Call ${this.callId}: Processing control message:`, message.event);
    
    switch (message.event) {
      case 'stop':
        console.log(`Call ${this.callId}: Received stop event, ending call`);
        this.endCall();
        break;
        
      case 'error':
        console.error(`Call ${this.callId}: Received error event:`, message.error);
        break;
        
      default:
        console.log(`Call ${this.callId}: Unknown control message:`, message.event);
    }
  }
  
  private escalateError(error: any): void {
    console.error(`Call ${this.callId}: Critical error requiring escalation:`, error);
    
    // Log comprehensive diagnostics
    const metrics = this.websocketManager.getMetrics();
    const bufferStats = this.websocketManager.getBufferStats();
    
    console.error(`Call ${this.callId}: Error diagnostics:`, {
      connectionUptime: metrics.connectionUptime,
      totalErrors: metrics.errorCount,
      protocolErrors: metrics.protocolErrors,
      frameValidationErrors: metrics.frameValidationErrors,
      bufferOverflows: bufferStats.overflowCount,
      lastDisconnection: metrics.disconnectionReason
    });
  }
  
  private logConnectionMetrics(): void {
    const metrics = this.websocketManager.getMetrics();
    const bufferStats = this.websocketManager.getBufferStats();
    
    console.log(`Call ${this.callId}: Connection metrics:`, {
      quality: metrics.connectionQuality,
      uptime: metrics.connectionUptime,
      messagesSent: metrics.messagesSent,
      messagesReceived: metrics.messagesReceived,
      bytesSent: metrics.bytesSent,
      bytesReceived: metrics.bytesReceived,
      latency: metrics.latency,
      bufferSize: bufferStats.size,
      memoryPressure: bufferStats.memoryPressure
    });
  }
  
  public endCall(): void {
    console.log(`Call ${this.callId}: Ending call and cleaning up resources`);
    
    // Send stop message if connected
    if (this.websocketManager.isConnected()) {
      this.sendControlMessage('stop', { reason: 'call_ended' });
    }
    
    // Log final metrics
    this.logConnectionMetrics();
    
    // Gracefully close connection
    this.websocketManager.close();
  }
  
  public getCallMetrics() {
    return {
      connection: this.websocketManager.getMetrics(),
      buffer: this.websocketManager.getBufferStats()
    };
  }
}

// Example usage
export async function exampleUsage(): Promise<void> {
  const callManager = new TwilioCallManager('call-123', 'wss://stream.twilio.com/v1/stream');
  
  try {
    await callManager.startCall();
    
    // Simulate sending audio data
    const audioData = Buffer.from('simulated audio data');
    callManager.sendAudioData(audioData);
    
    // Send control messages
    callManager.sendControlMessage('mark', { name: 'speech_start' });
    
    // Get call metrics for monitoring
    const metrics = callManager.getCallMetrics();
    console.log('Call metrics:', metrics);
    
  } catch (error) {
    console.error('Call failed:', error);
  } finally {
    callManager.endCall();
  }
}