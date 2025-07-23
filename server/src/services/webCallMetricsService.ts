import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { WebCallSession } from './webCallService';
import WebCallTest from '../models/WebCallTest';

/**
 * Interface for component latency metrics
 */
export interface ComponentLatencyMetrics {
  speechToText: number[];
  llmProcessing: number[];
  textToSpeech: number[];
  totalResponse: number[];
  clientProcessing: number[];
}

/**
 * Interface for speech timing metrics
 */
export interface SpeechTimingMetrics {
  userSpeakingTime: number;
  agentSpeakingTime: number;
  silenceDuration: number[];
  turnTakingDelay: number[];
}

/**
 * Interface for interruption metrics
 */
export interface InterruptionMetrics {
  count: number;
  userInterruptingAgent: number;
  agentInterruptingUser: number;
  interruptionTimestamps: number[];
}

/**
 * Interface for real-time metrics
 */
export interface RealTimeMetrics {
  sessionId: string;
  latency: ComponentLatencyMetrics;
  timing: SpeechTimingMetrics;
  interruptions: InterruptionMetrics;
  turnCount: number;
  lastUpdateTime: number;
}

/**
 * Service for collecting and analyzing real-time metrics for web call testing
 */
export class WebCallMetricsService extends EventEmitter {
  private metrics: Map<string, RealTimeMetrics>;
  private readonly METRICS_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  
  constructor() {
    super();
    this.metrics = new Map();
    
    // Set up periodic cleanup
    setInterval(() => {
      this.cleanupOldMetrics();
    }, this.METRICS_CLEANUP_INTERVAL);
    
    logger.info('WebCallMetricsService initialized');
  }
  
  /**
   * Initialize metrics for a new session
   * @param sessionId The session ID
   */
  initializeMetrics(sessionId: string): void {
    const newMetrics: RealTimeMetrics = {
      sessionId,
      latency: {
        speechToText: [],
        llmProcessing: [],
        textToSpeech: [],
        totalResponse: [],
        clientProcessing: []
      },
      timing: {
        userSpeakingTime: 0,
        agentSpeakingTime: 0,
        silenceDuration: [],
        turnTakingDelay: []
      },
      interruptions: {
        count: 0,
        userInterruptingAgent: 0,
        agentInterruptingUser: 0,
        interruptionTimestamps: []
      },
      turnCount: 0,
      lastUpdateTime: Date.now()
    };
    
    this.metrics.set(sessionId, newMetrics);
    logger.info(`Initialized metrics for session ${sessionId}`);
  }
  
  /**
   * Record component latency
   * @param sessionId The session ID
   * @param component The component name
   * @param latency The latency in milliseconds
   */
  recordComponentLatency(
    sessionId: string, 
    component: keyof ComponentLatencyMetrics, 
    latency: number
  ): void {
    const sessionMetrics = this.getSessionMetrics(sessionId);
    if (!sessionMetrics) return;
    
    sessionMetrics.latency[component].push(latency);
    sessionMetrics.lastUpdateTime = Date.now();
    
    // Emit metrics updated event
    this.emit('metrics:latency', {
      sessionId,
      component,
      latency,
      average: this.calculateAverage(sessionMetrics.latency[component]),
      timestamp: Date.now()
    });
    
    logger.debug(`Recorded ${component} latency for session ${sessionId}: ${latency}ms`);
  }
  
  /**
   * Record speech timing
   * @param sessionId The session ID
   * @param speaker The speaker ('user' or 'agent')
   * @param duration The speaking duration in milliseconds
   */
  recordSpeechTiming(
    sessionId: string,
    speaker: 'user' | 'agent',
    duration: number
  ): void {
    const sessionMetrics = this.getSessionMetrics(sessionId);
    if (!sessionMetrics) return;
    
    if (speaker === 'user') {
      sessionMetrics.timing.userSpeakingTime += duration;
    } else {
      sessionMetrics.timing.agentSpeakingTime += duration;
    }
    
    sessionMetrics.lastUpdateTime = Date.now();
    
    // Emit metrics updated event
    this.emit('metrics:speech', {
      sessionId,
      speaker,
      duration,
      totalUserTime: sessionMetrics.timing.userSpeakingTime,
      totalAgentTime: sessionMetrics.timing.agentSpeakingTime,
      timestamp: Date.now()
    });
    
    logger.debug(`Recorded ${speaker} speaking time for session ${sessionId}: ${duration}ms`);
  }
  
