/**
 * Unit tests for ConnectionHealthMonitor
 */

import { ConnectionHealthMonitor, ConnectionError } from '../ConnectionHealthMonitor';

describe('ConnectionHealthMonitor', () => {
  let monitor: ConnectionHealthMonitor;
  const connectionId = 'test-connection-123';

  beforeEach(() => {
    monitor = new ConnectionHealthMonitor(connectionId);
  });

  describe('Latency Tracking', () => {
    it('should record and calculate average latency', () => {
      monitor.recordLatency(50);
      monitor.recordLatency(100);
      monitor.recordLatency(75);

      const metrics = monitor.getMetrics();
      expect(metrics.averageLatency).toBe(75);
    });

    it('should maintain latency history within limits', () => {
      // Add more than max history size
      for (let i = 0; i < 150; i++) {
        monitor.recordLatency(i);
      }

      const metrics = monitor.getMetrics();
      // Should only keep the last 100 entries (50-149)
      expect(metrics.averageLatency).toBeGreaterThan(99);
    });

    it('should detect high latency issues', () => {
      monitor.recordLatency(1500); // High latency

      const report = monitor.generateHealthReport();
      const highLatencyIssue = report.alerts.find(
        issue => issue.type === 'high_latency'
      );
      
      expect(highLatencyIssue).toBeDefined();
      expect(highLatencyIssue?.severity).toBe('high');
    });
  });

  describe('Error Tracking', () => {
    it('should record and track errors', () => {
      const error: ConnectionError = {
        type: 'network',
        code: 'CONN_TIMEOUT',
        message: 'Connection timeout',
        timestamp: new Date(),
        severity: 'medium'
      };

      monitor.recordError(error);
      const metrics = monitor.getMetrics();
      
      expect(metrics.errorRate).toBeGreaterThan(0);
    });

    it('should create health issues for critical errors', () => {
      const criticalError: ConnectionError = {
        type: 'protocol',
        code: 'PROTOCOL_VIOLATION',
        message: 'WebSocket protocol violation',
        timestamp: new Date(),
        severity: 'critical'
      };

      monitor.recordError(criticalError);
      const report = monitor.generateHealthReport();
      
      expect(report.alerts.length).toBeGreaterThan(0);
      expect(report.alerts[0].severity).toBe('critical');
    });

    it('should not create health issues for low severity errors', () => {
      const lowError: ConnectionError = {
        type: 'network',
        message: 'Minor network hiccup',
        timestamp: new Date(),
        severity: 'low'
      };

      monitor.recordError(lowError);
      const report = monitor.generateHealthReport();
      
      expect(report.alerts.length).toBe(0);
    });
  });

  describe('Reconnection Tracking', () => {
    it('should track successful reconnections', () => {
      monitor.recordReconnection(true);
      monitor.recordReconnection(true);

      const metrics = monitor.getMetrics();
      expect(metrics.reconnectionRate).toBeGreaterThan(0);
    });

    it('should create health issues for failed reconnections', () => {
      monitor.recordReconnection(false);

      const report = monitor.generateHealthReport();
      const reconnectionIssue = report.alerts.find(
        issue => issue.type === 'reconnection_failure'
      );
      
      expect(reconnectionIssue).toBeDefined();
      expect(reconnectionIssue?.severity).toBe('medium');
    });
  });

  describe('Health Assessment', () => {
    it('should calculate excellent health score for good metrics', () => {
      // Add good latency measurements
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(30); // Excellent latency
      }

      const healthScore = monitor.assessConnectionHealth();
      
      expect(healthScore.overall).toBeGreaterThan(85); // Adjusted for uptime calculation
      expect(healthScore.quality).toMatch(/excellent|good/);
      expect(healthScore.latency).toBe(100);
    });

    it('should calculate poor health score for bad metrics', () => {
      // Add poor latency measurements
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(800); // Poor latency
      }

      // Add multiple errors
      for (let i = 0; i < 5; i++) {
        monitor.recordError({
          type: 'network',
          message: 'Network error',
          timestamp: new Date(),
          severity: 'medium'
        });
      }

      const healthScore = monitor.assessConnectionHealth();
      
      expect(healthScore.overall).toBeLessThan(50);
      expect(healthScore.quality).toMatch(/poor|critical/);
    });

    it('should recommend reconnection for poor health', () => {
      // Simulate very poor conditions
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(2000); // Very high latency
        monitor.recordError({
          type: 'protocol',
          message: 'Protocol error',
          timestamp: new Date(),
          severity: 'high'
        });
      }

      expect(monitor.shouldTriggerReconnection()).toBe(true);
    });

    it('should not recommend reconnection for good health', () => {
      // Simulate good conditions
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(50); // Good latency
      }

      expect(monitor.shouldTriggerReconnection()).toBe(false);
    });
  });

  describe('Health Report Generation', () => {
    it('should generate comprehensive health report', () => {
      monitor.recordLatency(100);
      monitor.recordError({
        type: 'network',
        message: 'Test error',
        timestamp: new Date(),
        severity: 'medium'
      });

      const report = monitor.generateHealthReport();
      
      expect(report.connectionId).toBe(connectionId);
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.healthScore).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.alerts).toBeInstanceOf(Array);
    });

    it('should provide recommendations based on health issues', () => {
      // Simulate high latency
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(600);
      }

      const report = monitor.generateHealthReport();
      
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some(rec => 
        rec.includes('latency') || rec.includes('network')
      )).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old resolved issues', () => {
      // Add a resolved issue with old timestamp
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      
      monitor.recordError({
        type: 'network',
        message: 'Old resolved error',
        timestamp: oldTimestamp,
        severity: 'high'
      });

      // Manually mark as resolved (in real implementation, this would happen elsewhere)
      const metrics = monitor.getMetrics();
      if (metrics.issues.length > 0) {
        metrics.issues[0].resolved = true;
        metrics.issues[0].timestamp = oldTimestamp;
      }

      monitor.cleanup();
      
      const reportAfterCleanup = monitor.generateHealthReport();
      expect(reportAfterCleanup.alerts.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty metrics gracefully', () => {
      const metrics = monitor.getMetrics();
      
      expect(metrics.averageLatency).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.reconnectionRate).toBe(0);
    });

    it('should handle health assessment with no data', () => {
      const healthScore = monitor.assessConnectionHealth();
      
      expect(healthScore.overall).toBeGreaterThan(0);
      expect(healthScore.quality).toBeDefined();
    });

    it('should not trigger reconnection with no data', () => {
      expect(monitor.shouldTriggerReconnection()).toBe(false);
    });
  });
});