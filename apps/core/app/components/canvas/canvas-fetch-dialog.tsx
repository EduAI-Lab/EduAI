import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { IconLoader } from "@tabler/icons-react";

import { Button } from "@eduai/ui";
import { Checkbox } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";
import { Label } from "@eduai/ui";
import {
  listCanvasCourses,
  syncCanvasCourses,
  type CanvasCoursePickerItem,
  type SyncCanvasCoursesResult,
} from "~/lib/canvas/client";

export interface CanvasFetchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CanvasFetchDialog({ open, onOpenChange }: CanvasFetchDialogProps) {
  const [courses, setCourses] = useState<CanvasCoursePickerItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncCanvasCoursesResult | null>(null);
  const [syncErrors, setSyncErrors] = useState<SyncCanvasCoursesResult["errors"]>([]);

  const loadCourses = useCallback(async (options?: { preserveResult?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!options?.preserveResult) {
      setResult(null);
      setSyncErrors([]);
    }
    try {
      setCourses(await listCanvasCourses());
      setSelectedIds(new Set());
    } catch {
      setError("Could not load Canvas courses. Please try again.");
      setCourses([]);
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
      if (checked) next.add(canvasId);
      else next.delete(canvasId);
      return next;
    });
  };

  const handleFetch = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    setSyncErrors([]);
    try {
      const alreadySyncedIds = courses
        .filter((c) => c.isSynced && c.coreCourseId != null)
        .map((c) => c.canvasId);
      const syncResult = await syncCanvasCourses({
        canvasCourseIds: [...alreadySyncedIds, ...selectedIds],
      });
      setResult(syncResult);
      setSyncErrors(syncResult.errors);
      await loadCourses({ preserveResult: true });
      if (syncResult.synced.length > 0 || syncResult.unsynced.length > 0) {
        window.dispatchEvent(new CustomEvent("eduai:courses-changed"));
      }
    } catch {
      setError("Could not sync with Canvas. Please try again.");
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
          <DialogTitle>Fetch from Canvas</DialogTitle>
          <DialogDescription>
            Select courses to fetch into EduAI, or click an already-fetched course to open it.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <IconLoader className="h-4 w-4 animate-spin" />
            Loading your Canvas courses…
          </div>
        ) : courses.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No Canvas courses found for your account.</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {courses.map((course) =>
              course.isSynced && course.coreCourseId != null ? (
                <Link
                  key={course.canvasId}
                  to={`/courses/${course.coreCourseId}`}
                  onClick={() => onOpenChange(false)}
                  className="flex items-start gap-3 rounded-md border p-3 hover:bg-accent transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium leading-snug">{course.name}</p>
                    <p className="text-sm text-muted-foreground">{course.courseCode}</p>
                    {course.lastSyncedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last fetched {new Date(course.lastSyncedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </Link>
              ) : (
                <div key={course.canvasId} className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    id={`canvas-course-${course.canvasId}`}
                    checked={selectedIds.has(course.canvasId)}
                    onCheckedChange={(value) => toggleCourse(course.canvasId, value === true)}
                    disabled={syncing}
                  />
                  <div className="min-w-0 space-y-1">
                    <Label
                      htmlFor={`canvas-course-${course.canvasId}`}
                      className="cursor-pointer font-medium leading-snug"
                    >
                      {course.name}
                    </Label>
                    <p className="text-sm text-muted-foreground">{course.courseCode}</p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {resultSummary && (
          <p className="text-sm text-green-700 dark:text-green-400">Fetch complete: {resultSummary}.</p>
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
        {syncErrors.map((entry) => (
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
            onClick={() => void handleFetch()}
            disabled={loading || syncing || selectedIds.size === 0}
          >
            {syncing ? (
              <>
                <IconLoader className="mr-2 h-4 w-4 animate-spin" />
                Fetching…
              </>
            ) : (
              `Fetch selected${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
