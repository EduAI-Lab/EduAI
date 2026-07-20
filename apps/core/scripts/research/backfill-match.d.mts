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

export interface TakeMatchOptions {
  runTimestamp?: string | Date | null;
  windowMs?: number;
}

/**
 * Prefer userId::query. Without userId, only match when the prompt is unique in
 * the interaction set, and (when both timestamps exist) within windowMs.
 */
export function takeMatch(
  index: BackfillIndex,
  promptText: string | null | undefined,
  userId: string | null | undefined,
  options?: TakeMatchOptions,
): BackfillRow | null;
