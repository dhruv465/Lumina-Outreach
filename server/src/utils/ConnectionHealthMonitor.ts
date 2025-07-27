/**
 * Connection Health Monitor
 * 
 * Tracks WebSocket connection health metrics including latency, error rates,
 * and connection quality assessment for Twilio WebSocket stability.
 * 
 * Requirements: 2.1, 2.2, 2.3
 */

export interface ConnectionError {
  type: 'network' | 'protocol' | 'resource' | 'processing' | 'session';
  code?: string;
  message: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, any>;
}

export interface HealthIssue {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
}

export interface ConnectionMetrics {
  connectionId: string;
  averageLatency: number;
  packetLoss: number;
  errorRate: number;
  reconnectionRate: number;
  uptime: number;
  lastHealthCheck: Date;
  healthScore: number; // 0-100
  issues: HealthIssue[];
}

export interface HealthScore {
  overall: number; // 0-100
  latency: number;
  stability: number;
  errorRate: number;
  uptime: number;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export interface HealthReport {
  connectionId: string;
  timestamp: Date;
  healthScore: HealthScore;
  metrics: ConnectionMetrics;
  recommendations: string[];
  alerts: HealthIssue[];
}

export class ConnectionHealthMonitor {
  private connectionId: string;
  private latencyHistory: number[] = [];
  private errorHistory: ConnectionError[] = [];
  private reconnectionHistory: { timestamp: Date; success: boolean }[] = [];
  private connectionStartTime: Date;
  private lastHealthCheck: Date;
  private currentIssues: HealthIssue[] = [];
  
  // Configuration
  private readonly maxHistorySize = 100;
  private readonly healthCheckInterval = 5000; // 5 seconds
  private readonly latencyThresholds = {
    excellent: 50,   // < 50ms
    good: 150,       // < 150ms
    fair: 300,       // < 300ms
    poor: 500        // < 500ms
  };
  private readonly errorRateThresholds = {
    excellent: 0.01, // < 1%
    good: 0.05,      // < 5%
    fair: 0.10,      // < 10%
    poor: 0.20       // < 20%
  };

  constructor(connectionId: string) {
    this.connectionId = connectionId;
    this.connectionStartTime = new Date();
    this.lastHealthCheck = new Date();
  }

  /**
   * Record latency measurement
   */
  recordLatency(latency: number): void {
    this.latencyHistory.push(latency);
    
    // Keep history size manageable
    if (this.latencyHistory.length > this.maxHistorySize) {
      this.latencyHistory.shift();
    }

    // Check for latency issues
    this.checkLatencyIssues(latency);
  }

  /**
   * Record connection error
   */
  recordError(error: ConnectionError): void {
    this.errorHistory.push(error);
    
    // Keep history size manageable
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    // Create health issue for significant errors
    if (error.severity === 'high' || error.severity === 'critical') {
      this.addHealthIssue({
        type: `${error.type}_error`,
        severity: error.severity,
        message: error.message,
        timestamp: error.timestamp,
        resolved: false
      });
    }
  }

  /**
   * Record reconnection attempt
   */
  recordReconnection(success: boolean): void {
    this.reconnectionHistory.push({
      timestamp: new Date(),
      success
    });
    
    // Keep history size manageable
    if (this.reconnectionHistory.length > this.maxHistorySize) {
      this.reconnectionHistory.shift();
    }

    // Track reconnection issues
    if (!success) {
      this.addHealthIssue({
        type: 'reconnection_failure',
        severity: 'medium',
        message: 'Failed to reconnect to WebSocket',
        timestamp: new Date(),
        resolved: false
      });
    }
  }

  /**
   * Assess overall connection health
   */
  assessConnectionHealth(): HealthScore {
    const latencyScore = this.calculateLatencyScore();
    const stabilityScore = this.calculateStabilityScore();
    const errorRateScore = this.calculateErrorRateScore();
    const uptimeScore = this.calculateUptimeScore();
    
    const overall = Math.round(
      (latencyScore * 0.3 + 
       stabilityScore * 0.3 + 
       errorRateScore * 0.25 + 
       uptimeScore * 0.15)
    );

    const quality = this.determineQuality(overall);

    return {
      overall,
      latency: latencyScore,
      stability: stabilityScore,
      errorRate: errorRateScore,
      uptime: uptimeScore,
      quality
    };
  }

  /**
   * Determine if reconnection should be triggered
   */
  shouldTriggerReconnection(): boolean {
    const healthScore = this.assessConnectionHealth();
    
    // Trigger reconnection if overall health is poor or critical
    if (healthScore.overall < 30) {
      return true;
    }

    // Trigger if latency is consistently high
    if (healthScore.latency < 20 && this.getAverageLatency() > 1000) {
      return true;
    }

    // Trigger if error rate is too high
    if (healthScore.errorRate < 25) {
      return true;
    }

    // Check for critical issues
    const criticalIssues = this.currentIssues.filter(
      issue => issue.severity === 'critical' && !issue.resolved
    );
    
    return criticalIssues.length > 0;
  }

  /**
   * Generate comprehensive health report
   */
  generateHealthReport(): HealthReport {
    const healthScore = this.assessConnectionHealth();
    const metrics = this.getMetrics();
    const recommendations = this.generateRecommendations(healthScore);
    const alerts = this.currentIssues.filter(issue => !issue.resolved);

    return {
      connectionId: this.connectionId,
      timestamp: new Date(),
      healthScore,
      metrics,
      recommendations,
      alerts
    };
  }

