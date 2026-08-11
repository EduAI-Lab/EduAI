import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from '../types/auth';
import { authService } from '../services/authService';
import { apiKeyStorage } from '../services/apiKeyStorage';
import {
  clearAiReviewHistoryForUser,
  discardLegacyAiReviewHistory,
} from '../services/aiReviewHistoryStorage';
import { clearOCRHistoryForUser, OCR_HISTORY_KEY } from '../types/ocr';
import { isAxiosError } from 'axios';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiKeyStorage.setAuthenticatedUser(null);
    try {
      localStorage.removeItem(OCR_HISTORY_KEY);
    } catch {
      // Storage may be disabled. The unscoped history is never loaded regardless.
    }
    discardLegacyAiReviewHistory();

    authService
      .getCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        apiKeyStorage.setAuthenticatedUser(currentUser.id);
        setAuthError(null);
        setUser(currentUser);
        setIsAuthenticated(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        apiKeyStorage.setAuthenticatedUser(null);
        setUser(null);
        setIsAuthenticated(false);
        if (isAxiosError(error) && error.response?.status === 401) {
          // The API interceptor redirects confirmed unauthenticated sessions to Core login.
          setAuthError(null);
        } else {
          setAuthError('Authentication service unavailable');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      apiKeyStorage.setAuthenticatedUser(null);
    };
  }, []);

  const logout = useCallback(async () => {
    const currentUserId = user?.id ?? null;

    // Revoke browser-held secrets before making a request that can fail. Keep
    // the visible session until the server confirms that logout succeeded.
    apiKeyStorage.setAuthenticatedUser(null);
    apiKeyStorage.clearApiKeysForUser(currentUserId);
    clearOCRHistoryForUser(currentUserId);
    clearAiReviewHistoryForUser(currentUserId);

    const apiUrl = import.meta.env?.VITE_API_URL || 'http://localhost:8000';
    let response: Response;
    try {
      response = await fetch(`${apiUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      apiKeyStorage.setAuthenticatedUser(currentUserId);
      throw error;
    }

    if (!response.ok) {
      let message = `Logout failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload?.error === 'string' && payload.error.trim()) {
          message = payload.error;
        }
      } catch {
        // The status code still communicates the failure when no JSON body exists.
      }
      apiKeyStorage.setAuthenticatedUser(currentUserId);
      throw new Error(message);
    }

    setUser(null);
    setIsAuthenticated(false);
    setAuthError(null);
    const coreUrl = import.meta.env?.VITE_CORE_URL || 'http://localhost:3000';
    window.location.href = `${coreUrl}/login`;
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated, authError, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
