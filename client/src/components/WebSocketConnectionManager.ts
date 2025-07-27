// WebSocketConnectionManager.ts
// This utility provides reliable WebSocket connection management with fallback mechanisms

/**
 * Attempts to establish a WebSocket connection with fallback options
 * 
 * @param primaryUrl - The primary WebSocket URL to connect to
 * @param fallbackUrls - Array of fallback URLs to try if the primary fails
 * @param timeoutMs - Timeout in milliseconds before trying next URL
 * @param onOpen - Callback when connection is successful
 * @param onMessage - Callback for message handling
 * @param onError - Callback for error handling
 * @param onClose - Callback when connection closes
 * @returns The WebSocket instance and a cleanup function
 */
export const createReliableWebSocket = (
  primaryUrl: string,
  fallbackUrls: string[],
  timeoutMs: number = 5000,
  onOpen?: (socket: WebSocket) => void,
  onMessage?: (event: MessageEvent) => void,
  onError?: (event: Event) => void,
  onClose?: (event: CloseEvent) => void
): { socket: WebSocket; cleanup: () => void } => {
  let socket: WebSocket | null = null;
  let currentUrlIndex = -1;
  const urls = [primaryUrl, ...fallbackUrls];
  let timeoutId: NodeJS.Timeout | null = null;
  
  // Function to try the next URL in the list
  const tryNextUrl = () => {
    // Clear any existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Close existing socket if it exists
    if (socket) {
      try {
        socket.close();
      } catch (e) {
        console.error('Error closing previous socket:', e);
      }
    }
    
    // Move to the next URL
    currentUrlIndex++;
    
    // If we've tried all URLs, call the error handler
    if (currentUrlIndex >= urls.length) {
      if (onError) {
        const errorEvent = new Event('error');
        onError(errorEvent);
      }
      return null;
    }
    
    // Try to connect to the next URL
    const url = urls[currentUrlIndex];
    console.log(`Attempting WebSocket connection to: ${url}`);
    
    socket = new WebSocket(url);
    
    // Set up event handlers
    socket.onopen = (event) => {
      // Clear the timeout since we've connected successfully
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (onOpen && socket) {
        onOpen(socket);
      }
    };
    
    socket.onmessage = (event) => {
      if (onMessage) {
        onMessage(event);
      }
    };
    
    socket.onerror = (event) => {
      console.error(`WebSocket error with ${url}:`, event);
      // Don't call the error handler here, we'll try the next URL first
      tryNextUrl();
    };
    
    socket.onclose = (event) => {
      console.log(`WebSocket connection to ${url} closed:`, event);
      
      // Check if the socket was closed due to a timeout (code 1006 typically)
      if (event.code === 1006 || event.code === 1001) {
        console.log(`Connection to ${url} closed unexpectedly, attempting reconnect...`);
        // Only attempt reconnect if this wasn't an intentional close
        if (currentUrlIndex < urls.length - 1) {
          setTimeout(() => tryNextUrl(), 1000); // Try next URL with a short delay
        }
      }
      
      if (onClose) {
        onClose(event);
      }
    };
    
    // Set a timeout to try the next URL if this one doesn't connect
    timeoutId = setTimeout(() => {
      if (socket && socket.readyState !== WebSocket.OPEN) {
        console.log(`Connection to ${url} timed out after ${timeoutMs}ms`);
        tryNextUrl();
      }
    }, timeoutMs);
    
    return socket;
  };
  
  // Start the connection process
  const initialSocket = tryNextUrl();
  
  // Cleanup function to clear any timeouts and close the socket
  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    if (socket) {
      try {
        socket.close();
      } catch (e) {
        console.error('Error closing socket during cleanup:', e);
      }
    }
  };
  
  return { 
    socket: initialSocket as WebSocket, 
    cleanup 
  };
};

/**
 * Creates a fallback HTTP endpoint for when WebSockets aren't available
 * 
 * @param baseUrl - The base API URL
 * @param endpoint - The specific endpoint for the HTTP fallback
 * @param data - The data to send with the request
 * @returns Promise with the response data
 */
export const createHttpFallback = async (
  baseUrl: string,
  endpoint: string,
  data: any
): Promise<any> => {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP fallback failed with status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('HTTP fallback error:', error);
    throw error;
  }
};