  /**
   * Record silence duration
   * @param sessionId The session ID
   * @param duration The silence duration in milliseconds
   */
  recordSilence(sessionId: string, duration: number): void {
    const sessionMetrics = this.getSessionMetrics(sessionId);
    if (!sessionMetrics) return;
    
    sessionMetrics.timing.silenceDuration.push(duration);
    sessionMetrics.lastUpdateTime = Date.now();
    
    // Emit metrics updated event
    this.emit('metrics:silence', {
      sessionId,
      duration,
      average: this.calculateAverage(sessionMetrics.timing.silenceDuration),
      timestamp: Date.now()
    });
    
    logger.debug(`Recorded silence duration for session ${sessionId}: ${duration}ms`);
  }
  
  /**
   * Record turn taking delay
   * @param sessionId The session ID
   * @param delay The delay in milliseconds
   */
  recordTurnTakingDelay(sessionId: string, delay: number): void {
    const sessionMetrics = this.getSessionMetrics(sessionId);
    if (!sessionMetrics) return;
    
    sessionMetrics.timing.turnTakingDelay.push(delay);
    sessionMetrics.lastUpdateTime = Date.now();
    
    // Emit metrics updated event
    this.emit('metrics:turnDelay', {
      sessionId,
      delay,
      average: this.calculateAverage(sessionMetrics.timing.turnTakingDelay),
      timestamp: Date.now()
    });
    
    logger.debug(`Recorded turn taking delay for session ${sessionId}: ${delay}ms`);
  }
  
  /**
   * Record interruption
   * @param sessionId The session ID
   * @param interrupter The interrupter ('user' or 'agent')
   */
  recordInterruption(sessionId: string, interrupter: 'user' | 'agent'): void {
    const sessionMetrics = this.getSessionMetrics(sessionId);
    if (!sessionMetrics) return;
    
    sessionMetrics.interruptions.count++;
    sessionMetrics.interruptions.interruptionTimestamps.push(Date.now());
    
    if (interrupter === 'user') {
      sessionMetrics.interruptions.userInterruptingAgent++;
    } else {
      sessionMetrics.interruptions.agentInterruptingUser++;
    }
    
    sessionMetrics.lastUpdateTime = Date.now();
    
    // Emit metrics updated event
    this.emit('metrics:interruption', {
      sessionId,
      interrupter,
      count: sessionMetrics.interruptions.count,
      userInterrupting: sessionMetrics.interruptions.userInterruptingAgent,
      agentInterrupting: sessionMetrics.interruptions.agentInterruptingUser,
      timestamp: Date.now()
    });
    
    logger.debug(`Recorded interruption by ${interrupter} for session ${sessionId}`);
  }
  
  /**
   * Increment turn count
   * @param sessionId The session ID
   */
  incrementTurnCount(sessionId: string): void {
    const sessionMetrics = this.getSessionMetrics(sessionId);
    if (!sessionMetrics) return;
    
    sessionMetrics.turnCount++;
    sessionMetrics.lastUpdateTime = Date.now();
    
    // Emit metrics updated event
    this.emit('metrics:turn', {
      sessionId,
      turnCount: sessionMetrics.turnCount,
      timestamp: Date.now()
    });
    
    logger.debug(`Incremented turn count for session ${sessionId}: ${sessionMetrics.turnCount}`);
  }
  
  /**
   * Get metrics for a session
   * @param sessionId The session ID
   * @returns The session metrics or null if not found
   */
  getSessionMetrics(sessionId: string): RealTimeMetrics | null {
    return this.metrics.get(sessionId) || null;
  }
  
  /**
   * Get summary metrics for a session
   * @param sessionId The session ID
   * @returns Summary metrics object
   */
  getMetricsSummary(sessionId: string): Record<string, any> | null {
    const metrics = this.getSessionMetrics(sessionId);
    if (!metrics) return null;
    
    return {
      latency: {
        speechToText: {
          avg: this.calculateAverage(metrics.latency.speechToText),
          min: this.calculateMin(metrics.latency.speechToText),
          max: this.calculateMax(metrics.latency.speechToText)
        },
        llmProcessing: {
          avg: this.calculateAverage(metrics.latency.llmProcessing),
          min: this.calculateMin(metrics.latency.llmProcessing),
          max: this.calculateMax(metrics.latency.llmProcessing)
        },
        textToSpeech: {
          avg: this.calculateAverage(metrics.latency.textToSpeech),
          min: this.calculateMin(metrics.latency.textToSpeech),
          max: this.calculateMax(metrics.latency.textToSpeech)
        },
        totalResponse: {
          avg: this.calculateAverage(metrics.latency.totalResponse),
          min: this.calculateMin(metrics.latency.totalResponse),
          max: this.calculateMax(metrics.latency.totalResponse)
        }
      },
      timing: {
        userSpeakingTime: metrics.timing.userSpeakingTime,
        agentSpeakingTime: metrics.timing.agentSpeakingTime,
        silenceDuration: {
          avg: this.calculateAverage(metrics.timing.silenceDuration),
          total: this.calculateSum(metrics.timing.silenceDuration)
        },
        turnTakingDelay: {
          avg: this.calculateAverage(metrics.timing.turnTakingDelay),
          min: this.calculateMin(metrics.timing.turnTakingDelay),
          max: this.calculateMax(metrics.timing.turnTakingDelay)
        }
      },
      interruptions: {
        count: metrics.interruptions.count,
        userInterruptingAgent: metrics.interruptions.userInterruptingAgent,
        agentInterruptingUser: metrics.interruptions.agentInterruptingUser
      },
      turnCount: metrics.turnCount
    };
  }
  
