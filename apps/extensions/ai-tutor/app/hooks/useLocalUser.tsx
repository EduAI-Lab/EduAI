import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '~/lib/api';
import type { User } from '~/lib/types';

export type AuthUser = Pick<User, 'id' | 'name' | 'role'>;

type AuthContextValue = {
  user: AuthUser | null;
  isInitializing: boolean;
  saveAuth: (userData: AuthUser) => void;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  initialUser: AuthUser | null;
  children: React.ReactNode;
};

export function AuthProvider({ initialUser, children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [isInitializing, setIsInitializing] = useState(!initialUser);

  useEffect(() => {
    if (initialUser) {
      setIsInitializing(false);
      return;
    }

    // Guard against late `setState` if the provider unmounts before the
    // in-flight `/api/me` resolves (e.g. fast route swap during hydration).
    let cancelled = false;

    api
      .me()
      .then((data) => {
        if (cancelled) return;
        const nextUser = data?.user ?? null;
        if (nextUser) {
          setUser({ id: nextUser.id, name: nextUser.name, role: nextUser.role });
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsInitializing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialUser]);

  const saveAuth = (userData: AuthUser) => {
    setUser(userData);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Failed to log out', error);
    }
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isInitializing,
      saveAuth,
      logout,
      setUser,
    }),
    [isInitializing, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useLocalUser() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useLocalUser must be used within an AuthProvider');
  }
  return context;
}
