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

/**
 * Exported (not just internal) so callers can check "is this a usable
 * timestamp" with the exact same parsing rules takeMatch() itself uses --
 * e.g. to count/warn about rows that will silently hit the FIFO fallback
 * because their timestamp field is present but unparseable, not just
 * missing. See backfill-interaction-energy.mjs's rowsWithoutUsableTimestamp.
 */
export function toMs(value) {
  if (value == null || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Prefer userId::query. Without userId, only match when the prompt is unique in
 * the interaction set, and (when both timestamps exist) within windowMs.
 *
 * When multiple rows share the same userId::query key (e.g. repeated prompts
 * from a fixed synthetic userId across many runs/replicates -- the exact shape
 * research scripts produce with a constant service-key userId), plain FIFO
 * order is not reliable: it silently matches the OLDEST unconsumed row for
 * that key, which may belong to an entirely different run than the one being
 * backfilled. If the caller supplies runTimestamp, prefer the candidate whose
 * createdAt is closest to it, bounded by windowMs (default 60s, same default
 * as the query-only path -- omitting windowMs does NOT mean unbounded; a
 * runTimestamp-bearing caller with no window would otherwise be able to
 * silently accept an arbitrarily stale "closest" candidate). A candidate
 * with no parseable createdAt can't be time-verified against runTimestamp at
 * all, so it's excluded from consideration rather than falling back to FIFO
 * for it specifically -- when NONE of the candidates have a usable
 * createdAt, the whole lookup is rejected (returns null) rather than
 * silently matching an unverifiable row. Callers that don't pass
 * runTimestamp at all keep the original FIFO behavior unchanged.
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

    // windowMs always defaults to 60s here, matching the query-only path
    // below -- an omitted windowMs must NOT mean "unbounded", or a
    // runTimestamp-bearing caller could silently accept an arbitrarily
    // stale match (e.g. years old) just because it was the closest of a
    // bad set of candidates.
    const windowMs = options.windowMs ?? 60_000;
    const runMs = toMs(options.runTimestamp);
    if (runMs == null) {
      // No runTimestamp supplied at all -- there's nothing to check a
      // window against, so fall back to the original FIFO behavior
      // (matches pre-fix callers exactly). This is different from "no
      // candidate has a usable createdAt" below, which DOES have a
      // runTimestamp to verify against and rejects instead.
      return consumeFromQueryOnlyIndex(index, query, list.shift());
    }

    // A runTimestamp was supplied: pick whichever candidate is closest in
    // time to it (bounded by windowMs), even if there's only one candidate
    // -- a single stale match outside the window should still be rejected,
    // not accepted just because it was the only option.
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < list.length; i++) {
      const rowMs = toMs(list[i].createdAt);
      if (rowMs == null) continue;
      const diff = Math.abs(runMs - rowMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      // None of the candidates have a usable createdAt, so none can be
      // time-verified against runTimestamp -- the whole point of this
      // branch is to avoid accepting an unverifiable match, so reject
      // rather than silently falling back to FIFO (which would defeat
      // the fix for exactly the callers most likely to need it: a run
      // export using a field name toMs() doesn't recognize).
      return null;
    }
    if (bestDiff > windowMs) return null;
    const [chosen] = list.splice(bestIdx, 1);
    return consumeFromQueryOnlyIndex(index, query, chosen);
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

/**
 * Removes a row already consumed from byUserQuery out of byQueryOnly too,
 * mirroring the query-only branch's own scopedList cleanup (below) in the
 * other direction. Without this, a row matched via userId::query stays
 * visible to a later query-only lookup for the same prompt text (now
 * "unique" again from that index's point of view) and gets matched AGAIN --
 * the same silent-duplicate-match risk this file exists to prevent, just on
 * the other index. Caller must have already removed `chosen` from
 * byUserQuery itself (both call sites do, via list.shift()/splice()).
 *
 * @param {{ byQueryOnly: Map<string, any[]> }} index
 */
function consumeFromQueryOnlyIndex(index, query, chosen) {
  if (!chosen) return chosen;
  const qList = index.byQueryOnly.get(query);
  if (qList) {
    const idx = qList.indexOf(chosen);
    if (idx >= 0) qList.splice(idx, 1);
  }
  return chosen;
}
