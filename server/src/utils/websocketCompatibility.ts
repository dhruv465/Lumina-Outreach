/**
 * WebSocket Compatibility Layer
 * 
 * This module provides a compatibility layer between Node.js WebSocket API (ws library)
 * and the DOM WebSocket API, ensuring seamless integration across different contexts.
 * 
 * Key features:
 * - Bridges Node.js WebSocket and DOM WebSocket API differences
 * - Adds missing methods and properties for compatibility
 * - Handles Twilio WebSocket protocol requirements
 * - Provides dispatchEvent functionality for Node.js WebSockets
 */

import * as NodeWebSocket from 'ws';
import { EventEmitter } from 'events';

// Extended interface to bridge Node.js and DOM WebSocket APIs
export interface CompatibleWebSocket {
  // Core WebSocket properties and methods
  readyState: number;
  url: string;
  protocol: string;
  extensions: string;
  binaryType?: string;
  bufferedAmount?: number;
  
  // Core WebSocket methods
  send(data: string | Buffer | ArrayBuffer, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  ping?(data?: any): void;
  pong?(data?: any): void;
  
  // Node.js EventEmitter methods
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string | symbol): this;
  
  // DOM-style event methods for compatibility
  dispatchEvent?(event: Event): boolean;
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
  
  // WebSocket constants
  CONNECTING?: number;
  OPEN?: number;
  CLOSING?: number;
  CLOSED?: number;
}

// Custom Event class for Node.js compatibility
export class WebSocketEvent {
  public type: string;
  public data?: any;
  public target?: any;
  public currentTarget?: any;

  constructor(type: string, eventInitDict?: { data?: any; target?: any }) {
    this.type = type;
    this.data = eventInitDict?.data;
    this.target = eventInitDict?.target;
    this.currentTarget = eventInitDict?.target;
  }
}

/**
 * WebSocket Compatibility Manager
 * Provides unified interface for WebSocket operations across Node.js and browser environments
 */
export class WebSocketCompatibilityManager {
  private websocket: CompatibleWebSocket;
  private eventListeners: Map<string, Set<Function>>;

  constructor(websocket: any) {
    // Cast the WebSocket to CompatibleWebSocket since we'll add methods
    this.websocket = websocket as CompatibleWebSocket;
    this.eventListeners = new Map();
    this.addCompatibilityMethods();
  }

  /**
   * Add DOM-style methods to Node.js WebSocket
   */
  private addCompatibilityMethods(): void {
    // Add dispatchEvent functionality
    this.websocket.dispatchEvent = (event: Event | WebSocketEvent) => {
      const listeners = this.eventListeners.get(event.type);
      if (listeners) {
        listeners.forEach(listener => {
          try {
            if (typeof listener === 'function') {
              listener(event);
            }
          } catch (error) {
            console.error(`Error in WebSocket event listener for ${event.type}:`, error);
          }
        });
        return true;
      }
      return false;
    };

    // Add addEventListener functionality
    this.websocket.addEventListener = (type: string, listener: EventListener) => {
      if (!this.eventListeners.has(type)) {
        this.eventListeners.set(type, new Set());
      }
      this.eventListeners.get(type)!.add(listener);

      // Bridge to Node.js event system
      this.websocket.on(type, listener);
    };

    // Add removeEventListener functionality
    this.websocket.removeEventListener = (type: string, listener: EventListener) => {
      const listeners = this.eventListeners.get(type);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.eventListeners.delete(type);
        }
      }

