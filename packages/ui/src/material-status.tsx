import {
  IconFileText,
  IconLoader,
  IconCircleCheck,
  IconCircleX,
} from "@tabler/icons-react"

/**
 * Course-material processing/embedding status, as returned by Core's
 * material APIs (`CourseMaterial["status"]`).
 */
export type MaterialStatus = "PROCESSING" | "READY" | "FAILED"

export interface MaterialStatusIconProps {
  status: MaterialStatus
}

/** Small status glyph for a material row (spinner while embedding, check/x on completion). */
export function MaterialStatusIcon({ status }: MaterialStatusIconProps) {
  if (status === "PROCESSING")
    return <IconLoader className="h-4 w-4 text-yellow-500 animate-spin" />
  if (status === "READY")
    return <IconCircleCheck className="h-4 w-4 text-green-500" />
  if (status === "FAILED")
    return <IconCircleX className="h-4 w-4 text-red-500" />
  return <IconFileText className="h-4 w-4 text-muted-foreground" />
}

export interface MaterialStatusChipProps {
  status: MaterialStatus
}

/** Small labelled pill mirroring {@link MaterialStatusIcon}'s status → color mapping. */
export function MaterialStatusChip({ status }: MaterialStatusChipProps) {
  const cfg = {
    READY: {
      label: "Embedded",
      bg: "var(--color-success-100)",
      color: "var(--color-success-700)",
    },
    PROCESSING: {
      label: "Processing",
      bg: "oklch(0.97 0.03 90)",
      color: "oklch(0.55 0.18 90)",
    },
    FAILED: {
      label: "Failed",
      bg: "var(--color-error-100)",
      color: "var(--destructive)",
    },
  }[status] ?? {
    label: "Unknown",
    bg: "var(--muted)",
    color: "var(--muted-foreground)",
  }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}
