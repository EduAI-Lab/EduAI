import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { IconLoader } from "@tabler/icons-react";

import { Button } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";
import { listCanvasCourses, type CanvasCoursePickerItem } from "~/lib/canvas/client";

export interface CanvasFetchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CanvasFetchDialog({ open, onOpenChange }: CanvasFetchDialogProps) {
  const [courses, setCourses] = useState<CanvasCoursePickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCourses(await listCanvasCourses());
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fetch from Canvas</DialogTitle>
          <DialogDescription>
            Your Canvas courses. Fetched courses are clickable; others have not been imported into
            EduAI yet.
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
                <div
                  key={course.canvasId}
                  className="flex items-start gap-3 rounded-md border p-3 opacity-50"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium leading-snug">{course.name}</p>
                    <p className="text-sm text-muted-foreground">{course.courseCode}</p>
                    <p className="text-xs text-muted-foreground">Not yet fetched into EduAI</p>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
