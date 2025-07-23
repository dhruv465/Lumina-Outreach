import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import webCallService, { WebCallService } from '../../../services/webCallService';
import webCallMetricsService from '../../../services/webCallMetricsService';
import webCallDebugService from '../../../services/webCallDebugService';

// Mock dependencies
vi.mock('../../../services/webCallMetricsService', () => ({
  default: {
    initializeMetrics: vi.fn(),
    recordComponentLatency: vi.fn(),
    recordSpeechTiming: vi.fn(),
    recordInterruption: vi.fn(),
    incrementTurnCount: vi.fn(),
    saveMetricsToDatabase: vi.fn(),
    cleanupSessionMetrics: vi.fn()
  }
}));

vi.mock('../../../services/webCallDebugService', () => ({
  default: {
    initializeDebugLogs: vi.fn(),
    addLogEntry: vi.fn(),
    reportError: vi.fn(),
    saveLogsToDatabase: vi.fn(),
    cleanupSessionLogs: vi.fn(),
    generateDiagnosticInfo: vi.fn()
  }
}));

vi.mock('../../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe('WebCallService', () => {
  let service: WebCallService;
  let sessionId: string;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a new instance for each test
    service = new WebCallService();
    
    // Mock Date.now and new Date()
    const mockDate = new Date('2025-07-21T12:00:00Z');
    vi.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
    
    // Mock setTimeout and clearTimeout
    vi.spyOn(global, 'setTimeout').mockReturnValue(123 as any);
    vi.spyOn(global, 'clearTimeout').mockImplementation(() => {});
    
    // Mock setInterval and clearInterval
    vi.spyOn(global, 'setInterval').mockReturnValue(456 as any);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('createSession', () => {
    it('should create a new session with the provided options', async () => {
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      
      expect(session).toBeDefined();
      expect(session.campaignId).toBe(options.campaignId);
      expect(session.userId).toBe(options.userId);
      expect(session.status).toBe('connecting');
      expect(session.transcript).toEqual([]);
      expect(webCallMetricsService.initializeMetrics).toHaveBeenCalledWith(session.id);
      expect(webCallDebugService.initializeDebugLogs).toHaveBeenCalledWith(session.id);
      
      // Save session ID for later tests
      sessionId = session.id;
    });
  });
  
  describe('updateSessionState', () => {
    it('should update session state', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Set up event listener to verify event emission
      const stateChangedHandler = vi.fn();
      service.on('session:stateChanged', stateChangedHandler);
      
      // Update state
      await service.updateSessionState(sessionId, 'connected');
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      expect(updatedSession?.status).toBe('connected');
      expect(stateChangedHandler).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        oldState: 'connecting',
        newState: 'connected'
      }));
      expect(webCallDebugService.addLogEntry).toHaveBeenCalled();
    });
    
    it('should handle state transitions with speaker tracking', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Update to connected
      await service.updateSessionState(sessionId, 'connected');
      
      // Update to speaking (agent)
      await service.updateSessionState(sessionId, 'speaking');
      
      // Get session to verify speaker
      let updatedSession = await service.getSession(sessionId);
      expect(updatedSession?.resources.currentSpeaker).toBe('agent');
      expect(updatedSession?.resources.speakingStartTime).toBeDefined();
      
      // Update to listening
      await service.updateSessionState(sessionId, 'listening');
      
      // Verify agent speaking time was calculated
      updatedSession = await service.getSession(sessionId);
      expect(updatedSession?.resources.currentSpeaker).toBeNull();
      expect(webCallMetricsService.recordSpeechTiming).toHaveBeenCalledWith(
        sessionId, 'agent', expect.any(Number)
      );
    });
    
    it('should handle invalid state transitions with a warning', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Try an invalid transition (connecting -> processing)
      await service.updateSessionState(sessionId, 'processing');
      
      // Should still update the state despite the warning
      const updatedSession = await service.getSession(sessionId);
      expect(updatedSession?.status).toBe('processing');
    });
  });
  
  describe('processUserAudio', () => {
    it('should process user audio and update state', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Update to connected and then listening
      await service.updateSessionState(sessionId, 'connected');
      await service.updateSessionState(sessionId, 'listening');
      
      // Set up event listener to verify event emission
      const audioReceivedHandler = vi.fn();
      service.on('audio:received', audioReceivedHandler);
      
      // Process audio
      const audioBuffer = Buffer.from('test audio data');
      await service.processUserAudio(sessionId, audioBuffer);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should transition from listening to processing
      expect(updatedSession?.status).toBe('processing');
      expect(updatedSession?.resources.currentSpeaker).toBe('user');
      expect(updatedSession?.resources.speakingStartTime).toBeDefined();
      expect(audioReceivedHandler).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        audioSize: audioBuffer.length
      }));
    });
    
    it('should count interruption if agent was speaking', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Update to connected and then speaking (agent)
      await service.updateSessionState(sessionId, 'connected');
      await service.updateSessionState(sessionId, 'speaking');
      
      // Process audio (user interrupts)
      const audioBuffer = Buffer.from('test audio data');
      await service.processUserAudio(sessionId, audioBuffer);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should count as interruption
      expect(updatedSession?.metrics.interruptions).toBe(1);
      expect(webCallMetricsService.recordInterruption).toHaveBeenCalledWith(sessionId, 'user');
    });
  });
  
  describe('generateAgentResponse', () => {
    it('should add user input to transcript', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Set up event listener to verify event emission
      const transcriptUpdatedHandler = vi.fn();
      service.on('transcript:updated', transcriptUpdatedHandler);
      
      const inputReceivedHandler = vi.fn();
      service.on('input:received', inputReceivedHandler);
      
      // Generate agent response with user input
      const userInput = 'Hello, this is a test';
      await service.generateAgentResponse(sessionId, userInput);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should add user input to transcript
      expect(updatedSession?.transcript).toHaveLength(1);
      expect(updatedSession?.transcript[0]).toEqual({
        speaker: 'user',
        text: userInput,
        timestamp: expect.any(Date),
        isFinal: true
      });
      expect(updatedSession?.metrics.totalTurns).toBe(1);
      expect(transcriptUpdatedHandler).toHaveBeenCalled();
      expect(inputReceivedHandler).toHaveBeenCalled();
    });
  });
  
  describe('addAgentResponse', () => {
    it('should add agent response to transcript and update state', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Set up event listener to verify event emission
      const transcriptUpdatedHandler = vi.fn();
      service.on('transcript:updated', transcriptUpdatedHandler);
      
      const responseGeneratedHandler = vi.fn();
      service.on('response:generated', responseGeneratedHandler);
      
      // Add agent response
      const agentResponse = 'I am the agent responding to your query';
      const responseTime = 500;
      await service.addAgentResponse(sessionId, agentResponse, responseTime);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should add agent response to transcript
      expect(updatedSession?.transcript).toHaveLength(1);
      expect(updatedSession?.transcript[0]).toEqual({
        speaker: 'agent',
        text: agentResponse,
        timestamp: expect.any(Date),
        isFinal: true
      });
      expect(updatedSession?.metrics.responseTime).toContain(responseTime);
      expect(updatedSession?.metrics.totalTurns).toBe(1);
      expect(updatedSession?.status).toBe('speaking');
      expect(transcriptUpdatedHandler).toHaveBeenCalled();
      expect(responseGeneratedHandler).toHaveBeenCalled();
    });
  });
  
  describe('updateSessionMetrics', () => {
    it('should update session metrics', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Set up event listener to verify event emission
      const metricsUpdatedHandler = vi.fn();
      service.on('metrics:updated', metricsUpdatedHandler);
      
      // Update metrics
      const metricUpdates = {
        speechToTextLatency: 100,
        llmLatency: 300,
        textToSpeechLatency: 200
      };
      await service.updateSessionMetrics(sessionId, metricUpdates);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should update metrics
      expect(updatedSession?.metrics.speechToTextLatency).toBe(100);
      expect(updatedSession?.metrics.llmLatency).toBe(300);
      expect(updatedSession?.metrics.textToSpeechLatency).toBe(200);
      expect(metricsUpdatedHandler).toHaveBeenCalled();
      expect(webCallMetricsService.recordComponentLatency).toHaveBeenCalledTimes(3);
    });
  });
  
  describe('endSession', () => {
    it('should end the session and clean up resources', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user',
        testId: 'test-test-id'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Add some metrics
      await service.updateSessionMetrics(sessionId, {
        speechToTextLatency: 100,
        llmLatency: 300,
        textToSpeechLatency: 200
      });
      
      // Set up event listener to verify event emission
      const sessionEndedHandler = vi.fn();
      service.on('session:ended', sessionEndedHandler);
      
      // End session
      const endedSession = await service.endSession(sessionId);
      
      // Should update session state and set end time
      expect(endedSession.status).toBe('ended');
      expect(endedSession.endTime).toBeDefined();
      expect(sessionEndedHandler).toHaveBeenCalled();
      expect(webCallMetricsService.saveMetricsToDatabase).toHaveBeenCalledWith(sessionId, 'test-test-id');
      expect(webCallDebugService.saveLogsToDatabase).toHaveBeenCalledWith(sessionId, 'test-test-id');
      expect(webCallMetricsService.cleanupSessionMetrics).toHaveBeenCalledWith(sessionId);
      expect(webCallDebugService.cleanupSessionLogs).toHaveBeenCalledWith(sessionId);
    });
  });
  
  describe('handleSessionError', () => {
    it('should handle session errors and update state', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Set up event listener to verify event emission
      const sessionErrorHandler = vi.fn();
      service.on('session:error', sessionErrorHandler);
      
      // Handle error
      const error = new Error('Test error');
      await service.handleSessionError(sessionId, error, true, 'TestComponent');
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should update session state to error
      expect(updatedSession?.status).toBe('error');
      expect(sessionErrorHandler).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        error: 'Test error',
        recoverable: true
      }));
      expect(webCallDebugService.reportError).toHaveBeenCalledWith(
        sessionId,
        'TestComponent',
        error,
        undefined,
        true
      );
    });
    
    it('should end session after delay for non-recoverable errors', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Mock setTimeout to execute immediately
      const mockSetTimeout = vi.spyOn(global, 'setTimeout');
      mockSetTimeout.mockImplementation((callback) => {
        callback();
        return 789 as any;
      });
      
      // Handle non-recoverable error
      const error = new Error('Fatal error');
      await service.handleSessionError(sessionId, error, false);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      // Should update session state to ended after error
      expect(updatedSession?.status).toBe('ended');
    });
  });
  
  describe('getSession and session queries', () => {
    it('should get session by ID', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Get session
      const retrievedSession = await service.getSession(sessionId);
      
      expect(retrievedSession).toBeDefined();
      expect(retrievedSession?.id).toBe(sessionId);
    });
    
    it('should get active sessions', async () => {
      // Create multiple sessions
      const options1 = {
        campaignId: 'test-campaign-1',
        userId: 'test-user-1'
      };
      
      const options2 = {
        campaignId: 'test-campaign-2',
        userId: 'test-user-2'
      };
      
      const session1 = await service.createSession(options1);
      const session2 = await service.createSession(options2);
      
      // End one session
      await service.endSession(session1.id);
      
      // Get active sessions
      const activeSessions = await service.getActiveSessions();
      
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(session2.id);
    });
    
    it('should get sessions by campaign ID', async () => {
      // Create multiple sessions
      const options1 = {
        campaignId: 'test-campaign-1',
        userId: 'test-user-1'
      };
      
      const options2 = {
        campaignId: 'test-campaign-2',
        userId: 'test-user-2'
      };
      
      const options3 = {
        campaignId: 'test-campaign-1',
        userId: 'test-user-3'
      };
      
      await service.createSession(options1);
      await service.createSession(options2);
      await service.createSession(options3);
      
      // Get sessions by campaign
      const campaignSessions = await service.getSessionsByCampaign('test-campaign-1');
      
      expect(campaignSessions).toHaveLength(2);
      expect(campaignSessions[0].campaignId).toBe('test-campaign-1');
      expect(campaignSessions[1].campaignId).toBe('test-campaign-1');
    });
    
    it('should get sessions by user ID', async () => {
      // Create multiple sessions
      const options1 = {
        campaignId: 'test-campaign-1',
        userId: 'test-user-1'
      };
      
      const options2 = {
        campaignId: 'test-campaign-2',
        userId: 'test-user-2'
      };
      
      const options3 = {
        campaignId: 'test-campaign-3',
        userId: 'test-user-1'
      };
      
      await service.createSession(options1);
      await service.createSession(options2);
      await service.createSession(options3);
      
      // Get sessions by user
      const userSessions = await service.getSessionsByUser('test-user-1');
      
      expect(userSessions).toHaveLength(2);
      expect(userSessions[0].userId).toBe('test-user-1');
      expect(userSessions[1].userId).toBe('test-user-1');
    });
  });
  
  describe('session configuration', () => {
    it('should configure session settings', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Configure session
      const config = {
        inactivityTimeout: 10 * 60 * 1000, // 10 minutes
        maxSessionDuration: 60 * 60 * 1000 // 1 hour
      };
      await service.configureSession(sessionId, config);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      expect(updatedSession?.config.inactivityTimeout).toBe(10 * 60 * 1000);
      expect(updatedSession?.config.maxSessionDuration).toBe(60 * 60 * 1000);
    });
    
    it('should set voice settings', async () => {
      // Create a session first
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      sessionId = session.id;
      
      // Set voice settings
      const voiceSettings = {
        voiceId: 'test-voice',
        stability: 0.7,
        similarity: 0.8,
        speed: 1.1,
        modelId: 'eleven_turbo_v2'
      };
      await service.setVoiceSettings(sessionId, voiceSettings);
      
      // Get updated session
      const updatedSession = await service.getSession(sessionId);
      
      expect(updatedSession?.config.voiceSettings).toEqual(voiceSettings);
    });
  });
  
  describe('statistics', () => {
    it('should get session statistics', async () => {
      // Create multiple sessions with different states
      const options1 = {
        campaignId: 'test-campaign-1',
        userId: 'test-user-1'
      };
      
      const options2 = {
        campaignId: 'test-campaign-2',
        userId: 'test-user-2'
      };
      
      const options3 = {
        campaignId: 'test-campaign-3',
        userId: 'test-user-3'
      };
      
      const session1 = await service.createSession(options1);
      const session2 = await service.createSession(options2);
      const session3 = await service.createSession(options3);
      
      // End one session
      await service.endSession(session1.id);
      
      // Set one session to error
      await service.handleSessionError(session2.id, new Error('Test error'));
      
      // Add response time to active session
      await service.addAgentResponse(session3.id, 'Test response', 500);
      
      // Get statistics
      const stats = await service.getStatistics();
      
      expect(stats.totalSessions).toBe(3);
      expect(stats.activeSessions).toBe(1);
      expect(stats.completedSessions).toBe(1);
      expect(stats.errorSessions).toBe(1);
      expect(stats.averageResponseTime).toBe(500);
    });
  });
  
  describe('cleanup', () => {
    it('should clean up old sessions', async () => {
      // Create a session
      const options = {
        campaignId: 'test-campaign',
        userId: 'test-user'
      };
      
      const session = await service.createSession(options);
      
      // Mock session to be old
      const oldSession = await service.getSession(session.id);
      if (oldSession) {
        oldSession.status = 'ended';
        oldSession.lastActivityTime = new Date('2025-07-20T00:00:00Z'); // Yesterday
      }
      
      // Run cleanup
      service.cleanupOldSessions();
      
      // Session should be removed
      const retrievedSession = await service.getSession(session.id);
      expect(retrievedSession).toBeNull();
    });
  });
});