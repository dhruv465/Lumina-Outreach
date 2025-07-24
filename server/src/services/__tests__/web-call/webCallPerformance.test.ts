import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import webCallAudioPipeline from '../../../services/webCallAudioPipeline';
import webCallResponsePipeline from '../../../services/webCallResponsePipeline';
import webCallCircuitBreaker, { ServiceType, CircuitState } from '../../../services/webCallCircuitBreaker';
import { getDeepgramServiceWithRecovery } from '../../../services/deepgramServiceWithRecovery';
import { getLLMService } from '../../../services';
import { getTextToSpeechService } from '../../../services/textToSpeechService';

// Mock dependencies
vi.mock('../../../services/deepgramServiceWithRecovery', () => ({
  getDeepgramServiceWithRecovery: vi.fn().mockResolvedValue({
    transcribeAudioWithRecovery: vi.fn().mockResolvedValue({
      transcript: 'This is a test transcription',
      confidence: 0.95,
      startTime: Date.now()
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

vi.mock('../../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../../services/webCallMetricsService', () => ({
  default: {
    recordComponentLatency: vi.fn(),
    recordSpeechTiming: vi.fn(),
    recordInterruption: vi.fn()
  }
}));

describe('WebCall Performance Optimizations', () => {
  const sessionId = 'test-session-id';
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset circuit breakers
    webCallCircuitBreaker.resetAllCircuits();
    
    // Initialize audio pipeline
    webCallAudioPipeline.initializeSession(sessionId);
  });
  
  afterEach(() => {
    // Clean up
    webCallAudioPipeline.cleanupSession(sessionId);
    webCallResponsePipeline.cleanupSession(sessionId);
  });
  
  describe('WebCallAudioPipeline', () => {
    it('should process audio data efficiently', async () => {
      // Create mock audio buffer
      const audioBuffer = Buffer.from(new ArrayBuffer(16000)); // 1 second of audio at 16kHz
      
      // Set up event listener for processing completion
      const processingCompletePromise = new Promise<any>((resolve) => {
        webCallAudioPipeline.once('processingComplete', (data) => {
          resolve(data);
        });
      });
      
      // Add audio data to pipeline
      await webCallAudioPipeline.addAudioData(sessionId, audioBuffer);
      
      // Wait for processing to complete
      const result = await processingCompletePromise;
      
      // Verify result
      expect(result.sessionId).toBe(sessionId);
      expect(result.result).toBeDefined();
      expect(result.result.transcript).toBe('This is a test transcription');
      expect(result.processingTime).toBeDefined();
      
      // Get metrics
      const metrics = webCallAudioPipeline.getMetrics(sessionId);
      
      // Verify metrics
      expect(metrics).toBeDefined();
      expect(metrics.processedChunks).toBe(1);
      expect(metrics.totalAudioLength).toBe(audioBuffer.length);
    });
    
    it('should detect speech in audio', async () => {
      // Create mock audio buffer with "speech"
      const audioBuffer = Buffer.from(new ArrayBuffer(16000)); // 1 second of audio
      
      // Set up event listeners
      const speechStartPromise = new Promise<any>((resolve) => {
        webCallAudioPipeline.once('speechStart', (data) => {
          resolve(data);
        });
      });
      
      // Mock speech detection
      const detectSpeechSpy = vi.spyOn(webCallAudioPipeline as any, 'detectSpeech');
      detectSpeechSpy.mockResolvedValue(true);
      
      // Add audio data to pipeline
      await webCallAudioPipeline.addAudioData(sessionId, audioBuffer);
      
      // Wait for speech start event
      const result = await speechStartPromise;
      
      // Verify result
      expect(result.sessionId).toBe(sessionId);
      expect(result.timestamp).toBeDefined();
    });
  });
  
  describe('WebCallResponsePipeline', () => {
    it('should generate responses efficiently', async () => {
      // Set up test data
      const userInput = 'This is a test input';
      const systemPrompt = 'You are a helpful assistant';
      const conversationHistory = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      
      // Generate response
      const result = await webCallResponsePipeline.generateResponse(
        sessionId,
        userInput,
        systemPrompt,
        conversationHistory
      );
      
      // Verify result
      expect(result).toBeDefined();
      expect(result.text).toBe('This is a test response');
      expect(result.audio).toBeDefined();
      expect(result.processingTime).toBeDefined();
      expect(result.processingTime.total).toBeGreaterThan(0);
      expect(result.processingTime.llm).toBeGreaterThan(0);
      expect(result.processingTime.tts).toBeGreaterThan(0);
      
      // Get metrics
      const metrics = webCallResponsePipeline.getMetrics(sessionId);
      
      // Verify metrics
      expect(metrics).toBeDefined();
      expect(metrics.processedResponses).toBe(1);
      expect(metrics.llmProcessingTime).toBeGreaterThan(0);
      expect(metrics.ttsProcessingTime).toBeGreaterThan(0);
    });
    
    it('should use caching for repeated requests', async () => {
      // Set up test data
      const userInput = 'This is a test input for caching';
      const systemPrompt = 'You are a helpful assistant';
      const conversationHistory = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      
      // Generate response first time
      await webCallResponsePipeline.generateResponse(
        sessionId,
        userInput,
        systemPrompt,
        conversationHistory
      );
      
      // Mock LLM service to verify it's not called again
      const llmService = getLLMService();
      const chatSpy = vi.spyOn(llmService, 'chat');
      
      // Generate response second time (should use cache)
      await webCallResponsePipeline.generateResponse(
        sessionId,
        userInput,
        systemPrompt,
        conversationHistory
      );
      
      // Verify LLM service was not called again
      expect(chatSpy).not.toHaveBeenCalled();
      
      // Get metrics
      const metrics = webCallResponsePipeline.getMetrics(sessionId);
      
      // Verify metrics
      expect(metrics).toBeDefined();
      expect(metrics.processedResponses).toBe(2);
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.cacheMisses).toBe(1);
    });
    
    it('should analyze session effectively', async () => {
      // Set up test session
      const session = {
        id: sessionId,
        transcript: [
          { speaker: 'user', text: 'Hello', timestamp: new Date(), isFinal: true },
          { speaker: 'agent', text: 'Hi there!', timestamp: new Date(), isFinal: true },
          { speaker: 'user', text: 'How are you?', timestamp: new Date(), isFinal: true },
          { speaker: 'agent', text: 'I am doing well, thank you!', timestamp: new Date(), isFinal: true }
        ]
      };
      
      // Analyze session
      const analysisResult = await webCallResponsePipeline.analyzeSession(
        session as any,
        'You are a helpful assistant'
      );
      
      // Verify result
      expect(analysisResult).toBeDefined();
      expect(analysisResult.sessionId).toBe(sessionId);
      expect(analysisResult.analysis).toBe('This is a test response');
      expect(analysisResult.analysisTime).toBeGreaterThan(0);
    });
  });
  
  describe('WebCallCircuitBreaker', () => {
    it('should protect against service failures', async () => {
      // Set up test function
      const testFn = vi.fn().mockRejectedValue(new Error('Service failure'));
      
      // Execute with circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await webCallCircuitBreaker.executeWithBreaker(
            ServiceType.SPEECH_TO_TEXT,
            testFn
          );
        } catch (error) {
          // Expected error
        }
      }
      
      // Verify circuit is open
      expect(webCallCircuitBreaker.getCircuitState(ServiceType.SPEECH_TO_TEXT)).toBe(CircuitState.OPEN);
      
      // Try to execute again
      const fallbackFn = vi.fn().mockResolvedValue('Fallback result');
      
      try {
        await webCallCircuitBreaker.executeWithBreaker(
          ServiceType.SPEECH_TO_TEXT,
          testFn,
          { fallbackFn }
        );
      } catch (error) {
        // Should not reach here if fallback works
        expect(true).toBe(false);
      }
      
      // Verify fallback was called
      expect(fallbackFn).toHaveBeenCalled();
      
      // Verify original function was not called again
      expect(testFn).toHaveBeenCalledTimes(3);
    });
    
    it('should reset circuit after timeout', async () => {
      // Set up test function
      const testFn = vi.fn().mockRejectedValue(new Error('Service failure'));
      
      // Execute with circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await webCallCircuitBreaker.executeWithBreaker(
            ServiceType.LLM,
            testFn
          );
        } catch (error) {
          // Expected error
        }
      }
      
      // Verify circuit is open
      expect(webCallCircuitBreaker.getCircuitState(ServiceType.LLM)).toBe(CircuitState.OPEN);
      
      // Reset circuit
      webCallCircuitBreaker.resetCircuit(ServiceType.LLM);
      
      // Verify circuit is closed
      expect(webCallCircuitBreaker.getCircuitState(ServiceType.LLM)).toBe(CircuitState.CLOSED);
      
      // Set up success function
      const successFn = vi.fn().mockResolvedValue('Success result');
      
      // Execute with circuit breaker
      const result = await webCallCircuitBreaker.executeWithBreaker(
        ServiceType.LLM,
        successFn
      );
      
      // Verify result
      expect(result).toBe('Success result');
      
      // Verify success function was called
      expect(successFn).toHaveBeenCalled();
    });
    
    it('should provide health information', () => {
      // Get health
      const health = webCallCircuitBreaker.getHealth();
      
      // Verify health
      expect(health).toBeDefined();
      expect(health[ServiceType.SPEECH_TO_TEXT]).toBeDefined();
      expect(health[ServiceType.TEXT_TO_SPEECH]).toBeDefined();
      expect(health[ServiceType.LLM]).toBeDefined();
      expect(health[ServiceType.GENERAL]).toBeDefined();
    });
  });
  
  describe('Performance Benchmarks', () => {
    it('should process audio within acceptable latency', async () => {
      // Create mock audio buffer
      const audioBuffer = Buffer.from(new ArrayBuffer(32000)); // 2 seconds of audio at 16kHz
      
      // Set up event listener for processing completion
      const processingCompletePromise = new Promise<any>((resolve) => {
        webCallAudioPipeline.once('processingComplete', (data) => {
          resolve(data);
        });
      });
      
      // Measure processing time
      const startTime = Date.now();
      
      // Add audio data to pipeline
      await webCallAudioPipeline.addAudioData(sessionId, audioBuffer);
      
      // Wait for processing to complete
      const result = await processingCompletePromise;
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Verify processing time is within acceptable range (less than 500ms)
      // This is a mock test, so actual time will be very fast
      expect(processingTime).toBeLessThan(500);
    });
    
    it('should generate responses within acceptable latency', async () => {
      // Set up test data
      const userInput = 'This is a benchmark test input';
      const systemPrompt = 'You are a helpful assistant';
      const conversationHistory = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      
      // Measure processing time
      const startTime = Date.now();
      
      // Generate response
      await webCallResponsePipeline.generateResponse(
        sessionId,
        userInput,
        systemPrompt,
        conversationHistory
      );
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Verify processing time is within acceptable range (less than 1000ms)
      // This is a mock test, so actual time will be very fast
      expect(processingTime).toBeLessThan(1000);
    });
  });
});