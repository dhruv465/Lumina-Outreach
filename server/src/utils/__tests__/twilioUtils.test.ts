/**
 * Tests for Twilio utility functions
 */

import { isTwilioCallSid } from '../twilioUtils';

describe('twilioUtils', () => {
  describe('isTwilioCallSid', () => {
    test('should return true for valid Twilio CallSid format', () => {
      const validCallSids = [
        'CA1234567890abcdef1234567890abcdef',
        'ca1234567890abcdef1234567890abcdef', // lowercase
        'CA0123456789ABCDEF0123456789ABCDEF', // uppercase
        'CAfedcba0987654321fedcba0987654321'
      ];

      validCallSids.forEach(callSid => {
        expect(isTwilioCallSid(callSid)).toBe(true);
      });
    });

    test('should return false for invalid Twilio CallSid format', () => {
      const invalidCallSids = [
        'invalid-call-id',
        'CA123', // too short
        'CA1234567890abcdef1234567890abcdef123', // too long
        'CB1234567890abcdef1234567890abcdef', // wrong prefix
        'CA1234567890abcdef1234567890abcdeg', // invalid hex character
        '',
        'sim_123456789', // simulated call ID
        '1234567890'
      ];

      invalidCallSids.forEach(callSid => {
        expect(isTwilioCallSid(callSid)).toBe(false);
      });
    });

    test('should handle edge cases', () => {
      expect(isTwilioCallSid(null as any)).toBe(false);
      expect(isTwilioCallSid(undefined as any)).toBe(false);
      expect(isTwilioCallSid(123 as any)).toBe(false);
    });
  });
});