import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import {
  listCanvasCourses,
  syncCanvasCourses,
  type CanvasCoursePickerItem,
  type SyncCanvasCoursesResult,
} from "~/lib/canvas/client";

export interface CanvasCourseSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CanvasCourseSyncDialog({ open, onOpenChange }: CanvasCourseSyncDialogProps) {
  const [courses, setCourses] = useState<CanvasCoursePickerItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncCanvasCoursesResult | null>(null);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const items = await listCanvasCourses();
      setCourses(items);
      setSelectedIds(new Set(items.filter((course) => course.isSynced).map((course) => course.canvasId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Canvas courses");
      setCourses([]);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadCourses();
    }
  }, [open, loadCourses]);

  const toggleCourse = (canvasId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(canvasId);
      } else {
        next.delete(canvasId);
      }
      return next;
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const syncResult = await syncCanvasCourses({
        canvasCourseIds: [...selectedIds],
      });
      setResult(syncResult);
      await loadCourses();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sync Canvas courses");
    } finally {
      setSyncing(false);
    }
  };

  const resultSummary = result
    ? [
        result.synced.length > 0 ? `${result.synced.length} synced` : null,
        result.unsynced.length > 0 ? `${result.unsynced.length} unsynced` : null,
        result.errors.length > 0 ? `${result.errors.length} failed` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync Canvas courses</DialogTitle>
          <DialogDescription>
            Choose which Canvas courses to sync into EduAI. Unchecking a previously synced course
            will unsync it on save.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your Canvas courses…
          </div>
        ) : courses.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No Canvas courses found for your account.</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {courses.map((course) => {
              const checkboxId = `canvas-course-${course.canvasId}`;
              const checked = selectedIds.has(course.canvasId);

              return (
                <div
                  key={course.canvasId}
                  className="flex items-start gap-3 rounded-md border p-3"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={(value) => toggleCourse(course.canvasId, value === true)}
                  />
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor={checkboxId} className="cursor-pointer font-medium leading-snug">
                      {course.name}
                    </Label>
                    <p className="text-sm text-muted-foreground">{course.courseCode}</p>
                    {course.isSynced && (
                      <p className="text-xs text-muted-foreground">Currently synced in EduAI</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {resultSummary && (
          <p className="text-sm text-green-700 dark:text-green-400">Sync complete: {resultSummary}.</p>
        )}
        {result?.synced.map((entry) => (
          <p key={entry.canvasId} className="text-sm text-muted-foreground">
            Course {entry.canvasId}: {entry.rosterMembersSynced} roster member
            {entry.rosterMembersSynced === 1 ? "" : "s"} staged
            {entry.enrollmentsLinked > 0
              ? `, ${entry.enrollmentsLinked} enrollment${entry.enrollmentsLinked === 1 ? "" : "s"} linked`
              : ""}
            .
          </p>
        ))}
        {result?.errors.map((entry) => (
          <p key={entry.canvasId} className="text-sm text-destructive">
            Course {entry.canvasId}: {entry.message}
          </p>
        ))}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={syncing}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void handleSync()}
            disabled={loading || syncing || courses.length === 0}
          >
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing…
              </>
            ) : (
              "Save sync"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
