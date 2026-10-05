import { IconBug } from "@tabler/icons-react";
import { Button } from "./ui/button";

/** The one header trigger for the bug-report modal across Core, AI Tutor and QM (#1752). */
export function BugReportTriggerButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-label="Report a bug"
      className={className}
    >
      <IconBug className="h-4 w-4 sm:mr-1" aria-hidden="true" />
      <span className="hidden sm:inline">Report a bug</span>
    </Button>
  );
}
