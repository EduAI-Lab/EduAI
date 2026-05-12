/**
 * Auth context provider that manages user session state, token storage, and auth actions.
 * Exposes hooks for login/register/logout and guards consumers until initialization completes.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { User } from '../types/auth';
import { authService } from '../services/authService';
import { refreshEduAIStatus } from '../hooks/useEduAIStatus';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Hook to read auth context; throws if used outside AuthProvider. */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

/** Provides auth state/actions to the React tree and initializes from stored tokens. */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const hasInitialized = useRef(false);

  // Initialize authentication state
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    
    const initAuth = async () => {
      console.log('AuthProvider: Initializing auth...');
      const token = authService.getStoredToken();
      const storedUser = authService.getStoredUser();

      if (token && storedUser) {
        try {
          console.log('AuthProvider: Verifying stored token...');
          const currentUser = await authService.getCurrentUser();
          setUser(currentUser);
          setIsAuthenticated(true);
          console.log('AuthProvider: Token verified, user authenticated');
        } catch (error) {
          console.log('AuthProvider: Token invalid, clearing storage');
          authService.logout();
        }
      }
      setIsLoading(false);
      setIsInitialized(true);
      console.log('AuthProvider: Initialization complete');
    };

    initAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      console.log('AuthProvider: Attempting login...');
      const response = await authService.login({ email, password });
      const { user: userData, token } = response.data;
      
      // Store auth data first
      authService.storeAuthData(userData, token);
      
      // Update state synchronously
      setUser(userData);
      setIsAuthenticated(true);
      setIsInitialized(true);
      void refreshEduAIStatus();
      console.log('AuthProvider: Login successful');
      return { success: true };
    } catch (error: any) {
      console.error('AuthProvider: Login error:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Login failed' 
      };
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    try {
      console.log('AuthProvider: Attempting registration...');
      const response = await authService.register({ email, password });
      const { user: userData, token } = response.data;
      
      // Store auth data first
      authService.storeAuthData(userData, token);
      
      // Update state synchronously
      setUser(userData);
      setIsAuthenticated(true);
      setIsInitialized(true);
      void refreshEduAIStatus();
      try {
        sessionStorage.setItem('newUserTourPending', '1');
      } catch (_) {}
      console.log('AuthProvider: Registration successful');
      return { success: true };
    } catch (error: any) {
      console.error('AuthProvider: Registration error:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Registration failed' 
      };
    }
  }, []);

  const logout = useCallback(() => {
    console.log('AuthProvider: Logging out...');
    authService.logout();
    setUser(null);
    setIsAuthenticated(false);
    setIsInitialized(false);
    hasInitialized.current = false;
  }, []);

  const value = {
    user,
    isLoading,
    isAuthenticated,
    login,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
