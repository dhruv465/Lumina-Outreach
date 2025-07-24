import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { Socket } from 'socket.io';
import { initializeWebCall, endWebCall, handleWebCallEvent } from '../../controllers/webCallController';
import webCallService from '../../services/webCallService';
import CampaignService from '../../services/campaignService';
import { getDeepgramServiceWithRecovery } from '../../services/deepgramServiceWithRecovery';
import { getLLMService } from '../../services';
import { getTextToSpeechService } from '../../services/textToSpeechService';
import WebCallTest from '../../models/WebCallTest';
import webCallMetricsService from '../../services/webCallMetricsService';
import webCallDebugService from '../../services/webCallDebugService';
import mongoose from 'mongoose';

// Mock dependencies
vi.mock('../../services/webCallService', () => ({
  default: {
    createSession: vi.fn(),
    getSession: vi.fn(),
    endSession: vi.fn(),
    processUserAudio: vi.fn(),
    generateAgentResponse: vi.fn(),
    addAgentResponse: vi.fn()
  }
}));

vi.mock('../../services/campaignService', () => ({
  default: vi.fn().mockImplementation(() => ({
    getCampaignById: vi.fn()
  }))
}));

vi.mock('../../services/deepgramServiceWithRecovery', () => ({
  getDeepgramServiceWithRecovery: vi.fn().mockResolvedValue({
    transcribeAudioWithRecovery: vi.fn()
  })
}));

vi.mock('../../services', () => ({
  getLLMService: vi.fn().mockReturnValue({
    chat: vi.fn()
  })
}));

vi.mock('../../services/textToSpeechService', () => ({
  getTextToSpeechService: vi.fn().mockResolvedValue({
    generateSpeech: vi.fn()
  })
}));

vi.mock('../../models/WebCallTest', () => ({
  default: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue({ _id: 'test-test-id' })
  })),
  findById: vi.fn(),
  findByIdAndUpdate: vi.fn()
}));

vi.mock('../../services/webCallMetricsService', () => ({
  default: {
    recordComponentLatency: vi.fn(),
    recordSpeechTiming: vi.fn(),
    recordInterruption: vi.fn()
  }
}));

