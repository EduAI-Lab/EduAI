import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { useBugReportCapture } from "@eduai/ui/bug-report-capture";

type BugReportCapture = ReturnType<typeof useBugReportCapture>;

const BugReportCaptureContext = createContext<BugReportCapture | null>(null);

/**
 * Owns Core's single `useBugReportCapture` mount (#1752). It sits in `root.tsx`
 * rather than the header because every route renders its own `CoreAppShell`:
 * a header-level hook remounted on each navigation and reset the console and
 * request buffers, losing the failed request from the page the user just left.
 */
export function BugReportCaptureProvider({ children }: { children: ReactNode }) {
  const { captureScreenshot, getCapturedData, clearScreenshot } = useBugReportCapture();
  const capture = useMemo(
    () => ({ captureScreenshot, getCapturedData, clearScreenshot }),
    [captureScreenshot, getCapturedData, clearScreenshot],
  );
  return (
    <BugReportCaptureContext.Provider value={capture}>{children}</BugReportCaptureContext.Provider>
  );
}

/** `null` outside the provider; the bug-report dialog then offers no diagnostics. */
export function useBugReportCaptureContext(): BugReportCapture | null {
  return useContext(BugReportCaptureContext);
}
