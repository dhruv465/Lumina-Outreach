/**
 * Unit tests for SessionAwareSocketHandler
 */

import { SessionAwareSocketHandler, SessionState, SocketBinding } from '../SessionAwareSocketHandler';
import { TwilioWebSocketManager } from '../TwilioWebSocketManager';
import { EventEmitter } from 'events';

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  public readyState = 1; // WebSocket.OPEN
  public sentMessages: any[] = [];

  send(data: any) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit('close', code || 1000, Buffer.from(reason || ''));
  }

  simulateMessage(data: Buffer) {
    this.emit('message', data);
  }

  simulateError(error: Error) {
    this.emit('error', error);
  }
}

// Mock TwilioWebSocketManager
class MockTwilioWebSocketManager extends EventEmitter {
  public connectionHealth = { isHealthy: true };

  getConnectionHealth() {
    return this.connectionHealth;
  }

  simulateConnectionDead() {
    this.emit('connectionDead');
  }
}

describe('SessionAwareSocketHandler', () => {
  let sessionHandler: SessionAwareSocketHandler;
  let mockSocket: MockWebSocket;
  let mockTwilioManager: MockTwilioWebSocketManager;

  beforeEach(() => {
    sessionHandler = new SessionAwareSocketHandler({
      maxSessions: 100,
      sessionTimeout: 60000, // 1 minute for faster tests
      cleanupInterval: 1000,  // 1 second for faster tests
      maxMessageHistory: 10
    });

    mockSocket = new MockWebSocket();
    mockTwilioManager = new MockTwilioWebSocketManager();
  });

  afterEach(() => {
    sessionHandler.stop();
  });

  describe('Session Creation', () => {
    it('should create a new session', () => {
      const sessionId = 'test-session-1';
      const callId = 'call-123';
      const conversationId = 'conv-456';

      const session = sessionHandler.createSession(sessionId, callId, conversationId, {
        userId: 'user-789',
        isPersistent: true
      });

      expect(session.sessionId).toBe(sessionId);
      expect(session.callId).toBe(callId);
      expect(session.conversationId).toBe(conversationId);
      expect(session.userId).toBe('user-789');
      expect(session.isPersistent).toBe(true);
      expect(session.connectionCount).toBe(0);
      expect(session.messageHistory).toEqual([]);
    });

    it('should return existing session if already exists', () => {
      const sessionId = 'test-session-2';
      const callId = 'call-123';
      const conversationId = 'conv-456';

      const session1 = sessionHandler.createSession(sessionId, callId, conversationId);
      const session2 = sessionHandler.createSession(sessionId, callId, conversationId);

      expect(session1).toBe(session2);
    });

    it('should emit session created event', (done) => {
      sessionHandler.on('session_created', (event) => {
        expect(event.sessionId).toBe('test-session-3');
        expect(event.data.callId).toBe('call-123');
        done();
      });

      sessionHandler.createSession('test-session-3', 'call-123', 'conv-456');
    });
  });

  describe('Session Binding', () => {
    let session: SessionState;

    beforeEach(() => {
      session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
    });

    it('should bind socket to session', () => {
      const success = sessionHandler.bindSession(
        mockSocket as any,
        mockTwilioManager as any,
        session.sessionId
      );

      expect(success).toBe(true);
      expect(session.currentSocketId).toBeDefined();
      expect(session.connectionCount).toBe(1);
      expect(session.connectionHealth.totalConnections).toBe(1);
    });

    it('should not bind socket to non-existent session', () => {
      const success = sessionHandler.bindSession(
        mockSocket as any,
        mockTwilioManager as any,
        'non-existent-session'
      );

      expect(success).toBe(false);
    });

    it('should unbind existing socket when binding new one', () => {
      const socket1 = new MockWebSocket();
      const socket2 = new MockWebSocket();

      // Bind first socket
      sessionHandler.bindSession(socket1 as any, mockTwilioManager as any, session.sessionId);
      const firstSocketId = session.currentSocketId;

      // Bind second socket
      sessionHandler.bindSession(socket2 as any, mockTwilioManager as any, session.sessionId);
      const secondSocketId = session.currentSocketId;

      expect(firstSocketId).not.toBe(secondSocketId);
      expect(session.connectionCount).toBe(2);
    });

    it('should emit session bound event', (done) => {
      sessionHandler.on('session_bound', (event) => {
        expect(event.sessionId).toBe(session.sessionId);
        expect(event.data.connectionCount).toBe(1);
        done();
      });

      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);
    });
  });

  describe('Session Unbinding', () => {
    let session: SessionState;

    beforeEach(() => {
      session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);
    });

    it('should unbind session from socket', () => {
      const success = sessionHandler.unbindSession(session.sessionId);

      expect(success).toBe(true);
      expect(session.currentSocketId).toBeUndefined();
    });

    it('should calculate connection duration on unbind', () => {
      const bindTime = Date.now();
      
      setTimeout(() => {
        sessionHandler.unbindSession(session.sessionId);
        expect(session.connectionHealth.averageConnectionDuration).toBeGreaterThan(0);
      }, 10);
    });

    it('should emit session unbound event', (done) => {
      sessionHandler.on('session_unbound', (event) => {
        expect(event.sessionId).toBe(session.sessionId);
        expect(event.data.duration).toBeGreaterThan(0);
        done();
      });

      setTimeout(() => {
        sessionHandler.unbindSession(session.sessionId);
      }, 10);
    });
  });

  describe('Session Retrieval', () => {
    let session: SessionState;

    beforeEach(() => {
      session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);
    });

    it('should get session by ID', () => {
      const retrievedSession = sessionHandler.getSession(session.sessionId);
      expect(retrievedSession).toBe(session);
    });

    it('should get session by socket', () => {
      const retrievedSession = sessionHandler.getSessionBySocket(mockSocket as any);
      expect(retrievedSession).toBe(session);
    });

    it('should get socket binding for session', () => {
      const binding = sessionHandler.getSessionSocket(session.sessionId);
      expect(binding).toBeDefined();
      expect(binding!.socket).toBe(mockSocket);
      expect(binding!.sessionId).toBe(session.sessionId);
    });

    it('should return undefined for non-existent session', () => {
      const retrievedSession = sessionHandler.getSession('non-existent');
      expect(retrievedSession).toBeUndefined();
    });
  });

  describe('Session State Management', () => {
    let session: SessionState;

    beforeEach(() => {
      session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
    });

    it('should update session state', () => {
      const success = sessionHandler.updateSessionState(session.sessionId, {
        streamSid: 'stream-123',
        conversationContext: { key: 'value' }
      });

      expect(success).toBe(true);
      expect(session.streamSid).toBe('stream-123');
      expect(session.conversationContext.key).toBe('value');
    });

    it('should add message to session history', () => {
      const success = sessionHandler.addSessionMessage(session.sessionId, {
        type: 'user',
        content: 'Hello, world!',
        metadata: { source: 'test' }
      });

      expect(success).toBe(true);
      expect(session.messageHistory.length).toBe(1);
      expect(session.messageHistory[0].content).toBe('Hello, world!');
      expect(session.messageHistory[0].type).toBe('user');
      expect(session.messageHistory[0].id).toBeDefined();
      expect(session.messageHistory[0].timestamp).toBeInstanceOf(Date);
    });

    it('should trim message history when limit exceeded', () => {
      // Add messages beyond the limit (10)
      for (let i = 0; i < 15; i++) {
        sessionHandler.addSessionMessage(session.sessionId, {
          type: 'user',
          content: `Message ${i}`
        });
      }

      expect(session.messageHistory.length).toBe(10);
      expect(session.messageHistory[0].content).toBe('Message 5'); // First 5 should be trimmed
    });
  });

  describe('Session Recovery', () => {
    let session: SessionState;

    beforeEach(() => {
      session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      session.streamSid = 'stream-123';
      session.audioSequence = 42;
      session.conversationContext = { important: 'data' };
    });

    it('should prepare session for recovery', () => {
      const success = sessionHandler.prepareSessionRecovery(session.sessionId);

      expect(success).toBe(true);
      expect(session.recoveryData).toBeDefined();
      expect(session.recoveryData!.lastKnownState.streamSid).toBe('stream-123');
      expect(session.recoveryData!.lastKnownState.audioSequence).toBe(42);
      expect(session.recoveryData!.recoveryAttempts).toBe(0);
    });

    it('should recover session state', () => {
      // Prepare recovery
      sessionHandler.prepareSessionRecovery(session.sessionId);

      // Simulate state loss
      session.streamSid = undefined;
      session.audioSequence = 0;
      session.conversationContext = {};

      // Recover
      const recoveryData = sessionHandler.recoverSession(session.sessionId);

      expect(recoveryData).toBeDefined();
      expect(session.streamSid).toBe('stream-123');
      expect(session.audioSequence).toBe(42);
      expect(session.conversationContext.important).toBe('data');
      expect(session.totalReconnections).toBe(1);
    });

    it('should limit recovery attempts', () => {
      sessionHandler.prepareSessionRecovery(session.sessionId);

      // Exceed max recovery attempts
      for (let i = 0; i < 5; i++) {
        sessionHandler.recoverSession(session.sessionId);
      }

      const recoveryData = sessionHandler.recoverSession(session.sessionId);
      expect(recoveryData).toBeUndefined();
      expect(session.recoveryData).toBeUndefined();
    });

    it('should emit session recovered event', (done) => {
      sessionHandler.on('session_recovered', (event) => {
        expect(event.sessionId).toBe(session.sessionId);
        expect(event.data.recoveryAttempt).toBe(1);
        done();
      });

      sessionHandler.prepareSessionRecovery(session.sessionId);
      sessionHandler.recoverSession(session.sessionId);
    });
  });

  describe('Socket Event Handling', () => {
    let session: SessionState;
    let binding: SocketBinding;

    beforeEach(() => {
      session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);
      binding = sessionHandler.getSessionSocket(session.sessionId)!;
    });

    it('should handle socket messages', () => {
      const testData = Buffer.from('test message');
      mockSocket.simulateMessage(testData);

      expect(binding.connectionMetrics.messagesReceived).toBe(1);
      expect(binding.connectionMetrics.bytesReceived).toBe(testData.length);
      expect(binding.lastActivity).toBeInstanceOf(Date);
    });

    it('should handle socket errors', (done) => {
      sessionHandler.on('session_error', (event) => {
        expect(event.sessionId).toBe(session.sessionId);
        expect(event.data.error).toBe('Test error');
        done();
      });

      mockSocket.simulateError(new Error('Test error'));

      expect(binding.connectionMetrics.errors).toBe(1);
      expect(session.connectionHealth.failedConnections).toBe(1);
    });

    it('should handle socket close', () => {
      mockSocket.close(1006, 'Unexpected close');

      expect(session.currentSocketId).toBeUndefined();
      expect(session.recoveryData).toBeDefined(); // Should prepare for recovery on unexpected close
    });

    it('should handle Twilio manager connection dead', () => {
      mockTwilioManager.simulateConnectionDead();

      expect(session.recoveryData).toBeDefined();
    });
  });

  describe('Session Statistics', () => {
    beforeEach(() => {
      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        const session = sessionHandler.createSession(`session-${i}`, `call-${i}`, `conv-${i}`);
        
        // Bind some sessions
        if (i < 3) {
          const socket = new MockWebSocket();
          sessionHandler.bindSession(socket as any, mockTwilioManager as any, session.sessionId);
        }

        // Add messages to some sessions
        for (let j = 0; j < i * 2; j++) {
          sessionHandler.addSessionMessage(session.sessionId, {
            type: 'user',
            content: `Message ${j}`
          });
        }
      }
    });

    it('should provide accurate session statistics', () => {
      const stats = sessionHandler.getSessionStats();

      expect(stats.totalSessions).toBe(5);
      expect(stats.activeSessions).toBe(3);
      expect(stats.totalConnections).toBe(3);
      expect(stats.totalMessages).toBe(20); // 0+2+4+6+8 = 20
      expect(stats.averageSessionDuration).toBeGreaterThan(0);
    });

    it('should get active sessions', () => {
      const activeSessions = sessionHandler.getActiveSessions();
      expect(activeSessions.length).toBe(3);
      
      activeSessions.forEach(session => {
        expect(session.currentSocketId).toBeDefined();
      });
    });
  });

  describe('Session Cleanup', () => {
    it('should remove expired sessions', (done) => {
      // Create session with short timeout
      const handler = new SessionAwareSocketHandler({
        sessionTimeout: 50, // 50ms
        cleanupInterval: 25  // 25ms
      });

      const session = handler.createSession('temp-session', 'call-123', 'conv-456');

      // Wait for session to expire and be cleaned up
      setTimeout(() => {
        const retrievedSession = handler.getSession('temp-session');
        expect(retrievedSession).toBeUndefined();
        
        handler.stop();
        done();
      }, 100);
    });

    it('should clean up inactive socket bindings', () => {
      const session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);

      // Simulate socket close
      mockSocket.readyState = 3; // WebSocket.CLOSED

      // Run cleanup
      sessionHandler.cleanup();

      expect(session.currentSocketId).toBeUndefined();
    });

    it('should remove session completely', () => {
      const session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);

      const success = sessionHandler.removeSession(session.sessionId);

      expect(success).toBe(true);
      expect(sessionHandler.getSession(session.sessionId)).toBeUndefined();
      expect(sessionHandler.getSessionSocket(session.sessionId)).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations on non-existent sessions gracefully', () => {
      expect(sessionHandler.updateSessionState('non-existent', {})).toBe(false);
      expect(sessionHandler.addSessionMessage('non-existent', { type: 'user', content: 'test' })).toBe(false);
      expect(sessionHandler.prepareSessionRecovery('non-existent')).toBe(false);
      expect(sessionHandler.recoverSession('non-existent')).toBeUndefined();
      expect(sessionHandler.unbindSession('non-existent')).toBe(false);
      expect(sessionHandler.removeSession('non-existent')).toBe(false);
    });

    it('should handle multiple unbind calls gracefully', () => {
      const session = sessionHandler.createSession('test-session', 'call-123', 'conv-456');
      sessionHandler.bindSession(mockSocket as any, mockTwilioManager as any, session.sessionId);

      expect(sessionHandler.unbindSession(session.sessionId)).toBe(true);
      expect(sessionHandler.unbindSession(session.sessionId)).toBe(false); // Second call should return false
    });

    it('should handle session creation with persistent until date', () => {
      const persistUntil = new Date(Date.now() + 60000); // 1 minute from now
      const session = sessionHandler.createSession('persistent-session', 'call-123', 'conv-456', {
        isPersistent: true,
        persistUntil
      });

      expect(session.persistUntil).toBe(persistUntil);
    });
  });
});