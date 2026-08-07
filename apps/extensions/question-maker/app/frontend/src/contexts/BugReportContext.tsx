import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { BugReportDialog } from '@eduai/ui';
import type { BugReportSubmitData } from '@eduai/ui';
import { useAuth } from './AuthContext';
import { useBugReportCapture } from '../hooks/useBugReportCapture';
import { bugReportApi } from '../services/bugReportApi';

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
  const { isAuthenticated, isLoading } = useAuth();
  const [open, setOpen] = useState(false);

  const captureEnabled = !isLoading && isAuthenticated;
  const { getCapturedData } = useBugReportCapture(captureEnabled);

  const handleSubmit = async (data: BugReportSubmitData) => {
    await bugReportApi.submit({
      description: data.description,
      bugType: data.bugType,
      consoleLogs: data.consoleLogs ?? '[]',
      networkLogs: data.networkLogs ?? '[]',
      screenshot: data.screenshot ?? null,
      pageUrl: data.pageUrl ?? window.location.href,
      userAgent: data.userAgent ?? navigator.userAgent,
      isAnonymous: data.isAnonymous,
    });
  };

  const value = useMemo(
    () => ({
      openBugReport: () => setOpen(true)
    }),
    []
  );

  return (
    <BugReportContext.Provider value={value}>
      {children}
      {captureEnabled && (
        <BugReportDialog
          open={open}
          onOpenChange={setOpen}
          onSubmit={handleSubmit}
          getCapturedData={getCapturedData}
        />
      )}
    </BugReportContext.Provider>
  );
}
