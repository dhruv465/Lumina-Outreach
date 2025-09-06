/**
 * Tests for EnhancedWebSocketServer
 */

import http from 'http';
import { EnhancedWebSocketServer, initializeEnhancedWebSocketServer } from '../src/services/enhancedWebSocketServer';
import { EnhancedWebSocketManager } from '../src/utils/enhancedWebSocketManager';

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(), 
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock resilience service
jest.mock('../src/services/callResilienceService', () => ({
  getCallResilienceService: () => ({
    registerCall: jest.fn(),
    unregisterCall: jest.fn(),
    updateHeartbeat: jest.fn(),
    updateAudioBufferSize: jest.fn(),
    reportError: jest.fn(),
    activateFallback: jest.fn(),
    emit: jest.fn()
  })
}));

// Mock other dependencies
jest.mock('../src/utils/ConnectionHealthMonitor');
jest.mock('../src/utils/ConnectionCircuitBreaker');
jest.mock('../src/utils/RealTimeHealthAssessment');
jest.mock('../src/utils/HeartbeatService');
jest.mock('../src/utils/AdaptiveHeartbeatManager');
jest.mock('../src/services/ReconnectionService');

describe('EnhancedWebSocketServer', () => {
  let server: http.Server;
  let enhancedWsServer: EnhancedWebSocketServer;

  beforeEach(() => {
    // Create a mock HTTP server
    server = {
      on: jest.fn(),
      listening: true,
      address: () => ({ port: 8080 })
    } as any;
  });

  afterEach(() => {
    if (enhancedWsServer) {
      enhancedWsServer.cleanup();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      expect(enhancedWsServer).toBeDefined();
      expect(server.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
    });

    it('should initialize with custom configuration', () => {
      const config = {
        maxConnections: 500,
        connectionTimeout: 20000,
        enableHealthMonitoring: true,
        enhancedManagerConfig: {
          maxReconnectAttempts: 3,
          reconnectDelay: 2000,
          heartbeatInterval: 20000,
          connectionTimeout: 15000,
          maxHeartbeatMisses: 2,
          pingInterval: 25000,
          pongTimeout: 8000,
          enableFrameValidation: true,
          strictProtocolCompliance: true,
          maxFrameSize: 32 * 1024,
          maxMessageSize: 512 * 1024,
          errorClassificationEnabled: true,
          retryOnProtocolErrors: false
        }
      };

      enhancedWsServer = new EnhancedWebSocketServer(server, config);
      expect(enhancedWsServer).toBeDefined();
    });

    it('should use factory function for initialization', () => {
      enhancedWsServer = initializeEnhancedWebSocketServer(server);
      expect(enhancedWsServer).toBeDefined();
      expect(enhancedWsServer).toBeInstanceOf(EnhancedWebSocketServer);
    });
  });

  describe('Configuration Management', () => {
    it('should merge custom config with defaults', () => {
      const partialConfig = {
        maxConnections: 200,
        enhancedManagerConfig: {
          maxReconnectAttempts: 3,
          enableFrameValidation: true
        }
      };

      enhancedWsServer = new EnhancedWebSocketServer(server, partialConfig);
      expect(enhancedWsServer).toBeDefined();
      
      // Should have merged with defaults
      const healthStatus = enhancedWsServer.getHealthStatus();
      expect(healthStatus).toBeDefined();
      expect(healthStatus.status).toBe('healthy');
    });

    it('should handle empty configuration', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server, {});
      expect(enhancedWsServer).toBeDefined();
    });
  });

  describe('Health Monitoring', () => {
    it('should provide health status', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      const healthStatus = enhancedWsServer.getHealthStatus();
      
      expect(healthStatus).toBeDefined();
      expect(healthStatus.status).toBe('healthy'); // Should start healthy
      expect(healthStatus.score).toBe(100);
      expect(healthStatus.activeConnections).toBe(0);
      expect(healthStatus.timestamp).toBeDefined();
    });

    it('should provide connection metrics', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      const metrics = enhancedWsServer.getConnectionMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.server).toBeDefined();
      expect(metrics.connections).toBeDefined();
      expect(Array.isArray(metrics.connections)).toBe(true);
    });

    it('should handle health monitoring when disabled', () => {
      const config = {
        enableHealthMonitoring: false
      };
      
      enhancedWsServer = new EnhancedWebSocketServer(server, config);
      const healthStatus = enhancedWsServer.getHealthStatus();
      
      expect(healthStatus).toBeDefined();
      expect(healthStatus.status).toBe('healthy');
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
    });

    it('should handle WebSocket upgrade requests', () => {
      const mockRequest = {
        headers: {
          'upgrade': 'websocket',
          'connection': 'upgrade',
          'user-agent': 'test-agent'
        },
        url: '/voice/stream/test-call/test-conversation'
      };
      const mockSocket = {
        write: jest.fn(),
        destroy: jest.fn()
      };
      const mockHead = Buffer.from('test');

      // Get the upgrade handler that was registered
      const upgradeHandler = (server.on as jest.Mock).mock.calls.find(
        call => call[0] === 'upgrade'
      )?.[1];

      expect(upgradeHandler).toBeDefined();
      
      // Should not throw when called
      expect(() => {
        upgradeHandler(mockRequest, mockSocket, mockHead);
      }).not.toThrow();
    });

    it('should reject non-WebSocket upgrade requests', () => {
      const mockRequest = {
        headers: {
          'upgrade': 'http',
          'connection': 'keep-alive'
        },
        url: '/voice/stream/test-call/test-conversation'
      };
      const mockSocket = {
        write: jest.fn(),
        destroy: jest.fn()
      };
      const mockHead = Buffer.from('test');

      const upgradeHandler = (server.on as jest.Mock).mock.calls.find(
        call => call[0] === 'upgrade'
      )?.[1];

      upgradeHandler(mockRequest, mockSocket, mockHead);
      
      // Should not write error response for non-WebSocket requests (let other handlers manage)
      expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('should reject invalid Twilio paths', () => {
      const mockRequest = {
        headers: {
          'upgrade': 'websocket',
          'connection': 'upgrade'
        },
        url: '/invalid/path'
      };
      const mockSocket = {
        write: jest.fn(),
        destroy: jest.fn()
      };
      const mockHead = Buffer.from('test');

      const upgradeHandler = (server.on as jest.Mock).mock.calls.find(
        call => call[0] === 'upgrade'
      )?.[1];

      upgradeHandler(mockRequest, mockSocket, mockHead);
      
      // Should not handle invalid paths
      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  describe('Enhanced Features', () => {
    it('should support enhanced media frame sending', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      const audioData = Buffer.from('test audio data');
      
      // Should handle missing connection gracefully
      const result = enhancedWsServer.sendEnhancedMediaFrame('nonexistent', 'call', audioData);
      expect(result).toBe(false);
    });

    it('should provide comprehensive metrics collection', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      
      // Should provide metrics even with no connections
      const metrics = enhancedWsServer.getConnectionMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.server).toBeDefined();
      expect(metrics.connections).toEqual([]);
    });

    it('should support connection-specific metrics', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      
      // Should return null for non-existent connection
      const metrics = enhancedWsServer.getConnectionMetrics('nonexistent-call');
      expect(metrics).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle server upgrade errors gracefully', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      
      const mockRequest = {
        headers: {
          'upgrade': 'websocket',
          'connection': 'upgrade'
        },
        url: '/voice/stream/malformed/path/with/too/many/segments'
      };
      const mockSocket = {
        write: jest.fn(),
        destroy: jest.fn()
      };
      const mockHead = Buffer.from('test');

      const upgradeHandler = (server.on as jest.Mock).mock.calls.find(
        call => call[0] === 'upgrade'
      )?.[1];

      // Should handle malformed paths without throwing
      expect(() => {
        upgradeHandler(mockRequest, mockSocket, mockHead);
      }).not.toThrow();
    });

    it('should handle cleanup errors gracefully', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      
      // Should not throw during cleanup even if there are issues
      expect(() => {
        enhancedWsServer.cleanup();
      }).not.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server, {
        enableHealthMonitoring: true,
        healthCheckInterval: 1000,
        metricsCollectionInterval: 2000
      });

      // Should not throw during cleanup
      expect(() => {
        enhancedWsServer.cleanup();
      }).not.toThrow();
    });

    it('should handle cleanup with no active connections', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      
      expect(() => {
        enhancedWsServer.cleanup();
      }).not.toThrow();
      
      const healthStatus = enhancedWsServer.getHealthStatus();
      expect(healthStatus.activeConnections).toBe(0);
    });
  });

  describe('Integration Features', () => {
    it('should be compatible with existing TwilioWebSocketServer usage patterns', () => {
      // Test that it can be initialized the same way as TwilioWebSocketServer
      const enhancedServer = initializeEnhancedWebSocketServer(server);
      expect(enhancedServer).toBeDefined();
      expect(typeof enhancedServer.cleanup).toBe('function');
      expect(typeof enhancedServer.getHealthStatus).toBe('function');
      expect(typeof enhancedServer.getConnectionMetrics).toBe('function');
    });

    it('should provide enhanced capabilities beyond basic WebSocket server', () => {
      enhancedWsServer = new EnhancedWebSocketServer(server);
      
      // Should have enhanced methods not available in basic WebSocket server
      expect(typeof enhancedWsServer.sendEnhancedMediaFrame).toBe('function');
      expect(typeof enhancedWsServer.getConnectionMetrics).toBe('function');
      expect(typeof enhancedWsServer.getHealthStatus).toBe('function');
    });
  });

  describe('Configuration Validation', () => {
    it('should handle configuration with all enhanced features enabled', () => {
      const config = {
        maxConnections: 1000,
        connectionTimeout: 30000,
        heartbeatInterval: 15000,
        enableHealthMonitoring: true,
        healthCheckInterval: 20000,
        metricsCollectionInterval: 30000,
        enableProtocolValidation: true,
        strictTwilioCompliance: true,
        enhancedManagerConfig: {
          maxReconnectAttempts: 5,
          reconnectDelay: 1000,
          heartbeatInterval: 15000,
          connectionTimeout: 10000,
          maxHeartbeatMisses: 3,
          pingInterval: 20000,
          pongTimeout: 5000,
          enableFrameValidation: true,
          strictProtocolCompliance: true,
          maxFrameSize: 64 * 1024,
          maxMessageSize: 1024 * 1024,
          errorClassificationEnabled: true,
          retryOnProtocolErrors: false
        }
      };

      expect(() => {
        enhancedWsServer = new EnhancedWebSocketServer(server, config);
      }).not.toThrow();

      expect(enhancedWsServer).toBeDefined();
    });
  });
});