vi.mock('../../services/webCallDebugService', () => ({
  default: {
    generateDiagnosticInfo: vi.fn(),
    addLogEntry: vi.fn()
  }
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe('WebCallController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockSocket: Partial<Socket>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock request and response
    mockRequest = {
      body: {},
      params: {},
      user: { _id: 'test-user-id' }
    };
    
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    
    // Setup mock socket
    mockSocket = {
      id: 'test-socket-id',
      on: vi.fn(),
      emit: vi.fn(),
      join: vi.fn(),
      to: vi.fn().mockReturnThis(),
      disconnect: vi.fn()
    };
    
    // Setup mock campaign service
    const mockCampaignService = new CampaignService('', '', '', '', '');
    (mockCampaignService.getCampaignById as vi.Mock).mockResolvedValue({
      _id: 'test-campaign-id',
      name: 'Test Campaign',
      systemPrompt: 'You are a helpful assistant',
      initialPrompt: 'Hello, how can I help you today?',
      voiceId: 'test-voice-id',
      voiceStability: 0.5,
      voiceSimilarity: 0.75,
      voiceSpeed: 1.0
    });
    
    // Setup mock web call service
    (webCallService.createSession as vi.Mock).mockResolvedValue({
      id: 'test-session-id',
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      status: 'initializing',
      startTime: new Date(),
      transcript: [],
      metrics: {
        responseTime: [],
        userSpeakingTime: 0,
        agentSpeakingTime: 0,
        interruptions: 0,
        speechToTextLatency: 0,
        textToSpeechLatency: 0,
        llmLatency: 0,
        totalTurns: 0
      }
    });
    
    (webCallService.getSession as vi.Mock).mockResolvedValue({
      id: 'test-session-id',
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      status: 'connected',
      startTime: new Date(),
      transcript: [],
      metrics: {
        responseTime: [],
        userSpeakingTime: 0,
        agentSpeakingTime: 0,
        interruptions: 0,
        speechToTextLatency: 0,
        textToSpeechLatency: 0,
        llmLatency: 0,
        totalTurns: 0
      }
    });
    
    (webCallService.endSession as vi.Mock).mockResolvedValue({
      id: 'test-session-id',
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      status: 'ended',
      startTime: new Date(),
      endTime: new Date(),
      transcript: [],
      metrics: {
        responseTime: [],
        userSpeakingTime: 0,
        agentSpeakingTime: 0,
        interruptions: 0,
        speechToTextLatency: 0,
        textToSpeechLatency: 0,
        llmLatency: 0,
        totalTurns: 0
      }
    });
    
    // Setup mock deepgram service
    const mockDeepgramService = {
      transcribeAudioWithRecovery: vi.fn().mockResolvedValue({
        transcript: 'This is a test transcription'
      })
    };
    (getDeepgramServiceWithRecovery as vi.Mock).mockResolvedValue(mockDeepgramService);
    
    // Setup mock LLM service
    const mockLLMService = {
      chat: vi.fn().mockResolvedValue({
        content: 'This is a test response'
      })
    };
    (getLLMService as vi.Mock).mockReturnValue(mockLLMService);
    
    // Setup mock TTS service
    const mockTTSService = {
      generateSpeech: vi.fn().mockResolvedValue(Buffer.from('test audio data'))
    };
    (getTextToSpeechService as vi.Mock).mockResolvedValue(mockTTSService);
    
    // Setup mock WebCallTest
    (WebCallTest.findById as vi.Mock).mockResolvedValue({
      _id: 'test-test-id',
      campaignId: 'test-campaign-id',
      userId: 'test-user-id',
      startTime: new Date(),
      transcript: [],
      agentResponses: [{ responseTime: 500 }],
      metrics: {
        responseTime: {
          avg: 0,
          min: 0,
          max: 0
        }
      }
    });
    
    (WebCallTest.findByIdAndUpdate as vi.Mock).mockResolvedValue(true);
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('initializeWebCall', () => {
    it('should initialize a web call session', async () => {
      // Setup request
      mockRequest.body = {
        campaignId: 'test-campaign-id'
      };
      
      // Call the controller
      await initializeWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        sessionId: 'test-session-id',
        testId: expect.any(String)
      }));
      
      // Verify service calls
      expect(webCallService.createSession).toHaveBeenCalledWith({
        campaignId: 'test-campaign-id',
        userId: 'test-user-id'
      });
    });
    
    it('should return 400 if campaignId is missing', async () => {
      // Setup request with missing campaignId
      mockRequest.body = {};
      
      // Call the controller
      await initializeWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Campaign ID is required'
      }));
    });
    
    it('should return 401 if user is not authenticated', async () => {
      // Setup request with missing user
      mockRequest.body = {
        campaignId: 'test-campaign-id'
      };
      mockRequest.user = undefined;
      
      // Call the controller
      await initializeWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication required'
      }));
    });
    
    it('should return 404 if campaign is not found', async () => {
      // Setup request
      mockRequest.body = {
        campaignId: 'non-existent-campaign'
      };
      
      // Mock campaign service to return null
      const mockCampaignService = new CampaignService('', '', '', '', '');
      (mockCampaignService.getCampaignById as vi.Mock).mockResolvedValueOnce(null);
      
      // Call the controller
      await initializeWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Campaign not found'
      }));
    });
    
    it('should handle errors', async () => {
      // Setup request
      mockRequest.body = {
        campaignId: 'test-campaign-id'
      };
      
      // Mock service to throw error
      (webCallService.createSession as vi.Mock).mockRejectedValueOnce(new Error('Test error'));
      
      // Call the controller
      await initializeWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Failed to initialize web call'
      }));
    });
  });
  
  describe('endWebCall', () => {
    it('should end a web call session', async () => {
      // Setup request
      mockRequest.params = {
        sessionId: 'test-session-id'
      };
      mockRequest.body = {
        testId: 'test-test-id'
      };
      
      // Call the controller
      await endWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        testId: 'test-test-id'
      }));
      
      // Verify service calls
      expect(webCallService.endSession).toHaveBeenCalledWith('test-session-id');
      expect(WebCallTest.findByIdAndUpdate).toHaveBeenCalled();
    });
    
    it('should return 400 if sessionId is missing', async () => {
      // Setup request with missing sessionId
      mockRequest.params = {};
      mockRequest.body = {
        testId: 'test-test-id'
      };
      
      // Call the controller
      await endWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Session ID is required'
      }));
    });
    
    it('should return 401 if user is not authenticated', async () => {
      // Setup request with missing user
      mockRequest.params = {
        sessionId: 'test-session-id'
      };
      mockRequest.body = {
        testId: 'test-test-id'
      };
      mockRequest.user = undefined;
      
      // Call the controller
      await endWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication required'
      }));
    });
    
    it('should return 404 if session is not found', async () => {
      // Setup request
      mockRequest.params = {
        sessionId: 'non-existent-session'
      };
      mockRequest.body = {
        testId: 'test-test-id'
      };
      
      // Mock service to return null
      (webCallService.getSession as vi.Mock).mockResolvedValueOnce(null);
      
      // Call the controller
      await endWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Session not found'
      }));
    });
    
    it('should return 403 if user does not own the session', async () => {
      // Setup request
      mockRequest.params = {
        sessionId: 'test-session-id'
      };
      mockRequest.body = {
        testId: 'test-test-id'
      };
      
      // Mock service to return session with different userId
      (webCallService.getSession as vi.Mock).mockResolvedValueOnce({
        id: 'test-session-id',
        campaignId: 'test-campaign-id',
        userId: 'different-user-id',
        status: 'connected'
      });
      
      // Call the controller
      await endWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Not authorized to end this session'
      }));
    });
    
    it('should handle errors', async () => {
      // Setup request
      mockRequest.params = {
        sessionId: 'test-session-id'
      };
      mockRequest.body = {
        testId: 'test-test-id'
      };
      
      // Mock service to throw error
      (webCallService.endSession as vi.Mock).mockRejectedValueOnce(new Error('Test error'));
      
      // Call the controller
      await endWebCall(mockRequest as Request, mockResponse as Response);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Failed to end web call'
      }));
    });
  });
  
  describe('handleWebCallEvent', () => {
    it('should set up socket event handlers', async () => {
      // Call the controller
      await handleWebCallEvent(mockSocket as Socket);
      
      // Verify socket event handlers were set up
      expect(mockSocket.on).toHaveBeenCalledWith('webcall:initialize', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('webcall:audio', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('webcall:end', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('webcall:debug', expect.any(Function));
    });
    
    it('should handle webcall:initialize event', async () => {
      // Call the controller
      await handleWebCallEvent(mockSocket as Socket);
      
      // Get the initialize handler
      const initializeHandler = (mockSocket.on as vi.Mock).mock.calls.find(
        call => call[0] === 'webcall:initialize'
      )[1];
      
      // Call the handler
      await initializeHandler({
        sessionId: 'test-session-id',
        campaignId: 'test-campaign-id',
        userId: 'test-user-id',
        testId: 'test-test-id'
      });
      
      // Verify socket actions
      expect(mockSocket.join).toHaveBeenCalledWith('webcall:test-session-id');
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:state', expect.objectContaining({
        status: 'connecting'
      }));
      
      // Should emit connected state after campaign is loaded
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:state', expect.objectContaining({
        status: 'connected'
      }));
      
      // Should emit initial prompt if available
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:agentAudio', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:transcript', expect.objectContaining({
        speaker: 'agent',
        text: 'Hello, how can I help you today?'
      }));
      
      // Should emit listening state
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:state', expect.objectContaining({
        status: 'listening'
      }));
    });
    
    it('should handle webcall:audio event', async () => {
      // Setup mock deepgram service
      const mockDeepgramService = {
        transcribeAudioWithRecovery: vi.fn().mockResolvedValue({
          transcript: 'This is a test transcription'
        })
      };
      (getDeepgramServiceWithRecovery as vi.Mock).mockResolvedValue(mockDeepgramService);
      
      // Setup mock LLM service
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue({
          content: 'This is a test response'
        })
      };
      (getLLMService as vi.Mock).mockReturnValue(mockLLMService);
      
      // Call the controller
      await handleWebCallEvent(mockSocket as Socket);
      
      // Get the audio handler
      const audioHandler = (mockSocket.on as vi.Mock).mock.calls.find(
        call => call[0] === 'webcall:audio'
      )[1];
      
      // Mock session state
      let currentSessionId: string | null = 'test-session-id';
      
      // Call the handler
      await audioHandler({
        audio: Buffer.from('test audio data').toString('base64')
      });
      
      // Verify service calls
      expect(webCallService.processUserAudio).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:state', expect.objectContaining({
        status: 'processing'
      }));
      
      // Deepgram should be called
      expect(mockDeepgramService.transcribeAudioWithRecovery).toHaveBeenCalled();
      
      // Transcript should be updated
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:transcript', expect.objectContaining({
        speaker: 'user',
        text: 'This is a test transcription'
      }));
      
      // Agent should respond
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:state', expect.objectContaining({
        status: 'speaking'
      }));
      
      // LLM should be called
      expect(mockLLMService.chat).toHaveBeenCalled();
      
      // Agent response should be sent
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:transcript', expect.objectContaining({
        speaker: 'agent',
        text: 'This is a test response'
      }));
      
      // Audio should be generated
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:agentAudio', expect.any(Object));
    });
    
    it('should handle webcall:end event', async () => {
      // Call the controller
      await handleWebCallEvent(mockSocket as Socket);
      
      // Get the end handler
      const endHandler = (mockSocket.on as vi.Mock).mock.calls.find(
        call => call[0] === 'webcall:end'
      )[1];
      
      // Call the handler
      await endHandler({
        callId: 'test-session-id',
        testId: 'test-test-id'
      });
      
      // API should be called to end the session
      expect(webCallService.endSession).toHaveBeenCalled();
    });
    
    it('should handle webcall:debug event', async () => {
      // Setup mock debug service
      (webCallDebugService.generateDiagnosticInfo as vi.Mock).mockReturnValue({
        sessionId: 'test-session-id',
        metrics: {},
        logs: []
      });
      
      // Call the controller
      await handleWebCallEvent(mockSocket as Socket);
      
      // Get the debug handler
      const debugHandler = (mockSocket.on as vi.Mock).mock.calls.find(
        call => call[0] === 'webcall:debug'
      )[1];
      
      // Mock session state
      let currentSessionId: string | null = 'test-session-id';
      
      // Call the handler
      await debugHandler();
      
      // Debug info should be sent
      expect(webCallDebugService.generateDiagnosticInfo).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('webcall:debugInfo', expect.any(Object));
    });
  });
});