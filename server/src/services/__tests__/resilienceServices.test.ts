/**
 * Resilience Services Test Suite
 * 
 * Tests the core functionality of call resilience services to ensure
 * they work correctly during various failure scenarios.
 */

import { CallResilienceService } from '../services/callResilienceService';
import { CallMonitoringService } from '../services/callMonitoringService';
import { FallbackTTSService } from '../services/fallbackTTSService';

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
});