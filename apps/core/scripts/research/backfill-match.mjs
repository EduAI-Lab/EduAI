/**
 * Pure matching helpers for research energy backfill (unit-tested).
 */

/**
 * @param {Array<{ userId?: string|null, query?: string|null, createdAt?: string|Date|null }>} rows
 */
export function indexInteractions(rows) {
  /** @type {Map<string, typeof rows>} */
  const byUserQuery = new Map();
  /** @type {Map<string, typeof rows>} */
  const byQueryOnly = new Map();

  for (const row of rows) {
    const query = (row.query ?? "").trim();
    if (!query) continue;
    const userId = (row.userId ?? "").trim();
    if (userId) {
      const key = `${userId}::${query}`;
      if (!byUserQuery.has(key)) byUserQuery.set(key, []);
      byUserQuery.get(key).push(row);
    }
    if (!byQueryOnly.has(query)) byQueryOnly.set(query, []);
    byQueryOnly.get(query).push(row);
  }

  return { byUserQuery, byQueryOnly };
}

function toMs(value) {
  if (value == null || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Prefer userId::query. Without userId, only match when the prompt is unique in
 * the interaction set, and (when both timestamps exist) within windowMs.
 *
 * @param {{ byUserQuery: Map<string, any[]>, byQueryOnly: Map<string, any[]> }} index
 * @param {string|null|undefined} promptText
 * @param {string|null|undefined} userId
 * @param {{ runTimestamp?: string|Date|null, windowMs?: number }} [options]
 */
export function takeMatch(index, promptText, userId, options = {}) {
  const query = (promptText ?? "").trim();
  if (!query) return null;

  const uid = (userId ?? "").trim();
  if (uid) {
    const list = index.byUserQuery.get(`${uid}::${query}`);
    if (!list || list.length === 0) return null;
    return list.shift();
  }

  // Query-only path: require uniqueness to avoid cross-user contamination.
  const candidates = index.byQueryOnly.get(query);
  if (!candidates || candidates.length !== 1) return null;

  const only = candidates[0];
  const windowMs = options.windowMs ?? 60_000;
  const runMs = toMs(options.runTimestamp);
  const interactionMs = toMs(only.createdAt);
  if (runMs != null && interactionMs != null) {
    if (Math.abs(runMs - interactionMs) > windowMs) return null;
  }

  // Consume so duplicate run rows do not reuse the same interaction.
  candidates.shift();
  const scopedUser = (only.userId ?? "").trim();
  if (scopedUser) {
    const scopedList = index.byUserQuery.get(`${scopedUser}::${query}`);
    if (scopedList) {
      const idx = scopedList.indexOf(only);
      if (idx >= 0) scopedList.splice(idx, 1);
    }
  }
  return only;
}
