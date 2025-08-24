/**
 * Adaptive Heartbeat Manager
 * 
 * Implements sophisticated adaptive heartbeat frequency algorithms based on
 * connection quality, network conditions, and operational context.
 * 
 * Requirements: 1.1, 5.4
 */

import { EventEmitter } from 'events';
import { HeartbeatService, HeartbeatMetrics } from './HeartbeatService';
import logger from './logger';

export interface NetworkCondition {
  type: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  latency: number;
  jitter: number;
  packetLoss: number;
  stability: number; // 0-1 score
  timestamp: Date;
}

export interface AdaptiveConfig {
  // Base intervals for different network conditions
  excellentInterval: number;    // Interval for excellent networks
  goodInterval: number;         // Interval for good networks
  fairInterval: number;         // Interval for fair networks
  poorInterval: number;         // Interval for poor networks
  criticalInterval: number;     // Interval for critical networks
  
  // Adaptation parameters
  adaptationSensitivity: number;  // How quickly to adapt (0-1)
  stabilityWindow: number;        // Time window for stability assessment (ms)
  jitterThreshold: number;        // Jitter threshold for adaptation (ms)
  
  // Operational context
  pauseDuringIntensiveOps: boolean;  // Pause heartbeat during intensive operations
  intensiveOpThreshold: number;      // CPU/memory threshold for intensive ops
  resumeDelay: number;               // Delay before resuming after intensive ops (ms)
  
  // Advanced features
  predictiveAdaptation: boolean;     // Use predictive algorithms
  learningEnabled: boolean;          // Learn from historical patterns
  timeOfDayOptimization: boolean;    // Optimize based on time of day patterns
}

export interface AdaptiveMetrics {
  currentCondition: NetworkCondition;
  recommendedInterval: number;
  actualInterval: number;
  adaptationHistory: AdaptationEvent[];
  pausedOperations: string[];
  learningData: LearningData;
  performanceScore: number; // 0-100
}

export interface AdaptationEvent {
  timestamp: Date;
  type: 'INTERVAL_CHANGE' | 'CONDITION_CHANGE' | 'PAUSE' | 'RESUME' | 'LEARNING_UPDATE';
  oldValue?: number;
  newValue?: number;
  reason: string;
  context?: Record<string, any>;
}

export interface LearningData {
  optimalIntervals: Map<string, number>; // Network condition -> optimal interval
  patternRecognition: Map<string, number>; // Time pattern -> adjustment factor
  successRates: Map<number, number>; // Interval -> success rate
  lastUpdated: Date;
}

export interface IntensiveOperation {
  id: string;
  type: 'audio_processing' | 'llm_request' | 'tts_generation' | 'file_upload' | 'custom';
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedDuration: number; // ms
  startTime: Date;
  pauseHeartbeat: boolean;
}

export class AdaptiveHeartbeatManager extends EventEmitter {
  private heartbeatService: HeartbeatService;
  private connectionId: string;
  private config: AdaptiveConfig;
  
  // State tracking
  private currentCondition: NetworkCondition;
  private adaptationHistory: AdaptationEvent[] = [];
  private pausedOperations: Map<string, IntensiveOperation> = new Map();
  private learningData: LearningData;
  private isPaused: boolean = false;
  private lastAdaptation: Date = new Date();
  
  // Analysis data
  private latencyHistory: number[] = [];
  private jitterHistory: number[] = [];
  private stabilityHistory: number[] = [];
  private performanceHistory: { interval: number; success: number; timestamp: Date }[] = [];
  
  // Timers
  private analysisInterval?: NodeJS.Timeout;
  private learningInterval?: NodeJS.Timeout;
  
  // Default configuration
  private static readonly DEFAULT_CONFIG: AdaptiveConfig = {
    excellentInterval: 20000,         // 20 seconds for excellent networks (reduced from 45)
    goodInterval: 15000,             // 15 seconds for good networks (reduced from 30)
    fairInterval: 10000,             // 10 seconds for fair networks (reduced from 20)
    poorInterval: 7000,              // 7 seconds for poor networks (reduced from 15)
    criticalInterval: 5000,          // 5 seconds for critical networks (reduced from 10)
    adaptationSensitivity: 0.8,      // Increased from 0.7 for faster adaptation
    stabilityWindow: 180000,         // 3 minute stability window (reduced from 5)
    jitterThreshold: 30,             // 30ms jitter threshold (reduced from 50)
    pauseDuringIntensiveOps: true,
    intensiveOpThreshold: 80,        // 80% CPU/memory threshold
    resumeDelay: 3000,               // 3 second resume delay (reduced from 5)
    predictiveAdaptation: true,
    learningEnabled: true,
    timeOfDayOptimization: false     // Disabled by default
  };

