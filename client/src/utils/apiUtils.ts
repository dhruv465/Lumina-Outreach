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

// Enhanced utility to throttle API calls with better rate limiting
export const throttleAPI = (() => {
  const pendingRequests: Record<string, number> = {};
  const requestCounts: Record<string, number> = {};
  const throttleInterval = 1000; // 1 second between requests to same endpoint
  const maxRequestsPerMinute = 30; // Max 30 requests per minute per endpoint
  
  // Clean up old request counts every minute
  setInterval(() => {
    Object.keys(requestCounts).forEach(key => {
      requestCounts[key] = 0;
    });
  }, 60000);
  
  return (endpoint: string): boolean => {
    const now = Date.now();
    const lastRequest = pendingRequests[endpoint] || 0;
    const currentCount = requestCounts[endpoint] || 0;
    
    // Check rate limiting
    if (currentCount >= maxRequestsPerMinute) {
      console.warn(`Rate limit exceeded for ${endpoint}. Max ${maxRequestsPerMinute} requests per minute.`);
      return false;
    }
    
    // Check throttling
    if (now - lastRequest < throttleInterval) {
      console.log(`Throttling request to ${endpoint}. Last request was ${now - lastRequest}ms ago.`);
      return false;
    }
    
    pendingRequests[endpoint] = now;
    requestCounts[endpoint] = currentCount + 1;
    return true;
  };
})();

// Enhanced utility to cache API responses with smarter invalidation
export const apiCache = (() => {
  const cache: Record<string, { data: any; timestamp: number; accessCount: number }> = {};
  const cacheTTL = 30000; // 30 seconds cache TTL (increased from 10s)
  const maxCacheSize = 100; // Maximum number of cached items
  
  // Clean up old cache entries periodically
  setInterval(() => {
    const now = Date.now();
    Object.keys(cache).forEach(key => {
      if (now - cache[key].timestamp > cacheTTL) {
        delete cache[key];
      }
    });
  }, 60000); // Clean up every minute
  
  return {
    get: (key: string) => {
      const cached = cache[key];
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        cached.accessCount++;
        return cached.data;
      }
      // Remove expired cache
      if (cached) {
        delete cache[key];
      }
      return null;
    },
    set: (key: string, data: any) => {
      // Implement LRU eviction if cache is too large
      if (Object.keys(cache).length >= maxCacheSize) {
        // Find least recently used item (lowest access count)
        let lruKey = '';
        let minAccessCount = Infinity;
        Object.keys(cache).forEach(k => {
          if (cache[k].accessCount < minAccessCount) {
            minAccessCount = cache[k].accessCount;
            lruKey = k;
          }
        });
        if (lruKey) {
          delete cache[lruKey];
        }
      }
      
      cache[key] = { 
        data, 
        timestamp: Date.now(),
        accessCount: 1
      };
    },
    invalidate: (pattern?: string) => {
      if (pattern) {
        // Invalidate keys matching pattern
        Object.keys(cache).forEach(key => {
          if (key.includes(pattern)) {
            delete cache[key];
          }
        });
      } else {
        // Clear all cache
        Object.keys(cache).forEach(key => {
          delete cache[key];
        });
      }
    }
  };
})();

// Request deduplication utility
export const requestDeduplicator = (() => {
  const pendingRequests: Map<string, Promise<any>> = new Map();
  
  return {
    deduplicate: async <T>(key: string, requestFn: () => Promise<T>): Promise<T> => {
      // If request is already in flight, return the existing promise
      if (pendingRequests.has(key)) {
        console.log(`Deduplicating request for ${key}`);
        return pendingRequests.get(key) as Promise<T>;
      }
      
      // Create new request
      const promise = requestFn().finally(() => {
        // Remove from pending requests when done
        pendingRequests.delete(key);
      });
      
      pendingRequests.set(key, promise);
      return promise;
    }
  };
})();