      // Bridge to Node.js event system
      this.websocket.off(type, listener);
    };
  }

  /**
   * Get the enhanced WebSocket instance
   */
  public getWebSocket(): CompatibleWebSocket {
    return this.websocket;
  }

  /**
   * Send data with Twilio protocol validation
   */
  public sendTwilioMessage(data: string | Buffer | ArrayBuffer, callback?: (error?: Error) => void): void {
    try {
      // Validate message size for Twilio compatibility
      const messageSize = this.getMessageSize(data);
      if (messageSize > 64 * 1024) { // 64KB limit for Twilio
        const error = new Error(`Message too large: ${messageSize} bytes. Twilio limit is 64KB.`);
        if (callback) callback(error);
        return;
      }

      // Ensure message is not fragmented
      if (this.websocket.readyState !== 1) { // WebSocket.OPEN = 1
        const error = new Error('WebSocket is not in OPEN state');
        if (callback) callback(error);
        return;
      }

      // Send with callback if provided
      if (callback && typeof (this.websocket as any).send === 'function') {
        (this.websocket as any).send(data, callback);
      } else {
        this.websocket.send(data, callback);
      }
    } catch (error) {
      if (callback) callback(error as Error);
    }
  }

  /**
   * Get message size in bytes
   */
  private getMessageSize(data: string | Buffer | ArrayBuffer): number {
    if (typeof data === 'string') {
      return Buffer.byteLength(data, 'utf8');
    } else if (Buffer.isBuffer(data)) {
      return data.length;
    } else if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }
    return 0;
  }

  /**
   * Close WebSocket with proper Twilio protocol handling
   */
  public close(code?: number, reason?: string): void {
    if (this.websocket.readyState === NodeWebSocket.OPEN || 
        this.websocket.readyState === NodeWebSocket.CONNECTING) {
      this.websocket.close(code || 1000, reason || 'Normal closure');
    }
  }

  /**
   * Check if WebSocket is connected
   */
  public isConnected(): boolean {
    return this.websocket.readyState === NodeWebSocket.OPEN;
  }
}

/**
 * Factory function to create a compatible WebSocket
 */
export function createCompatibleWebSocket(
  url: string, 
  protocols?: string | string[], 
  options?: any
): CompatibleWebSocket {
  const ws = new (NodeWebSocket as any)(url, protocols, {
    ...options,
    // Ensure proper settings for Twilio compatibility
    perMessageDeflate: false, // Disable compression to prevent fragmentation
    maxPayload: 64 * 1024,    // 64KB max payload for Twilio
  });

  const compatibilityManager = new WebSocketCompatibilityManager(ws);
  return compatibilityManager.getWebSocket();
}

/**
 * Enhance existing WebSocket with compatibility features
 */
export function enhanceWebSocket(websocket: any): CompatibleWebSocket {
  const compatibilityManager = new WebSocketCompatibilityManager(websocket);
  return compatibilityManager.getWebSocket();
}

/**
 * Validate Twilio WebSocket message format
 */
export function validateTwilioMessage(message: any): { valid: boolean; error?: string } {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  if (!message.event || typeof message.event !== 'string') {
    return { valid: false, error: 'Message must have a valid event field' };
  }

  // Validate known Twilio event types
  const validEvents = ['media', 'start', 'stop', 'mark', 'clear'];
  if (!validEvents.includes(message.event)) {
    return { valid: false, error: `Invalid event type: ${message.event}. Must be one of: ${validEvents.join(', ')}` };
  }

  // Validate media messages specifically
  if (message.event === 'media') {
    if (!message.media || typeof message.media !== 'object') {
      return { valid: false, error: 'Media messages must include media object' };
    }

    const { media } = message;
    if (!media.track || typeof media.track !== 'string') {
      return { valid: false, error: 'Media messages must include media.track as string' };
    }
    if (!media.chunk || typeof media.chunk !== 'string') {
      return { valid: false, error: 'Media messages must include media.chunk as string' };
    }
    if (!media.timestamp || typeof media.timestamp !== 'string') {
      return { valid: false, error: 'Media messages must include media.timestamp as string' };
    }
    if (!media.payload || typeof media.payload !== 'string') {
      return { valid: false, error: 'Media messages must include media.payload as string' };
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

  // Validate mark messages
  if (message.event === 'mark') {
    if (!message.streamSid || typeof message.streamSid !== 'string') {
      return { valid: false, error: 'Mark messages must include streamSid as string' };
    }
    if (!message.mark || typeof message.mark !== 'object') {
      return { valid: false, error: 'Mark messages must include mark object' };
    }
    if (!message.mark.name || typeof message.mark.name !== 'string') {
      return { valid: false, error: 'Mark messages must include mark.name as string' };
    }
  }

  return { valid: true };
}

export default {
  WebSocketCompatibilityManager,
  createCompatibleWebSocket,
  enhanceWebSocket,
  validateTwilioMessage,
  WebSocketEvent
};