  constructor(
    heartbeatService: HeartbeatService,
    connectionId: string,
    config?: Partial<AdaptiveConfig>
  ) {
    super();
    this.heartbeatService = heartbeatService;
    this.connectionId = connectionId;
    this.config = { ...AdaptiveHeartbeatManager.DEFAULT_CONFIG, ...config };
    
    // Initialize state
    this.currentCondition = {
      type: 'good',
      latency: 0,
      jitter: 0,
      packetLoss: 0,
      stability: 1.0,
      timestamp: new Date()
    };
    
    this.learningData = {
      optimalIntervals: new Map(),
      patternRecognition: new Map(),
      successRates: new Map(),
      lastUpdated: new Date()
    };
    
    this.setupHeartbeatListeners();
    this.startAnalysis();
  }

  /**
   * Start adaptive heartbeat management
   */
  public start(): void {
    logger.info(`Starting adaptive heartbeat manager for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      config: this.config
    });
    
    this.startAnalysis();
    
    if (this.config.learningEnabled) {
      this.startLearning();
    }
  }

  /**
   * Stop adaptive heartbeat management
   */
  public stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = undefined;
    }
    
    if (this.learningInterval) {
      clearInterval(this.learningInterval);
      this.learningInterval = undefined;
    }
    
    logger.info(`Stopped adaptive heartbeat manager for connection ${this.connectionId}`);
  }

  /**
   * Register an intensive operation that may require heartbeat pause
   */
  public registerIntensiveOperation(operation: IntensiveOperation): void {
    this.pausedOperations.set(operation.id, operation);
    
    logger.debug(`Registered intensive operation for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      operationId: operation.id,
      type: operation.type,
      priority: operation.priority,
      pauseHeartbeat: operation.pauseHeartbeat
    });
    
    if (operation.pauseHeartbeat && this.config.pauseDuringIntensiveOps) {
      this.pauseHeartbeat(operation.id, `Intensive operation: ${operation.type}`);
    }
    
