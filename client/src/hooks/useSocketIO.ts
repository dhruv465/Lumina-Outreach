import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './useAuth';

// Define types for the metric updates
interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
  queuedCalls: number;
  totalCalls24h: number;
  successRate24h: number;
  averageDuration: number;
  lastUpdated: Date;
}

interface ActiveCall {
  id: string;
  phoneNumber: string;
  status: string;
  duration: number;
  startTime: string;
}

// Create the hook
export function useSocketIO() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const { user } = useAuth();
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = useRef(1000);

  // Initialize socket connection with enhanced error handling
  useEffect(() => {
    let socketInstance: Socket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const createConnection = () => {
      try {
        // Get the base URL for the socket connection
        const SOCKET_URL = import.meta.env.VITE_WS_URL || 
                          import.meta.env.VITE_API_URL || 
                          window.location.origin;
        
        console.log('SocketIO attempting connection to:', SOCKET_URL);
        
        // Clear any previous connection error
        setConnectionError(null);
        
        socketInstance = io(SOCKET_URL, {
          transports: ['polling', 'websocket'], // Try polling first, then websocket
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: maxReconnectAttempts,
          reconnectionDelay: reconnectDelay.current,
          reconnectionDelayMax: 10000,
          timeout: 20000,
          forceNew: true, // Force new connection to avoid conflicts
          upgrade: true, // Allow transport upgrades
        });

        // Connection successful
        socketInstance.on('connect', () => {
          console.log('Socket connected successfully');
          setIsConnected(true);
          setConnectionError(null);
          reconnectAttempts.current = 0;
          reconnectDelay.current = 1000; // Reset delay

          // Join rooms for dashboard and notifications if user is authenticated
          if (user?._id) {
            socketInstance?.emit('join-dashboard', user._id);
            socketInstance?.emit('join-user-room', user._id);
            console.log(`Joined dashboard room for user: ${user._id}`);
          }
        });

        // Connection failed
        socketInstance.on('connect_error', (error) => {
          console.error('Socket connection error:', error);
          setIsConnected(false);
          setConnectionError(`Connection failed: ${error.message}`);
          
          reconnectAttempts.current++;
          
          // Exponential backoff
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 10000);
          
          if (reconnectAttempts.current >= maxReconnectAttempts) {
            console.error('Max reconnection attempts reached. Giving up.');
            setConnectionError('Unable to connect to server. Please check your internet connection and refresh the page.');
          }
        });

        // Connection lost
        socketInstance.on('disconnect', (reason) => {
          console.log('Socket disconnected:', reason);
          setIsConnected(false);
          
          // Don't show error for intentional disconnects
          if (reason === 'io client disconnect') {
            setConnectionError(null);
          } else {
            setConnectionError(`Connection lost: ${reason}`);
          }
        });

        // Reconnection attempt
        socketInstance.on('reconnect_attempt', (attemptNumber) => {
          console.log(`Reconnection attempt ${attemptNumber}/${maxReconnectAttempts}`);
          setConnectionError(`Reconnecting... (${attemptNumber}/${maxReconnectAttempts})`);
        });

        // Successful reconnection
        socketInstance.on('reconnect', (attemptNumber) => {
          console.log(`Successfully reconnected after ${attemptNumber} attempts`);
          setIsConnected(true);
          setConnectionError(null);
          reconnectAttempts.current = 0;
        });

        // Failed to reconnect
        socketInstance.on('reconnect_failed', () => {
          console.error('Failed to reconnect after maximum attempts');
          setConnectionError('Failed to reconnect. Please refresh the page.');
        });

        // Set up metrics and call data listeners
        socketInstance.on('metrics-update', (data: SystemMetrics) => {
          console.log('Received metrics update:', data);
          setSystemMetrics(data);
        });

        socketInstance.on('active-calls', (data: ActiveCall[]) => {
          console.log('Received active calls update:', data);
          setActiveCalls(data);
        });

        // Store the socket instance
        setSocket(socketInstance);

      } catch (error: any) {
        console.error('Error creating socket connection:', error);
        setConnectionError(`Failed to initialize connection: ${error.message}`);
      }
    };

    // Create initial connection
    createConnection();

    // Cleanup function
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      if (socketInstance) {
        console.log('Cleaning up socket connection');
        
        // Remove all listeners
        socketInstance.off('connect');
        socketInstance.off('disconnect');
        socketInstance.off('connect_error');
        socketInstance.off('reconnect_attempt');
        socketInstance.off('reconnect');
        socketInstance.off('reconnect_failed');
        socketInstance.off('metrics-update');
        socketInstance.off('active-calls');
        
        // Disconnect
        socketInstance.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
    };
  }, [user?._id]); // Only recreate when user changes

  // Function to emit an event with connection checking
  const emit = useCallback((event: string, data?: any) => {
    if (socket && isConnected) {
      try {
        socket.emit(event, data);
        console.log(`Emitted event: ${event}`, data);
      } catch (error) {
        console.error(`Failed to emit event ${event}:`, error);
      }
    } else {
      console.warn('Socket not connected, cannot emit:', event, {
        hasSocket: !!socket,
        isConnected,
        connectionError
      });
    }
  }, [socket, isConnected, connectionError]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    if (socket && !isConnected) {
      console.log('Manual reconnect requested');
      socket.connect();
    }
  }, [socket, isConnected]);

  return {
    socket,
    isConnected,
    connectionError,
    emit,
    reconnect,
    systemMetrics,
    activeCalls
  };
}
