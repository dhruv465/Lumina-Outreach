/**
 * Additional type declarations for WebSocket compatibility
 */

declare global {
  namespace NodeJS {
    interface Global {
      WebSocket?: any;
    }
  }
}

// Event listener type for compatibility
export interface WebSocketEventListener {
  (event: Event): void;
}

// Re-export common WebSocket types
export type WebSocketData = string | Buffer | ArrayBuffer | Buffer[];
export type WebSocketEventType = 'open' | 'close' | 'error' | 'message' | 'ping' | 'pong';

export {};