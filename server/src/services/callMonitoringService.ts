/**
 * Call Monitoring Service - Real-time call health tracking and diagnostics
 * 
 * Provides comprehensive monitoring of live calls with real-time alerts,
 * performance metrics, and automated issue detection.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { getCallResilienceService } from './callResilienceService';

export interface CallHealth {
  callId: string;
  overall: 'healthy' | 'warning' | 'critical' | 'failed';
  components: {
    connection: 'healthy' | 'degraded' | 'failed';
    audio: 'healthy' | 'degraded' | 'failed';
    tts: 'healthy' | 'degraded' | 'failed';
    stt: 'healthy' | 'degraded' | 'failed';
    llm: 'healthy' | 'degraded' | 'failed';
  };
  metrics: CallMetrics;
  issues: CallIssue[];
  lastUpdated: Date;
}

export interface CallMetrics {
  duration: number;
  messagesExchanged: number;
  audioLatency: number;
  responseTime: number;
  errorRate: number;
  fallbacksUsed: number;
  connectionStability: number;
  audioQuality: number;
  interruptionCount: number;
  silenceDetected: number;
}

export interface CallIssue {
  id: string;
  type: 'error' | 'warning' | 'info';
  category: 'connection' | 'audio' | 'tts' | 'stt' | 'llm' | 'performance';
  message: string;
  timestamp: Date;
  resolved: boolean;
  impact: 'low' | 'medium' | 'high' | 'critical';
  suggestion?: string;
}

export interface MonitoringConfig {
  healthCheckInterval: number;
  alertThresholds: {
    errorRate: number;
    responseTime: number;
    connectionStability: number;
    audioLatency: number;
  };
  retentionPeriod: number;
  enableRealTimeAlerts: boolean;
  enableAutoRecovery: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: (health: CallHealth) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cooldown: number;
  enabled: boolean;
}

export class CallMonitoringService extends EventEmitter {
  private config: MonitoringConfig;
  private activeCallsHealth: Map<string, CallHealth> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private alertCooldowns: Map<string, Date> = new Map();
  private monitoringTimer: NodeJS.Timeout | null = null;
  private historyRetentionTimer: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<MonitoringConfig> = {}) {
    super();
    
    this.config = {
      healthCheckInterval: 3000, // Reduced from 5000 (3 seconds for faster detection)
      alertThresholds: {
        errorRate: 0.08, // Reduced from 0.1 (8% error rate threshold)
        responseTime: 2000, // Reduced from 3000 (2 seconds response time)
        connectionStability: 0.85, // Increased from 0.8 (85% stability required)
        audioLatency: 300 // Reduced from 500 (300ms latency threshold)
      },
      retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      enableRealTimeAlerts: true,
      enableAutoRecovery: true,
      ...config
    };
    
    this.initializeAlertRules();
    this.startMonitoring();
    this.startHistoryCleanup();
    this.setupServiceCoordination();
  }
  
  /**
   * Initialize default alert rules
   */
  private initializeAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        condition: (health) => health.metrics.errorRate > this.config.alertThresholds.errorRate,
        severity: 'high',
        cooldown: 30000, // Reduced from 60000 (30 seconds)
        enabled: true
      },
      {
        id: 'slow_response_time',
        name: 'Slow Response Time',
        condition: (health) => health.metrics.responseTime > this.config.alertThresholds.responseTime,
        severity: 'medium',
        cooldown: 15000, // Reduced from 30000 (15 seconds)
        enabled: true
      },
      {
        id: 'connection_instability',
        name: 'Connection Instability',
        condition: (health) => health.metrics.connectionStability < this.config.alertThresholds.connectionStability,
        severity: 'high',
        cooldown: 20000, // Reduced from 45000 (20 seconds)
        enabled: true
      },
      {
        id: 'high_audio_latency',
        name: 'High Audio Latency',
        condition: (health) => health.metrics.audioLatency > this.config.alertThresholds.audioLatency,
        severity: 'medium',
        cooldown: 15000, // Reduced from 30000 (15 seconds)
        enabled: true
      },
      {
        id: 'service_failure',
        name: 'Service Component Failure',
        condition: (health) => Object.values(health.components).some(status => status === 'failed'),
        severity: 'critical',
        cooldown: 60000, // Reduced from 120000 (1 minute)
        enabled: true
      },
      {
        id: 'excessive_fallbacks',
        name: 'Excessive Fallback Usage',
        condition: (health) => health.metrics.fallbacksUsed > 3, // Reduced from 5
        severity: 'medium',
        cooldown: 30000, // Reduced from 60000 (30 seconds)
        enabled: true
      },
      {
        id: 'audio_quality_degradation',
        name: 'Audio Quality Degradation',
        condition: (health) => health.metrics.audioQuality < 0.75, // Increased from 0.7
        severity: 'medium',
        cooldown: 15000, // Reduced from 30000 (15 seconds)
        enabled: true
      }
    ];
    
    defaultRules.forEach(rule => {
      this.alertRules.set(rule.id, rule);
    });
    
    logger.info(`Initialized ${defaultRules.length} monitoring alert rules`);
  }
  
  /**
   * Start monitoring active calls
   */
  private startMonitoring(): void {
    this.monitoringTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    
    logger.info('Call monitoring service started');
  }
  
  /**
   * Start history cleanup
   */
  private startHistoryCleanup(): void {
    this.historyRetentionTimer = setInterval(() => {
      this.cleanupHistory();
    }, 60 * 60 * 1000); // Run every hour
  }

  /**
   * Setup coordination with other services
   */
  private setupServiceCoordination(): void {
    try {
      const resilienceService = getCallResilienceService();
      
      // Listen for resilience service cleanup events and coordinate
      resilienceService.on('sessionCleaned', (callId: string) => {
        if (this.activeCallsHealth.has(callId)) {
          this.activeCallsHealth.delete(callId);
          logger.debug(`Monitoring service cleaned up call ${callId} after resilience service cleanup`);
        }
      });
      
      logger.debug('Service coordination setup completed');
    } catch (error) {
      logger.warn('Failed to setup service coordination:', error);
    }
  }
  
  /**
   * Register a call for monitoring
   */
  public registerCall(callId: string): void {
    const health: CallHealth = {
      callId,
      overall: 'healthy',
      components: {
        connection: 'healthy',
        audio: 'healthy',
        tts: 'healthy',
        stt: 'healthy',
        llm: 'healthy'
      },
      metrics: {
        duration: 0,
        messagesExchanged: 0,
        audioLatency: 0,
        responseTime: 0,
        errorRate: 0,
        fallbacksUsed: 0,
        connectionStability: 1.0,
        audioQuality: 1.0,
        interruptionCount: 0,
        silenceDetected: 0
      },
      issues: [],
      lastUpdated: new Date()
    };
    
    this.activeCallsHealth.set(callId, health);
    logger.info(`Call ${callId} registered for monitoring`);
    
    this.emit('callRegistered', callId, health);
  }
  
  /**
   * Update call metrics
   */
  public updateCallMetrics(callId: string, metrics: Partial<CallMetrics>): void {
    const health = this.activeCallsHealth.get(callId);
    if (!health) {
      logger.warn(`Attempted to update metrics for unregistered call ${callId}`);
      return;
    }
    
    // Update metrics
    Object.assign(health.metrics, metrics);
    health.lastUpdated = new Date();
    
    // Recalculate overall health
    this.updateOverallHealth(health);
    
    // Check for alerts
    if (this.config.enableRealTimeAlerts) {
      this.checkAlerts(health);
    }
    
    this.emit('metricsUpdated', callId, health);
  }
  
  /**
   * Report a call issue
   */
  public reportIssue(callId: string, issue: Omit<CallIssue, 'id' | 'timestamp' | 'resolved'>): void {
    const health = this.activeCallsHealth.get(callId);
    if (!health) {
      logger.warn(`Attempted to report issue for unregistered call ${callId}`);
      return;
    }
    
    const callIssue: CallIssue = {
      id: `${callId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false,
      ...issue
    };
    
    health.issues.push(callIssue);
    health.lastUpdated = new Date();
    
    // Update component health based on issue
    this.updateComponentHealth(health, issue.category, issue.impact);
    
    // Update overall health
    this.updateOverallHealth(health);
    
    logger.warn(`Issue reported for call ${callId}:`, callIssue);
    
    this.emit('issueReported', callId, callIssue);
    
    // Trigger auto-recovery if enabled for critical and high impact issues
    if (this.config.enableAutoRecovery && (issue.impact === 'critical' || issue.impact === 'high')) {
      this.triggerAutoRecovery(callId, callIssue);
    }
  }
  
  /**
   * Resolve a call issue
   */
  public resolveIssue(callId: string, issueId: string): void {
    const health = this.activeCallsHealth.get(callId);
    if (!health) {
      return;
    }
    
    const issue = health.issues.find(i => i.id === issueId);
    if (issue) {
      issue.resolved = true;
      health.lastUpdated = new Date();
      
      // Recalculate component health
      this.recalculateComponentHealth(health);
      
      // Update overall health
      this.updateOverallHealth(health);
      
      logger.info(`Issue resolved for call ${callId}: ${issueId}`);
      
      this.emit('issueResolved', callId, issue);
    }
  }
  
  /**
   * Update component health based on issue
   */
  private updateComponentHealth(health: CallHealth, category: string, impact: string): void {
    if (category in health.components) {
      const component = category as keyof typeof health.components;
      
      if (impact === 'critical' || impact === 'high') {
        health.components[component] = 'failed';
      } else if (impact === 'medium') {
        health.components[component] = 'degraded';
      }
    }
  }
  
  /**
   * Recalculate component health based on unresolved issues
   */
  private recalculateComponentHealth(health: CallHealth): void {
    // Reset all components to healthy
    Object.keys(health.components).forEach(component => {
      health.components[component as keyof typeof health.components] = 'healthy';
    });
    
    // Apply unresolved issues
    health.issues
      .filter(issue => !issue.resolved)
      .forEach(issue => {
        this.updateComponentHealth(health, issue.category, issue.impact);
      });
  }
  
  /**
   * Update overall health status
   */
  private updateOverallHealth(health: CallHealth): void {
    const components = Object.values(health.components);
    const unresolvedIssues = health.issues.filter(i => !i.resolved);
    
    // Check for failed components
    if (components.some(status => status === 'failed')) {
      health.overall = 'failed';
    }
    // Check for critical issues
    else if (unresolvedIssues.some(issue => issue.impact === 'critical')) {
      health.overall = 'critical';
    }
    // Check for degraded components or high impact issues
    else if (components.some(status => status === 'degraded') || 
             unresolvedIssues.some(issue => issue.impact === 'high')) {
      health.overall = 'warning';
    }
    // Otherwise healthy
    else {
      health.overall = 'healthy';
    }
  }
  
  /**
   * Perform health checks on all active calls
   */
  private performHealthChecks(): void {
    const resilienceService = getCallResilienceService();
    
    for (const [callId, health] of this.activeCallsHealth) {
      // Get latest call status from resilience service
      const callStatus = resilienceService.getCallStatus(callId);
      
      if (callStatus) {
        // Update metrics based on resilience service data
        this.updateCallMetrics(callId, {
          duration: Date.now() - health.lastUpdated.getTime(),
          connectionStability: callStatus.connectionHealth === 'healthy' ? 1.0 : 
                             callStatus.connectionHealth === 'degraded' ? 0.7 : 0.3,
          errorRate: callStatus.errorCount / Math.max(1, health.metrics.messagesExchanged)
        });
        
        // Update component health based on call status
        if (callStatus.connectionHealth === 'failed') {
          health.components.connection = 'failed';
        } else if (callStatus.connectionHealth === 'degraded') {
          health.components.connection = 'degraded';
        } else {
          health.components.connection = 'healthy';
        }
        
        // Check if call is stale
        const timeSinceUpdate = Date.now() - health.lastUpdated.getTime();
        if (timeSinceUpdate > 60000) { // 1 minute
          this.reportIssue(callId, {
            type: 'warning',
            category: 'connection',
            message: 'No activity detected for over 1 minute',
            impact: 'medium',
            suggestion: 'Check connection status and consider reconnection'
          });
        }
      }
    }
  }
  
  /**
   * Check alerts for a call
   */
  private checkAlerts(health: CallHealth): void {
    for (const [ruleId, rule] of this.alertRules) {
      if (!rule.enabled) {
        continue;
      }
      
      const cooldownKey = `${health.callId}_${ruleId}`;
      const lastAlert = this.alertCooldowns.get(cooldownKey);
      
      // Check cooldown
      if (lastAlert && Date.now() - lastAlert.getTime() < rule.cooldown) {
        continue;
      }
      
      // Check condition
      if (rule.condition(health)) {
        this.alertCooldowns.set(cooldownKey, new Date());
        
        logger.warn(`Alert triggered for call ${health.callId}: ${rule.name}`);
        
        this.emit('alertTriggered', {
          callId: health.callId,
          rule,
          health,
          timestamp: new Date()
        });
      }
    }
  }
  
  /**
   * Trigger auto-recovery for critical issues
   */
  private triggerAutoRecovery(callId: string, issue: CallIssue): void {
    logger.info(`Triggering auto-recovery for call ${callId}: ${issue.message}`);
    
    const resilienceService = getCallResilienceService();
    
    switch (issue.category) {
      case 'connection':
        // Trigger connection recovery
        this.emit('autoRecovery', {
          callId,
          type: 'reconnect',
          reason: issue.message
        });
        break;
        
      case 'audio':
        // Enhanced audio recovery - immediate buffer cleanup and quality optimization
        this.emit('autoRecovery', {
          callId,
          type: 'audio_recovery',
          reason: issue.message
        });
        // Also activate audio fallback if needed
        if (issue.impact === 'critical' || issue.impact === 'high') {
          resilienceService.activateFallback(callId, 'Audio processing failure');
        }
        break;
        
      case 'performance':
        // Performance recovery - optimize processing and reduce quality if needed
        this.emit('autoRecovery', {
          callId,
          type: 'performance_optimization',
          reason: issue.message
        });
        break;
        
      case 'tts':
        // Activate TTS fallback
        resilienceService.activateFallback(callId, 'TTS service failure');
        break;
        
      case 'stt':
        // Activate STT fallback
        resilienceService.activateFallback(callId, 'STT service failure');
        break;
        
      case 'llm':
        // Activate LLM fallback
        resilienceService.activateFallback(callId, 'LLM service failure');
        break;
        
      default:
        logger.warn(`No auto-recovery strategy for category: ${issue.category}`);
    }
  }
  
  /**
   * Get call health status
   */
  public getCallHealth(callId: string): CallHealth | null {
    return this.activeCallsHealth.get(callId) || null;
  }
  
  /**
   * Get all active calls health
   */
  public getAllCallsHealth(): CallHealth[] {
    return Array.from(this.activeCallsHealth.values());
  }
  
  /**
   * Get monitoring statistics
   */
  public getMonitoringStats(): {
    activeCalls: number;
    healthyCalls: number;
    warningCalls: number;
    criticalCalls: number;
    failedCalls: number;
    totalIssues: number;
    resolvedIssues: number;
  } {
    const calls = Array.from(this.activeCallsHealth.values());
    
    return {
      activeCalls: calls.length,
      healthyCalls: calls.filter(c => c.overall === 'healthy').length,
      warningCalls: calls.filter(c => c.overall === 'warning').length,
      criticalCalls: calls.filter(c => c.overall === 'critical').length,
      failedCalls: calls.filter(c => c.overall === 'failed').length,
      totalIssues: calls.reduce((sum, c) => sum + c.issues.length, 0),
      resolvedIssues: calls.reduce((sum, c) => sum + c.issues.filter(i => i.resolved).length, 0)
    };
  }
  
  /**
   * Unregister a call from monitoring
   */
  public unregisterCall(callId: string): void {
    const health = this.activeCallsHealth.get(callId);
    if (health) {
      this.activeCallsHealth.delete(callId);
      logger.info(`Call ${callId} unregistered from monitoring`);
      
      this.emit('callUnregistered', callId, health);
    }
  }
  
  /**
   * Clean up old history
   */
  private cleanupHistory(): void {
    const cutoffTime = Date.now() - this.config.retentionPeriod;
    let removedCount = 0;
    
    for (const [callId, health] of this.activeCallsHealth) {
      if (health.lastUpdated.getTime() < cutoffTime) {
        this.activeCallsHealth.delete(callId);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      logger.info(`Cleaned up ${removedCount} old call monitoring records`);
    }
  }
  
  /**
   * Add custom alert rule
   */
  public addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info(`Added alert rule: ${rule.name}`);
  }
  
  /**
   * Remove alert rule
   */
  public removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    logger.info(`Removed alert rule: ${ruleId}`);
  }
  
  /**
   * Update alert rule
   */
  public updateAlertRule(ruleId: string, updates: Partial<AlertRule>): void {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      Object.assign(rule, updates);
      logger.info(`Updated alert rule: ${ruleId}`);
    }
  }
  
  /**
   * Get all alert rules
   */
  public getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Shutdown monitoring service
   */
  public shutdown(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    if (this.historyRetentionTimer) {
      clearInterval(this.historyRetentionTimer);
      this.historyRetentionTimer = null;
    }
    
    this.activeCallsHealth.clear();
    this.alertRules.clear();
    this.alertCooldowns.clear();
    
    logger.info('Call monitoring service shutdown');
  }
}

// Singleton instance
let monitoringService: CallMonitoringService | null = null;

export function getCallMonitoringService(): CallMonitoringService {
  if (!monitoringService) {
    monitoringService = new CallMonitoringService();
  }
  return monitoringService;
}

export function shutdownCallMonitoringService(): void {
  if (monitoringService) {
    monitoringService.shutdown();
    monitoringService = null;
  }
}