    // Auto-complete operation after estimated duration
    if (operation.estimatedDuration > 0) {
      setTimeout(() => {
        this.completeIntensiveOperation(operation.id);
      }, operation.estimatedDuration);
    }
  }

  /**
   * Complete an intensive operation
   */
  public completeIntensiveOperation(operationId: string): void {
    const operation = this.pausedOperations.get(operationId);
    if (!operation) {
      return;
    }
    
    this.pausedOperations.delete(operationId);
    
    logger.debug(`Completed intensive operation for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      operationId,
      duration: Date.now() - operation.startTime.getTime()
    });
    
    if (operation.pauseHeartbeat && this.isPaused) {
      // Check if any other operations require pause
      const stillPaused = Array.from(this.pausedOperations.values()).some(op => op.pauseHeartbeat);
      
      if (!stillPaused) {
        setTimeout(() => {
          this.resumeHeartbeat(operationId, 'All intensive operations completed');
        }, this.config.resumeDelay);
      }
    }
  }

  /**
   * Pause heartbeat for a specific reason
   */
  public pauseHeartbeat(reason: string, context?: string): void {
    if (this.isPaused) {
      return;
    }
    
    this.isPaused = true;
    
    logger.info(`Pausing heartbeat for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      reason,
      context
    });
    
    // Note: We don't actually stop the heartbeat service, just reduce frequency significantly
    // This maintains connection liveness while reducing overhead
    const pausedInterval = Math.max(this.config.criticalInterval * 3, 30000); // At least 30 seconds
    this.updateHeartbeatInterval(pausedInterval, `Paused: ${reason}`);
    
    this.addAdaptationEvent({
      timestamp: new Date(),
      type: 'PAUSE',
      newValue: pausedInterval,
      reason,
      context: { context }
    });
    
    this.emit('heartbeatPaused', { reason, context, connectionId: this.connectionId });
  }

  /**
   * Resume heartbeat after pause
   */
  public resumeHeartbeat(reason: string, context?: string): void {
    if (!this.isPaused) {
      return;
    }
    
    this.isPaused = false;
    
    logger.info(`Resuming heartbeat for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      reason,
      context
    });
    
    // Resume with appropriate interval based on current conditions
    const resumeInterval = this.calculateOptimalInterval(this.currentCondition);
    this.updateHeartbeatInterval(resumeInterval, `Resumed: ${reason}`);
    
    this.addAdaptationEvent({
      timestamp: new Date(),
      type: 'RESUME',
      newValue: resumeInterval,
      reason,
      context: { context }
    });
    
    this.emit('heartbeatResumed', { reason, context, connectionId: this.connectionId });
  }

  /**
   * Get current adaptive metrics
   */
  public getMetrics(): AdaptiveMetrics {
    return {
      currentCondition: this.currentCondition,
      recommendedInterval: this.calculateOptimalInterval(this.currentCondition),
      actualInterval: this.heartbeatService.getMetrics().currentInterval,
      adaptationHistory: [...this.adaptationHistory],
      pausedOperations: Array.from(this.pausedOperations.keys()),
      learningData: {
        optimalIntervals: new Map(this.learningData.optimalIntervals),
        patternRecognition: new Map(this.learningData.patternRecognition),
        successRates: new Map(this.learningData.successRates),
        lastUpdated: this.learningData.lastUpdated
      },
      performanceScore: this.calculatePerformanceScore()
    };
  }

  /**
   * Force adaptation based on external conditions
   */
  public forceAdaptation(condition: Partial<NetworkCondition>, reason: string): void {
    const newCondition: NetworkCondition = {
      ...this.currentCondition,
      ...condition,
      timestamp: new Date()
    };
    
    this.updateNetworkCondition(newCondition, `Forced: ${reason}`);
  }

  /**
   * Get adaptation recommendations
   */
  public getRecommendations(): string[] {
    const recommendations: string[] = [];
    const metrics = this.heartbeatService.getMetrics();
    
    // Analyze current performance
    if (metrics.averageLatency > 1000) {
      recommendations.push('High latency detected - consider increasing heartbeat interval');
    }
    
    if (metrics.missedHeartbeats > 1) {
      recommendations.push('Missed heartbeats detected - consider decreasing interval for better monitoring');
    }
    
    if (this.currentCondition.jitter > this.config.jitterThreshold) {
      recommendations.push('High jitter detected - enable adaptive intervals for better stability');
    }
    
    if (this.pausedOperations.size > 0) {
      recommendations.push('Intensive operations active - heartbeat may be paused or reduced');
    }
    
    if (this.config.learningEnabled && this.learningData.optimalIntervals.size > 5) {
      recommendations.push('Learning data available - intervals are being optimized based on historical performance');
    }
    
    return recommendations;
  }

  /**
   * Clean up old data and optimize memory usage
   */
  public cleanup(): void {
    // Clean adaptation history
    if (this.adaptationHistory.length > 100) {
      this.adaptationHistory = this.adaptationHistory.slice(-50);
    }
    
    // Clean performance history
    if (this.performanceHistory.length > 200) {
      this.performanceHistory = this.performanceHistory.slice(-100);
    }
    
    // Clean analysis data
    if (this.latencyHistory.length > 100) {
      this.latencyHistory = this.latencyHistory.slice(-50);
    }
    
    if (this.jitterHistory.length > 100) {
      this.jitterHistory = this.jitterHistory.slice(-50);
    }
    
    if (this.stabilityHistory.length > 100) {
      this.stabilityHistory = this.stabilityHistory.slice(-50);
    }
    
    // Clean completed operations
    const now = Date.now();
    for (const [id, operation] of this.pausedOperations.entries()) {
      if (now - operation.startTime.getTime() > operation.estimatedDuration * 2) {
        this.pausedOperations.delete(id);
      }
    }
  }

  // Private methods

  private setupHeartbeatListeners(): void {
    // Listen for pong events to analyze latency
    this.heartbeatService.on('pong', (data) => {
      this.analyzeLatency(data.latency);
    });
    
    // Listen for missed heartbeats
    this.heartbeatService.on('missedHeartbeat', (data) => {
      this.handleMissedHeartbeat(data);
    });
    
    // Listen for connection dead events
    this.heartbeatService.on('connectionDead', (data) => {
      this.handleConnectionDead(data);
    });
  }

  private startAnalysis(): void {
    this.analysisInterval = setInterval(() => {
      this.performNetworkAnalysis();
    }, 10000); // Analyze every 10 seconds
  }

  private startLearning(): void {
    this.learningInterval = setInterval(() => {
      this.performLearningUpdate();
    }, 60000); // Learn every minute
  }

  private performNetworkAnalysis(): void {
    const metrics = this.heartbeatService.getMetrics();
    
    // Calculate network condition
    const condition = this.calculateNetworkCondition(metrics);
    
    // Update condition if significantly changed
    if (this.shouldUpdateCondition(condition)) {
      this.updateNetworkCondition(condition, 'Network analysis');
    }
    
    // Record performance data
    this.recordPerformanceData(metrics);
  }

  private calculateNetworkCondition(metrics: HeartbeatMetrics): NetworkCondition {
    const latency = metrics.averageLatency;
    const jitter = this.calculateJitter();
    const packetLoss = this.calculatePacketLoss(metrics);
    const stability = this.calculateStability(metrics);
    
    // Determine condition type based on multiple factors
    let type: NetworkCondition['type'] = 'good';
    
    if (latency < 100 && jitter < 20 && packetLoss < 0.01 && stability > 0.95) {
      type = 'excellent';
    } else if (latency < 300 && jitter < 50 && packetLoss < 0.05 && stability > 0.85) {
      type = 'good';
    } else if (latency < 600 && jitter < 100 && packetLoss < 0.10 && stability > 0.70) {
      type = 'fair';
    } else if (latency < 1200 && jitter < 200 && packetLoss < 0.20 && stability > 0.50) {
      type = 'poor';
    } else {
      type = 'critical';
    }
    
    return {
      type,
      latency,
      jitter,
      packetLoss,
      stability,
      timestamp: new Date()
    };
  }

  private calculateJitter(): number {
    if (this.latencyHistory.length < 2) {
      return 0;
    }
    
    const differences = [];
    for (let i = 1; i < this.latencyHistory.length; i++) {
      differences.push(Math.abs(this.latencyHistory[i] - this.latencyHistory[i - 1]));
    }
    
    return differences.reduce((sum, diff) => sum + diff, 0) / differences.length;
  }

  private calculatePacketLoss(metrics: HeartbeatMetrics): number {
    if (metrics.totalPings === 0) {
      return 0;
    }
    
    return (metrics.totalPings - metrics.totalPongs) / metrics.totalPings;
  }

  private calculateStability(metrics: HeartbeatMetrics): number {
    // Stability based on consistency of response times and missed heartbeats
    const latencyVariance = this.calculateLatencyVariance();
    const missedRatio = metrics.totalPings > 0 ? metrics.missedHeartbeats / metrics.totalPings : 0;
    
    // Higher variance and more missed heartbeats = lower stability
    const latencyStability = Math.max(0, 1 - (latencyVariance / 1000)); // Normalize to 0-1
    const responseStability = Math.max(0, 1 - (missedRatio * 5)); // Penalize missed heartbeats
    
    return (latencyStability + responseStability) / 2;
  }

  private calculateLatencyVariance(): number {
    if (this.latencyHistory.length < 2) {
      return 0;
    }
    
    const mean = this.latencyHistory.reduce((sum, val) => sum + val, 0) / this.latencyHistory.length;
    const squaredDiffs = this.latencyHistory.map(val => Math.pow(val - mean, 2));
    
    return Math.sqrt(squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length);
  }

  private shouldUpdateCondition(newCondition: NetworkCondition): boolean {
    // Update if condition type changed or significant metric changes
    if (newCondition.type !== this.currentCondition.type) {
      return true;
    }
    
    const latencyChange = Math.abs(newCondition.latency - this.currentCondition.latency);
    const jitterChange = Math.abs(newCondition.jitter - this.currentCondition.jitter);
    const stabilityChange = Math.abs(newCondition.stability - this.currentCondition.stability);
    
    return latencyChange > 100 || jitterChange > 25 || stabilityChange > 0.1;
  }

  private updateNetworkCondition(condition: NetworkCondition, reason: string): void {
    const oldCondition = this.currentCondition;
    this.currentCondition = condition;
    
    logger.debug(`Network condition updated for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      oldType: oldCondition.type,
      newType: condition.type,
      latency: condition.latency,
      jitter: condition.jitter,
      stability: condition.stability,
      reason
    });
    
    // Calculate and apply new interval if not paused
    if (!this.isPaused) {
      const newInterval = this.calculateOptimalInterval(condition);
      this.updateHeartbeatInterval(newInterval, reason);
    }
    
    this.addAdaptationEvent({
      timestamp: new Date(),
      type: 'CONDITION_CHANGE',
      reason,
      context: {
        oldCondition: oldCondition.type,
        newCondition: condition.type,
        metrics: {
          latency: condition.latency,
          jitter: condition.jitter,
          stability: condition.stability
        }
      }
    });
    
    this.emit('conditionChanged', { oldCondition, newCondition: condition, connectionId: this.connectionId });
  }

  private calculateOptimalInterval(condition: NetworkCondition): number {
    let baseInterval: number;
    
    // Get base interval for condition type
    switch (condition.type) {
      case 'excellent':
        baseInterval = this.config.excellentInterval;
        break;
      case 'good':
        baseInterval = this.config.goodInterval;
        break;
      case 'fair':
        baseInterval = this.config.fairInterval;
        break;
      case 'poor':
        baseInterval = this.config.poorInterval;
        break;
      case 'critical':
        baseInterval = this.config.criticalInterval;
        break;
      default:
        baseInterval = this.config.goodInterval;
    }
    
    // Apply learning adjustments if enabled
    if (this.config.learningEnabled) {
      const learnedInterval = this.learningData.optimalIntervals.get(condition.type);
      if (learnedInterval) {
        baseInterval = (baseInterval + learnedInterval) / 2; // Average with learned value
      }
    }
    
    // Apply predictive adjustments if enabled
    if (this.config.predictiveAdaptation) {
      baseInterval = this.applyPredictiveAdjustments(baseInterval, condition);
    }
    
    return Math.round(baseInterval);
  }

  private applyPredictiveAdjustments(baseInterval: number, condition: NetworkCondition): number {
    // Adjust based on trends and patterns
    let adjustment = 1.0;
    
    // Trend analysis
    if (this.latencyHistory.length >= 5) {
      const recentLatencies = this.latencyHistory.slice(-5);
      const trend = this.calculateTrend(recentLatencies);
      
      if (trend > 0.1) { // Increasing latency trend
        adjustment *= 1.2; // Increase interval
      } else if (trend < -0.1) { // Decreasing latency trend
        adjustment *= 0.9; // Decrease interval
      }
    }
    
    // Jitter-based adjustment
    if (condition.jitter > this.config.jitterThreshold) {
      adjustment *= 1.1; // Increase interval for high jitter
    }
    
    // Stability-based adjustment
    if (condition.stability < 0.8) {
      adjustment *= 1.15; // Increase interval for low stability
    }
    
    return baseInterval * adjustment;
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }
    
    // Simple linear trend calculation
    const n = values.length;
    const sumX = (n * (n - 1)) / 2; // Sum of indices
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, index) => sum + (index * val), 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6; // Sum of squared indices
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    return slope / (sumY / n); // Normalize by average value
  }

  private updateHeartbeatInterval(newInterval: number, reason: string): void {
    const currentInterval = this.heartbeatService.getMetrics().currentInterval;
    
    if (Math.abs(newInterval - currentInterval) < currentInterval * 0.1) {
      return; // Skip small changes (less than 10%)
    }
    
    // Update the heartbeat service configuration
    (this.heartbeatService as any).currentInterval = newInterval;
    
    logger.debug(`Heartbeat interval updated for connection ${this.connectionId}`, {
      connectionId: this.connectionId,
      oldInterval: currentInterval,
      newInterval,
      reason
    });
    
    this.addAdaptationEvent({
      timestamp: new Date(),
      type: 'INTERVAL_CHANGE',
      oldValue: currentInterval,
      newValue: newInterval,
      reason
    });
    
    this.emit('intervalChanged', {
      oldInterval: currentInterval,
      newInterval,
      reason,
      connectionId: this.connectionId
    });
  }

  private analyzeLatency(latency: number): void {
    this.latencyHistory.push(latency);
    
    // Keep history manageable
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }
  }

  private handleMissedHeartbeat(data: any): void {
    // Record missed heartbeat for stability calculation
    this.stabilityHistory.push(0); // 0 indicates missed heartbeat
    
    if (this.stabilityHistory.length > 100) {
      this.stabilityHistory.shift();
    }
  }

  private handleConnectionDead(data: any): void {
    // Force critical condition when connection is declared dead
    this.updateNetworkCondition({
      type: 'critical',
      latency: 9999,
      jitter: 9999,
      packetLoss: 1.0,
      stability: 0,
      timestamp: new Date()
    }, 'Connection declared dead');
  }

  private recordPerformanceData(metrics: HeartbeatMetrics): void {
    const successRate = metrics.totalPings > 0 ? metrics.totalPongs / metrics.totalPings : 0;
    
    this.performanceHistory.push({
      interval: metrics.currentInterval,
      success: successRate,
      timestamp: new Date()
    });
    
    // Keep history manageable
    if (this.performanceHistory.length > 200) {
      this.performanceHistory.shift();
    }
  }

  private performLearningUpdate(): void {
    if (!this.config.learningEnabled) {
      return;
    }
    
    // Analyze performance data to learn optimal intervals
    const conditionGroups = new Map<string, { intervals: number[]; successes: number[] }>();
    
    // Group performance data by network condition
    for (const perf of this.performanceHistory) {
      // Estimate condition based on success rate and interval
      const estimatedCondition = this.estimateConditionFromPerformance(perf);
      
      if (!conditionGroups.has(estimatedCondition)) {
        conditionGroups.set(estimatedCondition, { intervals: [], successes: [] });
      }
      
      const group = conditionGroups.get(estimatedCondition)!;
      group.intervals.push(perf.interval);
      group.successes.push(perf.success);
    }
    
    // Find optimal intervals for each condition
    for (const [condition, data] of conditionGroups.entries()) {
      if (data.intervals.length >= 5) { // Need sufficient data
        const optimalInterval = this.findOptimalInterval(data.intervals, data.successes);
        this.learningData.optimalIntervals.set(condition, optimalInterval);
      }
    }
    
    this.learningData.lastUpdated = new Date();
    
    this.addAdaptationEvent({
      timestamp: new Date(),
      type: 'LEARNING_UPDATE',
      reason: 'Periodic learning update',
      context: {
        learnedConditions: Array.from(this.learningData.optimalIntervals.keys()),
        dataPoints: this.performanceHistory.length
      }
    });
  }

  private estimateConditionFromPerformance(perf: { interval: number; success: number }): string {
    // Estimate network condition based on interval and success rate
    if (perf.success > 0.95 && perf.interval >= this.config.goodInterval) {
      return 'excellent';
    } else if (perf.success > 0.85 && perf.interval >= this.config.fairInterval) {
      return 'good';
    } else if (perf.success > 0.70 && perf.interval >= this.config.poorInterval) {
      return 'fair';
    } else if (perf.success > 0.50) {
      return 'poor';
    } else {
      return 'critical';
    }
  }

  private findOptimalInterval(intervals: number[], successes: number[]): number {
    // Find interval with best success rate
    let bestInterval = intervals[0];
    let bestSuccess = successes[0];
    
    for (let i = 1; i < intervals.length; i++) {
      if (successes[i] > bestSuccess) {
        bestInterval = intervals[i];
        bestSuccess = successes[i];
      }
    }
    
    return bestInterval;
  }

  private calculatePerformanceScore(): number {
    if (this.performanceHistory.length === 0) {
      return 50; // Neutral score
    }
    
    // Calculate weighted performance score
    const recentPerformance = this.performanceHistory.slice(-20); // Last 20 data points
    const avgSuccess = recentPerformance.reduce((sum, perf) => sum + perf.success, 0) / recentPerformance.length;
    
    // Factor in adaptation effectiveness
    const adaptationScore = this.calculateAdaptationEffectiveness();
    
    return Math.round((avgSuccess * 70) + (adaptationScore * 30)); // Weighted combination
  }

  private calculateAdaptationEffectiveness(): number {
    const recentAdaptations = this.adaptationHistory.slice(-10);
    if (recentAdaptations.length === 0) {
      return 0.5; // Neutral
    }
    
    // Score based on adaptation frequency and success
    const adaptationRate = recentAdaptations.length / 10; // Normalize to 0-1
    const conditionChanges = recentAdaptations.filter(a => a.type === 'CONDITION_CHANGE').length;
    
    // Good adaptation: responsive but not too frequent
    if (adaptationRate > 0.3 && adaptationRate < 0.8 && conditionChanges > 0) {
      return 0.8;
    } else if (adaptationRate < 0.2) {
      return 0.3; // Too slow to adapt
    } else if (adaptationRate > 0.9) {
      return 0.4; // Too frequent, possibly unstable
    } else {
      return 0.6; // Moderate
    }
  }

  private addAdaptationEvent(event: AdaptationEvent): void {
    this.adaptationHistory.push(event);
    
    // Keep history manageable
    if (this.adaptationHistory.length > 200) {
      this.adaptationHistory = this.adaptationHistory.slice(-100);
    }
  }
}