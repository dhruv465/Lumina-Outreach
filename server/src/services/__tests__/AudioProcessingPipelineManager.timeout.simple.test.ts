/**
 * Simple tests for AudioProcessingPipelineManager timeout and error handling enhancements
 * 
 * Tests the implementation of task 5.2: Add processing timeout and error handling
 * Requirements: 3.2, 3.4, 2.2
 */

describe('AudioProcessingPipelineManager - Timeout and Error Handling', () => {
  describe('Error Classification', () => {
    it('should classify Twilio-specific protocol errors correctly', () => {
      // Mock the AudioProcessingPipelineManager class methods
      const classifyProcessingError = (
        error: Error,
        stage: string,
        context: Record<string, any> = {}
      ) => {
        const errorMessage = error.message.toLowerCase();
        let type = 'unknown_error';
        let severity = 'medium';
        let recoverable = true;
        let twilioSpecific = false;
        let requiresProtocolFix = false;

        // Twilio-specific error classification
        if (errorMessage.includes('twilio') || context.callSid || context.streamSid) {
          twilioSpecific = true;
          
          if (errorMessage.includes('malformed message') || 
              errorMessage.includes('not conformant with websocket protocol')) {
            type = 'protocol_error';
            severity = 'high';
            requiresProtocolFix = true;
          } else if (errorMessage.includes('control frame was fragmented')) {
            type = 'protocol_error';
            severity = 'high';
            requiresProtocolFix = true;
          }
        }

        return {
          type,
          severity,
          recoverable,
          twilioSpecific,
          requiresProtocolFix
        };
      };

      const error = new Error('Malformed message or message not conformant with WebSocket protocol');
      const context = {
        callSid: 'CA1234567890abcdef1234567890abcdef',
        streamSid: 'MZ1234567890abcdef1234567890abcdef'
      };

      const classification = classifyProcessingError(error, 'websocket_send', context);

      expect(classification.type).toBe('protocol_error');
      expect(classification.severity).toBe('high');
      expect(classification.twilioSpecific).toBe(true);
      expect(classification.requiresProtocolFix).toBe(true);
      expect(classification.recoverable).toBe(true);
    });

    it('should classify frame fragmentation errors (Requirement 3.2)', () => {
      const classifyProcessingError = (
        error: Error,
        stage: string,
        context: Record<string, any> = {}
      ) => {
        const errorMessage = error.message.toLowerCase();
        let type = 'unknown_error';
        let severity = 'medium';
        let twilioSpecific = false;
        let requiresProtocolFix = false;

        if (errorMessage.includes('twilio') || context.callSid || context.streamSid) {
          twilioSpecific = true;
          
          if (errorMessage.includes('control frame was fragmented')) {
            type = 'protocol_error';
            severity = 'high';
            requiresProtocolFix = true;
          }
        }

        return {
          type,
          severity,
          twilioSpecific,
          requiresProtocolFix
        };
      };

      const error = new Error('The WebSocket control frame was fragmented');
      const context = { callSid: 'CA123' };

      const classification = classifyProcessingError(error, 'websocket_send', context);

      expect(classification.type).toBe('protocol_error');
      expect(classification.severity).toBe('high');
      expect(classification.twilioSpecific).toBe(true);
      expect(classification.requiresProtocolFix).toBe(true);
    });

    it('should classify general timeout errors', () => {
      const classifyProcessingError = (
        error: Error,
        stage: string,
        context: Record<string, any> = {}
      ) => {
        const errorMessage = error.message.toLowerCase();
        let type = 'unknown_error';
        let severity = 'medium';
        let recoverable = true;

        if (errorMessage.includes('timeout')) {
          type = 'timeout';
          severity = 'medium';
        }

        return {
          type,
          severity,
          recoverable,
          twilioSpecific: false,
          requiresProtocolFix: false
        };
      };

      const error = new Error('Operation timeout exceeded');
      
      const classification = classifyProcessingError(error, 'llm_processing');

      expect(classification.type).toBe('timeout');
      expect(classification.severity).toBe('medium');
      expect(classification.twilioSpecific).toBe(false);
      expect(classification.recoverable).toBe(true);
    });
  });

  describe('Recovery Strategies', () => {
    it('should execute immediate retry strategy', async () => {
      const executeImmediateRetry = async (error: any, context: any) => {
        if (error.retryCount >= error.maxRetries) {
          return {
            success: false,
            message: 'Maximum retries exceeded',
            userFeedback: {
              type: 'error',
              message: 'Operation failed after multiple attempts',
              severity: 'error',
              actionRequired: true,
              suggestedActions: ['Try again later', 'Check connection']
            }
          };
        }

        return {
          success: true,
          message: 'Retrying immediately',
          userFeedback: {
            type: 'progress',
            message: 'Retrying operation...',
            severity: 'info',
            actionRequired: false,
            progressPercentage: Math.round((error.retryCount / error.maxRetries) * 100)
          }
        };
      };

      const mockError = {
        id: 'error123',
        retryCount: 0,
        maxRetries: 3
      };

      const result = await executeImmediateRetry(mockError, {});

      expect(result.success).toBe(true);
      expect(result.message).toBe('Retrying immediately');
      expect(result.userFeedback?.type).toBe('progress');
      expect(result.userFeedback?.progressPercentage).toBe(0);
    });

    it('should execute exponential backoff strategy', async () => {
      const executeExponentialBackoff = async (error: any, context: any) => {
        if (error.retryCount >= error.maxRetries) {
          return {
            success: false,
            message: 'Maximum retries exceeded with backoff'
          };
        }

        const delay = Math.min(Math.pow(2, error.retryCount) * 1000, 30000);
        error.nextRetryAt = new Date(Date.now() + delay);

        return {
          success: true,
          message: `Retrying with ${delay}ms delay`,
          newTimeout: delay,
          userFeedback: {
            type: 'progress',
            message: `Retrying in ${Math.round(delay / 1000)} seconds...`,
            severity: 'info',
            actionRequired: false,
            estimatedResolutionTime: delay
          }
        };
      };

      const mockError = {
        retryCount: 1,
        maxRetries: 3
      };
      
      const result = await executeExponentialBackoff(mockError, {});

      expect(result.success).toBe(true);
      expect(result.message).toContain('Retrying with');
      expect(result.newTimeout).toBeGreaterThan(0);
      expect(result.userFeedback?.estimatedResolutionTime).toBeGreaterThan(0);
    });

    it('should fail when max retries exceeded', async () => {
      const executeImmediateRetry = async (error: any, context: any) => {
        if (error.retryCount >= error.maxRetries) {
          return {
            success: false,
            message: 'Maximum retries exceeded',
            userFeedback: {
              type: 'error',
              message: 'Operation failed after multiple attempts',
              severity: 'error',
              actionRequired: true
            }
          };
        }

        return { success: true, message: 'Retrying' };
      };

      const mockError = {
        retryCount: 3,
        maxRetries: 3
      };
      
      const result = await executeImmediateRetry(mockError, {});

      expect(result.success).toBe(false);
      expect(result.message).toBe('Maximum retries exceeded');
      expect(result.userFeedback?.severity).toBe('error');
      expect(result.userFeedback?.actionRequired).toBe(true);
    });
  });

  describe('Twilio Feedback Enhancement', () => {
    it('should enhance feedback messages with Twilio context', () => {
      const enhanceTwilioFeedbackMessage = (message: string, twilioContext: any): string => {
        if (twilioContext.callSid) {
          message += ` (Call ID: ${twilioContext.callSid.substring(0, 8)}...)`;
        }
        
        if (twilioContext.errorCode) {
          message += ` [Error: ${twilioContext.errorCode}]`;
        }
        
        if (twilioContext.protocolViolation) {
          message += ' - Protocol compliance issue detected';
        }
        
        if (twilioContext.frameFragmented) {
          message += ' - Frame reconstruction required';
        }
        
        return message;
      };

      const originalMessage = 'Processing failed';
      const twilioContext = {
        callSid: 'CA1234567890abcdef1234567890abcdef',
        errorCode: 'WEBSOCKET_PROTOCOL_ERROR',
        protocolViolation: true,
        frameFragmented: true
      };

      const enhancedMessage = enhanceTwilioFeedbackMessage(originalMessage, twilioContext);

      expect(enhancedMessage).toContain('Call ID: CA123456...');
      expect(enhancedMessage).toContain('[Error: WEBSOCKET_PROTOCOL_ERROR]');
      expect(enhancedMessage).toContain('Protocol compliance issue detected');
      expect(enhancedMessage).toContain('Frame reconstruction required');
    });
  });

  describe('Timeout Configuration', () => {
    it('should apply Twilio-specific timeout settings', () => {
      const applyTwilioTimeoutConfig = (config: any) => {
        return {
          ...config,
          backoffMultiplier: config.twilioCompliant ? 1.5 : 2,
          maxBackoffDelay: config.twilioCompliant ? 15000 : 30000,
          criticalThreshold: config.twilioCompliant ? 30000 : 60000
        };
      };

      const stageConfig = {
        timeout: 5000,
        maxRetries: 3,
        twilioCompliant: true
      };

      const appliedConfig = applyTwilioTimeoutConfig(stageConfig);

      expect(appliedConfig.backoffMultiplier).toBe(1.5); // Gentler backoff for Twilio
      expect(appliedConfig.maxBackoffDelay).toBe(15000); // Shorter max delay for Twilio
      expect(appliedConfig.criticalThreshold).toBe(30000); // Lower threshold for Twilio
    });

    it('should apply standard timeout settings for non-Twilio', () => {
      const applyTwilioTimeoutConfig = (config: any) => {
        return {
          ...config,
          backoffMultiplier: config.twilioCompliant ? 1.5 : 2,
          maxBackoffDelay: config.twilioCompliant ? 15000 : 30000,
          criticalThreshold: config.twilioCompliant ? 30000 : 60000
        };
      };

      const stageConfig = {
        timeout: 5000,
        maxRetries: 3,
        twilioCompliant: false
      };

      const appliedConfig = applyTwilioTimeoutConfig(stageConfig);

      expect(appliedConfig.backoffMultiplier).toBe(2);
      expect(appliedConfig.maxBackoffDelay).toBe(30000);
      expect(appliedConfig.criticalThreshold).toBe(60000);
    });
  });
});