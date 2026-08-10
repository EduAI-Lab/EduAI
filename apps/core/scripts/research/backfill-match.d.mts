export interface BackfillRow {
  userId?: string | null;
  query?: string | null;
  createdAt?: string | Date | null;
  [key: string]: unknown;
}

export interface BackfillIndex {
  byUserQuery: Map<string, BackfillRow[]>;
  byQueryOnly: Map<string, BackfillRow[]>;
}

export function indexInteractions(rows: BackfillRow[]): BackfillIndex;

/**
 * Parses a value the same way takeMatch() does internally -- returns null
 * for missing/empty/unparseable values, epoch ms otherwise. Exported so
 * callers can check "is this timestamp usable" with identical rules.
 */
export function toMs(value: string | Date | null | undefined): number | null;

export interface TakeMatchOptions {
  runTimestamp?: string | Date | null;
  windowMs?: number;
}

/**
 * Prefer userId::query. Without userId, only match when the prompt is unique in
 * the interaction set, and (when both timestamps exist) within windowMs.
 *
 * When multiple rows share a userId::query key and runTimestamp is supplied,
 * picks the closest-in-time candidate (bounded by windowMs if given) instead
 * of plain FIFO order, so repeated prompts from a fixed userId across
 * multiple runs don't silently cross-match.
 */
export function takeMatch(
  index: BackfillIndex,
  promptText: string | null | undefined,
  userId: string | null | undefined,
  options?: TakeMatchOptions,
): BackfillRow | null;