  /**
   * Get current connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return {
      connectionId: this.connectionId,
      averageLatency: this.getAverageLatency(),
      packetLoss: this.calculatePacketLoss(),
      errorRate: this.calculateErrorRate(),
      reconnectionRate: this.calculateReconnectionRate(),
      uptime: this.getUptime(),
      lastHealthCheck: this.lastHealthCheck,
      healthScore: this.assessConnectionHealth().overall,
      issues: [...this.currentIssues]
    };
  }

  /**
   * Clear resolved issues and old history
   */
  cleanup(): void {
    // Remove resolved issues older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.currentIssues = this.currentIssues.filter(
      issue => !issue.resolved || issue.timestamp > oneHourAgo
    );

    // Clean old error history
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    this.errorHistory = this.errorHistory.filter(
      error => error.timestamp > tenMinutesAgo
    );
  }

  // Private helper methods

  private calculateLatencyScore(): number {
    if (this.latencyHistory.length === 0) return 100;
    
    const avgLatency = this.getAverageLatency();
    
    if (avgLatency < this.latencyThresholds.excellent) return 100;
    if (avgLatency < this.latencyThresholds.good) return 80;
    if (avgLatency < this.latencyThresholds.fair) return 60;
    if (avgLatency < this.latencyThresholds.poor) return 40;
    return 20;
  }

  private calculateStabilityScore(): number {
    const recentReconnections = this.reconnectionHistory.filter(
      r => r.timestamp > new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
    );
    
    if (recentReconnections.length === 0) return 100;
    if (recentReconnections.length <= 2) return 80;
    if (recentReconnections.length <= 5) return 60;
    if (recentReconnections.length <= 10) return 40;
    return 20;
  }

  private calculateErrorRateScore(): number {
    const errorRate = this.calculateErrorRate();
    
    if (errorRate < this.errorRateThresholds.excellent) return 100;
    if (errorRate < this.errorRateThresholds.good) return 80;
    if (errorRate < this.errorRateThresholds.fair) return 60;
    if (errorRate < this.errorRateThresholds.poor) return 40;
    return 20;
  }

  private calculateUptimeScore(): number {
    const uptime = this.getUptime();
    const totalTime = Date.now() - this.connectionStartTime.getTime();
    const uptimePercentage = (uptime / totalTime) * 100;
    
    if (uptimePercentage >= 99) return 100;
    if (uptimePercentage >= 95) return 80;
    if (uptimePercentage >= 90) return 60;
    if (uptimePercentage >= 80) return 40;
    return 20;
  }

  private determineQuality(score: number): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
    if (score >= 90) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    if (score >= 30) return 'poor';
    return 'critical';
  }

  private getAverageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    return this.latencyHistory.reduce((sum, latency) => sum + latency, 0) / this.latencyHistory.length;
  }

  private calculatePacketLoss(): number {
    // Simplified packet loss calculation based on reconnections and errors
    const recentReconnections = this.reconnectionHistory.filter(
      r => r.timestamp > new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
    );
    
    return Math.min(recentReconnections.length * 0.05, 1.0); // Max 100% loss
  }

  private calculateErrorRate(): number {
    const recentErrors = this.errorHistory.filter(
      error => error.timestamp > new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
    );
    
    const totalOperations = Math.max(this.latencyHistory.length, 1);
    return recentErrors.length / totalOperations;
  }

  private calculateReconnectionRate(): number {
    const recentReconnections = this.reconnectionHistory.filter(
      r => r.timestamp > new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
    );
    
    return recentReconnections.length / 10; // Per minute
  }

  private getUptime(): number {
    // Calculate uptime based on connection start time minus downtime from errors
    const totalTime = Date.now() - this.connectionStartTime.getTime();
    const criticalErrors = this.errorHistory.filter(e => e.severity === 'critical');
    const estimatedDowntime = criticalErrors.length * 5000; // 5 seconds per critical error
    
    return Math.max(totalTime - estimatedDowntime, 0);
  }

  private checkLatencyIssues(latency: number): void {
    if (latency > 1000) {
      this.addHealthIssue({
        type: 'high_latency',
        severity: 'high',
        message: `High latency detected: ${latency}ms`,
        timestamp: new Date(),
        resolved: false
      });
    }
  }

  private addHealthIssue(issue: HealthIssue): void {
    // Check if similar issue already exists
    const existingIssue = this.currentIssues.find(
      existing => existing.type === issue.type && !existing.resolved
    );
    
    if (!existingIssue) {
      this.currentIssues.push(issue);
    }
  }

  private generateRecommendations(healthScore: HealthScore): string[] {
    const recommendations: string[] = [];
    
    if (healthScore.latency < 50) {
      recommendations.push('Consider optimizing network routing or switching to a closer server');
    }
    
    if (healthScore.stability < 50) {
      recommendations.push('Investigate frequent reconnections - check network stability');
    }
    
    if (healthScore.errorRate < 50) {
      recommendations.push('High error rate detected - review error logs and implement better error handling');
    }
    
    if (healthScore.uptime < 80) {
      recommendations.push('Poor uptime - consider implementing more robust connection recovery mechanisms');
    }
    
    if (healthScore.overall < 30) {
      recommendations.push('Critical connection health - immediate intervention required');
    }
    
    return recommendations;
  }
}