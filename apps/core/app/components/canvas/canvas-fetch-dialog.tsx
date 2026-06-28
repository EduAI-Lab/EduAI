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

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCourses(await listCanvasCourses());
      setSelectedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Canvas courses");
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
    try {
      await syncCanvasCourses({ canvasCourseIds: [...selectedIds] });
      await loadCourses();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch Canvas courses");
    } finally {
      setSyncing(false);
    }
  };

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
              )
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

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
