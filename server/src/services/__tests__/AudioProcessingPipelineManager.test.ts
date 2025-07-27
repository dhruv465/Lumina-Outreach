/**
 * AudioProcessingPipelineManager Tests
 * 
 * Tests for the audio processing pipeline manager with timeout handling
 * and error recovery mechanisms.
 */

import AudioProcessingPipelineManager from '../AudioProcessingPipelineManager';
import AudioProcessingTimeoutHandler from '../AudioProcessingTimeoutHandler';
import { LLMService } from '../llmService';

// Mock dependencies
jest.mock('../llmService');
jest.mock('../textToSpeechService', () => ({
  textToSpeechService: {
    synthesizeSpeech: jest.fn()
  }
}));
jest.mock('../audioProcessingPipeline', () => ({
  audioProcessingPipeline: {
    processBuffer: jest.fn()
  }
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('AudioProcessingPipelineManager', () => {
  let pipelineManager: AudioProcessingPipelineManager;
  let mockLLMService: jest.Mocked<LLMService>;

  beforeEach(() => {
    mockLLMService = new LLMService('test-key') as jest.Mocked<LLMService>;
    pipelineManager = new AudioProcessingPipelineManager(mockLLMService);
  });

  afterEach(() => {
    pipelineManager.shutdown();
    jest.clearAllMocks();
  });

  describe('Task Enqueueing', () => {
    it('should enqueue audio processing task successfully', async () => {
      const taskId = await pipelineManager.enqueueAudioProcessing(
        'session-1',
        'speech_to_text',
        {
          audioData: Buffer.from('test audio data'),
          priority: 'high'
        }
      );

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');

      const task = pipelineManager.getTaskStatus(taskId);
      expect(task).toBeDefined();
      expect(task?.sessionId).toBe('session-1');
      expect(task?.type).toBe('speech_to_text');
      expect(task?.priority).toBe('high');
      expect(task?.status).toBe('queued');
    });

    it('should reject task when queue is full', async () => {
      // Update config to have small queue size
      pipelineManager.updateConfig({ maxQueueSize: 1 });

      // Fill the queue
      await pipelineManager.enqueueAudioProcessing('session-1', 'speech_to_text', {
        audioData: Buffer.from('test')
      });

      // Try to add another task
      await expect(
        pipelineManager.enqueueAudioProcessing('session-2', 'speech_to_text', {
          audioData: Buffer.from('test')
        })
      ).rejects.toThrow('Audio processing queue is full');
    });

    it('should handle different task types', async () => {
      const taskTypes = ['speech_to_text', 'llm_processing', 'text_to_speech', 'audio_analysis'] as const;
      const taskIds: string[] = [];

      for (const taskType of taskTypes) {
        const taskId = await pipelineManager.enqueueAudioProcessing(
          'session-1',
          taskType,
          {
            audioData: taskType === 'llm_processing' ? undefined : Buffer.from('test'),
            textData: taskType === 'text_to_speech' ? 'test text' : undefined,
            messages: taskType === 'llm_processing' ? [{ role: 'user', content: 'test' }] : undefined
          }
        );
        taskIds.push(taskId);
      }

      expect(taskIds).toHaveLength(4);
      taskIds.forEach(taskId => {
        const task = pipelineManager.getTaskStatus(taskId);
        expect(task).toBeDefined();
        expect(task?.status).toBe('queued');
      });
    });
  });

  describe('Session Queue Management', () => {
    it('should track session queue status', async () => {
      const sessionId = 'session-1';
      
      // Enqueue multiple tasks for the same session
      await pipelineManager.enqueueAudioProcessing(sessionId, 'speech_to_text', {
        audioData: Buffer.from('test1')
      });
      await pipelineManager.enqueueAudioProcessing(sessionId, 'llm_processing', {
        messages: [{ role: 'user', content: 'test' }]
      });

      const status = pipelineManager.getSessionQueueStatus(sessionId);
      expect(status.queuedTasks).toBe(2);
      expect(status.processingTasks).toBe(0);
      expect(status.completedTasks).toBe(0);
      expect(status.totalTasks).toBe(2);
    });

    it('should clear session queue', async () => {
      const sessionId = 'session-1';
      
      // Enqueue tasks
      await pipelineManager.enqueueAudioProcessing(sessionId, 'speech_to_text', {
        audioData: Buffer.from('test1')
      });
      await pipelineManager.enqueueAudioProcessing(sessionId, 'speech_to_text', {
        audioData: Buffer.from('test2')
      });

      const cancelledCount = pipelineManager.clearSessionQueue(sessionId);
      expect(cancelledCount).toBe(2);

      const status = pipelineManager.getSessionQueueStatus(sessionId);
      expect(status.totalTasks).toBe(0);
    });
  });

  describe('Task Cancellation', () => {
    it('should cancel queued task', async () => {
      const taskId = await pipelineManager.enqueueAudioProcessing(
        'session-1',
        'speech_to_text',
        { audioData: Buffer.from('test') }
      );

      const cancelled = pipelineManager.cancelTask(taskId);
      expect(cancelled).toBe(true);

      const task = pipelineManager.getTaskStatus(taskId);
      expect(task).toBeUndefined();
    });

    it('should return false when cancelling non-existent task', () => {
      const cancelled = pipelineManager.cancelTask('non-existent-task');
      expect(cancelled).toBe(false);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should provide queue metrics', () => {
      const metrics = pipelineManager.getQueueMetrics();
      
      expect(metrics).toHaveProperty('totalTasks');
      expect(metrics).toHaveProperty('queuedTasks');
      expect(metrics).toHaveProperty('processingTasks');
      expect(metrics).toHaveProperty('completedTasks');
      expect(metrics).toHaveProperty('failedTasks');
      expect(metrics).toHaveProperty('timeoutTasks');
      expect(metrics).toHaveProperty('averageProcessingTime');
      expect(metrics).toHaveProperty('averageQueueTime');
      expect(metrics).toHaveProperty('throughput');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('resourceUtilization');
    });

    it('should provide resource utilization', () => {
      const utilization = pipelineManager.getResourceUtilization();
      
      expect(utilization).toHaveProperty('memoryUsage');
      expect(utilization).toHaveProperty('memoryLimit');
      expect(utilization).toHaveProperty('memoryUtilization');
      expect(utilization).toHaveProperty('cpuUsage');
      expect(utilization).toHaveProperty('activeConnections');
      expect(utilization).toHaveProperty('maxConnections');
      expect(utilization).toHaveProperty('queueCapacity');
      expect(utilization).toHaveProperty('queueUtilization');
    });
  });

  describe('Timeout Handler Integration', () => {
    it('should provide access to timeout handler', () => {
      const timeoutHandler = pipelineManager.getTimeoutHandler();
      expect(timeoutHandler).toBeInstanceOf(AudioProcessingTimeoutHandler);
    });

    it('should get session error history', () => {
      const errorHistory = pipelineManager.getSessionErrorHistory('session-1');
      expect(Array.isArray(errorHistory)).toBe(true);
    });

    it('should get timeout metrics', () => {
      const timeoutMetrics = pipelineManager.getTimeoutMetrics();
      expect(timeoutMetrics).toHaveProperty('totalTimeouts');
      expect(timeoutMetrics).toHaveProperty('timeoutsByStage');
      expect(timeoutMetrics).toHaveProperty('averageRecoveryTime');
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      const originalConfig = pipelineManager.getQueueMetrics();
      
      pipelineManager.updateConfig({
        maxQueueSize: 500,
        maxConcurrentTasks: 5
      });

      const utilization = pipelineManager.getResourceUtilization();
      expect(utilization.queueCapacity).toBe(500);
      expect(utilization.maxConnections).toBe(5);
    });
  });

  describe('Event Emission', () => {
    it('should emit taskEnqueued event', async () => {
      const eventSpy = jest.fn();
      pipelineManager.on('taskEnqueued', eventSpy);

      await pipelineManager.enqueueAudioProcessing('session-1', 'speech_to_text', {
        audioData: Buffer.from('test')
      });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          type: 'speech_to_text'
        })
      );
    });

    it('should emit taskCancelled event', async () => {
      const eventSpy = jest.fn();
      pipelineManager.on('taskCancelled', eventSpy);

      const taskId = await pipelineManager.enqueueAudioProcessing('session-1', 'speech_to_text', {
        audioData: Buffer.from('test')
      });

      pipelineManager.cancelTask(taskId);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId,
          sessionId: 'session-1'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid task data', async () => {
      // Try to enqueue speech-to-text task without audio data
      await expect(
        pipelineManager.enqueueAudioProcessing('session-1', 'speech_to_text', {})
      ).resolves.toBeDefined(); // Should still enqueue but will fail during processing
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', () => {
      expect(() => {
        pipelineManager.shutdown();
      }).not.toThrow();
    });

    it('should cancel all queued tasks on shutdown', async () => {
      // Enqueue some tasks
      await pipelineManager.enqueueAudioProcessing('session-1', 'speech_to_text', {
        audioData: Buffer.from('test1')
      });
      await pipelineManager.enqueueAudioProcessing('session-2', 'speech_to_text', {
        audioData: Buffer.from('test2')
      });

      const metricsBefore = pipelineManager.getQueueMetrics();
      expect(metricsBefore.queuedTasks).toBe(2);

      pipelineManager.shutdown();

      const metricsAfter = pipelineManager.getQueueMetrics();
      expect(metricsAfter.queuedTasks).toBe(0);
    });
  });
});

