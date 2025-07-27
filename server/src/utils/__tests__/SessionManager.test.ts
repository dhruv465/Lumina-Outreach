/**
 * Unit tests for SessionManager
 */

import { SessionManager, Session, SessionConfig } from '../SessionManager';
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
    this.emit('close', code, reason);
  }

  simulateMessage(data: any) {
    this.emit('message', Buffer.from(JSON.stringify(data)));
  }

  simulateError(error: Error) {
    this.emit('error', error);
  }
}

// Mock TwilioWebSocketManager
jest.mock('../TwilioWebSocketManager', () => {
  return {
    TwilioWebSocketManager: jest.fn().mockImplementation(() => ({
      getConnectionHealth: () => ({ isHealthy: true, connectionQuality: 'good' }),
      getHeartbeatMetrics: () => ({
        isAlive: true,
        currentInterval: 30000,
        averageLatency: 100,
        missedHeartbeats: 0,
        totalPings: 10,
        totalPongs: 10
      }),
      getAdaptiveHeartbeatMetrics: () => ({
        currentCondition: { type: 'good' },
        performanceScore: 85,
        recommendedInterval: 30000
      }),
      getHealthScore: () => ({ overall: 85, quality: 'good' }),
      getRealTimeHealthReport: () => ({ alerts: [], recommendations: [] }),
      getAdaptiveHeartbeatRecommendations: () => [],
      getHeartbeatHealth: () => ({ recommendations: [] }),
      isHeartbeatAlive: () => true,
      cleanup: jest.fn(),
      on: jest.fn()
    }))
  };
});

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockWs: MockWebSocket;
  
  const baseConfig: SessionConfig = {
    sessionId: 'test-session-123',
    callId: 'test-call-456',
    conversationId: 'test-conversation-789',
    userId: 'test-user-001',
    sessionType: 'voice_call',
    priority: 'high',
    maxDuration: 300000, // 5 minutes
    idleTimeout: 60000,  // 1 minute
    healthCheckInterval: 10000 // 10 seconds
  };

  beforeEach(() => {
    sessionManager = new SessionManager();
    mockWs = new MockWebSocket();
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  describe('Session Creation', () => {
    it('should create a new session', () => {
      const session = sessionManager.createSession(mockWs as any, baseConfig);
      
      expect(session).toBeInstanceOf(Session);
      expect(session.config.sessionId).toBe(baseConfig.sessionId);
      expect(session.config.callId).toBe(baseConfig.callId);
    });

    it('should throw error for duplicate session ID', () => {
      sessionManager.createSession(mockWs as any, baseConfig);
      
      expect(() => {
        sessionManager.createSession(mockWs as any, baseConfig);
      }).toThrow('Session test-session-123 already exists');
    });
  });

  describe('Session Retrieval', () => {
    beforeEach(() => {
      sessionManager.createSession(mockWs as any, baseConfig);
    });

    it('should retrieve session by ID', () => {
      const session = sessionManager.getSession(baseConfig.sessionId);
      expect(session).toBeDefined();
      expect(session!.config.sessionId).toBe(baseConfig.sessionId);
    });

    it('should return undefined for non-existent session', () => {
      const session = sessionManager.getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('Session Lifecycle', () => {
    let session: Session;

    beforeEach(() => {
      session = sessionManager.createSession(mockWs as any, baseConfig);
    });

    it('should start session', () => {
      session.start();
      
      const metrics = session.getMetrics();
      expect(metrics.isActive).toBe(true);
    });

    it('should end session', () => {
      session.start();
      session.end('Test termination');
      
      const metrics = session.getMetrics();
      expect(metrics.isActive).toBe(false);
    });
  });

  describe('Session Health Monitoring', () => {
    let session: Session;

    beforeEach(() => {
      session = sessionManager.createSession(mockWs as any, baseConfig);
      session.start();
    });

    it('should provide health report', () => {
      const healthReport = session.getHealthReport();
      
      expect(healthReport.sessionId).toBe(baseConfig.sessionId);
      expect(healthReport.overallHealth).toBeDefined();
      expect(healthReport.metrics).toBeDefined();
      expect(healthReport.issues).toBeInstanceOf(Array);
      expect(healthReport.recommendations).toBeInstanceOf(Array);
    });

    it('should provide session metrics', () => {
      const metrics = session.getMetrics();
      
      expect(metrics.sessionId).toBe(baseConfig.sessionId);
      expect(metrics.startTime).toBeInstanceOf(Date);
      expect(metrics.duration).toBeGreaterThan(0);
      expect(metrics.isActive).toBe(true);
      expect(metrics.healthScore).toBeGreaterThan(0);
    });
  });
});