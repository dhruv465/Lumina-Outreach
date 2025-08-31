/**
 * Twilio-related utility functions
 */

/**
 * Helper function to check if a value is a valid Twilio CallSid
 * @param value String to check
 * @returns true if value matches Twilio CallSid pattern (CA + 32 hex chars)
 */
export function isTwilioCallSid(value: string): boolean {
  return /^CA[a-f0-9]{32}$/i.test(value);
}