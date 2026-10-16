/** Review state of one AI-generated draft in the composer queue (#1973). */
export type DraftStatus = "pending" | "saved" | "discarded";

/** Next pending draft after `from` (wrapping around), or -1 when none remain. */
export function nextPendingIndex(statuses: readonly DraftStatus[], from: number): number {
  for (let step = 1; step < statuses.length; step++) {
    const i = (from + step) % statuses.length;
    if (statuses[i] === "pending") return i;
  }
  return -1;
}
