/**
 * Resilience Services Test Suite
 * 
 * Tests the core functionality of call resilience services to ensure
 * they work correctly during various failure scenarios.
 */

import { CallResilienceService } from '../callResilienceService';
import { CallMonitoringService } from '../callMonitoringService';
import { FallbackTTSService } from '../fallbackTTSService';

describe('Call Resilience Services', () => {
  let resilienceService: CallResilienceService;
  let monitoringService: CallMonitoringService;
  let fallbackTTS: FallbackTTSService;
  
  beforeEach(() => {
    resilienceService = new CallResilienceService();
    monitoringService = new CallMonitoringService();
    fallbackTTS = new FallbackTTSService();
  });
  
  afterEach(() => {
    resilienceService.shutdown();
    monitoringService.shutdown();
  });

  describe('CallResilienceService', () => {
    it('should register and unregister calls', () => {
      const callId = 'test-call-1';
      
      resilienceService.registerCall(callId);
      const status = resilienceService.getCallStatus(callId);
      
      expect(status).toBeTruthy();
      expect(status!.callId).toBe(callId);
      expect(status!.connectionHealth).toBe('healthy');
      
      resilienceService.unregisterCall(callId);
      const statusAfter = resilienceService.getCallStatus(callId);
      expect(statusAfter).toBeNull();
    });
    
    it('should track heartbeats', () => {
      const callId = 'test-call-2';
      
      resilienceService.registerCall(callId);
      const initialStatus = resilienceService.getCallStatus(callId);
      const initialHeartbeat = initialStatus!.lastHeartbeat;
      
      // Wait a bit and update heartbeat
      setTimeout(() => {
        resilienceService.updateHeartbeat(callId);
        const updatedStatus = resilienceService.getCallStatus(callId);
        expect(updatedStatus!.lastHeartbeat.getTime()).toBeGreaterThan(initialHeartbeat.getTime());
      }, 10);
    });
    
    it('should report and track errors', () => {
      const callId = 'test-call-3';
      
      resilienceService.registerCall(callId);
      
      const error = new Error('Test error');
      resilienceService.reportError(callId, error, 'test_context');
      
      const status = resilienceService.getCallStatus(callId);
      expect(status!.errorCount).toBe(1);
    });
    
    it('should activate and deactivate fallback mode', () => {
      const callId = 'test-call-4';
      
      resilienceService.registerCall(callId);
      
      resilienceService.activateFallback(callId, 'test reason');
      let status = resilienceService.getCallStatus(callId);
      expect(status!.fallbackActive).toBe(true);
      
      resilienceService.deactivateFallback(callId);
      status = resilienceService.getCallStatus(callId);
      expect(status!.fallbackActive).toBe(false);
    });
  });

  describe('CallMonitoringService', () => {
    it('should register calls for monitoring', () => {
      const callId = 'monitor-test-1';
      
      monitoringService.registerCall(callId);
      const health = monitoringService.getCallHealth(callId);
      
      expect(health).toBeTruthy();
      expect(health!.callId).toBe(callId);
      expect(health!.overall).toBe('healthy');
    });
    
    it('should update call metrics', () => {
      const callId = 'monitor-test-2';
      
      monitoringService.registerCall(callId);
      
      monitoringService.updateCallMetrics(callId, {
        duration: 5000,
        messagesExchanged: 10,
        audioLatency: 200
      });
      
      const health = monitoringService.getCallHealth(callId);
      expect(health!.metrics.duration).toBe(5000);
      expect(health!.metrics.messagesExchanged).toBe(10);
      expect(health!.metrics.audioLatency).toBe(200);
    });
    
    it('should report and resolve issues', () => {
      const callId = 'monitor-test-3';
      
      monitoringService.registerCall(callId);
      
      monitoringService.reportIssue(callId, {
        type: 'warning',
        category: 'connection',
        message: 'Test issue',
        impact: 'medium'
      });
      
      let health = monitoringService.getCallHealth(callId);
      expect(health!.issues.length).toBe(1);
      expect(health!.issues[0].resolved).toBe(false);
      
      const issueId = health!.issues[0].id;
      monitoringService.resolveIssue(callId, issueId);
      
      health = monitoringService.getCallHealth(callId);
      expect(health!.issues[0].resolved).toBe(true);
    });
    
    it('should track monitoring statistics', () => {
      const callId1 = 'stats-test-1';
      const callId2 = 'stats-test-2';
      
      monitoringService.registerCall(callId1);
      monitoringService.registerCall(callId2);
      
      // Report an issue for one call
      monitoringService.reportIssue(callId1, {
        type: 'error',
        category: 'audio',
        message: 'Audio processing error',
        impact: 'high'
      });
      
      const stats = monitoringService.getMonitoringStats();
      expect(stats.activeCalls).toBe(2);
      expect(stats.healthyCalls).toBe(1); // callId2 should still be healthy
      expect(stats.warningCalls).toBe(1); // callId1 should be in warning state
      expect(stats.totalIssues).toBe(1);
      expect(stats.resolvedIssues).toBe(0);
    });
  });

  describe('FallbackTTSService', () => {
    it('should synthesize fallback TTS', async () => {
      const callId = 'tts-test-1';
      
      const request = {
        text: 'Hello, this is a test message',
        language: 'en'
      };
      
      const response = await fallbackTTS.synthesize(request, callId);
      
      expect(response).toBeTruthy();
      expect(response.audioData).toBeTruthy();
      expect(response.format).toBe('mulaw');
      expect(response.provider).toBe('twilio_fallback');
    });
    
    it('should find prerecorded messages', async () => {
      const callId = 'tts-test-2';
      
      const request = {
        text: 'Hello! How can I help you today?',
        language: 'en'
      };
      
      const response = await fallbackTTS.synthesize(request, callId);
      
      expect(response.provider).toBe('prerecorded');
    });
    
    it('should return cache statistics', () => {
      const stats = fallbackTTS.getCacheStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
    });
    
    it('should test fallback capabilities', async () => {
      const callId = 'tts-test-3';
      
      const results = await fallbackTTS.testFallbacks(callId);
      
      expect(results).toHaveProperty('twilio');
      expect(results).toHaveProperty('prerecorded');
      expect(results).toHaveProperty('silence');
      expect(typeof results.twilio).toBe('boolean');
      expect(typeof results.prerecorded).toBe('boolean');
      expect(typeof results.silence).toBe('boolean');
    });
    
    it('should manage prerecorded messages', () => {
      const initialMessages = fallbackTTS.getPrerecordedMessages();
      const initialCount = initialMessages.length;
      
      const newMessage = {
        id: 'test-message',
        text: 'This is a test message',
        audioData: Buffer.alloc(1000),
        language: 'en',
        voiceType: 'neutral' as const
      };
      
      fallbackTTS.addPrerecordedMessage(newMessage);
      
      const afterAdd = fallbackTTS.getPrerecordedMessages();
      expect(afterAdd.length).toBe(initialCount + 1);
      
      fallbackTTS.removePrerecordedMessage('test-message');
      
      const afterRemove = fallbackTTS.getPrerecordedMessages();
      expect(afterRemove.length).toBe(initialCount);
    });
  });

  describe('Integration Tests', () => {
    it('should integrate resilience and monitoring services', () => {
      const callId = 'integration-test-1';
      
      // Register with both services
      resilienceService.registerCall(callId);
      monitoringService.registerCall(callId);
      
      // Report an error through resilience service
      const error = new Error('Integration test error');
      resilienceService.reportError(callId, error, 'integration_test');
      
      // Check resilience status
      const resilienceStatus = resilienceService.getCallStatus(callId);
      expect(resilienceStatus!.errorCount).toBe(1);
      
      // The monitoring service should be updated separately
      monitoringService.reportIssue(callId, {
        type: 'error',
        category: 'connection',
        message: 'Integration test issue',
        impact: 'high'
      });
      
      const monitoringHealth = monitoringService.getCallHealth(callId);
      expect(monitoringHealth!.issues.length).toBe(1);
      expect(monitoringHealth!.overall).toBe('warning');
    });
    
    it('should handle service health monitoring', () => {
      const serviceHealth = resilienceService.getServiceHealth();
      
      expect(serviceHealth).toHaveProperty('tts');
      expect(serviceHealth).toHaveProperty('stt');
      expect(serviceHealth).toHaveProperty('llm');
      expect(serviceHealth).toHaveProperty('websocket');
      expect(serviceHealth).toHaveProperty('database');
      
      // All services should start as healthy
      expect(serviceHealth.tts).toBe(true);
      expect(serviceHealth.stt).toBe(true);
      expect(serviceHealth.llm).toBe(true);
      expect(serviceHealth.websocket).toBe(true);
      expect(serviceHealth.database).toBe(true);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle invalid call IDs gracefully', () => {
      expect(() => {
        resilienceService.updateHeartbeat('non-existent-call');
      }).not.toThrow();
      
      expect(() => {
        monitoringService.updateCallMetrics('non-existent-call', { duration: 1000 });
      }).not.toThrow();
    });
    
    it('should handle fallback TTS errors gracefully', async () => {
      const callId = 'error-test-1';
      
      // Test with empty text
      const request = {
        text: '',
        language: 'en'
      };
      
      const response = await fallbackTTS.synthesize(request, callId);
      expect(response).toBeTruthy();
      expect(response.provider).toBe('emergency_silence');
    });
    
    it('should cleanup resources properly', () => {
      const callId = 'cleanup-test-1';
      
      resilienceService.registerCall(callId);
      monitoringService.registerCall(callId);
      
      // Verify calls are registered
      expect(resilienceService.getCallStatus(callId)).toBeTruthy();
      expect(monitoringService.getCallHealth(callId)).toBeTruthy();
      
      // Shutdown services
      resilienceService.shutdown();
      monitoringService.shutdown();
      
      // Create new instances
      const newResilience = new CallResilienceService();
      const newMonitoring = new CallMonitoringService();
      
      // Verify old calls are not present
      expect(newResilience.getCallStatus(callId)).toBeNull();
      expect(newMonitoring.getCallHealth(callId)).toBeNull();
      
      newResilience.shutdown();
      newMonitoring.shutdown();
    });
  });

  describe('Call Resilience Improvements', () => {
    it('should have optimized configuration for faster detection', () => {
      // Test that the optimized configurations are in place
      const resilienceConfig = (resilienceService as any).config;
      
      // Check that intervals are reduced for faster detection
      expect(resilienceConfig.heartbeatInterval).toBe(5000); // 5 seconds instead of 10
      expect(resilienceConfig.connectionTimeout).toBe(15000); // 15 seconds instead of 30
      expect(resilienceConfig.cleanupInterval).toBe(30000); // 30 seconds instead of 60
      expect(resilienceConfig.circuitBreakerThreshold).toBe(3); // 3 instead of 5
      expect(resilienceConfig.fallbackTimeout).toBe(3000); // 3 seconds instead of 5
    });

    it('should have optimized monitoring configuration', () => {
      const monitoringConfig = (monitoringService as any).config;
      
      // Check optimized monitoring intervals and thresholds
      expect(monitoringConfig.healthCheckInterval).toBe(3000); // 3 seconds instead of 5
      expect(monitoringConfig.alertThresholds.errorRate).toBe(0.08); // 8% instead of 10%
      expect(monitoringConfig.alertThresholds.responseTime).toBe(2000); // 2 seconds instead of 3
      expect(monitoringConfig.alertThresholds.connectionStability).toBe(0.85); // 85% instead of 80%
      expect(monitoringConfig.alertThresholds.audioLatency).toBe(300); // 300ms instead of 500ms
    });

    it('should trigger auto-recovery for high impact issues', (done) => {
      const callId = 'high-impact-test';
      monitoringService.registerCall(callId);

      // Listen for auto-recovery events
      monitoringService.once('autoRecovery', (event) => {
        expect(event.callId).toBe(callId);
        expect(event.type).toBe('audio_recovery');
        expect(event.reason).toContain('high impact audio issue');
        done();
      });

      // Report a high impact audio issue
      monitoringService.reportIssue(callId, {
        type: 'error',
        category: 'audio',
        message: 'high impact audio issue',
        impact: 'high'
      });
    });

    it('should emit cleanup events for coordinated resource management', (done) => {
      const callId = 'coordination-test';
      resilienceService.registerCall(callId);

      // Listen for cleanup events
      resilienceService.once('sessionCleaned', (cleanedCallId) => {
        expect(cleanedCallId).toBe(callId);
        done();
      });

      // Trigger cleanup by unregistering
      resilienceService.unregisterCall(callId);
    });

    it('should handle aggressive session cleanup for failed connections', () => {
      jest.useFakeTimers();
      const callId = 'failed-connection-test';
      
      resilienceService.registerCall(callId);
      
      // Simulate a failed connection by updating the session state
      const session = (resilienceService as any).sessions.get(callId);
      session.connectionHealth = 'failed';
      session.lastHeartbeat = new Date(Date.now() - 130000); // 2 minutes and 10 seconds ago
      
      // Trigger cleanup manually to test the logic
      (resilienceService as any).performCleanup();
      
      // Should be cleaned up because it's failed and older than 2 minutes
      expect(resilienceService.getCallStatus(callId)).toBeNull();
      
      jest.useRealTimers();
    });

    it('should clean up healthy sessions after 5 minutes of no heartbeat', () => {
      jest.useFakeTimers();
      const callId = 'stale-session-test';
      
      resilienceService.registerCall(callId);
      
      // Simulate an old session (6 minutes)
      const session = (resilienceService as any).sessions.get(callId);
      session.lastHeartbeat = new Date(Date.now() - 360000); // 6 minutes ago
      
      // Trigger cleanup
      (resilienceService as any).performCleanup();
      
      // Should be cleaned up
      expect(resilienceService.getCallStatus(callId)).toBeNull();
      
      jest.useRealTimers();
    });

    it('should not clean up healthy recent sessions', () => {
      const callId = 'recent-session-test';
      
      resilienceService.registerCall(callId);
      
      // Update heartbeat to recent time
      resilienceService.updateHeartbeat(callId);
      
      // Trigger cleanup
      (resilienceService as any).performCleanup();
      
      // Should NOT be cleaned up
      expect(resilienceService.getCallStatus(callId)).toBeTruthy();
    });

    it('should coordinate cleanup between services', () => {
      const callId = 'service-coordination-test';
      
      // Register with both services
      resilienceService.registerCall(callId);
      monitoringService.registerCall(callId);
      
      // Verify both have the call
      expect(resilienceService.getCallStatus(callId)).toBeTruthy();
      expect(monitoringService.getCallHealth(callId)).toBeTruthy();
      
      // Unregister from resilience service (should emit cleanup event)
      resilienceService.unregisterCall(callId);
      
      // Give a moment for the event to propagate
      setTimeout(() => {
        // Monitoring service should automatically clean up too
        expect(monitoringService.getCallHealth(callId)).toBeNull();
      }, 10);
    });
  });
});