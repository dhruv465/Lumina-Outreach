import * as WebSocket from 'ws';
import logger from './logger';

/**
 * Enhanced WebSocket message handling with proper framing
 * Addresses Twilio's WebSocket protocol requirements
 */
export class WebSocketFrameHandler {
  private messageBuffer: Buffer[] = [];
  private isProcessing = false;

  constructor(private ws: WebSocket, private onMessage: (data: any) => void) {
    this.setupMessageHandling();
  }

  private setupMessageHandling() {
    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleIncomingFrame(data);
    });
  }

  private handleIncomingFrame(data: WebSocket.Data) {
    try {
      // Ensure we have a Buffer
      let buffer: Buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else if (typeof data === 'string') {
        buffer = Buffer.from(data, 'utf8');
      } else {
        logger.warn('Received unknown data type in WebSocket frame');
        return;
      }

      // Add to buffer
      this.messageBuffer.push(buffer);

      // Process complete messages
      this.processBufferedMessages();
    } catch (error) {
      logger.error('Error handling WebSocket frame:', error);
    }
  }

  private processBufferedMessages() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Combine all buffered data
      const completeBuffer = Buffer.concat(this.messageBuffer);
      this.messageBuffer = [];

      // Try to parse as JSON (Twilio sends JSON messages)
      const messageStr = completeBuffer.toString('utf8');
      
      // Handle multiple JSON messages in one frame (if any)
      const messages = this.splitJsonMessages(messageStr);
      
      for (const msgStr of messages) {
        if (msgStr.trim()) {
          try {
            const message = JSON.parse(msgStr);
            this.onMessage(message);
          } catch (parseError) {
            logger.error('Failed to parse JSON message:', {
              error: parseError,
              message: msgStr.substring(0, 100)
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error processing buffered messages:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private splitJsonMessages(data: string): string[] {
    // Handle case where multiple JSON objects might be concatenated
    const messages: string[] = [];
    let currentMessage = '';
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      currentMessage += char;

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          
          if (braceCount === 0 && currentMessage.trim()) {
            messages.push(currentMessage.trim());
            currentMessage = '';
          }
        }
      }
    }

    // If we have remaining data, add it
    if (currentMessage.trim()) {
      messages.push(currentMessage.trim());
    }

    return messages;
  }

  /**
   * Send a message with proper framing
   */
  public sendMessage(message: any): boolean {
    try {
      if (this.ws.readyState !== WebSocket.OPEN) {
        logger.warn('Cannot send message: WebSocket not open');
        return false;
      }

      // Ensure message is properly formatted JSON
      const jsonStr = JSON.stringify(message);
      
      // Send as a single frame
      this.ws.send(jsonStr, (error) => {
        if (error) {
          logger.error('Error sending WebSocket message:', error);
        }
      });

      return true;
    } catch (error) {
      logger.error('Failed to send WebSocket message:', error);
      return false;
    }
  }

  /**
   * Send binary data with proper framing
   */
  public sendBinary(data: Buffer): boolean {
    try {
      if (this.ws.readyState !== WebSocket.OPEN) {
        logger.warn('Cannot send binary data: WebSocket not open');
        return false;
      }

      this.ws.send(data, { binary: true }, (error) => {
        if (error) {
          logger.error('Error sending binary WebSocket data:', error);
        }
      });

      return true;
    } catch (error) {
      logger.error('Failed to send binary WebSocket data:', error);
      return false;
    }
  }
}

/**
 * Create a frame handler for a WebSocket connection
 */
export function createFrameHandler(
  ws: WebSocket, 
  onMessage: (data: any) => void
): WebSocketFrameHandler {
  return new WebSocketFrameHandler(ws, onMessage);
}