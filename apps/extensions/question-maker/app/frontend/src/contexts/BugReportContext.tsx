/**
 * Provides bug-report capture, dialog state, and a floating entry point for logged-in users.
 */
import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { BugOff } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useBugReportCapture } from '../hooks/useBugReportCapture';
import { BugReportDialog } from '../components/bug-report/BugReportDialog';
import { Tooltip } from '../components/ui/tooltip';
import { Button } from '../components/ui/button';

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
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const captureEnabled = !isLoading && isAuthenticated && pathname !== '/login';
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
              className="fixed bottom-4 right-4 z-40 shadow-md gap-2 rounded-full border border-gray-200 bg-white/95 backdrop-blur-sm px-4 py-2 h-auto text-gray-800 hover:bg-gray-50"
              onClick={() => setOpen(true)}
              aria-label="Report a bug"
            >
              <BugOff className="h-4 w-4 text-blue-700" />
              <span className="text-sm font-medium">Report bug</span>
            </Button>
          </Tooltip>
        </>
      )}
    </BugReportContext.Provider>
  );
}
