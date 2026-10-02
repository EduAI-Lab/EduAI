import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  termLabelLong,
} from "@eduai/ui";
import type {
  CourseDuplicateError,
  DuplicateCourseSummary,
  DuplicateResolution,
} from "~/hooks/api/use-courses";

interface DuplicateCourseDialogProps {
  warning: CourseDuplicateError | null;
  onResolve: (resolution: DuplicateResolution) => Promise<void>;
  onCancel: () => void;
}

function describe(course: DuplicateCourseSummary) {
  return `${course.code} section ${course.section}, ${termLabelLong(course.term, course.year)}`;
}

/** #1811: shown when a new course matches a soft-deleted one or one the instructor already teaches. */
export function DuplicateCourseDialog({
  warning,
  onResolve,
  onCancel,
}: DuplicateCourseDialogProps) {
  const [pending, setPending] = useState(false);

  const resolve = async (resolution: DuplicateResolution) => {
    setPending(true);
    try {
      await onResolve(resolution);
    } finally {
      setPending(false);
    }
  };

  const deleted = warning?.deletedMatches ?? [];
  const similar = warning?.similarCourses ?? [];

  return (
    <Dialog
      open={warning !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This course may already exist</DialogTitle>
          <DialogDescription>
            {deleted.length > 0
              ? "A deleted course has the same code, section and term. Restoring it brings back its materials and enrollments."
              : "You already teach a course that differs from this one by only its section, term or year."}
          </DialogDescription>
        </DialogHeader>

        {deleted.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Deleted</h3>
            <ul className="flex flex-col gap-2">
              {deleted.map((course) => (
                <li
                  key={course.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{course.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {describe(course)}
                      {course.deletedAt &&
                        ` · deleted ${new Date(course.deletedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  {course.canRestore ? (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        resolve({ duplicateResolution: "restore", restoreCourseId: course.id })
                      }
                    >
                      Restore
                    </Button>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Ask an admin to restore
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {similar.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Similar courses</h3>
            <ul className="flex flex-col gap-2">
              {similar.map((course) => (
                <li key={course.id} className="rounded-md border p-3">
                  <p className="truncate font-medium">{course.name}</p>
                  <p className="text-sm text-muted-foreground">{describe(course)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={deleted.length > 0 ? "outline" : "default"}
            disabled={pending}
            onClick={() => resolve({ duplicateResolution: "create" })}
          >
            Create new course anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