describe('AudioProcessingTimeoutHandler', () => {
  let timeoutHandler: AudioProcessingTimeoutHandler;

  beforeEach(() => {
    timeoutHandler = new AudioProcessingTimeoutHandler();
  });

  describe('Timeout Configuration', () => {
    it('should set timeout configuration', () => {
      timeoutHandler.setTimeoutConfig('speech_to_text', {
        timeout: 10000,
        maxRetries: 3,
        recoveryStrategy: 'exponential_backoff'
      });

      const config = timeoutHandler.getTimeoutConfig('speech_to_text');
      expect(config.timeout).toBe(10000);
      expect(config.maxRetries).toBe(3);
      expect(config.recoveryStrategy).toBe('exponential_backoff');
    });

    it('should provide default configurations for all stages', () => {
      const stages = [
        'speech_to_text',
        'llm_processing',
        'text_to_speech',
        'audio_analysis',
        'websocket_send',
        'websocket_receive',
        'session_recovery'
      ] as const;

      stages.forEach(stage => {
        const config = timeoutHandler.getTimeoutConfig(stage);
        expect(config).toBeDefined();
        expect(config.stage).toBe(stage);
        expect(config.timeout).toBeGreaterThan(0);
        expect(config.maxRetries).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Timeout Monitoring', () => {
    it('should start and clear timeout', () => {
      timeoutHandler.startTimeout('op-1', 'session-1', 'speech_to_text');
      
      const cleared = timeoutHandler.clearTimeout('op-1');
      expect(cleared).toBe(true);
    });

    it('should return false when clearing non-existent timeout', () => {
      const cleared = timeoutHandler.clearTimeout('non-existent');
      expect(cleared).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle processing error', async () => {
      const error = new Error('Test error');
      
      const result = await timeoutHandler.handleProcessingError(
        'session-1',
        'speech_to_text',
        error,
        { testContext: true }
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });

    it('should classify different error types', async () => {
      const errors = [
        new Error('Operation timed out'),
        new Error('Network connection failed'),
        new Error('Rate limit exceeded'),
        new Error('Authentication failed'),
        new Error('Invalid input data'),
        new Error('Out of memory'),
        new Error('WebSocket protocol error'),
        new Error('Service unavailable')
      ];

      for (const error of errors) {
        const result = await timeoutHandler.handleProcessingError(
          'session-1',
          'speech_to_text',
          error
        );
        expect(result).toBeDefined();
      }
    });
  });

  describe('Circuit Breaker', () => {
    it('should provide circuit breaker status', () => {
      const status = timeoutHandler.getCircuitBreakerStatus('llm_processing');
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('failures');
      expect(['closed', 'open', 'half-open']).toContain(status.state);
    });

    it('should reset circuit breaker', () => {
      timeoutHandler.resetCircuitBreaker('llm_processing');
      
      const status = timeoutHandler.getCircuitBreakerStatus('llm_processing');
      expect(status.state).toBe('closed');
      expect(status.failures).toBe(0);
    });
  });

  describe('Metrics', () => {
    it('should provide timeout metrics', () => {
      const metrics = timeoutHandler.getTimeoutMetrics();
      
      expect(metrics).toHaveProperty('totalTimeouts');
      expect(metrics).toHaveProperty('timeoutsByStage');
      expect(metrics).toHaveProperty('timeoutsByError');
      expect(metrics).toHaveProperty('averageRecoveryTime');
      expect(metrics).toHaveProperty('successfulRecoveries');
      expect(metrics).toHaveProperty('failedRecoveries');
      expect(metrics).toHaveProperty('userNotificationsSent');
      expect(metrics).toHaveProperty('criticalTimeouts');
      expect(metrics).toHaveProperty('recoveryStrategiesUsed');
    });
  });

  describe('Session Error History', () => {
    it('should track session error history', async () => {
      const error = new Error('Test error');
      
      await timeoutHandler.handleProcessingError('session-1', 'speech_to_text', error);
      
      const history = timeoutHandler.getSessionErrorHistory('session-1');
      expect(history).toHaveLength(1);
      expect(history[0].sessionId).toBe('session-1');
      expect(history[0].stage).toBe('speech_to_text');
    });

    it('should limit error history', async () => {
      const error = new Error('Test error');
      
      // Add multiple errors
      for (let i = 0; i < 15; i++) {
        await timeoutHandler.handleProcessingError('session-1', 'speech_to_text', error);
      }
      
      const history = timeoutHandler.getSessionErrorHistory('session-1', 5);
      expect(history).toHaveLength(5);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup expired data', () => {
      expect(() => {
        timeoutHandler.cleanup();
      }).not.toThrow();
    });
  });
});