import { useEffect, useState } from "react";
import { IconLoader } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from "@eduai/ui";

type PreviewResponse = {
  material: {
    id: string;
    title: string;
    mimeType: string;
    fileSize: number;
    status: string;
    createdAt: string;
  };
  excerpt: string;
  truncated: boolean;
};

interface MaterialPreviewDialogProps {
  courseId: string;
  materialId: string | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MaterialPreviewDialog({
  courseId,
  materialId,
  title,
  open,
  onOpenChange,
}: MaterialPreviewDialogProps) {
  const [excerpt, setExcerpt] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !materialId) return;

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setExcerpt("");
    setTruncated(false);

    fetch(`/api/courses/${courseId}/materials/${materialId}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Could not load preview");
        }
        return res.json() as Promise<PreviewResponse>;
      })
      .then((data) => {
        setExcerpt(data.excerpt);
        setTruncated(data.truncated);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not load preview");
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [open, materialId, courseId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{title}</DialogTitle>
          <DialogDescription>Text preview of course material</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <IconLoader className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading preview…</span>
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : (
          <ScrollArea className="max-h-[min(60vh,480px)] rounded-md border border-border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground font-sans">
              {excerpt || "No text content available for preview."}
            </pre>
            {truncated && (
              <p className="mt-4 text-xs text-muted-foreground">
                Preview truncated — open the full file from your instructor if you need more.
              </p>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
