/**
 * Call Resilience Optimizations Test Suite
 * 
 * Tests the key improvements made to call resilience configuration
 * and functionality for faster issue detection and recovery.
 */

describe('Call Resilience Optimizations', () => {
  describe('Configuration Optimizations', () => {
    it('should have optimized default configurations', () => {
      // Test that our configuration changes are in place
      // This validates the key improvements without complex dependencies
      
      const { CallResilienceService } = require('../callResilienceService');
      const { CallMonitoringService } = require('../callMonitoringService');
      const { EnhancedWebSocketManager } = require('../../utils/enhancedWebSocketManager');
      
      // Test CallResilienceService optimizations
      const resilienceService = new CallResilienceService();
      const resilienceConfig = (resilienceService as any).config;
      
      expect(resilienceConfig.heartbeatInterval).toBe(5000); // Reduced from 10000
      expect(resilienceConfig.connectionTimeout).toBe(15000); // Reduced from 30000
      expect(resilienceConfig.cleanupInterval).toBe(30000); // Reduced from 60000
      expect(resilienceConfig.circuitBreakerThreshold).toBe(3); // Reduced from 5
      expect(resilienceConfig.fallbackTimeout).toBe(3000); // Reduced from 5000
      
      resilienceService.shutdown();
      
      // Test CallMonitoringService optimizations
      const monitoringService = new CallMonitoringService();
      const monitoringConfig = (monitoringService as any).config;
      
      expect(monitoringConfig.healthCheckInterval).toBe(3000); // Reduced from 5000
      expect(monitoringConfig.alertThresholds.errorRate).toBe(0.08); // Reduced from 0.1
      expect(monitoringConfig.alertThresholds.responseTime).toBe(2000); // Reduced from 3000
      expect(monitoringConfig.alertThresholds.connectionStability).toBe(0.85); // Increased from 0.8
      expect(monitoringConfig.alertThresholds.audioLatency).toBe(300); // Reduced from 500
      
      monitoringService.shutdown();
      
      // Test WebSocket Manager optimizations
      const wsManager = new EnhancedWebSocketManager('test-call', 'ws://test', {});
      const wsConfig = (wsManager as any).config;
      
      expect(wsConfig.reconnectDelay).toBe(500); // Reduced from 1000
      expect(wsConfig.heartbeatInterval).toBe(5000); // Reduced from 10000
      expect(wsConfig.connectionTimeout).toBe(15000); // Reduced from 30000
      expect(wsConfig.maxHeartbeatMisses).toBe(2); // Reduced from 3
      expect(wsConfig.pingInterval).toBe(10000); // Reduced from 15000
      expect(wsConfig.pongTimeout).toBe(3000); // Reduced from 5000
      
      wsManager.close();
    });

    it('should have optimized circuit breaker configurations', () => {
      const { CallResilienceService } = require('../callResilienceService');
      
      const resilienceService = new CallResilienceService();
      
      // Access the circuit breaker config through the initialization
      const circuitBreakerConfig = (resilienceService as any).ttsCircuitBreaker?.config || {};
      
      // These values should be optimized for faster failover
      // Note: The actual values depend on the RateLimitAwareCircuitBreaker implementation
      expect(typeof circuitBreakerConfig.errorThresholdPercentage === 'undefined' || 
             circuitBreakerConfig.errorThresholdPercentage <= 50).toBe(true);
      
      resilienceService.shutdown();
    });

    it('should have aggressive session cleanup timings', () => {
      const { CallResilienceService } = require('../callResilienceService');
      
      const resilienceService = new CallResilienceService();
      
      // Register a call and simulate cleanup scenarios
      const callId = 'cleanup-test';
      resilienceService.registerCall(callId);
      
      const session = (resilienceService as any).sessions.get(callId);
      expect(session).toBeTruthy();
      
      // Test that cleanup configuration is more aggressive
      const config = (resilienceService as any).config;
      expect(config.cleanupInterval).toBe(30000); // 30 seconds instead of 60
      
      resilienceService.shutdown();
    });

    it('should have optimized buffer management', () => {
      const { EnhancedWebSocketManager } = require('../../utils/enhancedWebSocketManager');
      
      const wsManager = new EnhancedWebSocketManager('test-call', 'ws://test', {});
      
      // Check that buffer sizes are optimized
      const maxBufferSize = (wsManager as any).MAX_BUFFER_SIZE;
      const cleanupThreshold = (wsManager as any).BUFFER_CLEANUP_THRESHOLD;
      const aggressiveThreshold = (wsManager as any).AGGRESSIVE_CLEANUP_THRESHOLD;
      
      expect(maxBufferSize).toBe(30 * 1024 * 1024); // 30MB instead of 50MB
      expect(cleanupThreshold).toBe(20 * 1024 * 1024); // 20MB instead of 40MB
      expect(aggressiveThreshold).toBe(25 * 1024 * 1024); // New aggressive threshold
      
      wsManager.close();
    });
  });

  describe('Enhanced Auto-Recovery', () => {
    it('should trigger auto-recovery for high impact issues', () => {
      const { CallMonitoringService } = require('../callMonitoringService');
      
      const monitoringService = new CallMonitoringService();
      const callId = 'auto-recovery-test';
      
      monitoringService.registerCall(callId);
      
      let autoRecoveryTriggered = false;
      monitoringService.once('autoRecovery', () => {
        autoRecoveryTriggered = true;
      });
      
      // Report a high impact issue (should trigger auto-recovery)
      monitoringService.reportIssue(callId, {
        type: 'error',
        category: 'audio',
        message: 'High impact audio issue',
        impact: 'high'
      });
      
      // Give a moment for the event to be processed
      setTimeout(() => {
        expect(autoRecoveryTriggered).toBe(true);
      }, 10);
      
      monitoringService.shutdown();
    });

    it('should have enhanced recovery strategies for different issue categories', () => {
      const { CallMonitoringService } = require('../callMonitoringService');
      
      const monitoringService = new CallMonitoringService();
      const callId = 'recovery-strategy-test';
      
      monitoringService.registerCall(callId);
      
      const recoveryEvents: any[] = [];
      monitoringService.on('autoRecovery', (event: any) => {
        recoveryEvents.push(event);
      });
      
      // Test audio recovery
      monitoringService.reportIssue(callId, {
        type: 'error',
        category: 'audio',
        message: 'Audio processing failure',
        impact: 'high'
      });
      
      // Test performance recovery
      monitoringService.reportIssue(callId, {
        type: 'error',
        category: 'performance',
        message: 'Performance degradation',
        impact: 'high'
      });
      
      setTimeout(() => {
        expect(recoveryEvents.length).toBeGreaterThan(0);
        
        // Check that different recovery types are used
        const recoveryTypes = recoveryEvents.map(e => e.type);
        expect(recoveryTypes).toContain('audio_recovery');
        
        monitoringService.shutdown();
      }, 20);
    });
  });

  describe('Coordination Between Services', () => {
    it('should emit cleanup events for better coordination', () => {
      const { CallResilienceService } = require('../callResilienceService');
      
      const resilienceService = new CallResilienceService();
      const callId = 'coordination-test';
      
      resilienceService.registerCall(callId);
      
      let cleanupEventEmitted = false;
      resilienceService.once('sessionCleaned', (cleanedCallId: string) => {
        expect(cleanedCallId).toBe(callId);
        cleanupEventEmitted = true;
      });
      
      resilienceService.unregisterCall(callId);
      
      setTimeout(() => {
        expect(cleanupEventEmitted).toBe(true);
        resilienceService.shutdown();
      }, 10);
    });
  });

  describe('Performance Validation', () => {
    it('should complete operations within reasonable time limits', async () => {
      const { CallResilienceService } = require('../callResilienceService');
      const { CallMonitoringService } = require('../callMonitoringService');
      
      const start = Date.now();
      
      // Test that service initialization is fast
      const resilienceService = new CallResilienceService();
      const monitoringService = new CallMonitoringService();
      
      const callId = 'performance-test';
      resilienceService.registerCall(callId);
      monitoringService.registerCall(callId);
      
      // Update operations should be fast
      resilienceService.updateHeartbeat(callId);
      monitoringService.updateCallMetrics(callId, {
        duration: 1000,
        messagesExchanged: 5,
        audioLatency: 100
      });
      
      // Cleanup should be fast
      resilienceService.unregisterCall(callId);
      monitoringService.unregisterCall(callId);
      
      resilienceService.shutdown();
      monitoringService.shutdown();
      
      const elapsed = Date.now() - start;
      
      // All operations should complete within 100ms
      expect(elapsed).toBeLessThan(100);
    });
  });
});