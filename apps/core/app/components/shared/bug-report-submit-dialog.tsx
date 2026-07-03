import { useState } from "react";
import { IconBug } from "@tabler/icons-react";

import { Button, BugReportDialog } from "@eduai/ui";
import type { BugReportSubmitData } from "@eduai/ui";
import { useSubmitBugReport } from "~/hooks/api/use-submit-bug-report";

type BugReportSubmitDialogProps = {
  triggerClassName?: string;
};

export function BugReportSubmitDialog({ triggerClassName }: BugReportSubmitDialogProps) {
  const [open, setOpen] = useState(false);
  const { submitBugReport } = useSubmitBugReport();

  const handleSubmit = async (data: BugReportSubmitData) => {
    const ok = await submitBugReport({
      description: data.description,
      bugType: data.bugType,
      isAnonymous: data.isAnonymous,
    });
    if (!ok) throw new Error("Failed to submit bug report");
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <IconBug className="h-4 w-4 mr-1" />
        Report a bug
      </Button>
      <BugReportDialog open={open} onOpenChange={setOpen} onSubmit={handleSubmit} />
    </>
  );
}
