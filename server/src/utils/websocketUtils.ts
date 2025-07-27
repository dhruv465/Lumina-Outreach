import * as WebSocket from 'ws';
import logger from './logger';

/**
 * Safely send a JSON message over WebSocket with proper error handling
 */
export function safeSendWebSocketMessage(ws: WebSocket, message: any, context?: string): boolean {
  try {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn(`WebSocket not open, cannot send message${context ? ` (${context})` : ''}`, {
        readyState: ws.readyState,
        message: typeof message === 'object' ? JSON.stringify(message).substring(0, 100) : message
      });
      return false;
    }

    // Validate that message can be serialized to JSON
    const jsonMessage = JSON.stringify(message);
    
    // Check for reasonable message size (Twilio has limits)
    if (jsonMessage.length > 1024 * 1024) { // 1MB limit
      logger.error(`WebSocket message too large${context ? ` (${context})` : ''}`, {
        size: jsonMessage.length,
        messageType: message.event || message.type || 'unknown'
      });
      return false;
    }

    ws.send(jsonMessage);
    
    logger.debug(`WebSocket message sent${context ? ` (${context})` : ''}`, {
      messageType: message.event || message.type || 'unknown',
      size: jsonMessage.length
    });
    
    return true;
  } catch (error) {
    logger.error(`Failed to send WebSocket message${context ? ` (${context})` : ''}:`, {
      error: error instanceof Error ? error.message : String(error),
      message: typeof message === 'object' ? JSON.stringify(message).substring(0, 100) : message,
      readyState: ws.readyState
    });
    return false;
  }
}

/**
 * Validate Twilio Media Stream message format
 */
export function validateTwilioMediaMessage(message: any): { valid: boolean; error?: string } {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  if (!message.event) {
    return { valid: false, error: 'Message must have an event field' };
  }

  if (message.event === 'media') {
    if (!message.streamSid) {
      return { valid: false, error: 'Media messages must include streamSid' };
    }
    
    if (!message.media || !message.media.payload) {
      return { valid: false, error: 'Media messages must include media.payload' };
    }
    
    if (!message.media.track) {
      return { valid: false, error: 'Media messages must include media.track' };
    }
    
    if (!message.media.chunk) {
      return { valid: false, error: 'Media messages must include media.chunk' };
    }
  }

  return { valid: true };
}

/**
 * Create a properly formatted Twilio media message
 */
export function createTwilioMediaMessage(
  streamSid: string,
  audioData: Buffer,
  sequenceNumber: number
): any {
  return {
    event: 'media',
    streamSid: streamSid,
    media: {
      track: 'outbound',
      chunk: sequenceNumber.toString(),
      timestamp: Date.now().toString(),
      payload: audioData.toString('base64')
    }
  };
}