import { useState } from "react";

import { BugReportDialog, BugReportTriggerButton } from "@eduai/ui";
import type { BugReportSubmitData } from "@eduai/ui";
import { useBugReportCapture } from "@eduai/ui/bug-report-capture";
import { useSubmitBugReport } from "~/hooks/api/use-submit-bug-report";

type BugReportSubmitDialogProps = {
  triggerClassName?: string;
};

export function BugReportSubmitDialog({ triggerClassName }: BugReportSubmitDialogProps) {
  const [open, setOpen] = useState(false);
  const { submitBugReport } = useSubmitBugReport();
  // Mounted once, via CoreAppShell; a second mount would double-patch console/fetch.
  const { captureScreenshot, getCapturedData, clearScreenshot } = useBugReportCapture();

  const handleOpenChange = (next: boolean) => {
    if (!next) clearScreenshot();
    setOpen(next);
  };

  // The dialog only fills the diagnostics fields when the toggle is on, so the
  // data passes straight through.
  const handleSubmit = async (data: BugReportSubmitData) => {
    const result = await submitBugReport(data);
    if (!result.ok) throw new Error(result.error);
  };

  return (
    <>
      <BugReportTriggerButton className={triggerClassName} onClick={() => setOpen(true)} />
      <BugReportDialog
        open={open}
        onOpenChange={handleOpenChange}
        onSubmit={handleSubmit}
        captureScreenshot={captureScreenshot}
        getCapturedData={getCapturedData}
      />
    </>
  );
}