  /**
   * Save metrics to database
   * @param sessionId The session ID
   * @param testId The test ID
   */
  async saveMetricsToDatabase(sessionId: string, testId: string): Promise<void> {
    const metrics = this.getMetricsSummary(sessionId);
    if (!metrics || !testId) return;
    
    try {
      await WebCallTest.findByIdAndUpdate(testId, {
        $set: {
          'metrics.speechToTextLatency': metrics.latency.speechToText.avg,
          'metrics.llmLatency': metrics.latency.llmProcessing.avg,
          'metrics.textToSpeechLatency': metrics.latency.textToSpeech.avg,
          'metrics.responseTime.avg': metrics.latency.totalResponse.avg,
          'metrics.responseTime.min': metrics.latency.totalResponse.min,
          'metrics.responseTime.max': metrics.latency.totalResponse.max,
          'metrics.userSpeakingTime': metrics.timing.userSpeakingTime,
          'metrics.agentSpeakingTime': metrics.timing.agentSpeakingTime,
          'metrics.interruptions': metrics.interruptions.count
        }
      });
      
      logger.info(`Saved metrics for session ${sessionId} to test record ${testId}`);
    } catch (error) {
      logger.error(`Failed to save metrics for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Update session metrics from WebCallSession
   * @param session The web call session
   */
  updateFromSession(session: WebCallSession): void {
    if (!this.metrics.has(session.id)) {
      this.initializeMetrics(session.id);
    }
    
    const metrics = this.getSessionMetrics(session.id);
    if (!metrics) return;
    
    // Update metrics from session data
    metrics.timing.userSpeakingTime = session.metrics.userSpeakingTime;
    metrics.timing.agentSpeakingTime = session.metrics.agentSpeakingTime;
    metrics.interruptions.count = session.metrics.interruptions;
    metrics.turnCount = session.metrics.totalTurns;
    
    // Update latency metrics if available
    if (session.metrics.speechToTextLatency > 0) {
      this.recordComponentLatency(session.id, 'speechToText', session.metrics.speechToTextLatency);
    }
    
    if (session.metrics.llmLatency > 0) {
      this.recordComponentLatency(session.id, 'llmProcessing', session.metrics.llmLatency);
    }
    
    if (session.metrics.textToSpeechLatency > 0) {
      this.recordComponentLatency(session.id, 'textToSpeech', session.metrics.textToSpeechLatency);
    }
    
    if (session.metrics.responseTime.length > 0) {
      session.metrics.responseTime.forEach(time => {
        this.recordComponentLatency(session.id, 'totalResponse', time);
      });
    }
    
    logger.debug(`Updated metrics from session ${session.id}`);
  }
  
  /**
   * Clean up metrics for a session
   * @param sessionId The session ID
   */
  cleanupSessionMetrics(sessionId: string): void {
    this.metrics.delete(sessionId);
    logger.debug(`Cleaned up metrics for session ${sessionId}`);
  }
  
  /**
   * Clean up old metrics
   * Removes metrics that haven't been updated in more than 2 hours
   */
  cleanupOldMetrics(): void {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [sessionId, metrics] of this.metrics.entries()) {
      if (metrics.lastUpdateTime < twoHoursAgo) {
        this.metrics.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleaned up metrics for ${cleanedCount} old sessions`);
    }
  }
  
  /**
   * Calculate average of an array of numbers
   * @param values Array of numbers
   * @returns Average value or 0 if array is empty
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  
  /**
   * Calculate minimum of an array of numbers
   * @param values Array of numbers
   * @returns Minimum value or 0 if array is empty
   */
  private calculateMin(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.min(...values);
  }
  
  /**
   * Calculate maximum of an array of numbers
   * @param values Array of numbers
   * @returns Maximum value or 0 if array is empty
   */
  private calculateMax(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.max(...values);
  }
  
  /**
   * Calculate sum of an array of numbers
   * @param values Array of numbers
   * @returns Sum of values or 0 if array is empty
   */
  private calculateSum(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0);
  }
}

// Create singleton instance
const webCallMetricsService = new WebCallMetricsService();

export default webCallMetricsService;