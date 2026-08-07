/**
 * Discloses that a surface is rendering a bounded slice of a longer list (#1208).
 *
 * Some surfaces legitimately show only the first page — the dashboard panels are
 * a curated preview, not a browser. The defect this fixes is that they showed it
 * *silently*, so a user with more courses than the page size had no way to know
 * anything was missing. Renders nothing when the list is complete, so it costs
 * nothing on the common path.
 */
import { IconInfoCircle } from '@tabler/icons-react';

export function TruncatedListNotice({
  shown,
  total,
  /** Plural noun for the items, e.g. "courses". */
  noun = 'courses',
  /** Where the full, searchable list lives. */
  action,
  className,
}: {
  shown: number;
  total: number;
  noun?: string;
  action?: string;
  className?: string;
}) {
  if (!Number.isFinite(total) || !Number.isFinite(shown) || total <= shown) return null;

  return (
    <p
      className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}
      data-testid="truncated-list-notice"
    >
      <IconInfoCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
        {action ? ` — ${action}` : ''}
      </span>
    </p>
  );
}
