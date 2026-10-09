import { useState } from "react";
import { Button, ConfirmDialog } from "@eduai/ui";
import { CoursePublishError } from "~/lib/courses/set-course-published";

interface CoursePublishControlProps {
  /** "CODE — Name", as the Courses-list confirm dialog titles it. */
  courseLabel: string;
  isPublished: boolean;
  /** Rejects when the server refuses; the control reports it inline. */
  onPublishChange: (publish: boolean) => Promise<void>;
}

/**
 * Publish / unpublish from the course page (#1939). Same confirm wording as the
 * Courses list, so the two entry points can't drift into describing different
 * consequences of the same switch.
 */
export function CoursePublishControl({
  courseLabel,
  isPublished,
  onPublishChange,
}: CoursePublishControlProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = !isPublished;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPublishChange(publish);
      setConfirmOpen(false);
    } catch (err) {
      setConfirmOpen(false);
      // A 403 will not clear on retry (e.g. the instructor policy was switched off).
      setError(
        err instanceof CoursePublishError && err.status === 403
          ? "You don't have permission to publish or unpublish this course."
          : "Could not update the course. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={publish ? "default" : "outline"}
        size="sm"
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
      >
        {publish ? "Publish course" : "Unpublish course"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={publish ? `Publish "${courseLabel}"?` : `Unpublish "${courseLabel}"?`}
        description={
          publish
            ? "Students will be able to see this course."
            : "Students will lose access to this course."
        }
        confirmLabel={publish ? "Publish" : "Unpublish"}
        variant={publish ? "default" : "destructive"}
        isLoading={busy}
        closeOnConfirm={false}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
}
