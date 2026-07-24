import type * as React from "react"
import { IconFileText } from "@tabler/icons-react"
import { cn } from "./utils"
import { EmptyState } from "./empty-state"
import { MaterialStatusIcon, MaterialStatusChip, type MaterialStatus } from "./material-status"

/**
 * Minimal shape a course-material row needs to render. Apps own the richer
 * `CourseMaterial` type (rename/delete/visibility fields, timestamps, etc.) —
 * pass those through unchanged via a subtype, this only reads what it draws.
 */
export interface MaterialListItem {
  id: string
  /** Display name / title of the file. */
  name: string
  status: MaterialStatus
  /** Used to tint the file-type chip; falls back to a neutral color. */
  mimeType?: string
  /** Pre-formatted size string, e.g. "1.2 MB". Apps own their own formatter. */
  sizeLabel?: string
  /** Pre-formatted date string, e.g. "7/21/2026". */
  dateLabel?: string
  /** Override the whole subtitle line instead of composing size/date. */
  meta?: React.ReactNode
}

export interface MaterialListProps<T extends MaterialListItem = MaterialListItem> {
  items: T[]
  /** Defaults to "Course materials". */
  title?: React.ReactNode
  /**
   * Show the labelled `MaterialStatusChip` alongside the status icon.
   * Student-facing views typically want the icon only (`showChip={false}`).
   */
  showChip?: boolean
  /** Header action buttons (upload, sync, embedding settings, ...). */
  headerActions?: React.ReactNode
  /** Per-item trailing actions (rename/delete/visibility), role-gated by the caller. */
  renderItemActions?: (item: T) => React.ReactNode
  /** Make the item name clickable (e.g. open a preview dialog). */
  onItemClick?: (item: T) => void
  /** Override the empty-state block entirely; defaults to a shared EmptyState. */
  emptyState?: React.ReactNode
  /** Copy shown by the default empty state. */
  emptyStateDescription?: React.ReactNode
  /** Color for the file-type chip; defaults to a neutral muted tone. */
  fileTypeColor?: (item: T) => string
  className?: string
}

const DEFAULT_FILE_COLOR = "var(--muted-foreground)"

/**
 * Shared "course materials" list: header + unified file-count line +
 * per-row status + optional actions. Reconciles the 3 Core role views
 * (manager/TA/student), which previously drifted on count phrasing and
 * duplicated the row markup — unified here as "{n} files · {r} ready".
 */
export function MaterialList<T extends MaterialListItem = MaterialListItem>({
  items,
  title = "Course materials",
  showChip = true,
  headerActions,
  renderItemActions,
  onItemClick,
  emptyState,
  emptyStateDescription = "Materials will appear here once they're uploaded.",
  fileTypeColor,
  className,
}: MaterialListProps<T>) {
  const readyCount = items.filter((m) => m.status === "READY").length

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[16px] font-semibold text-foreground">{title}</p>
          {items.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {items.length} file{items.length !== 1 ? "s" : ""} · {readyCount} ready
            </p>
          )}
        </div>
        {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
      </div>

      {items.length === 0 ? (
        emptyState ?? (
          <EmptyState
            icon={<IconFileText size={22} stroke={1.5} />}
            title="No materials yet"
            description={emptyStateDescription}
          />
        )
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const clickable = !!onItemClick && item.status === "READY"
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border border-border bg-card"
              >
                <div
                  className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0"
                  style={{ background: fileTypeColor?.(item) ?? DEFAULT_FILE_COLOR }}
                >
                  <IconFileText size={14} color="white" stroke={2} />
                </div>
                <div className="flex-1 min-w-0">
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => onItemClick?.(item)}
                      className="text-left w-full text-[13px] font-medium text-foreground truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      {item.name}
                    </button>
                  ) : (
                    <p className="text-[13px] font-medium text-foreground truncate">{item.name}</p>
                  )}
                  {item.meta !== undefined ? (
                    <div className="text-[11px] text-muted-foreground mt-0.5">{item.meta}</div>
                  ) : (
                    (item.sizeLabel || item.dateLabel) && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {item.sizeLabel}
                        {item.sizeLabel && item.dateLabel ? " · " : ""}
                        {item.dateLabel}
                      </p>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {showChip && <MaterialStatusChip status={item.status} />}
                  <MaterialStatusIcon status={item.status} />
                  {renderItemActions?.(item)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
