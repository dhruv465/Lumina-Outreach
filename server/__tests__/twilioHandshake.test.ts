/**
 * Tests for Twilio WebSocket handshake sequence and protocol compliance
 */

// Mock the logger module first with all required methods
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock the resilience service
jest.mock('../src/services/callResilienceService', () => ({
  getCallResilienceService: () => ({
    registerCall: jest.fn(),
    updateHeartbeat: jest.fn(),
    reportError: jest.fn(),
    emit: jest.fn()
  })
}));

import { EnhancedWebSocketManager, TwilioProtocolState } from '../src/utils/enhancedWebSocketManager';

// Mock WebSocket to test handshake logic without actual network connections
class MockWebSocket {
  public static OPEN = 1;
  public static CLOSED = 3;
  public readyState = MockWebSocket.OPEN;
  public sentMessages: any[] = [];

  send(data: any, options?: any) {
    this.sentMessages.push({ data, options });
  }

  terminate() {
    this.readyState = MockWebSocket.CLOSED;
  }

  on(event: string, handler: Function) {
    // Store handlers for testing
  }
}

describe('Twilio WebSocket Handshake', () => {
  let manager: EnhancedWebSocketManager;
  
  beforeEach(() => {
    jest.clearAllMocks();
    manager = new EnhancedWebSocketManager('test-call-123', 'wss://example.com/voice/stream');
    
    // Replace the internal WebSocket with mock
    (manager as any).ws = new MockWebSocket();
  });

  describe('URL Normalization', () => {
    it('should normalize URLs to prevent path duplication', () => {
      const testCases = [
        {
          input: 'wss://example.com/voice/stream/.websocket',
          expected: 'wss://example.com/voice/stream'
        },
        {
          input: 'wss://example.com/voice/stream.websocket',
          expected: 'wss://example.com/voice/stream'
        },
        {
          input: 'wss://example.com//voice//stream',
          expected: 'wss://example.com/voice/stream'
        },
        {
          input: 'wss://example.com/voice/stream',
          expected: 'wss://example.com/voice/stream'
        }
      ];

      testCases.forEach(({ input, expected }) => {
        const normalizedManager = new EnhancedWebSocketManager('test-call', input);
        expect((normalizedManager as any).url).toBe(expected);
      });
    });
  });

  describe('Protocol State Initialization', () => {
    it('should initialize Twilio protocol state correctly', () => {
      const protocolState: TwilioProtocolState = manager.getTwilioProtocolState();
      
      expect(protocolState.receivedConnected).toBe(false);
      expect(protocolState.receivedStart).toBe(false);
      expect(protocolState.sentConnectedAck).toBe(false);
      expect(protocolState.hasStreamSid).toBe(false);
      expect(protocolState.messageCount).toBe(0);
      expect(protocolState.protocolCompliant).toBe(true);
      expect(protocolState.complianceScore).toBe(100);
      expect(protocolState.protocolErrors).toHaveLength(0);
      expect(protocolState.recoveryState).toBe('stable');
    });
  });

  describe('Handshake Sequence', () => {
    it('should handle connected message and send connected_ack', () => {
      const connectedMessage = JSON.stringify({ event: 'connected' });
      
      // Simulate receiving a connected message
      (manager as any).handleTextMessage(connectedMessage);
      
      // Check protocol state was updated
      const protocolState = manager.getTwilioProtocolState();
      expect(protocolState.receivedConnected).toBe(true);
      expect(protocolState.connectedEventTime).toBeDefined();
      
      // Check connected_ack was sent
      const mockWs = (manager as any).ws as MockWebSocket;
      expect(mockWs.sentMessages).toHaveLength(1);
      
      const sentMessage = JSON.parse(mockWs.sentMessages[0].data);
      expect(sentMessage.event).toBe('connected_ack');
      
      // Check protocol state reflects sent ack
      expect(protocolState.sentConnectedAck).toBe(true);
      expect(protocolState.connectedAckTime).toBeDefined();
    });

    it('should handle start message and validate handshake completion', () => {
      const connectedMessage = JSON.stringify({ event: 'connected' });
      const startMessage = JSON.stringify({
        event: 'start',
        start: { streamSid: 'MZ123456789abcdef' }
      });
      
      // Simulate handshake sequence
      (manager as any).handleTextMessage(connectedMessage);
      (manager as any).handleTextMessage(startMessage);
      
      // Check protocol state
      const protocolState = manager.getTwilioProtocolState();
      expect(protocolState.receivedStart).toBe(true);
      expect(protocolState.hasStreamSid).toBe(true);
      expect(protocolState.startEventTime).toBeDefined();
    });

    it('should track message count and sequence', () => {
      const messages = [
        JSON.stringify({ event: 'connected' }),
        JSON.stringify({ event: 'start', start: { streamSid: 'test' } }),
        JSON.stringify({ event: 'media', media: { payload: 'test' } })
      ];
      
      messages.forEach(msg => (manager as any).handleTextMessage(msg));
      
      const protocolState = manager.getTwilioProtocolState();
      expect(protocolState.messageCount).toBe(3);
      expect(protocolState.lastMessageTimestamp).toBeGreaterThan(0);
    });
  });

  describe('Control Frame Handling', () => {
    it('should prevent fragmentation of control frames', () => {
      const controlMessage = JSON.stringify({ event: 'connected_ack' });
      const result = manager.sendTwilioMessage(controlMessage);
      
      expect(result).toBe(true);
      
      const mockWs = (manager as any).ws as MockWebSocket;
      const sentMessage = mockWs.sentMessages[0];
      
      // Verify control frame options
      expect(sentMessage.options.compress).toBe(false);
      expect(sentMessage.options.fin).toBe(true);
      expect(sentMessage.options.binary).toBe(false);
    });

    it('should enforce size limits for control frames', () => {
      // Create a large control message that exceeds 1KB limit
      const largeMessage = JSON.stringify({
        event: 'connected_ack',
        data: 'x'.repeat(2000) // 2KB of data
      });
      
      const result = manager.sendTwilioMessage(largeMessage);
      expect(result).toBe(false);
    });
  });

  describe('Protocol Compliance Scoring', () => {
    it('should maintain perfect compliance score with proper handshake', () => {
      // Complete proper handshake
      (manager as any).handleTextMessage(JSON.stringify({ event: 'connected' }));
      (manager as any).handleTextMessage(JSON.stringify({ 
        event: 'start', 
        start: { streamSid: 'test' } 
      }));
      
      const protocolState = manager.getTwilioProtocolState();
      expect(protocolState.complianceScore).toBe(100);
      expect(protocolState.protocolCompliant).toBe(true);
    });

    it('should reduce compliance score with protocol errors', () => {
      const initialState = manager.getTwilioProtocolState();
      expect(initialState.complianceScore).toBe(100);
      
      // Add protocol errors by accessing private method
      (manager as any).twilioProtocolState.protocolErrors.push('Test error');
      (manager as any).calculateProtocolComplianceScore();
      
      const updatedState = manager.getTwilioProtocolState();
      expect(updatedState.complianceScore).toBeLessThan(100);
    });
  });
});