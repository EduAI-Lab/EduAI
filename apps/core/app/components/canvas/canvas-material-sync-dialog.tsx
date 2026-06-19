import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { discoverCanvasMaterials, syncCanvasMaterials } from "~/lib/canvas/client";
import type { CanvasMaterialDiscoverItem, SyncCanvasMaterialsResult } from "@eduai/types";
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
import { Badge } from "@eduai/ui";

export interface CanvasMaterialSyncDialogProps {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(
  status: CanvasMaterialDiscoverItem["importStatus"],
): string {
  switch (status) {
    case "not_imported":
      return "Not imported";
    case "imported":
      return "Imported";
    case "updated_on_canvas":
      return "Updated on Canvas";
  }
}

function formatSyncResultSummary(result: SyncCanvasMaterialsResult): string {
  const parts = [
    result.imported > 0 ? `${result.imported} imported` : null,
    result.updated > 0 ? `${result.updated} updated` : null,
    result.skipped > 0 ? `${result.skipped} skipped` : null,
    result.failed.length > 0 ? `${result.failed.length} failed` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "No changes";
}

function syncResultTone(
  result: SyncCanvasMaterialsResult,
): "success" | "warning" | "error" {
  if (result.failed.length > 0) return "error";
  if (result.imported > 0 || result.updated > 0) return "success";
  return "warning";
}

export function CanvasMaterialSyncDialog({
  courseId,
  open,
  onOpenChange,
  onSynced,
}: CanvasMaterialSyncDialogProps) {
  const [files, setFiles] = useState<CanvasMaterialDiscoverItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncCanvasMaterialsResult | null>(null);

  const loadFiles = useCallback(
    async (options?: { clearResult?: boolean; silent?: boolean }) => {
      if (options?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      if (options?.clearResult !== false) {
        setResult(null);
      }
      try {
        const items = await discoverCanvasMaterials(courseId);
        setFiles(items);
        setSelectedIds(
          new Set(
            items
              .filter((file) => file.importStatus === "not_imported")
              .map((f) => f.canvasFileId),
          ),
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load Canvas files",
        );
        setFiles([]);
        setSelectedIds(new Set());
      } finally {
        if (options?.silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [courseId],
  );

  useEffect(() => {
    if (open) {
      void loadFiles();
    }
  }, [open, loadFiles]);

  const toggleFile = (canvasFileId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(canvasFileId);
      else next.delete(canvasFileId);
      return next;
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const syncResult = await syncCanvasMaterials(courseId, [...selectedIds]);
      await loadFiles({ clearResult: false, silent: true });
      setResult(syncResult);
      onSynced?.();

      const summary = formatSyncResultSummary(syncResult);
      const tone = syncResultTone(syncResult);
      if (tone === "success") {
        toast.success("Canvas sync complete", { description: summary });
      } else if (tone === "error") {
        toast.error("Canvas sync had errors", { description: summary });
      } else {
        toast.message("Canvas sync finished", { description: summary });
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to sync materials";
      setError(message);
      toast.error("Canvas sync failed", { description: message });
    } finally {
      setSyncing(false);
    }
  };

  const resultSummary = result ? formatSyncResultSummary(result) : null;
  const resultTone = result ? syncResultTone(result) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync materials from Canvas</DialogTitle>
          <DialogDescription>
            Select course files to import into EduAI for chat and RAG. Only
            supported document types are shown (PDF, DOCX, PPTX, TXT, MD).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Canvas files…
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No importable files found in this Canvas course.
          </p>
        ) : (
          <div className="relative max-h-72 overflow-y-auto rounded-md border divide-y">
            {refreshing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {files.map((file) => (
              <label
                key={file.canvasFileId}
                className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50"
              >
                <Checkbox
                  checked={selectedIds.has(file.canvasFileId)}
                  onCheckedChange={(checked) =>
                    toggleFile(file.canvasFileId, checked === true)
                  }
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="text-sm font-medium truncate">
                    {file.displayName}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(file.sizeBytes)}</span>
                    <Badge variant="outline">
                      {statusLabel(file.importStatus)}
                    </Badge>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {resultSummary && (
          <div
            className={
              resultTone === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                : resultTone === "success"
                ? "rounded-md border border-green-600/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950/30 dark:text-green-100"
                : "rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            }
            role="status"
          >
            <p className="font-medium">Sync complete: {resultSummary}</p>
            {result?.failed.map((failure) => {
              const file = files.find(
                (item) => item.canvasFileId === failure.canvasFileId,
              );
              return (
                <p key={failure.canvasFileId} className="mt-1 text-xs">
                  {file?.displayName ?? failure.canvasFileId}: {failure.message}
                </p>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={syncing}
          >
            Close
          </Button>
          <Button
            onClick={() => void handleSync()}
            disabled={syncing || selectedIds.size === 0}
          >
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Syncing…
              </>
            ) : (
              `Sync selected (${selectedIds.size})`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
