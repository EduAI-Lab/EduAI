import { createContext, useCallback, useMemo, useState } from "react";
import { useBugReportCapture } from "@eduai/ui/bug-report-capture";
import type { BugReportContext as BugReportContextType } from "~/lib/types";

type BugReportProviderValue = {
  context: BugReportContextType;
  setContext: (next: BugReportContextType) => void;
  clearContext: () => void;
  captureScreenshot: () => Promise<string | null>;
  getCapturedData: () => { consoleLogs: string; networkLogs: string; screenshot: string | null };
  clearScreenshot: () => void;
};

const EMPTY_CONTEXT: BugReportContextType = {
  courseOfferingId: null,
  moduleId: null,
  lessonId: null,
  activityId: null,
};

export const BugReportContext = createContext<BugReportProviderValue | undefined>(undefined);

export function BugReportProvider({ children }: { children: React.ReactNode }) {
  const [context, setContextState] = useState<BugReportContextType>(EMPTY_CONTEXT);
  const { captureScreenshot, getCapturedData, clearScreenshot } = useBugReportCapture();
  const setContext = useCallback((next: BugReportContextType) => {
    setContextState({
      courseOfferingId: next.courseOfferingId ?? null,
      moduleId: next.moduleId ?? null,
      lessonId: next.lessonId ?? null,
      activityId: next.activityId ?? null,
    });
  }, []);
  const clearContext = useCallback(() => setContextState(EMPTY_CONTEXT), []);

  const value = useMemo<BugReportProviderValue>(
    () => ({
      context,
      setContext,
      clearContext,
      captureScreenshot,
      getCapturedData,
      clearScreenshot,
    }),
    [captureScreenshot, clearContext, clearScreenshot, context, getCapturedData, setContext],
  );

  return <BugReportContext.Provider value={value}>{children}</BugReportContext.Provider>;
}
