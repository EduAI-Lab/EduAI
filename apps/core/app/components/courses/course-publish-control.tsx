import { useState } from "react";
import { Button, ConfirmDialog } from "@eduai/ui";
import { CoursePublishError } from "~/lib/courses/set-course-published";

interface CoursePublishControlProps {
  /** "CODE — Name", as the Courses-list confirm dialog titles it. */
  courseLabel: string;
  isPublished: boolean;
  /** Rejects when the server refuses; the control reports it inline. */
  onPublishChange: (publish: boolean) => Promise<void>;
  /**
   * Controlled confirm dialog with no button of its own, for a trigger that
   * lives elsewhere such as a ⋯ menu item (#2105).
   */
  confirmOpen?: boolean;
  onConfirmOpenChange?: (open: boolean) => void;
}

/**
 * The confirm / busy / error state of one publish switch. A page that offers the
 * switch in several places calls this once and hands the result to
 * `CoursePublishButton`, `CoursePublishError` and a single `CoursePublishDialog`,
 * so two triggers can't run at once or report failure in different ways.
 */
export function useCoursePublish(
  isPublished: boolean,
  onPublishChange: (publish: boolean) => Promise<void>,
) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = !isPublished;

  const confirm = async () => {
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

  return {
    publish,
    confirmOpen,
    setConfirmOpen: (open: boolean) => setConfirmOpen(open),
    busy,
    error,
    confirm,
  };
}

export type CoursePublishState = ReturnType<typeof useCoursePublish>;

export function CoursePublishButton({ state }: { state: CoursePublishState }) {
  return (
    <Button
      variant={state.publish ? "default" : "outline"}
      size="sm"
      disabled={state.busy}
      onClick={() => state.setConfirmOpen(true)}
    >
      {state.publish ? "Publish course" : "Unpublish course"}
    </Button>
  );
}

export function CoursePublishErrorMessage({ state }: { state: CoursePublishState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {state.error}
    </p>
  );
}

export function CoursePublishDialog({
  courseLabel,
  state,
}: {
  courseLabel: string;
  state: CoursePublishState;
}) {
  const { publish } = state;
  return (
    <ConfirmDialog
      open={state.confirmOpen}
      onOpenChange={state.setConfirmOpen}
      title={publish ? `Publish "${courseLabel}"?` : `Unpublish "${courseLabel}"?`}
      description={
        publish
          ? "Students will be able to see this course."
          : "Students will lose access to this course."
      }
      confirmLabel={publish ? "Publish" : "Unpublish"}
      variant={publish ? "default" : "destructive"}
      isLoading={state.busy}
      closeOnConfirm={false}
      onConfirm={() => void state.confirm()}
    />
  );
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
  confirmOpen: controlledOpen,
  onConfirmOpenChange,
}: CoursePublishControlProps) {
  const own = useCoursePublish(isPublished, onPublishChange);
  const controlled = controlledOpen !== undefined;
  const state: CoursePublishState = controlled
    ? { ...own, confirmOpen: controlledOpen, setConfirmOpen: onConfirmOpenChange ?? (() => {}) }
    : own;

  return (
    <div className="flex flex-col items-start gap-1">
      {!controlled && <CoursePublishButton state={state} />}
      <CoursePublishErrorMessage state={state} />
      <CoursePublishDialog courseLabel={courseLabel} state={state} />
    </div>
  );
}
