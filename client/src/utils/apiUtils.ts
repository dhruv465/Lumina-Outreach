import { useState, useEffect } from 'react';

// Hook for debouncing API requests
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
}

// Utility to throttle API calls
export const throttleAPI = (() => {
  const pendingRequests: Record<string, number> = {};
  const throttleInterval = 1000; // 1 second between requests to same endpoint
  
  return (endpoint: string): boolean => {
    const now = Date.now();
    const lastRequest = pendingRequests[endpoint] || 0;
    
    if (now - lastRequest < throttleInterval) {
      return false; // Request should not proceed
    }
    
    pendingRequests[endpoint] = now;
    return true; // Request can proceed
  };
})();

// Utility to cache API responses
export const apiCache = (() => {
  const cache: Record<string, { data: any; timestamp: number }> = {};
  const cacheTTL = 10000; // 10 seconds cache TTL
  
  return {
    get: (key: string) => {
      const cached = cache[key];
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
      return null;
    },
    set: (key: string, data: any) => {
      cache[key] = { data, timestamp: Date.now() };
    }
  };
})();
