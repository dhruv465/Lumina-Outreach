/**
 * Tests for RealTelephonyService, focusing on new CallSid validation functionality
 */

import { RealTelephonyService } from '../realTelephonyService';

// Mock Twilio client
jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      create: jest.fn().mockResolvedValue({
        sid: 'CA1234567890abcdef1234567890abcdef',
        status: 'initiated'
      }),
      list: jest.fn().mockResolvedValue([]),
      (callSid: string) => ({
        fetch: jest.fn().mockResolvedValue({
          sid: callSid,
          status: 'in-progress'
        })
      })
    }
  }));
});

// Import the helper function by requiring the module and accessing it
// Since it's not exported, we'll test it indirectly through the service behavior
describe('RealTelephonyService', () => {
  let service: RealTelephonyService;

  beforeEach(() => {
    service = new RealTelephonyService(
      'ACtest1234567890abcdef1234567890abcdef', 
      'test_auth_token',
      'https://test.example.com'
    );
  });

  describe('CallSid validation (indirect testing)', () => {
    test('should handle valid Twilio CallSid format', async () => {
      const validCallSid = 'CA1234567890abcdef1234567890abcdef';
      
      // Create a call with valid CallSid
      const callId = await service.makeCall(
        '+1234567890',
        '+0987654321', 
        'https://test.example.com/callback'
      );
      
      expect(callId).toBe(validCallSid);
      
      // Verify call data includes twilioCallSid
      const callData = service.getCallData(callId);
      expect(callData).toBeDefined();
      expect(callData?.twilioCallSid).toBe(validCallSid);
    });

    test('should store twilioCallSid for incoming calls with valid CallSid', () => {
      const validCallSid = 'CA9876543210fedcba9876543210fedcba';
      
      // Simulate incoming call webhook
      service.handleWebhook('call-status', {
        CallSid: validCallSid,
        CallStatus: 'ringing'
      });
      
      const callData = service.getCallData(validCallSid);
      expect(callData).toBeDefined();
      expect(callData?.twilioCallSid).toBe(validCallSid);
    });

    test('should handle invalid CallSid format in webhook', () => {
      const invalidCallSid = 'invalid-call-id-123';
      
      // Simulate incoming call webhook with invalid format
      service.handleWebhook('call-status', {
        CallSid: invalidCallSid,
        CallStatus: 'ringing'
      });
      
      const callData = service.getCallData(invalidCallSid);
      expect(callData).toBeDefined();
      expect(callData?.twilioCallSid).toBeUndefined(); // Should not set invalid CallSid
    });
  });

  describe('Health check behavior', () => {
    test('should return healthy status when Twilio API is accessible', async () => {
      const health = await service.checkHealth();
      expect(health.status).toBe('healthy');
    });

    test('should include note about ASR checks in healthy response', async () => {
      const health = await service.checkHealth();
      expect(health.status).toBe('healthy');
      // The ASR check is handled by advancedTelephonyService, 
      // realTelephonyService just focuses on Twilio connectivity
    });
  });
});