import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type QmLayoutContextValue = {
  profileOpen: boolean;
  openProfile: () => void;
  closeProfile: () => void;
};

const QmLayoutContext = createContext<QmLayoutContextValue | null>(null);

export function QmLayoutProvider({ children }: { children: ReactNode }) {
  const [profileOpen, setProfileOpen] = useState(false);

  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);

  const value = useMemo(
    () => ({
      profileOpen,
      openProfile,
      closeProfile,
    }),
    [profileOpen, openProfile, closeProfile],
  );

  return <QmLayoutContext.Provider value={value}>{children}</QmLayoutContext.Provider>;
}

export function useQmLayout() {
  const ctx = useContext(QmLayoutContext);
  if (!ctx) {
    throw new Error("useQmLayout must be used within QmLayoutProvider");
  }
  return ctx;
}
