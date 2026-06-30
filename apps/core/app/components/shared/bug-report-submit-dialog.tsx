import { BugReportDialog, type BugReportPayload } from "@eduai/ui"
import { useSubmitBugReport } from "~/hooks/api/use-submit-bug-report"

type BugReportSubmitDialogProps = {
  triggerClassName?: string
}

export function BugReportSubmitDialog({
  triggerClassName,
}: BugReportSubmitDialogProps) {
  const { submitBugReport, isSubmitting } = useSubmitBugReport()

  const handleSubmit = async (payload: BugReportPayload) => {
    // Fold the optional title into the description before sending — the DB schema
    // has no separate title column (removed in #304).
    const mergedDescription = payload.title.trim()
      ? `${payload.title.trim()}\n\n${payload.description.trim()}`
      : payload.description.trim()
    await submitBugReport({ description: mergedDescription, isAnonymous: payload.isAnonymous })
  }

  return (
    <BugReportDialog
      onSubmit={handleSubmit}
      triggerClassName={triggerClassName}
    />
  )
}
