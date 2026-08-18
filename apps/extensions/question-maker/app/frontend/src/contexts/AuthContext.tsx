import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { User } from "../types/auth";
import { authService } from "../services/authService";
import { getCoreLoginUrl } from "../lib/coreUrl";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
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
  useEffect(() => {
    let cancelled = false;

    authService
      .getCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        setUser(currentUser);
        setIsAuthenticated(true);
      })
      .catch(() => {
        // 401s are handled by the api.ts interceptor (redirects to Core login).
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";
    await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(
      () => {},
    );
    // Match the api.ts 401 interceptor and AI Tutor: send the user to Core login
    // with a `redirect` back to this extension so re-login returns them here,
    // rather than stranding them on Core with a bare `/login` (#1574).
    window.location.href = getCoreLoginUrl();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
