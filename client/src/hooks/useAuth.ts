import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import { useToast } from '@/hooks/useToast';
import authDebug from '@/utils/authDebug';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  token: string;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Function to verify and set the authentication state
  const initializeAuth = useCallback(() => {
    authDebug.log('Initializing authentication state');
    setIsLoading(true);
    
    try {
      // Check if user is stored in local storage
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        authDebug.log('Found stored user:', parsedUser.email);
        
        // Validate token format
        if (!parsedUser.token || typeof parsedUser.token !== 'string') {
          authDebug.warn('Invalid token format in stored user data, logging out');
          localStorage.removeItem('user');
          setUser(null);
        } else {
          // Set user in state
          setUser(parsedUser);
          
          // Set the Authorization header for all future API calls
          api.defaults.headers.common['Authorization'] = `Bearer ${parsedUser.token}`;
          authDebug.log('Set Authorization header from stored user');
        }
      } else {
        authDebug.log('No stored user found');
        setUser(null);
      }
    } catch (error) {
      authDebug.error('Error initializing auth:', error);
      // Clear potentially corrupted data
      localStorage.removeItem('user');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
    
    // Log current auth state
    authDebug.state();
  }, []);

  // Initialize on component mount
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      authDebug.log('Attempting login for:', email);
      const response = await api.post('/users/login', { email, password });
      const userData = response.data;

      if (!userData || !userData.token) {
        throw new Error('Login response missing user data or token');
      }

      authDebug.log('Login successful for:', userData.email);
      
      // Store user in local storage
      localStorage.setItem('user', JSON.stringify(userData));
      
      // Store login timestamp to prevent immediate logout due to 401 errors
      localStorage.setItem('lastLoginTime', Date.now().toString());
      
      // Reset session initialization flag
      sessionStorage.removeItem('sessionInitialized');
      
      // Clear any previous 401 errors
      localStorage.removeItem('last401Time');
      
      // Set user in state
      setUser(userData);

      // Set the Authorization header for all future API calls
      api.defaults.headers.common['Authorization'] = `Bearer ${userData.token}`;
      
      // Log current auth state
      authDebug.state();

      // Navigate to dashboard after a small delay to ensure token is set
      setTimeout(() => {
        navigate('/dashboard');
      }, 100);

      toast({
        title: 'Login successful',
        description: `Welcome back, ${userData.name}!`,
      });

      return userData;
    } catch (error: any) {
      const message = error.response?.data?.message || 'An error occurred during login';
      authDebug.error('Login error:', error);
      toast({
        title: 'Login failed',
        description: message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (name: string, email: string, password: string, role?: string) => {
    setIsLoading(true);
    try {
      const response = await api.post('/users/register', { name, email, password, role });
      const userData = response.data;

      // Store user in local storage
      localStorage.setItem('user', JSON.stringify(userData));
      
      // Set user in state
      setUser(userData);

      // Set the Authorization header for all future API calls
      api.defaults.headers.common['Authorization'] = `Bearer ${userData.token}`;

      // Navigate to dashboard
      navigate('/dashboard');

      toast({
        title: 'Registration successful',
        description: `Welcome, ${userData.name}!`,
      });

      return userData;
    } catch (error: any) {
      const message = error.response?.data?.message || 'An error occurred during registration';
      toast({
        title: 'Registration failed',
        description: message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authDebug.log('Logging out user');
    
    // Clear all auth-related items from local storage
    localStorage.removeItem('user');
    localStorage.removeItem('lastLoginTime');
    localStorage.removeItem('last401Time');
    
    // Remove the Authorization header
    delete api.defaults.headers.common['Authorization'];
    
    // Clear user from state
    setUser(null);
    
    // Reset any pending requests
    if (typeof window !== 'undefined') {
      // Abort any pending requests
      const controller = new AbortController();
      controller.abort();
    }
    
    // Log current auth state after logout
    authDebug.state();
    
    // Navigate to login page
    navigate('/login');

    toast({
      title: 'Logged out',
      description: 'You have been successfully logged out.',
    });
  };

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
  };
};
