import axios from 'axios';
import authDebug from '@/utils/authDebug';

// For debugging configuration saves
const logAPIOperation = (operation: string, url: string, data?: any) => {
  console.log(`API ${operation} - ${url}`, data || '');
};

// Determine base URL - this ensures proxy works correctly in dev mode
const apiBaseURL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: apiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Adding longer timeout for voice synthesis requests
  timeout: 30000 // 30 seconds
});

// Log API configuration
console.log('API configured with baseURL:', apiBaseURL);
console.log('Running in environment:', import.meta.env.MODE);

// Add custom type to window for production error reporting
declare global {
  interface Window {
    reportAPIError?: (errorData: {
      url?: string;
      method?: string;
      status?: number;
      message: string;
      code?: string;
    }) => void;
  }
}

// Intercept requests
api.interceptors.request.use(
  (config) => {
    // Add authorization header if user is logged in
    const user = localStorage.getItem('user');
    if (user) {
      try {
        const userData = JSON.parse(user);
        if (userData && userData.token) {
          // Ensure token is properly formatted
          const token = userData.token.trim();
          if (token) {
            authDebug.log(`Setting Authorization header for ${config.url}`);
            config.headers.Authorization = `Bearer ${token}`;
          } else {
            authDebug.warn('Token is empty after trimming');
          }
        } else {
          authDebug.warn('User data found but token is missing');
        }
      } catch (error) {
        authDebug.error('Failed to parse user data from localStorage:', error);
      }
    }
    
    // Log the request for debugging
    logAPIOperation('Request', config.url || '', config.data);
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Intercept responses
api.interceptors.response.use(
  (response) => {
    // Log successful response for debugging
    logAPIOperation('Response', response.config.url || '', response.data);
    return response;
  },
  (error) => {
    // Enhanced error logging
    authDebug.error('API Error Details:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    
    // For 404 Not Found errors related to data endpoints, return empty data
    if (error.response?.status === 404 && 
        (error.config?.url?.includes('/campaigns') || 
         error.config?.url?.includes('/leads') || 
         error.config?.url?.includes('/analytics') ||
         error.config?.url?.includes('/calls/analytics'))) {
      
      // Handle different endpoint formats
      if (error.config?.url?.includes('/campaigns')) {
        return Promise.resolve({ 
          data: { campaigns: [], pagination: { page: 1, pages: 0, total: 0, limit: 10 } }
        });
      } else if (error.config?.url?.includes('/calls/analytics')) {
        return Promise.resolve({
          data: {
            summary: {
              totalCalls: 0,
              completedCalls: 0,
              failedCalls: 0,
              averageDuration: 0,
              totalDuration: 0,
              successRate: 0,
              conversionRate: 0,
              negativeRate: 0,
              outcomes: {}
            },
            callsByDay: []
          }
        });
      } else {
        return Promise.resolve({ data: [] });
      }
    }
    
    // For monitoring/tracking in production
    if (typeof window.reportAPIError === 'function') {
      window.reportAPIError({
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        message: error.message,
        code: error.code
      });
    }
    
    // Handle unauthorized errors (401)
    if (error.response && error.response.status === 401) {
      // Get info about the current request
      const requestUrl = error.config?.url || '';
      const method = error.config?.method || '';
      
      // Check if this is a login-related request or other authentication endpoint
      const isAuthEndpoint = 
        requestUrl.includes('/users/login') || 
        requestUrl.includes('/users/register') || 
        requestUrl.includes('/auth');
      
      authDebug.warn(`401 error on ${method} ${requestUrl}, isAuthEndpoint: ${isAuthEndpoint}`);
      
      // Don't logout during login/register operations
      if (isAuthEndpoint) {
        authDebug.log('Ignoring 401 on auth endpoint');
        return Promise.reject(error);
      }
      
      // Check if we just logged in (grace period)
      const lastLoginTime = localStorage.getItem('lastLoginTime');
      const currentTime = Date.now();
      const loginTimeDiff = lastLoginTime ? (currentTime - parseInt(lastLoginTime)) : Infinity;
      const recentLogin = loginTimeDiff < 15000; // 15 seconds grace period
      
      authDebug.log(`Time since login: ${loginTimeDiff}ms, recentLogin: ${recentLogin}`);
      
      // Check if we're already on the login page
      const isLoginPage = window.location.pathname === '/login';
      
      // Only logout if we're not in a safe condition and it's not a recent login
      if (!recentLogin && !isLoginPage) {
        authDebug.error('401 error detected, logging out user');
        // Remove user from local storage
        localStorage.removeItem('user');
        localStorage.removeItem('lastLoginTime');
        sessionStorage.removeItem('sessionInitialized');
        
        // Redirect to login page
        setTimeout(() => {
          window.location.href = '/login';
        }, 100);
      } else {
        authDebug.log('Ignoring 401 due to safety conditions', {
          isAuthEndpoint,
          recentLogin,
          isLoginPage
        });
      }
    }
    return Promise.reject(error);
  }
);

export default api;
