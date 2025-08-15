import * as WebSocket from 'ws';
import logger from './logger';

/**
 * Safely send a JSON message over WebSocket with proper error handling
 * Enhanced for Twilio Media Stream protocol compliance
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

    // Validate message format for Twilio compliance if it's a Twilio message
    if (message && typeof message === 'object' && message.event) {
      const validation = validateTwilioMediaMessage(message);
      if (!validation.valid) {
        logger.error(`Invalid Twilio message format${context ? ` (${context})` : ''}: ${validation.error}`, {
          message: JSON.stringify(message).substring(0, 200)
        });
        return false;
      }
    }

    // Validate that message can be serialized to JSON
    const jsonMessage = JSON.stringify(message);
    
    // Check for reasonable message size (Twilio has strict limits)
    if (jsonMessage.length > 256 * 1024) { // 256KB limit for safety
      logger.error(`WebSocket message too large${context ? ` (${context})` : ''}`, {
        size: jsonMessage.length,
        messageType: message.event || message.type || 'unknown'
      });
      return false;
    }

    // Send with Twilio-compliant options
    ws.send(jsonMessage, {
      binary: false,
      compress: false, // Disable compression to prevent fragmentation 
      fin: true // Send as complete frame
    });
    
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

  if (!message.event || typeof message.event !== 'string') {
    return { valid: false, error: 'Message must have an event field' };
  }

  // Validate known Twilio event types
  const validEvents = ['media', 'start', 'stop', 'mark', 'clear'];
  if (!validEvents.includes(message.event)) {
    return { valid: false, error: `Invalid event type: ${message.event}. Must be one of: ${validEvents.join(', ')}` };
  }

  if (message.event === 'media') {
    if (!message.streamSid || typeof message.streamSid !== 'string') {
      return { valid: false, error: 'Media messages must include streamSid as string' };
    }
    
    if (!message.media || typeof message.media !== 'object') {
      return { valid: false, error: 'Media messages must include media object' };
    }
    
    const { media } = message;
    
    if (!media.track || typeof media.track !== 'string') {
      return { valid: false, error: 'Media messages must include track as string' };
    }
    
    if (!media.chunk || typeof media.chunk !== 'string') {
      return { valid: false, error: 'Media messages must include chunk as string' };
    }

    if (!media.timestamp || typeof media.timestamp !== 'string') {
      return { valid: false, error: 'Media messages must include timestamp as string' };
    }

    if (!media.payload || typeof media.payload !== 'string') {
      return { valid: false, error: 'Media messages must include payload as string' };
    }

    // Validate track value
    if (!['inbound', 'outbound'].includes(media.track)) {
      return { valid: false, error: 'Media track must be either "inbound" or "outbound"' };
    }

    // Validate chunk is a valid sequence number
    const chunkNum = parseInt(media.chunk, 10);
    if (isNaN(chunkNum) || chunkNum < 0) {
      return { valid: false, error: 'Media chunk must be a valid non-negative integer string' };
    }

    // Validate timestamp is a valid number string
    const timestampNum = parseInt(media.timestamp, 10);
    if (isNaN(timestampNum) || timestampNum <= 0) {
      return { valid: false, error: 'Media timestamp must be a valid positive integer string' };
    }

    // Validate base64 payload
    try {
      const decoded = Buffer.from(media.payload, 'base64');
      if (decoded.length === 0) {
        return { valid: false, error: 'Media payload cannot be empty after base64 decoding' };
      }
    } catch (e) {
      return { valid: false, error: 'Media payload must be valid base64' };
    }
  }

  return { valid: true };
}

/**
 * Create a properly formatted Twilio media message
 * Follows Twilio Media Stream specification exactly
 */
export function createTwilioMediaMessage(
  streamSid: string,
  audioData: Buffer,
  sequenceNumber: number
): any {
  // Validate inputs
  if (!streamSid || typeof streamSid !== 'string') {
    throw new Error('streamSid must be a non-empty string');
  }
  
  if (!Buffer.isBuffer(audioData) || audioData.length === 0) {
    throw new Error('audioData must be a non-empty Buffer');
  }
  
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new Error('sequenceNumber must be a non-negative integer');
  }

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

/**
 * Create a properly formatted Twilio mark message
 */
export function createTwilioMarkMessage(streamSid: string, markName: string): any {
  if (!streamSid || typeof streamSid !== 'string') {
    throw new Error('streamSid must be a non-empty string');
  }
  
  if (!markName || typeof markName !== 'string') {
    throw new Error('markName must be a non-empty string');
  }

  return {
    event: 'mark',
    streamSid: streamSid,
    mark: {
      name: markName
    }
  };
}

/**
 * Create a properly formatted Twilio clear message
 */
export function createTwilioClearMessage(streamSid: string): any {
  if (!streamSid || typeof streamSid !== 'string') {
    throw new Error('streamSid must be a non-empty string');
  }

  return {
    event: 'clear',
    streamSid: streamSid
  };
}