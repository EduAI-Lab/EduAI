import { BugReportDialog } from "@eduai/ui";
import type { BugReportSubmitData } from "@eduai/ui";
import { useBugReportCaptureContext } from "~/contexts/bug-report-capture";
import { useSubmitBugReport } from "~/hooks/api/use-submit-bug-report";

type BugReportSubmitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Core's bug report dialog, wired to submission and diagnostics capture. It has
 * no trigger of its own: the shell opens it from the Help tray (desktop) or the
 * Help accordion (mobile drawer).
 */
export function BugReportSubmitDialog({ open, onOpenChange }: BugReportSubmitDialogProps) {
  const { submitBugReport } = useSubmitBugReport();
  // The capture hook lives in root.tsx's provider so its buffers survive
  // client-side navigation; this dialog remounts with every route's shell.
  const capture = useBugReportCaptureContext();

  const handleOpenChange = (next: boolean) => {
    if (!next) capture?.clearScreenshot();
    onOpenChange(next);
  };

  // The dialog only fills the diagnostics fields when the toggle is on, so the
  // data passes straight through.
  const handleSubmit = async (data: BugReportSubmitData) => {
    const result = await submitBugReport(data);
    if (!result.ok) throw new Error(result.error);
  };

  return (
    <BugReportDialog
      open={open}
      onOpenChange={handleOpenChange}
      onSubmit={handleSubmit}
      captureScreenshot={capture?.captureScreenshot}
      getCapturedData={capture?.getCapturedData}
    />
  );
}
