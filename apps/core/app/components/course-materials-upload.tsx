import { useRef, useState } from "react";
import { Spinner } from "@eduai/ui";
import { cn } from "@eduai/ui";
import { Alert, AlertDescription } from "@eduai/ui";
import { IconUpload, IconFile, IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { MATERIAL_INPUT_ACCEPT } from "~/lib/materials/accepted-types";
import type { MaterialFailureCode } from "~/hooks/api/use-course-materials";

export interface CourseMaterial {
  id: string;
  title: string;
  mimeType: string;
  fileSize: number;
  status: "PROCESSING" | "READY" | "FAILED";
  createdAt: string;
  chunkCount?: number;
  /** Owner FK — used to gate TA own-only delete (§7). */
  uploadedBy?: string | null;
  /**
   * Student-visibility gate (staff-only field; omitted from student responses).
   * false = hidden from students even in a published course.
   */
  visibleToStudents?: boolean;
  /**
   * Scheduled reveal timestamp (ISO string) or null. When set in the future,
   * students don't see the material until it passes. Staff-only field.
   */
  availableAt?: string | null;
  chunks?: Array<{ id: string; content: string }>;
  /**
   * Set on a FAILED row whose content turned out to already exist on the
   * course (#949) — points at the material that won.
   */
  duplicateOfId?: string | null;
  /**
   * FAILED rows only (#1749): whether the extracted text survived server-side,
   * which decides whether indexing can be retried without re-uploading.
   */
  hasExtractedText?: boolean;
  /** Why a FAILED row failed (#1791); null on rows that predate the column. */
  failureCode?: MaterialFailureCode | null;
}

/** Where one file of a batch upload (#1748) stands. */
export type UploadItemStatus =
  | "queued"
  | "uploading"
  | "ready"
  | "processing"
  | "duplicate"
  | "failed";

export interface UploadItem {
  name: string;
  status: UploadItemStatus;
  /** Why the file wasn't added; set on `duplicate` and `failed`. */
  message?: string;
}

export interface CourseMaterialsUploadProps {
  isUploading?: boolean;
  error?: string | null;
  success?: string | null;
  /** Per-file progress of the current batch; listed only when it has more than one file. */
  uploads?: UploadItem[];
  onFilesSelect: (files: File[]) => void;
}

const STATUS_LABEL = {
  queued: "Waiting",
  uploading: "Uploading…",
  ready: "Added",
  processing: "Still processing",
  duplicate: "Already in course",
  failed: "Failed",
} satisfies Record<UploadItemStatus, string>;

function UploadItemIcon({ status }: { status: UploadItemStatus }) {
  switch (status) {
    case "uploading":
      return <Spinner className="shrink-0" />;
    case "ready":
      return <IconCircleCheck className="h-4 w-4 shrink-0 text-[var(--color-success-500)]" />;
    case "duplicate":
    case "failed":
      return <IconAlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
    default:
      return <IconFile className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
}

// ── component ─────────────────────────────────────────────────────────────────

export function CourseMaterialsUpload({
  isUploading = false,
  error = null,
  success = null,
  uploads = [],
  onFilesSelect,
}: CourseMaterialsUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const triggerPick = () => {
    if (!isUploading) inputRef.current?.click();
  };

  const processFiles = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFilesSelect(files);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    processFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isUploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };

  const settled = uploads.filter((u) => u.status !== "queued" && u.status !== "uploading").length;
  const uploadingLabel =
    uploads.length > 1
      ? `Uploading ${uploads.length} files (${settled} of ${uploads.length} done)…`
      : uploads.length === 1
        ? `Uploading "${uploads[0].name}"…`
        : "Uploading…";

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MATERIAL_INPUT_ACCEPT}
        onChange={handleFileChange}
        disabled={isUploading}
        className="sr-only"
        tabIndex={-1}
      />
      <button
        type="button"
        disabled={isUploading}
        onClick={triggerPick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)]",
          "border-2 border-dashed border-border py-9 px-6 outline-none",
          "transition-colors duration-150 select-none",
          isDragging && "border-primary bg-primary/5",
          isUploading
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-primary/50 hover:bg-muted/30 focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)]",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-lg)] bg-primary/10">
          <IconUpload className="h-5 w-5 text-primary-text" />
        </div>

        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Drag & drop or{" "}
            <span className="text-primary-text underline-offset-2 hover:underline">
              browse files
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, DOCX, PPTX, TXT, MD, PNG, JPG, WebP · select several to upload them together
          </p>
        </div>
      </button>

      {/* Upload states */}
      {isUploading && (
        <Alert>
          <Spinner />
          <AlertDescription>{uploadingLabel}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <IconAlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <IconCircleCheck className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Per-file progress; a single file is fully described by the alerts above */}
      {uploads.length > 1 && (
        <ul
          aria-label="Upload progress"
          className="max-h-60 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-muted/30 p-2"
        >
          {uploads.map((item, i) => (
            <li key={`${i}-${item.name}`} className="flex items-start gap-2 px-1 py-1 text-sm">
              <UploadItemIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{item.name}</p>
                {item.message && <p className="text-xs text-muted-foreground">{item.message}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {STATUS_LABEL[item.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
