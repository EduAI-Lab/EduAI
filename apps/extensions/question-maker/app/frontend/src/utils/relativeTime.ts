/**
 * Shared "N days ago" formatting for save-time validation verdicts (task 15).
 * Used by both the Settings page's inline per-key verdict line and the header
 * cloud chip's "checked when saved" detail — kept in one place so a wording
 * change lands once instead of twice.
 */

/** Renders an ISO timestamp as "today" / "1 day ago" / "N days ago". */
export function daysAgoLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
