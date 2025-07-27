import { useState, useEffect, useCallback } from 'react';
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
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const { user } = useAuth();

  // Initialize socket connection
  useEffect(() => {
    // Create the socket instance using the same URL from environment variable
    const SOCKET_URL = import.meta.env.VITE_WS_URL || window.location.origin;
    console.log('SocketIO connecting to:', SOCKET_URL);
    
    const socketInstance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 60000,            // Increased connection timeout matching server
    });

    // Set up event handlers
    socketInstance.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);

      // Join rooms for dashboard and notifications if user is authenticated
      if (user?._id) {
        socketInstance.emit('join-dashboard', user._id);
        socketInstance.emit('join-user-room', user._id);
        console.log(`Joined dashboard room for user: ${user._id}`);
      }
    });

    socketInstance.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
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

    // Cleanup on unmount
    return () => {
      socketInstance.off('connect');
      socketInstance.off('disconnect');
      socketInstance.off('metrics-update');
      socketInstance.off('active-calls');
      socketInstance.disconnect();
    };
  }, [user]);

  // Function to emit an event
  const emit = useCallback((event: string, data?: any) => {
    if (socket && isConnected) {
      socket.emit(event, data);
    } else {
      console.warn('Socket not connected, cannot emit:', event);
    }
  }, [socket, isConnected]);

  return {
    socket,
    isConnected,
    emit,
    systemMetrics,
    activeCalls
  };
}
