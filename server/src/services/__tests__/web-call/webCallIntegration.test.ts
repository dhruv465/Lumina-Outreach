import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import webCallService from '../../../services/webCallService';
import { getDeepgramServiceWithRecovery } from '../../../services/deepgramServiceWithRecovery';
import { getLLMService } from '../../../services';
import { getTextToSpeechService } from '../../../services/textToSpeechService';
import CampaignService from '../../../services/campaignService';
import WebCallTest from '../../../models/WebCallTest';
import mongoose from 'mongoose';

// Mock dependencies
vi.mock('../../../services/deepgramServiceWithRecovery', () => ({
  getDeepgramServiceWithRecovery: vi.fn().mockResolvedValue({
    transcribeAudioWithRecovery: vi.fn().mockResolvedValue({
      transcript: 'This is a test transcription'
    })
  })
}));

vi.mock('../../../services', () => ({
  getLLMService: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      content: 'This is a test response'
    })
  })
}));

vi.mock('../../../services/textToSpeechService', () => ({
  getTextToSpeechService: vi.fn().mockResolvedValue({
    generateSpeech: vi.fn().mockResolvedValue(Buffer.from('test audio data'))
  })
}));

vi.mock('../../../services/campaignService', () => ({
  default: vi.fn().mockImplementation(() => ({
    getCampaignById: vi.fn().mockResolvedValue({
      _id: 'test-campaign-id',
      name: 'Test Campaign',
      systemPrompt: 'You are a helpful assistant',
      initialPrompt: 'Hello, how can I help you today?',
      voiceId: 'test-voice-id',
      voiceStability: 0.5,
      voiceSimilarity: 0.75,
      voiceSpeed: 1.0,
      llmProvider: 'openai',
      llmModel: 'gpt-4'
    })
  }))
}));

vi.mock('../../../models/WebCallTest', () => ({
  default: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue({ _id: 'test-test-id' })
  })),
  findById: vi.fn().mockResolvedValue({
    _id: 'test-test-id',
    campaignId: 'test-campaign-id',
    userId: 'test-user-id',
    startTime: new Date(),
    transcript: [],
    agentResponses: [],
    metrics: {
      responseTime: {
        avg: 0,
        min: 0,
        max: 0
      }
    },
    save: vi.fn().mockResolvedValue(true)
  }),
  findByIdAndUpdate: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock event emitter methods
const mockOn = vi.fn();
const mockEmit = vi.fn();

// Override EventEmitter methods
Object.defineProperty(webCallService, 'on', {
  value: mockOn
});

Object.defineProperty(webCallService, 'emit', {
  value: mockEmit
});

