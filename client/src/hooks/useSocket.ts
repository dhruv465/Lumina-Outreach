import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './useAuth';

// Create a Socket.IO client instance using the environment variable 
// VITE_WS_URL from .env file or falling back to window.location.origin
const SOCKET_URL = import.meta.env.VITE_WS_URL || window.location.origin;
let socket: Socket | null = null;

console.log('Using WebSocket URL:', SOCKET_URL); // Helpful for debugging

export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useAuth();
  
  useEffect(() => {
    // Initialize socket connection if not already established
    if (!socket) {
      socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 60000,            // Increased connection timeout matching server
      });
    }

    // Socket event listeners
    const onConnect = () => {
      console.log('Socket connected');
      setIsConnected(true);
      
      // Join user-specific rooms if authenticated
      if (user?._id) {
        // Join dashboard room for real-time updates
        socket?.emit('join-dashboard', user._id);
        
        // Join user notification room
        socket?.emit('join-user-room', user._id);
        
        console.log(`Joined dashboard and notification rooms for user: ${user._id}`);
      }
    };

    const onDisconnect = () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    };

    const onError = (error: Error) => {
      console.error('Socket error:', error);
    };

    // Register event handlers
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('error', onError);

    // Clean up event listeners on component unmount
    return () => {
      socket?.off('connect', onConnect);
      socket?.off('disconnect', onDisconnect);
      socket?.off('error', onError);
    };
  }, [user]);

  // Helper function to emit events
  const emit = (event: string, data?: any) => {
    if (socket && isConnected) {
      socket.emit(event, data);
    } else {
      console.warn('Socket not connected, cannot emit:', event);
    }
  };

  // Helper function to listen for events
  const on = (event: string, callback: (...args: any[]) => void) => {
    if (socket) {
      socket.on(event, callback);
      return () => {
        socket?.off(event, callback);
      };
    }
    return () => {}; // Return empty cleanup function if socket doesn't exist
  };

  return {
    socket,
    isConnected,
    emit,
    on
  };
};
