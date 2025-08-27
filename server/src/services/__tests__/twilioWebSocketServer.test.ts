import { TwilioWebSocketServer, initializeTwilioWebSocketServer } from '../twilioWebSocketServer';
import WebSocket from 'ws';
import * as http from 'http';

describe('TwilioWebSocketServer', () => {
  let server: http.Server;
  let twilioServer: TwilioWebSocketServer;

  beforeAll(() => {
    server = http.createServer();
    twilioServer = initializeTwilioWebSocketServer(server);
  });

  afterAll(() => {
    if (twilioServer) {
      twilioServer.close();
    }
    if (server) {
      server.close();
    }
  });

  describe('Audio Chunking', () => {
    test('should have OUTBOUND_AUDIO_CHUNK_SIZE constant', () => {
      // Access the private constant via class inspection
      const chunkSize = (TwilioWebSocketServer as any).OUTBOUND_AUDIO_CHUNK_SIZE;
      expect(chunkSize).toBe(32 * 1024); // 32KB
    });

    test('sendMediaChunks should split large audio into chunks', async () => {
      // Create a mock WebSocket
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        sequenceNumber: 0
      } as any;

      // Create large audio buffer (larger than chunk size)
      const largeAudioBuffer = Buffer.alloc(100 * 1024); // 100KB
      const streamSid = 'test-stream-sid-123';

      // Access the private sendMediaChunks method
      const sendMediaChunks = (twilioServer as any).sendMediaChunks.bind(twilioServer);
      sendMediaChunks(mockWs, streamSid, largeAudioBuffer);

      // Should have sent multiple chunks
      expect(mockWs.send).toHaveBeenCalledTimes(4); // 100KB / 32KB = ~4 chunks

      // Verify each call contains proper structure
      const calls = mockWs.send.mock.calls;
      calls.forEach((call: any, index: number) => {
        const message = JSON.parse(call[0]);
        expect(message).toMatchObject({
          event: 'media',
          streamSid: streamSid,
          media: {
            track: 'outbound',
            chunk: (index + 1).toString(),
            timestamp: expect.any(String),
            payload: expect.any(String)
          }
        });
      });
    });
  });

  describe('StreamSid Usage', () => {
    test('sendAudioResponse should use real streamSid', () => {
      const mockWs = {
        readyState: WebSocket.OPEN,
        streamSid: 'real-twilio-stream-sid-123',
        sequenceNumber: 0
      };

      // Mock the activeConnections map
      const connectionKey = 'test-call:test-conversation';
      (twilioServer as any).activeConnections.set(connectionKey, mockWs);

      // Spy on sendMediaChunks
      const sendMediaChunksSpy = jest.spyOn(twilioServer as any, 'sendMediaChunks');

      const audioBuffer = Buffer.alloc(1024);
      twilioServer.sendAudioResponse('test-call', 'test-conversation', audioBuffer);

      // Should have called sendMediaChunks with real streamSid
      expect(sendMediaChunksSpy).toHaveBeenCalledWith(
        mockWs,
        'real-twilio-stream-sid-123',
        audioBuffer
      );

      sendMediaChunksSpy.mockRestore();
    });

    test('sendAudioResponse should warn when streamSid is missing', () => {
      const mockWs = {
        readyState: WebSocket.OPEN,
        // streamSid is missing
        sequenceNumber: 0
      };

      const connectionKey = 'test-call-2:test-conversation-2';
      (twilioServer as any).activeConnections.set(connectionKey, mockWs);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const audioBuffer = Buffer.alloc(1024);
      twilioServer.sendAudioResponse('test-call-2', 'test-conversation-2', audioBuffer);

      // Should log warning about missing streamSid
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot send audio response - streamSid missing')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Keep-Alive Mechanism', () => {
    test('setupConnectionKeepAlive should use ws.ping() instead of JSON messages', () => {
      const mockWs = {
        readyState: WebSocket.OPEN,
        ping: jest.fn(),
        send: jest.fn()
      } as any;

      const connectionKey = 'test-connection';

      // Set up keep-alive
      const setupKeepAlive = (twilioServer as any).setupConnectionKeepAlive.bind(twilioServer);
      setupKeepAlive(connectionKey, mockWs);

      // Wait for the timer to trigger
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Should have called ping, not send
          expect(mockWs.ping).toHaveBeenCalled();
          expect(mockWs.send).not.toHaveBeenCalled();

          // Clean up timer
          const clearKeepAlive = (twilioServer as any).clearConnectionKeepAlive.bind(twilioServer);
          clearKeepAlive(connectionKey);
          
          resolve();
        }, 100);
      });
    });
  });
});