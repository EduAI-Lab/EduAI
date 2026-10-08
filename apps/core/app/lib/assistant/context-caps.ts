/**
 * @file Character caps for grounding context (#1819, #1821). Pure.
 *
 * Every character is billed on someone's key on every question, and a cut page
 * must never be presented to the model as complete — so truncation always leaves
 * an explicit marker, and the total cap is enforced across pages, not just per
 * page.
 */

export const TRUNCATION_MARKER = "[truncated]";

/** Per documentation page, and across all pages of one answer. */
export const DOC_PAGE_MAX_CHARS = 12_000;
export const DOC_TOTAL_MAX_CHARS = 30_000;

/** Course-material context: per field and per block. */
export const MATERIAL_FIELD_MAX_CHARS = 4_000;
export const MATERIAL_BLOCK_MAX_CHARS = 9_000;

/** A piece of context text and whether it was cut to fit. */
export type CappedText = { text: string; truncated: boolean };

/** `text` cut to `max` characters including the marker, or unchanged when it fits. */
export function truncateWithMarker(text: string, max: number): CappedText {
  if (text.length <= max) return { text, truncated: false };
  const room = Math.max(0, max - TRUNCATION_MARKER.length - 1);
  return { text: `${text.slice(0, room).trimEnd()}\n${TRUNCATION_MARKER}`, truncated: true };
}

/**
 * Apply the per-item cap, then the shared total cap in order. An item that no
 * longer fits at all is dropped; one that partly fits is cut with the marker.
 */
export function capContents<T extends { content: string }>(
  items: readonly T[],
  limits: { perItem: number; total: number },
): Array<T & { truncated: boolean }> {
  const out: Array<T & { truncated: boolean }> = [];
  let remaining = limits.total;
  for (const item of items) {
    if (remaining <= TRUNCATION_MARKER.length + 1) break;
    const perItem = truncateWithMarker(item.content, limits.perItem);
    const total = truncateWithMarker(perItem.text, remaining);
    out.push({ ...item, content: total.text, truncated: perItem.truncated || total.truncated });
    remaining -= total.text.length;
  }
  return out;
}
