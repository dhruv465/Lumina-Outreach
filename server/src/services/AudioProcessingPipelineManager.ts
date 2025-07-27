/**
 * Audio Processing Pipeline Manager
 * 
 * Implements comprehensive audio processing queue management with timeout handling
 * for LLM and TTS operations, resource usage monitoring, and throttling capabilities.
 * 
 * Requirements: 3.1, 3.2, 5.1
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import logger from '../utils/logger';
import { LLMService, Message } from './llmService';

import { audioProcessingPipeline } from './audioProcessingPipeline';
import AudioProcessingTimeoutHandler, { 
  ProcessingStage, 
  ProcessingError, 
  RecoveryResult, 
  RecoveryStrategy, 
  ErrorType, 
  ErrorSeverity,
  UserFeedback 
} from './AudioProcessingTimeoutHandler';

export interface AudioProcessingTask {
  id: string;
  sessionId: string;
  type: 'speech_to_text' | 'llm_processing' | 'text_to_speech' | 'audio_analysis';
  priority: 'low' | 'medium' | 'high' | 'critical';
  audioData?: Buffer;
  textData?: string;
  messages?: Message[];
  options?: Record<string, any>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  timeout: number;
  retryCount: number;
  maxRetries: number;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'timeout';
  result?: any;
  error?: string;
  resourceUsage?: TaskResourceUsage;
}

export interface TaskResourceUsage {
  memoryUsed: number;
  cpuTime: number;
  processingTime: number;
  queueTime: number;
  networkTime?: number;
  cacheHits?: number;
  cacheMisses?: number;
}

export interface QueueMetrics {
  totalTasks: number;
  queuedTasks: number;
  processingTasks: number;
  completedTasks: number;
  failedTasks: number;
  timeoutTasks: number;
  averageProcessingTime: number;
  averageQueueTime: number;
  throughput: number; // tasks per second
  errorRate: number;
  resourceUtilization: ResourceUtilization;
}

export interface ResourceUtilization {
  memoryUsage: number; // MB
  memoryLimit: number; // MB
  memoryUtilization: number; // percentage
  cpuUsage: number; // percentage
  activeConnections: number;
  maxConnections: number;
  queueCapacity: number;
  queueUtilization: number; // percentage
}

export interface ProcessingStageConfig {
  name: string;
  timeout: number;
  maxRetries: number;
  concurrency: number;
  resourceLimits: {
    maxMemory: number; // MB
    maxCpuTime: number; // ms
  };
  throttling: {
    enabled: boolean;
    maxRequestsPerSecond: number;
    burstLimit: number;
  };
}

export interface PipelineConfig {
  maxQueueSize: number;
  defaultTimeout: number;
  maxConcurrentTasks: number;
  resourceLimits: {
    maxMemoryUsage: number; // MB
    maxCpuUsage: number; // percentage
  };
  stages: {
    speechToText: ProcessingStageConfig;
    llmProcessing: ProcessingStageConfig;
    textToSpeech: ProcessingStageConfig;
    audioAnalysis: ProcessingStageConfig;
  };
  monitoring: {
    metricsInterval: number;
    alertThresholds: {
      queueSize: number;
      processingTime: number;
      errorRate: number;
      memoryUsage: number;
    };
  };
}

export class AudioProcessingPipelineManager extends EventEmitter {
  private taskQueue: Map<string, AudioProcessingTask> = new Map();
  private processingTasks: Map<string, AudioProcessingTask> = new Map();
  private completedTasks: Map<string, AudioProcessingTask> = new Map();
  private sessionQueues: Map<string, string[]> = new Map();
  
  private config: PipelineConfig;
  private llmService: LLMService;
  private timeoutHandler: AudioProcessingTimeoutHandler;
  private isProcessing: boolean = false;
  private processingInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private resourceMonitor?: NodeJS.Timeout;
  
  // Resource tracking
  private currentMemoryUsage: number = 0;
  private currentCpuUsage: number = 0;
  private taskStartTimes: Map<string, number> = new Map();
  private throughputCounter: number = 0;
  private lastThroughputReset: number = Date.now();
  
  // Throttling
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();
  
  constructor(llmService: LLMService, config?: Partial<PipelineConfig>) {
    super();
    
    this.llmService = llmService;
    this.config = this.mergeConfig(config);
    this.timeoutHandler = new AudioProcessingTimeoutHandler();
    
    this.setupTimeoutHandlerEvents();
    this.startProcessing();
    this.startMetricsCollection();
    this.startResourceMonitoring();
    
    logger.info('AudioProcessingPipelineManager initialized', {
      maxQueueSize: this.config.maxQueueSize,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      stages: Object.keys(this.config.stages)
    });
  }

  /**
   * Enqueue audio processing task
   */
  public async enqueueAudioProcessing(
    sessionId: string,
    taskType: AudioProcessingTask['type'],
    data: {
      audioData?: Buffer;
      textData?: string;
      messages?: Message[];
      options?: Record<string, any>;
      priority?: AudioProcessingTask['priority'];
      timeout?: number;
    }
  ): Promise<string> {
    // Check queue capacity
    if (this.taskQueue.size >= this.config.maxQueueSize) {
      throw new Error('Audio processing queue is full');
    }
    
    // Check throttling
    if (!this.checkThrottling(sessionId, taskType)) {
      throw new Error('Rate limit exceeded for session');
    }
    
    // Create task
    const taskId = this.generateTaskId();
    const task: AudioProcessingTask = {
      id: taskId,
      sessionId,
      type: taskType,
      priority: data.priority || 'medium',
      audioData: data.audioData,
      textData: data.textData,
      messages: data.messages,
      options: data.options || {},
      createdAt: new Date(),
      timeout: data.timeout || this.getStageConfig(taskType).timeout,
      retryCount: 0,
      maxRetries: this.getStageConfig(taskType).maxRetries,
      status: 'queued'
    };
    
    // Add to queue
    this.taskQueue.set(taskId, task);
    
    // Add to session queue
    if (!this.sessionQueues.has(sessionId)) {
      this.sessionQueues.set(sessionId, []);
    }
    this.sessionQueues.get(sessionId)!.push(taskId);
    
    logger.debug(`Enqueued audio processing task`, {
      taskId,
      sessionId,
      type: taskType,
      priority: task.priority,
      queueSize: this.taskQueue.size
    });
    
    this.emit('taskEnqueued', { taskId, sessionId, type: taskType });
    
    return taskId;
  }

  /**
   * Get task status
   */
  public getTaskStatus(taskId: string): AudioProcessingTask | undefined {
    return this.taskQueue.get(taskId) || 
           this.processingTasks.get(taskId) || 
           this.completedTasks.get(taskId);
  }

  /**
   * Get session queue status
   */
  public getSessionQueueStatus(sessionId: string): {
    queuedTasks: number;
    processingTasks: number;
    completedTasks: number;
    totalTasks: number;
  } {
    const sessionTaskIds = this.sessionQueues.get(sessionId) || [];
    
    let queuedTasks = 0;
    let processingTasks = 0;
    let completedTasks = 0;
    
    for (const taskId of sessionTaskIds) {
      const task = this.getTaskStatus(taskId);
      if (task) {
        switch (task.status) {
          case 'queued':
            queuedTasks++;
            break;
          case 'processing':
            processingTasks++;
            break;
          case 'completed':
          case 'failed':
          case 'timeout':
            completedTasks++;
            break;
        }
      }
    }
    
    return {
      queuedTasks,
      processingTasks,
      completedTasks,
      totalTasks: sessionTaskIds.length
    };
  }

  /**
   * Cancel task
   */
  public cancelTask(taskId: string): boolean {
    const task = this.taskQueue.get(taskId);
    if (!task) {
      return false;
    }
    
    this.taskQueue.delete(taskId);
    this.removeFromSessionQueue(task.sessionId, taskId);
    
    logger.info(`Cancelled task ${taskId}`, {
      taskId,
      sessionId: task.sessionId,
      type: task.type
    });
    
    this.emit('taskCancelled', { taskId, sessionId: task.sessionId });
    
    return true;
  }

  /**
   * Clear session queue
   */
  public clearSessionQueue(sessionId: string): number {
    const sessionTaskIds = this.sessionQueues.get(sessionId) || [];
    let cancelledCount = 0;
    
    for (const taskId of sessionTaskIds) {
      if (this.taskQueue.has(taskId)) {
        this.taskQueue.delete(taskId);
        cancelledCount++;
      }
    }
    
    this.sessionQueues.delete(sessionId);
    
    logger.info(`Cleared session queue for ${sessionId}`, {
      sessionId,
      cancelledTasks: cancelledCount
    });
    
    return cancelledCount;
  }

  /**
   * Get queue metrics
   */
  public getQueueMetrics(): QueueMetrics {
    const allTasks = [
      ...Array.from(this.taskQueue.values()),
      ...Array.from(this.processingTasks.values()),
      ...Array.from(this.completedTasks.values())
    ];
    
    const completedTasks = allTasks.filter(t => t.status === 'completed');
    const failedTasks = allTasks.filter(t => t.status === 'failed');
    const timeoutTasks = allTasks.filter(t => t.status === 'timeout');
    
    // Calculate averages
    const totalProcessingTime = completedTasks.reduce((sum, task) => {
      if (task.startedAt && task.completedAt) {
        return sum + (task.completedAt.getTime() - task.startedAt.getTime());
      }
      return sum;
    }, 0);
    
    const totalQueueTime = completedTasks.reduce((sum, task) => {
      if (task.startedAt) {
        return sum + (task.startedAt.getTime() - task.createdAt.getTime());
      }
      return sum;
    }, 0);
    
    const averageProcessingTime = completedTasks.length > 0 ? 
      totalProcessingTime / completedTasks.length : 0;
    const averageQueueTime = completedTasks.length > 0 ? 
      totalQueueTime / completedTasks.length : 0;
    
    // Calculate throughput
    const now = Date.now();
    const timeSinceReset = now - this.lastThroughputReset;
    const throughput = timeSinceReset > 0 ? 
      (this.throughputCounter / timeSinceReset) * 1000 : 0;
    
    // Calculate error rate
    const totalFinishedTasks = completedTasks.length + failedTasks.length + timeoutTasks.length;
    const errorRate = totalFinishedTasks > 0 ? 
      (failedTasks.length + timeoutTasks.length) / totalFinishedTasks : 0;
    
    return {
      totalTasks: allTasks.length,
      queuedTasks: this.taskQueue.size,
      processingTasks: this.processingTasks.size,
      completedTasks: completedTasks.length,
      failedTasks: failedTasks.length,
      timeoutTasks: timeoutTasks.length,
      averageProcessingTime,
      averageQueueTime,
      throughput,
      errorRate,
      resourceUtilization: this.getResourceUtilization()
    };
  }

  /**
   * Get resource utilization
   */
  public getResourceUtilization(): ResourceUtilization {
    return {
      memoryUsage: this.currentMemoryUsage,
      memoryLimit: this.config.resourceLimits.maxMemoryUsage,
      memoryUtilization: (this.currentMemoryUsage / this.config.resourceLimits.maxMemoryUsage) * 100,
      cpuUsage: this.currentCpuUsage,
      activeConnections: this.processingTasks.size,
      maxConnections: this.config.maxConcurrentTasks,
      queueCapacity: this.config.maxQueueSize,
      queueUtilization: (this.taskQueue.size / this.config.maxQueueSize) * 100
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<PipelineConfig>): void {
    this.config = this.mergeConfig(updates);
    
    logger.info('Pipeline configuration updated', {
      updates: Object.keys(updates)
    });
    
    this.emit('configUpdated', { config: this.config });
  }

  /**
   * Shutdown the pipeline manager
   */
  public shutdown(): void {
    this.isProcessing = false;
    
    // Clear intervals
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
    
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
      this.resourceMonitor = undefined;
    }
    
    // Cancel all queued tasks
    const queuedTaskIds = Array.from(this.taskQueue.keys());
    for (const taskId of queuedTaskIds) {
      this.cancelTask(taskId);
    }
    
    // Clean up timeout handler
    this.timeoutHandler.cleanup();
    
    logger.info('AudioProcessingPipelineManager shutdown completed');
  }

  // Private methods

  private mergeConfig(updates?: Partial<PipelineConfig>): PipelineConfig {
    const defaultConfig: PipelineConfig = {
      maxQueueSize: 1000,
      defaultTimeout: 30000,
      maxConcurrentTasks: 10,
      resourceLimits: {
        maxMemoryUsage: 512, // MB
        maxCpuUsage: 80 // percentage
      },
      stages: {
        speechToText: {
          name: 'Speech to Text',
          timeout: 15000,
          maxRetries: 2,
          concurrency: 3,
          resourceLimits: {
            maxMemory: 128,
            maxCpuTime: 10000
          },
          throttling: {
            enabled: true,
            maxRequestsPerSecond: 10,
            burstLimit: 20
          }
        },
        llmProcessing: {
          name: 'LLM Processing',
          timeout: 30000,
          maxRetries: 3,
          concurrency: 5,
          resourceLimits: {
            maxMemory: 256,
            maxCpuTime: 25000
          },
          throttling: {
            enabled: true,
            maxRequestsPerSecond: 5,
            burstLimit: 10
          }
        },
        textToSpeech: {
          name: 'Text to Speech',
          timeout: 20000,
          maxRetries: 2,
          concurrency: 4,
          resourceLimits: {
            maxMemory: 128,
            maxCpuTime: 15000
          },
          throttling: {
            enabled: true,
            maxRequestsPerSecond: 8,
            burstLimit: 15
          }
        },
        audioAnalysis: {
          name: 'Audio Analysis',
          timeout: 10000,
          maxRetries: 1,
          concurrency: 2,
          resourceLimits: {
            maxMemory: 64,
            maxCpuTime: 8000
          },
          throttling: {
            enabled: true,
            maxRequestsPerSecond: 15,
            burstLimit: 25
          }
        }
      },
      monitoring: {
        metricsInterval: 5000,
        alertThresholds: {
          queueSize: 800,
          processingTime: 45000,
          errorRate: 0.1,
          memoryUsage: 400
        }
      }
    };
    
    return updates ? this.deepMerge(defaultConfig, updates) : defaultConfig;
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getStageConfig(taskType: AudioProcessingTask['type']): ProcessingStageConfig {
    switch (taskType) {
      case 'speech_to_text':
        return this.config.stages.speechToText;
      case 'llm_processing':
        return this.config.stages.llmProcessing;
      case 'text_to_speech':
        return this.config.stages.textToSpeech;
      case 'audio_analysis':
        return this.config.stages.audioAnalysis;
      default:
        return this.config.stages.speechToText;
    }
  }

  private checkThrottling(sessionId: string, taskType: AudioProcessingTask['type']): boolean {
    const stageConfig = this.getStageConfig(taskType);
    
    if (!stageConfig.throttling.enabled) {
      return true;
    }
    
    const key = `${sessionId}_${taskType}`;
    const now = Date.now();
    const windowSize = 1000; // 1 second window
    
    let requestData = this.requestCounts.get(key);
    
    if (!requestData || now - requestData.resetTime >= windowSize) {
      requestData = { count: 0, resetTime: now };
      this.requestCounts.set(key, requestData);
    }
    
    if (requestData.count >= stageConfig.throttling.maxRequestsPerSecond) {
      return false;
    }
    
    requestData.count++;
    return true;
  }

  private removeFromSessionQueue(sessionId: string, taskId: string): void {
    const sessionQueue = this.sessionQueues.get(sessionId);
    if (sessionQueue) {
      const index = sessionQueue.indexOf(taskId);
      if (index !== -1) {
        sessionQueue.splice(index, 1);
      }
      
      if (sessionQueue.length === 0) {
        this.sessionQueues.delete(sessionId);
      }
    }
  }

  private startProcessing(): void {
    this.isProcessing = true;
    
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, 100); // Process every 100ms
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoring.metricsInterval);
  }

  private startResourceMonitoring(): void {
    this.resourceMonitor = setInterval(() => {
      this.monitorResources();
    }, 1000); // Monitor every second
  }

  private async processQueue(): Promise<void> {
    if (!this.isProcessing || this.processingTasks.size >= this.config.maxConcurrentTasks) {
      return;
    }
    
    // Get next task by priority
    const nextTask = this.getNextTask();
    if (!nextTask) {
      return;
    }
    
    // Check resource limits
    if (!this.checkResourceLimits(nextTask)) {
      return;
    }
    
    // Move task to processing
    this.taskQueue.delete(nextTask.id);
    this.processingTasks.set(nextTask.id, nextTask);
    
    nextTask.status = 'processing';
    nextTask.startedAt = new Date();
    this.taskStartTimes.set(nextTask.id, performance.now());
    
    logger.debug(`Started processing task ${nextTask.id}`, {
      taskId: nextTask.id,
      sessionId: nextTask.sessionId,
      type: nextTask.type,
      queueTime: nextTask.startedAt.getTime() - nextTask.createdAt.getTime()
    });
    
    this.emit('taskStarted', { 
      taskId: nextTask.id, 
      sessionId: nextTask.sessionId, 
      type: nextTask.type 
    });
    
    // Process task asynchronously
    this.processTask(nextTask).catch(error => {
      logger.error(`Error processing task ${nextTask.id}:`, error);
    });
  }

  private getNextTask(): AudioProcessingTask | undefined {
    const tasks = Array.from(this.taskQueue.values());
    
    if (tasks.length === 0) {
      return undefined;
    }
    
    // Sort by priority and creation time
    tasks.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    
    return tasks[0];
  }

  private checkResourceLimits(task: AudioProcessingTask): boolean {
    const stageConfig = this.getStageConfig(task.type);
    
    // Check memory limit
    if (this.currentMemoryUsage + stageConfig.resourceLimits.maxMemory > 
        this.config.resourceLimits.maxMemoryUsage) {
      return false;
    }
    
    // Check CPU usage
    if (this.currentCpuUsage > this.config.resourceLimits.maxCpuUsage) {
      return false;
    }
    
    return true;
  }

  private async processTask(task: AudioProcessingTask): Promise<void> {
    const startTime = performance.now();
    let result: any;
    let error: string | undefined;
    
    // Start timeout monitoring
    const processingStage = this.mapTaskTypeToStage(task.type);
    this.timeoutHandler.startTimeout(task.id, task.sessionId, processingStage, {
      taskType: task.type,
      priority: task.priority,
      retryCount: task.retryCount
    });
    
    try {
      // Process based on task type
      result = await this.executeTask(task);
      
      task.status = 'completed';
      task.result = result;
      
      // Clear timeout on success
      this.timeoutHandler.clearTimeout(task.id);
      
    } catch (err) {
      const originalError = err instanceof Error ? err : new Error(String(err));
      
      // Clear timeout
      this.timeoutHandler.clearTimeout(task.id);
      
      // Handle error with timeout handler
      const recoveryResult = await this.timeoutHandler.handleProcessingError(
        task.sessionId,
        processingStage,
        originalError,
        {
          taskId: task.id,
          taskType: task.type,
          priority: task.priority,
          retryCount: task.retryCount,
          processingTime: performance.now() - startTime
        }
      );
      
      if (recoveryResult.success && task.retryCount < task.maxRetries) {
        // Retry task based on recovery strategy
        task.retryCount++;
        task.status = 'queued';
        
        logger.warn(`Retrying task ${task.id} (attempt ${task.retryCount})`, {
          taskId: task.id,
          error: originalError.message,
          retryCount: task.retryCount,
          recoveryStrategy: recoveryResult.message
        });
        
        // Re-queue task with potential delay
        this.processingTasks.delete(task.id);
        
        if (recoveryResult.newTimeout) {
          // Delay retry if specified
          setTimeout(() => {
            this.taskQueue.set(task.id, task);
          }, recoveryResult.newTimeout);
        } else {
          this.taskQueue.set(task.id, task);
        }
        
        return;
      } else {
        // Mark as failed
        if (originalError.message.includes('timeout') || originalError.message.includes('Task timeout')) {
          task.status = 'timeout';
          error = 'Processing timeout exceeded';
        } else {
          task.status = 'failed';
          error = originalError.message;
        }
      }
    }
    
    // Complete task
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    const queueTime = this.taskStartTimes.get(task.id) ? 
      this.taskStartTimes.get(task.id)! - task.createdAt.getTime() : 0;
    
    task.completedAt = new Date();
    task.error = error;
    task.resourceUsage = {
      memoryUsed: this.estimateTaskMemoryUsage(task),
      cpuTime: processingTime,
      processingTime,
      queueTime
    };
    
    // Move to completed tasks
    this.processingTasks.delete(task.id);
    this.completedTasks.set(task.id, task);
    
    // Clean up
    this.taskStartTimes.delete(task.id);
    this.throughputCounter++;
    
    // Limit completed tasks history
    if (this.completedTasks.size > 1000) {
      const oldestTasks = Array.from(this.completedTasks.entries())
        .sort(([, a], [, b]) => a.completedAt!.getTime() - b.completedAt!.getTime())
        .slice(0, 200);
      
      for (const [taskId] of oldestTasks) {
        this.completedTasks.delete(taskId);
      }
    }
    
    logger.debug(`Completed task ${task.id}`, {
      taskId: task.id,
      sessionId: task.sessionId,
      type: task.type,
      status: task.status,
      processingTime,
      queueTime,
      retryCount: task.retryCount
    });
    
    this.emit('taskCompleted', {
      taskId: task.id,
      sessionId: task.sessionId,
      type: task.type,
      status: task.status,
      result,
      error,
      processingTime,
      queueTime
    });
  }

  private async executeTask(task: AudioProcessingTask): Promise<any> {
    switch (task.type) {
      case 'speech_to_text':
        return this.executeSpeechToText(task);
      case 'llm_processing':
        return this.executeLLMProcessing(task);
      case 'text_to_speech':
        return this.executeTextToSpeech(task);
      case 'audio_analysis':
        return this.executeAudioAnalysis(task);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  private async executeSpeechToText(task: AudioProcessingTask): Promise<any> {
    if (!task.audioData) {
      throw new Error('Audio data required for speech-to-text processing');
    }
    
    return audioProcessingPipeline.processBuffer(task.audioData, task.options);
  }

  private async executeLLMProcessing(task: AudioProcessingTask): Promise<any> {
    if (!task.messages) {
      throw new Error('Messages required for LLM processing');
    }
    
    return this.llmService.generateResponse(
      task.messages,
      task.options?.provider || 'auto',
      task.options?.config || {}
    );
  }

  private async executeTextToSpeech(task: AudioProcessingTask): Promise<any> {
    if (!task.textData) {
      throw new Error('Text data required for text-to-speech processing');
    }
    
    // Placeholder implementation - would use actual TTS service
    return {
      audioBuffer: Buffer.from('mock-audio-data'),
      duration: task.textData.length * 0.1, // Rough estimate
      format: 'mp3',
      timestamp: new Date()
    };
  }

  private async executeAudioAnalysis(task: AudioProcessingTask): Promise<any> {
    if (!task.audioData) {
      throw new Error('Audio data required for audio analysis');
    }
    
    // Implement audio analysis logic here
    // This could include voice activity detection, emotion analysis, etc.
    return {
      duration: task.audioData.length / 16000, // Assuming 16kHz sample rate
      energy: this.calculateAudioEnergy(task.audioData),
      timestamp: new Date()
    };
  }

  private calculateAudioEnergy(audioData: Buffer): number {
    // Simple energy calculation for demonstration
    const samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.byteLength / 2);
    let sum = 0;
    
    for (let i = 0; i < samples.length; i++) {
      sum += Math.abs(samples[i]);
    }
    
    return sum / samples.length;
  }

  private estimateTaskMemoryUsage(task: AudioProcessingTask): number {
    // Estimate memory usage based on task type and data size
    let baseMemory = 10; // MB base usage
    
    if (task.audioData) {
      baseMemory += task.audioData.length / (1024 * 1024); // Convert bytes to MB
    }
    
    if (task.textData) {
      baseMemory += (task.textData.length * 2) / (1024 * 1024); // Assume UTF-16
    }
    
    // Add type-specific overhead
    switch (task.type) {
      case 'speech_to_text':
        baseMemory *= 1.5;
        break;
      case 'llm_processing':
        baseMemory *= 2.0;
        break;
      case 'text_to_speech':
        baseMemory *= 1.3;
        break;
      case 'audio_analysis':
        baseMemory *= 1.2;
        break;
    }
    
    return baseMemory;
  }

  private collectMetrics(): void {
    const metrics = this.getQueueMetrics();
    
    // Check alert thresholds
    const thresholds = this.config.monitoring.alertThresholds;
    
    if (metrics.queuedTasks > thresholds.queueSize) {
      this.emit('alert', {
        type: 'queue_size',
        message: `Queue size (${metrics.queuedTasks}) exceeds threshold (${thresholds.queueSize})`,
        metrics
      });
    }
    
    if (metrics.averageProcessingTime > thresholds.processingTime) {
      this.emit('alert', {
        type: 'processing_time',
        message: `Average processing time (${metrics.averageProcessingTime}ms) exceeds threshold (${thresholds.processingTime}ms)`,
        metrics
      });
    }
    
    if (metrics.errorRate > thresholds.errorRate) {
      this.emit('alert', {
        type: 'error_rate',
        message: `Error rate (${(metrics.errorRate * 100).toFixed(2)}%) exceeds threshold (${(thresholds.errorRate * 100).toFixed(2)}%)`,
        metrics
      });
    }
    
    if (metrics.resourceUtilization.memoryUsage > thresholds.memoryUsage) {
      this.emit('alert', {
        type: 'memory_usage',
        message: `Memory usage (${metrics.resourceUtilization.memoryUsage}MB) exceeds threshold (${thresholds.memoryUsage}MB)`,
        metrics
      });
    }
    
    this.emit('metrics', metrics);
  }

  private monitorResources(): void {
    // Update current resource usage
    const memUsage = process.memoryUsage();
    this.currentMemoryUsage = memUsage.heapUsed / (1024 * 1024); // Convert to MB
    
    // Simple CPU usage estimation (this would be more sophisticated in production)
    this.currentCpuUsage = Math.min(100, (this.processingTasks.size / this.config.maxConcurrentTasks) * 100);
    
    // Reset throughput counter periodically
    const now = Date.now();
    if (now - this.lastThroughputReset > 60000) { // Reset every minute
      this.throughputCounter = 0;
      this.lastThroughputReset = now;
    }
  }

  private setupTimeoutHandlerEvents(): void {
    // Forward timeout handler events
    this.timeoutHandler.on('timeout', (timeoutEvent) => {
      this.emit('taskTimeout', timeoutEvent);
    });
    
    this.timeoutHandler.on('processingError', (error) => {
      this.emit('processingError', error);
    });
    
    this.timeoutHandler.on('userFeedback', (feedbackEvent) => {
      this.emit('userFeedback', feedbackEvent);
    });
    
    this.timeoutHandler.on('recoveryAttempt', (recoveryEvent) => {
      this.emit('recoveryAttempt', recoveryEvent);
    });
  }

  private mapTaskTypeToStage(taskType: AudioProcessingTask['type']): ProcessingStage {
    switch (taskType) {
      case 'speech_to_text':
        return 'speech_to_text';
      case 'llm_processing':
        return 'llm_processing';
      case 'text_to_speech':
        return 'text_to_speech';
      case 'audio_analysis':
        return 'audio_analysis';
      default:
        return 'audio_analysis';
    }
  }

  /**
   * Get timeout handler instance for advanced configuration
   */
  public getTimeoutHandler(): AudioProcessingTimeoutHandler {
    return this.timeoutHandler;
  }

  /**
   * Get session error history from timeout handler
   */
  public getSessionErrorHistory(sessionId: string, limit?: number) {
    return this.timeoutHandler.getSessionErrorHistory(sessionId, limit);
  }

  /**
   * Get timeout metrics from timeout handler
   */
  public getTimeoutMetrics() {
    return this.timeoutHandler.getTimeoutMetrics();
  }

  /**
   * Enhanced processing timeout and error handling for Twilio WebSocket protocol compliance
   * Requirements: 3.2, 3.4, 2.2
   */

  /**
   * Configure processing timeouts for each stage with Twilio-specific settings
   */
  public configureProcessingTimeouts(stageConfigs: {
    [K in ProcessingStage]?: {
      timeout?: number;
      maxRetries?: number;
      recoveryStrategy?: RecoveryStrategy;
      twilioCompliant?: boolean;
    }
  }): void {
    for (const [stage, config] of Object.entries(stageConfigs)) {
      const processingStage = stage as ProcessingStage;
      
      // Set timeout configuration with Twilio-specific enhancements
      this.timeoutHandler.setTimeoutConfig(processingStage, {
        stage: processingStage,
        timeout: config.timeout || this.getStageConfig(this.mapStageToTaskType(processingStage)).timeout,
        maxRetries: config.maxRetries || this.getStageConfig(this.mapStageToTaskType(processingStage)).maxRetries,
        recoveryStrategy: config.recoveryStrategy || 'exponential_backoff',
        retryCount: 0,
        backoffMultiplier: config.twilioCompliant ? 1.5 : 2, // Gentler backoff for Twilio
        maxBackoffDelay: config.twilioCompliant ? 15000 : 30000, // Shorter max delay for Twilio
        userFeedbackEnabled: true,
        criticalThreshold: config.twilioCompliant ? 30000 : 60000 // Lower threshold for Twilio
      });
      
      logger.info(`Configured processing timeout for stage ${stage}`, {
        stage,
        timeout: config.timeout,
        maxRetries: config.maxRetries,
        twilioCompliant: config.twilioCompliant
      });
    }
  }

  /**
   * Handle Twilio-specific processing errors with protocol compliance
   * Requirement 2.2: Log detailed error information including Twilio error codes and SIDs
   */
  public async handleTwilioProcessingError(
    sessionId: string,
    stage: ProcessingStage,
    error: Error,
    twilioContext: {
      callSid?: string;
      streamSid?: string;
      errorCode?: string;
      errorMessage?: string;
      protocolViolation?: boolean;
      frameFragmented?: boolean;
    } = {}
  ): Promise<RecoveryResult> {
    // Enhanced error context for Twilio
    const enhancedContext = {
      ...twilioContext,
      timestamp: new Date().toISOString(),
      userAgent: 'AudioProcessingPipelineManager',
      twilioSpecific: true,
      protocolCompliance: {
        messageFormat: !twilioContext.protocolViolation,
        frameIntegrity: !twilioContext.frameFragmented,
        errorCode: twilioContext.errorCode
      }
    };

    // Log detailed Twilio error information (Requirement 2.2)
    logger.error('Twilio processing error detected', {
      sessionId,
      stage,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      twilio: {
        callSid: twilioContext.callSid,
        streamSid: twilioContext.streamSid,
        errorCode: twilioContext.errorCode,
        errorMessage: twilioContext.errorMessage,
        protocolViolation: twilioContext.protocolViolation,
        frameFragmented: twilioContext.frameFragmented
      },
      protocolCompliance: enhancedContext.protocolCompliance
    });

    // Handle frame fragmentation specifically (Requirement 3.2)
    if (twilioContext.frameFragmented) {
      logger.warn('WebSocket control frame fragmentation detected', {
        sessionId,
        callSid: twilioContext.callSid,
        streamSid: twilioContext.streamSid,
        stage
      });

      // Emit specific event for frame reconstruction
      this.emit('frameFragmentationDetected', {
        sessionId,
        stage,
        twilioContext: enhancedContext,
        requiresReconstruction: true
      });
    }

    // Handle protocol violations without crashing (Requirement 3.4)
    if (twilioContext.protocolViolation) {
      logger.warn('Twilio WebSocket protocol violation detected', {
        sessionId,
        errorCode: twilioContext.errorCode,
        errorMessage: twilioContext.errorMessage,
        stage
      });

      // Emit protocol violation event for handling
      this.emit('protocolViolationDetected', {
        sessionId,
        stage,
        errorCode: twilioContext.errorCode,
        errorMessage: twilioContext.errorMessage,
        recoveryRequired: true
      });
    }

    // Use timeout handler for recovery with enhanced context
    const recoveryResult = await this.timeoutHandler.handleProcessingError(
      sessionId,
      stage,
      error,
      enhancedContext
    );

    // Enhance recovery result with Twilio-specific information
    if (recoveryResult.userFeedback) {
      recoveryResult.userFeedback.message = this.enhanceTwilioFeedbackMessage(
        recoveryResult.userFeedback.message,
        twilioContext
      );
    }

    return recoveryResult;
  }

  /**
   * Create timeout recovery mechanisms with user feedback
   * Implements configurable timeouts and recovery strategies
   */
  public createTimeoutRecoveryMechanism(
    stage: ProcessingStage,
    customRecovery?: {
      onTimeout?: (context: any) => Promise<RecoveryResult>;
      onError?: (error: ProcessingError) => Promise<RecoveryResult>;
      userFeedbackGenerator?: (error: ProcessingError) => UserFeedback;
    }
  ): void {
    // Configure stage-specific timeout handling
    const stageConfig = this.getStageConfig(this.mapStageToTaskType(stage));
    
    this.timeoutHandler.setTimeoutConfig(stage, {
      stage,
      timeout: stageConfig.timeout,
      maxRetries: stageConfig.maxRetries,
      recoveryStrategy: 'exponential_backoff',
      retryCount: 0,
      backoffMultiplier: 2,
      maxBackoffDelay: 30000,
      userFeedbackEnabled: true,
      criticalThreshold: stageConfig.timeout * 2
    });

    // Set up custom recovery if provided
    if (customRecovery) {
      this.timeoutHandler.on('timeout', async (timeoutEvent) => {
        if (timeoutEvent.stage === stage && customRecovery.onTimeout) {
          try {
            const recoveryResult = await customRecovery.onTimeout(timeoutEvent.context);
            
            logger.info(`Custom timeout recovery executed for stage ${stage}`, {
              stage,
              sessionId: timeoutEvent.sessionId,
              success: recoveryResult.success,
              message: recoveryResult.message
            });

            this.emit('customRecoveryExecuted', {
              stage,
              sessionId: timeoutEvent.sessionId,
              type: 'timeout',
              result: recoveryResult
            });
          } catch (error) {
            logger.error(`Custom timeout recovery failed for stage ${stage}`, {
              stage,
              sessionId: timeoutEvent.sessionId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      });

      this.timeoutHandler.on('processingError', async (processingError) => {
        if (processingError.stage === stage && customRecovery.onError) {
          try {
            const recoveryResult = await customRecovery.onError(processingError);
            
            logger.info(`Custom error recovery executed for stage ${stage}`, {
              stage,
              sessionId: processingError.sessionId,
              errorType: processingError.type,
              success: recoveryResult.success
            });

            this.emit('customRecoveryExecuted', {
              stage,
              sessionId: processingError.sessionId,
              type: 'error',
              result: recoveryResult
            });
          } catch (error) {
            logger.error(`Custom error recovery failed for stage ${stage}`, {
              stage,
              sessionId: processingError.sessionId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      });
    }

    logger.info(`Created timeout recovery mechanism for stage ${stage}`, {
      stage,
      timeout: stageConfig.timeout,
      maxRetries: stageConfig.maxRetries,
      hasCustomRecovery: !!customRecovery
    });
  }

  /**
   * Add processing error classification with Twilio-specific error types
   */
  public classifyProcessingError(
    error: Error,
    stage: ProcessingStage,
    context: Record<string, any> = {}
  ): {
    type: ErrorType;
    severity: ErrorSeverity;
    recoverable: boolean;
    twilioSpecific: boolean;
    requiresProtocolFix: boolean;
  } {
    const errorMessage = error.message.toLowerCase();
    let type: ErrorType = 'unknown_error';
    let severity: ErrorSeverity = 'medium';
    let recoverable = true;
    let twilioSpecific = false;
    let requiresProtocolFix = false;

    // Twilio-specific error classification
    if (errorMessage.includes('twilio') || context.callSid || context.streamSid) {
      twilioSpecific = true;
      
      if (errorMessage.includes('malformed message') || 
          errorMessage.includes('not conformant with websocket protocol')) {
        type = 'protocol_error';
        severity = 'high';
        requiresProtocolFix = true;
      } else if (errorMessage.includes('control frame was fragmented')) {
        type = 'protocol_error';
        severity = 'high';
        requiresProtocolFix = true;
      } else if (errorMessage.includes('stream') && errorMessage.includes('error')) {
        type = 'service_unavailable';
        severity = 'high';
      }
    }

    // General error classification
    if (errorMessage.includes('timeout')) {
      type = 'timeout';
      severity = twilioSpecific ? 'high' : 'medium';
    } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      type = 'network_error';
      severity = 'high';
    } else if (errorMessage.includes('rate limit')) {
      type = 'rate_limit';
      severity = 'medium';
      recoverable = true;
    } else if (errorMessage.includes('memory') || errorMessage.includes('resource')) {
      type = 'resource_exhaustion';
      severity = 'critical';
      recoverable = false;
    }

    return {
      type,
      severity,
      recoverable,
      twilioSpecific,
      requiresProtocolFix
    };
  }

  /**
   * Implement processing error recovery strategies
   */
  public async executeErrorRecoveryStrategy(
    error: ProcessingError,
    strategy: RecoveryStrategy,
    context: Record<string, any> = {}
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    try {
      let result: RecoveryResult;

      switch (strategy) {
        case 'immediate_retry':
          result = await this.executeImmediateRetry(error, context);
          break;
        case 'exponential_backoff':
          result = await this.executeExponentialBackoff(error, context);
          break;
        case 'circuit_breaker':
          result = await this.executeCircuitBreaker(error, context);
          break;
        case 'fallback_service':
          result = await this.executeFallbackService(error, context);
          break;
        case 'graceful_degradation':
          result = await this.executeGracefulDegradation(error, context);
          break;
        case 'user_notification':
          result = await this.executeUserNotification(error, context);
          break;
        case 'session_reset':
          result = await this.executeSessionReset(error, context);
          break;
        default:
          result = {
            success: false,
            message: `Unknown recovery strategy: ${strategy}`
          };
      }

      const recoveryTime = Date.now() - startTime;
      
      logger.info(`Error recovery strategy executed`, {
        errorId: error.id,
        strategy,
        success: result.success,
        recoveryTime,
        message: result.message
      });

      this.emit('recoveryStrategyExecuted', {
        error,
        strategy,
        result,
        recoveryTime
      });

      return result;

    } catch (recoveryError) {
      const recoveryTime = Date.now() - startTime;
      const errorMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      
      logger.error(`Error recovery strategy failed`, {
        errorId: error.id,
        strategy,
        recoveryTime,
        recoveryError: errorMessage
      });

      return {
        success: false,
        message: `Recovery strategy failed: ${errorMessage}`
      };
    }
  }

  // Private helper methods for recovery strategies

  private async executeImmediateRetry(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    if (error.retryCount >= error.maxRetries) {
      return {
        success: false,
        message: 'Maximum retries exceeded',
        userFeedback: {
          type: 'error',
          message: 'Operation failed after multiple attempts',
          severity: 'error',
          actionRequired: true,
          suggestedActions: ['Try again later', 'Check connection']
        }
      };
    }

    return {
      success: true,
      message: 'Retrying immediately',
      userFeedback: {
        type: 'progress',
        message: 'Retrying operation...',
        severity: 'info',
        actionRequired: false,
        progressPercentage: Math.round((error.retryCount / error.maxRetries) * 100)
      }
    };
  }

  private async executeExponentialBackoff(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    if (error.retryCount >= error.maxRetries) {
      return {
        success: false,
        message: 'Maximum retries exceeded with backoff',
        userFeedback: {
          type: 'error',
          message: 'Operation failed after multiple attempts with delays',
          severity: 'error',
          actionRequired: true
        }
      };
    }

    const delay = Math.min(Math.pow(2, error.retryCount) * 1000, 30000);
    error.nextRetryAt = new Date(Date.now() + delay);

    return {
      success: true,
      message: `Retrying with ${delay}ms delay`,
      newTimeout: delay,
      userFeedback: {
        type: 'progress',
        message: `Retrying in ${Math.round(delay / 1000)} seconds...`,
        severity: 'info',
        actionRequired: false,
        estimatedResolutionTime: delay
      }
    };
  }

  private async executeCircuitBreaker(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    // Circuit breaker logic would be implemented here
    // For now, return a basic implementation
    return {
      success: false,
      message: 'Circuit breaker activated - service temporarily unavailable',
      userFeedback: {
        type: 'error',
        message: 'Service temporarily unavailable. Please try again in a few minutes.',
        severity: 'warning',
        actionRequired: false,
        estimatedResolutionTime: 60000
      }
    };
  }

  private async executeFallbackService(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    return {
      success: true,
      message: 'Using fallback service',
      fallbackUsed: true,
      userFeedback: {
        type: 'notification',
        message: 'Using alternative service to continue operation',
        severity: 'info',
        actionRequired: false
      }
    };
  }

  private async executeGracefulDegradation(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    return {
      success: true,
      message: 'Continuing with reduced functionality',
      fallbackUsed: true,
      userFeedback: {
        type: 'notification',
        message: 'Some features are temporarily unavailable, but core functionality continues',
        severity: 'warning',
        actionRequired: false
      }
    };
  }

  private async executeUserNotification(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    return {
      success: true,
      message: 'User notified of issue',
      userFeedback: {
        type: 'error',
        message: `${error.stage} operation failed: ${error.message}`,
        severity: error.severity === 'critical' ? 'critical' : 'error',
        actionRequired: true,
        suggestedActions: [
          'Check your internet connection',
          'Try refreshing the page',
          'Contact support if the issue persists'
        ]
      }
    };
  }

  private async executeSessionReset(error: ProcessingError, context: Record<string, any>): Promise<RecoveryResult> {
    // Emit session reset event
    this.emit('sessionResetRequired', {
      sessionId: error.sessionId,
      reason: error.message,
      stage: error.stage
    });

    return {
      success: true,
      message: 'Session reset initiated',
      userFeedback: {
        type: 'notification',
        message: 'Resetting connection to resolve the issue...',
        severity: 'info',
        actionRequired: false,
        progressPercentage: 0
      }
    };
  }

  private enhanceTwilioFeedbackMessage(message: string, twilioContext: any): string {
    if (twilioContext.callSid) {
      message += ` (Call ID: ${twilioContext.callSid.substring(0, 8)}...)`;
    }
    
    if (twilioContext.errorCode) {
      message += ` [Error: ${twilioContext.errorCode}]`;
    }
    
    if (twilioContext.protocolViolation) {
      message += ' - Protocol compliance issue detected';
    }
    
    if (twilioContext.frameFragmented) {
      message += ' - Frame reconstruction required';
    }
    
    return message;
  }

  private mapStageToTaskType(stage: ProcessingStage): AudioProcessingTask['type'] {
    switch (stage) {
      case 'speech_to_text':
        return 'speech_to_text';
      case 'llm_processing':
        return 'llm_processing';
      case 'text_to_speech':
        return 'text_to_speech';
      case 'audio_analysis':
        return 'audio_analysis';
      default:
        return 'audio_analysis';
    }
  }meoutMetrics() {
    return this.timeoutHandler.getTimeoutMetrics();
  }
}

export default AudioProcessingPipelineManager;