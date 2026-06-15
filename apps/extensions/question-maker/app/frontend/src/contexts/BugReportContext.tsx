/**
 * Provides bug-report capture, dialog state, and a floating entry point for logged-in users.
 */
import { Button } from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { BugOff } from 'lucide-react';
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
        <>
          <BugReportDialog
            open={open}
            setOpen={setOpen}
            getCapturedData={getCapturedData}
            userEmail={user.email}
          />
          <Tooltip content="Report a bug" side="left">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="fixed bottom-4 right-4 z-40 shadow-md gap-2 rounded-full border border-border bg-background/95 backdrop-blur-sm px-4 py-2 h-auto text-foreground hover:bg-muted"
              onClick={() => setOpen(true)}
              aria-label="Report a bug"
            >
              <BugOff className="h-4 w-4 text-foreground" />
              <span className="text-sm font-medium">Report bug</span>
            </Button>
          </Tooltip>
        </>
      )}
    </BugReportContext.Provider>
  );
}
