/**
 * Standalone auth hook for components that don't use the AuthContext wrapper.
 * Manages token-backed user state and exposes login/register/logout helpers.
 */
import { useState, useEffect, useCallback } from 'react';
import { User } from '../types/auth';
import { authService } from '../services/authService';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (isInitialized) return; // Prevent multiple initializations
    
    const initAuth = async () => {
      const token = authService.getStoredToken();
      const storedUser = authService.getStoredUser();

      if (token && storedUser) {
        try {
          // Verify token is still valid
          const currentUser = await authService.getCurrentUser();
          setUser(currentUser);
          setIsAuthenticated(true);
        } catch (error) {
          // Token is invalid, clear storage
          authService.logout();
        }
      }
      setIsLoading(false);
      setIsInitialized(true);
    };

    initAuth();
  }, [isInitialized]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await authService.login({ email, password });
      console.log('Login response:', response);
      const { user: userData, token } = response.data;
      
      // Store auth data first
      authService.storeAuthData(userData, token);
      
      // Update state synchronously
      setUser(userData);
      setIsAuthenticated(true);
      setIsInitialized(true); // Mark as initialized to prevent re-initialization
      
      console.log('Login successful, isAuthenticated set to true');
      return { success: true };
    } catch (error: any) {
      console.error('Login error:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Login failed' 
      };
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    try {
      const response = await authService.register({ email, password });
      const { user: userData, token } = response.data;
      
      // Store auth data first
      authService.storeAuthData(userData, token);
      
      // Update state synchronously
      setUser(userData);
      setIsAuthenticated(true);
      setIsInitialized(true); // Mark as initialized to prevent re-initialization
      
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.response?.data?.error || 'Registration failed' 
      };
    }
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated,
    login,
    register,
    logout
  };
};
