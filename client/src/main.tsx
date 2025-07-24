import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import './styles/globals.css';
import { ThemeProvider } from './contexts/ThemeContext';

// Clear storage if quota exceeded
try {
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(quota => {
      if (quota.usage && quota.quota && quota.usage / quota.quota > 0.8) {
        console.warn('Storage quota nearly exceeded, clearing cache');
        localStorage.clear();
        sessionStorage.clear();
      }
    });
  }
} catch (error) {
  console.warn('Could not check storage quota:', error);
  // Clear storage as a precaution
  localStorage.clear();
  sessionStorage.clear();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </BrowserRouter>
  </React.StrictMode>
);
