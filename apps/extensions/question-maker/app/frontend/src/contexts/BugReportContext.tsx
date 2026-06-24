/**
 * Provides bug-report capture and dialog state for the header entry point.
 */
import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useBugReportCapture } from '../hooks/useBugReportCapture';
import { BugReportDialog } from '../components/bug-report/BugReportDialog';

type BugReportContextValue = {
  openBugReport: () => void;
};

export const BugReportContext = createContext<BugReportContextValue | null>(null);

export function useBugReport(): BugReportContextValue | null {
  return useContext(BugReportContext);
}

interface BugReportProviderProps {
  children: ReactNode;
}

export function BugReportProvider({ children }: BugReportProviderProps) {
  const { isAuthenticated, user, isLoading } = useAuth();
  const [open, setOpen] = useState(false);

  const captureEnabled = !isLoading && isAuthenticated;
  const { getCapturedData } = useBugReportCapture(captureEnabled);

  const value = useMemo(
    () => ({
      openBugReport: () => setOpen(true)
    }),
    []
  );

  return (
    <BugReportContext.Provider value={value}>
      {children}
      {captureEnabled && user && (
        <BugReportDialog
          open={open}
          setOpen={setOpen}
          getCapturedData={getCapturedData}
          userEmail={user.email}
        />
      )}
    </BugReportContext.Provider>
  );
}
