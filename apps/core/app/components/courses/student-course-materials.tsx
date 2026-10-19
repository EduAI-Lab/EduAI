import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@eduai/ui";

import { MaterialPreviewDialog } from "~/components/courses/material-preview-dialog";
import { useCourseMaterials } from "~/hooks/api/use-course-materials";

/**
 * A course's files as a student reads them (#2002), shown only where the course
 * shares its files with students. Read-only: the materials API re-checks the
 * course's sharing and each file's own student gate on every read.
 */
export function StudentCourseMaterials({ courseId }: { courseId: string }) {
  const { materials, loading, error, hasMore, loadingMore, loadMore } =
    useCourseMaterials(courseId);
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Course files</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading files…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Course files are unavailable right now. Your instructor may have stopped sharing them.
          </p>
        ) : materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files are shared yet.</p>
        ) : (
          <ul className="divide-y">
            {materials.map((material) => (
              <li key={material.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0 break-words text-sm">{material.title}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={material.status !== "READY"}
                  onClick={() => setPreview({ id: material.id, title: material.title })}
                  aria-label={`Preview ${material.title}`}
                >
                  {material.status === "READY" ? "Preview" : "Not ready"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            Load more files
          </Button>
        )}
        <MaterialPreviewDialog
          courseId={courseId}
          materialId={preview?.id ?? null}
          title={preview?.title ?? "Course file"}
          open={preview !== null}
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
        />
      </CardContent>
    </Card>
  );
}
