import React, { createContext, useContext, useState, useMemo, ReactNode } from "react";
import { BugReportDialog } from "@eduai/ui";
import type { BugReportSubmitData } from "@eduai/ui";
import { useBugReportCapture } from "@eduai/ui/bug-report-capture";
import { useAuth } from "./AuthContext";
import { bugReportApi } from "../services/bugReportApi";

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

// Diagnostics come only from the dialog, which fills them after the reporter
// opts in; with the toggle off they are sent as null (#1752).
async function submitBugReport(data: BugReportSubmitData) {
  await bugReportApi.submit({
    description: data.description,
    bugType: data.bugType,
    isAnonymous: data.isAnonymous,
    consoleLogs: data.consoleLogs ?? null,
    networkLogs: data.networkLogs ?? null,
    screenshot: data.screenshot ?? null,
    pageUrl: data.pageUrl ?? null,
    userAgent: data.userAgent ?? null,
  });
}

export function BugReportProvider({ children }: BugReportProviderProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const [open, setOpen] = useState(false);

  const captureEnabled = !isLoading && isAuthenticated;
  const { captureScreenshot, getCapturedData, clearScreenshot } =
    useBugReportCapture(captureEnabled);

  const handleOpenChange = (next: boolean) => {
    if (!next) clearScreenshot();
    setOpen(next);
  };

  const value = useMemo(() => ({ openBugReport: () => setOpen(true) }), []);

  return (
    <BugReportContext.Provider value={value}>
      {children}
      {captureEnabled && (
        <BugReportDialog
          open={open}
          onOpenChange={handleOpenChange}
          onSubmit={submitBugReport}
          captureScreenshot={captureScreenshot}
          getCapturedData={getCapturedData}
        />
      )}
    </BugReportContext.Provider>
  );
}