describe('WebCall Integration Tests', () => {
  let sessionId: string;
  let testId: string = 'test-test-id';
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock Date.now and new Date()
    const mockDate = new Date('2025-07-21T12:00:00Z');
    vi.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
    
    // Reset mocks
    mockOn.mockReset();
    mockEmit.mockReset();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  it('should complete a full web call flow', async () => {
    // 1. Create a session
    const session = await webCallService.createSession({
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      testId: testId
    });
    
    sessionId = session.id;
    
    expect(session).toBeDefined();
    expect(session.campaignId).toBe('test-campaign-id');
    expect(session.userId).toBe('test-user-id');
    expect(session.status).toBe('connecting');
    
    // 2. Update session state to connected
    await webCallService.updateSessionState(sessionId, 'connected');
    
    let updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('connected');
    
    // 3. Add initial agent response (from campaign initialPrompt)
    await webCallService.addAgentResponse(sessionId, 'Hello, how can I help you today?', 0);
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.transcript).toHaveLength(1);
    expect(updatedSession?.transcript[0].speaker).toBe('agent');
    expect(updatedSession?.transcript[0].text).toBe('Hello, how can I help you today?');
    
    // 4. Update state to listening
    await webCallService.updateSessionState(sessionId, 'listening');
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('listening');
    
    // 5. Process user audio
    const audioBuffer = Buffer.from('test audio data');
    await webCallService.processUserAudio(sessionId, audioBuffer);
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('processing');
    expect(updatedSession?.resources.currentSpeaker).toBe('user');
    
    // 6. Generate agent response from user input
    const userInput = 'This is a test transcription';
    await webCallService.generateAgentResponse(sessionId, userInput);
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.transcript).toHaveLength(2);
    expect(updatedSession?.transcript[1].speaker).toBe('user');
    expect(updatedSession?.transcript[1].text).toBe(userInput);
    
    // 7. Add agent response
    const agentResponse = 'This is a test response';
    const responseTime = 500;
    await webCallService.addAgentResponse(sessionId, agentResponse, responseTime);
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.transcript).toHaveLength(3);
    expect(updatedSession?.transcript[2].speaker).toBe('agent');
    expect(updatedSession?.transcript[2].text).toBe(agentResponse);
    expect(updatedSession?.metrics.responseTime).toContain(responseTime);
    expect(updatedSession?.status).toBe('speaking');
    
    // 8. Update metrics
    await webCallService.updateSessionMetrics(sessionId, {
      speechToTextLatency: 100,
      llmLatency: 300,
      textToSpeechLatency: 100
    });
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.metrics.speechToTextLatency).toBe(100);
    expect(updatedSession?.metrics.llmLatency).toBe(300);
    expect(updatedSession?.metrics.textToSpeechLatency).toBe(100);
    
    // 9. Update state to listening again
    await webCallService.updateSessionState(sessionId, 'listening');
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('listening');
    
    // 10. End the session
    const endedSession = await webCallService.endSession(sessionId);
    
    expect(endedSession.status).toBe('ended');
    expect(endedSession.endTime).toBeDefined();
    
    // Verify events were emitted
    expect(mockEmit).toHaveBeenCalledWith('session:created', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('session:stateChanged', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('audio:received', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('transcript:updated', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('input:received', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('response:generated', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('metrics:updated', expect.any(Object));
    expect(mockEmit).toHaveBeenCalledWith('session:ended', expect.any(Object));
  });
  
  it('should handle errors during web call flow', async () => {
    // 1. Create a session
    const session = await webCallService.createSession({
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      testId: testId
    });
    
    sessionId = session.id;
    
    // 2. Update session state to connected
    await webCallService.updateSessionState(sessionId, 'connected');
    
    // 3. Handle a recoverable error
    const error = new Error('Test error');
    await webCallService.handleSessionError(sessionId, error, true, 'TestComponent');
    
    let updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('error');
    
    // 4. Verify error event was emitted
    expect(mockEmit).toHaveBeenCalledWith('session:error', expect.objectContaining({
      sessionId,
      error: 'Test error',
      recoverable: true
    }));
    
    // 5. Recover from error by setting state back to listening
    await webCallService.updateSessionState(sessionId, 'listening');
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('listening');
    
    // 6. Handle a non-recoverable error
    const fatalError = new Error('Fatal error');
    
    // Mock setTimeout to execute immediately
    const mockSetTimeout = vi.spyOn(global, 'setTimeout');
    mockSetTimeout.mockImplementation((callback) => {
      callback();
      return 789 as any;
    });
    
    await webCallService.handleSessionError(sessionId, fatalError, false, 'TestComponent');
    
    // 7. Verify session was ended
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.status).toBe('ended');
  });
  
  it('should handle interruptions during conversation', async () => {
    // 1. Create a session
    const session = await webCallService.createSession({
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      testId: testId
    });
    
    sessionId = session.id;
    
    // 2. Update session state to connected
    await webCallService.updateSessionState(sessionId, 'connected');
    
    // 3. Update state to speaking (agent is speaking)
    await webCallService.updateSessionState(sessionId, 'speaking');
    
    let updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.resources.currentSpeaker).toBe('agent');
    
    // 4. Process user audio (user interrupts)
    const audioBuffer = Buffer.from('test audio data');
    await webCallService.processUserAudio(sessionId, audioBuffer);
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.metrics.interruptions).toBe(1);
    expect(updatedSession?.status).toBe('processing');
    expect(updatedSession?.resources.currentSpeaker).toBe('user');
    
    // 5. Generate agent response
    const userInput = 'This is an interruption';
    await webCallService.generateAgentResponse(sessionId, userInput);
    
    // 6. Add agent response
    const agentResponse = 'I was interrupted but I will respond';
    await webCallService.addAgentResponse(sessionId, agentResponse, 300);
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.transcript).toHaveLength(2);
    expect(updatedSession?.transcript[0].speaker).toBe('user');
    expect(updatedSession?.transcript[1].speaker).toBe('agent');
  });
  
  it('should track speaking time correctly', async () => {
    // 1. Create a session
    const session = await webCallService.createSession({
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      testId: testId
    });
    
    sessionId = session.id;
    
    // 2. Update session state to connected
    await webCallService.updateSessionState(sessionId, 'connected');
    
    // 3. Update state to speaking (agent is speaking)
    await webCallService.updateSessionState(sessionId, 'speaking');
    
    // Mock date to advance by 5 seconds
    const speakingDate = new Date('2025-07-21T12:00:05Z');
    vi.spyOn(global, 'Date').mockImplementation(() => speakingDate as any);
    
    // 4. Update state to listening (agent finished speaking)
    await webCallService.updateSessionState(sessionId, 'listening');
    
    let updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.metrics.agentSpeakingTime).toBe(5000); // 5 seconds in ms
    
    // 5. Process user audio (user starts speaking)
    const audioBuffer = Buffer.from('test audio data');
    await webCallService.processUserAudio(sessionId, audioBuffer);
    
    // Mock date to advance by another 3 seconds
    const userSpeakingDate = new Date('2025-07-21T12:00:08Z');
    vi.spyOn(global, 'Date').mockImplementation(() => userSpeakingDate as any);
    
    // 6. Update state to processing (user finished speaking)
    await webCallService.updateSessionState(sessionId, 'processing');
    
    updatedSession = await webCallService.getSession(sessionId);
    expect(updatedSession?.metrics.userSpeakingTime).toBe(3000); // 3 seconds in ms
  });
});