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
         error.config?.url?.includes('/calls/analytics') ||
         error.config?.url?.includes('/dashboard') ||
         error.config?.url?.includes('/knowledge'))) {
      
      // Handle different endpoint formats
      if (error.config?.url?.includes('/campaigns')) {
        return Promise.resolve({ 
          data: { campaigns: [], pagination: { page: 1, pages: 0, total: 0, limit: 10 } }
        });
      } else if (error.config?.url?.includes('/dashboard/overview')) {
        return Promise.resolve({
          data: {
            stats: {
              campaigns: 0,
              leads: 0,
              calls: 0,
              successfulCalls: 0,
              conversionRate: 0,
              callsToday: 0,
              averageDuration: 0
            },
            recentActivity: {
              calls: [],
              campaigns: [],
              upcomingCallbacks: []
            }
          }
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
      } else if (error.config?.url?.includes('/calls') && !error.config?.url?.includes('/calls/analytics')) {
        return Promise.resolve({ 
          data: { calls: [], pagination: { page: 1, pages: 0, total: 0, limit: 10 } }
        });
      } else if (error.config?.url?.includes('/knowledge/documents')) {
        return Promise.resolve({ 
          data: { documents: [], pagination: { page: 1, pages: 0, total: 0, limit: 10 } }
        });
      } else if (error.config?.url?.includes('/knowledge/categories')) {
        return Promise.resolve({ 
          data: { categories: [] }
        });
      } else if (error.config?.url?.includes('/knowledge/tags')) {
        return Promise.resolve({ 
          data: { tags: [] }
        });
      } else if (error.config?.url?.includes('/knowledge')) {
        return Promise.resolve({ data: [] });
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
      
      // Check if we're already on the login page
      const isLoginPage = window.location.pathname === '/login';
      if (isLoginPage) {
        authDebug.log('Already on login page, ignoring 401');
        return Promise.reject(error);
      }
      
      // Check if user data exists in localStorage
      const userData = localStorage.getItem('user');
      if (!userData) {
        authDebug.log('No user data in localStorage, redirecting to login');
        window.location.href = '/login';
        return Promise.reject(error);
      }
      
      // Check if we just logged in (grace period)
      const lastLoginTime = localStorage.getItem('lastLoginTime');
      const currentTime = Date.now();
      const loginTimeDiff = lastLoginTime ? (currentTime - parseInt(lastLoginTime)) : Infinity;
      const recentLogin = loginTimeDiff < 30000; // 30 seconds grace period (increased)
      
      authDebug.log(`Time since login: ${loginTimeDiff}ms, recentLogin: ${recentLogin}`);
      
      // Track 401 errors to prevent logout loops
      const last401Time = localStorage.getItem('last401Time');
      const last401Diff = last401Time ? (currentTime - parseInt(last401Time)) : Infinity;
      const recent401 = last401Diff < 5000; // 5 seconds
      
      if (recent401) {
        authDebug.warn('Multiple 401 errors in short time, preventing logout loop');
        return Promise.reject(error);
      }
      
      // Store this 401 timestamp
      localStorage.setItem('last401Time', currentTime.toString());
      
      // For recording endpoints, provide a more helpful error message
      if (requestUrl.includes('/recording')) {
        authDebug.error('Authentication failed for recording endpoint - token may be expired');
        // Add a custom error message for the UI
        error.message = 'Your session has expired. Please refresh the page and try again.';
      }
      
      // Only logout if token is genuinely invalid (not a recent login)
      if (!recentLogin) {
        authDebug.error('401 error detected, token appears invalid, logging out user');
        // Remove user from local storage
        localStorage.removeItem('user');
        localStorage.removeItem('lastLoginTime');
        localStorage.removeItem('last401Time');
        sessionStorage.removeItem('sessionInitialized');
        
        // Redirect to login page
        setTimeout(() => {
          window.location.href = '/login';
        }, 100);
      } else {
        authDebug.log('Ignoring 401 due to recent login', {
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
