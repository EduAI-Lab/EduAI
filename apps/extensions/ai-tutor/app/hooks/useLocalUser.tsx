import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api, { ApiNetworkError } from "~/lib/api";
import { clearApiKeysForUser, discardLegacyApiKeysFromStorage } from "~/lib/provider-keys";
import type { User } from "~/lib/types";

// A fresh dev-stack start can briefly have the AI Tutor frontend reachable
// before its Express API has finished migrate/generate/seed and started
// listening. Retry a few times before concluding the user is logged out.
const ME_MAX_ATTEMPTS = 5;
const ME_RETRY_DELAY_MS = 800;

export type AuthUser = Pick<User, "id" | "name" | "role" | "authorizedUnits"> & {
  email?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isInitializing: boolean;
  authError: string | null;
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
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    discardLegacyApiKeysFromStorage();
    if (initialUser) {
      setIsInitializing(false);
      return;
    }

    // Guard against late `setState` if the provider unmounts before the
    // in-flight `/api/me` resolves (e.g. fast route swap during hydration).
    let cancelled = false;

    async function loadUser() {
      for (let attempt = 1; attempt <= ME_MAX_ATTEMPTS; attempt++) {
        try {
          const data = await api.me();
          if (cancelled) return;
          const nextUser = data?.user ?? null;
          setAuthError(null);
          if (nextUser) {
            setUser({
              id: nextUser.id,
              name: nextUser.name,
              email: nextUser.email,
              role: nextUser.role,
              authorizedUnits: nextUser.authorizedUnits,
            });
          } else {
            setUser(null);
          }
          return;
        } catch (err) {
          if (cancelled) return;
          // A network-level failure (e.g. the API hasn't started listening yet)
          // is transient — retry. An authenticated-but-rejected response already
          // redirects inside `http()`, so anything else reaching here is final.
          if (err instanceof ApiNetworkError && attempt < ME_MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, ME_RETRY_DELAY_MS));
            continue;
          }
          if (err instanceof Error && err.message === "Authentication required") {
            setAuthError(null);
            setUser(null);
          } else {
            setAuthError("Authentication service unavailable");
          }
          return;
        }
      }
    }

    loadUser().finally(() => {
      if (cancelled) return;
      setIsInitializing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [initialUser]);

  const setAuthUser = (nextUser: AuthUser | null) => {
    if (user && user.id !== nextUser?.id) {
      clearApiKeysForUser(user.id);
    }
    discardLegacyApiKeysFromStorage();
    setAuthError(null);
    setUser(nextUser);
  };

  const saveAuth = (userData: AuthUser) => {
    setAuthUser(userData);
  };

  const logout = async () => {
    // Remove browser-held credentials and revoke the hook's in-memory account
    // scope before waiting for the network logout to finish.
    clearApiKeysForUser(user?.id);
    discardLegacyApiKeysFromStorage();
    await api.logout();
    setAuthError(null);
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isInitializing,
      authError,
      saveAuth,
      logout,
      setUser: setAuthUser,
    }),
    [authError, isInitializing, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useLocalUser() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useLocalUser must be used within an AuthProvider");
  }
  return context;
}
