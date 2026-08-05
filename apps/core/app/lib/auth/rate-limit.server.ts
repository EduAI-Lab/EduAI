const store = new Map<string, number[]>();

/**
 * Number(process.env.X ?? fallback) only falls back on null/undefined — an
 * empty string ("") skips the fallback and parses to 0. Guard against that
 * here so a blank env value can't silently zero out a limit or window.
 */
export function parseEnvInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Bounds the store (#990): a plain unbounded Map leaks memory in a
// single-process deployment, since a key with one hit and no return visit is
// never removed. STALE_ENTRY_MS is comfortably larger than any configured
// window so a sweep never evicts a key with an active hit count.
//
// Caps are read lazily (not at module import) so a broken `parseEnvInt`
// undefined-guard is killable by the dedicated unit test — calling it at
// top level with an unset RATE_LIMIT_MAX_KEYS made those mutants crash the
// whole file on import, which Stryker could not attribute to a killing test.
const STALE_ENTRY_MS = 60 * 60_000;
let cachedMaxStoreKeys: number | null = null;

function getMaxStoreKeys(): number {
  if (cachedMaxStoreKeys === null) {
    cachedMaxStoreKeys = parseEnvInt(process.env.RATE_LIMIT_MAX_KEYS, 50_000);
  }
  return cachedMaxStoreKeys;
}

// Eviction below targets 90% of the cap rather than exactly MAX_STORE_KEYS,
// so a sweep isn't immediately re-triggered by the next insert once the
// store is sitting right at the cap under sustained load. Derived from the
// cached max on each call — caching the floor() result separately only
// added an equivalent-to-always-recompute branch for mutation testing.
function getEvictionTargetKeys(): number {
  return Math.floor(getMaxStoreKeys() * 0.9);
}

function evictStaleEntries(now: number): void {
  for (const [key, hits] of store) {
    const lastHit = hits[hits.length - 1];
    if (lastHit === undefined || now - lastHit > STALE_ENTRY_MS) {
      store.delete(key);
    }
  }
}

export function isRateLimited(
  key: string,
  limit = Number(process.env.SESSION_VALIDATE_RATE_LIMIT ?? 300),
  windowMs = 60_000
): boolean {
  const now = Date.now();
  // Equivalent ArrayDeclaration mutant: replacing `[]` with a non-empty
  // Stryker sentinel still yields an empty filtered list, because the
  // sentinel timestamps fail `now - t < windowMs` (NaN comparison).
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return true;
  }
  hits.push(now);
  store.set(key, hits);

  if (store.size > getMaxStoreKeys()) {
    evictStaleEntries(now);
    // Sweep alone may not be enough if every key is still "hot" — fall back
    // to evicting the oldest-inserted keys down to EVICTION_TARGET_KEYS
    // (not just MAX_STORE_KEYS) so this branch doesn't re-run on nearly
    // every request while size hovers at the cap.
    //
    // This is oldest-inserted, not LRU (Map.set on an existing key doesn't
    // move it in iteration order), and the store is shared across all
    // isRateLimited callers (IP-keyed session-validate limiter included), so
    // a flood of distinct keys could in theory evict another key's counter
    // early. Acceptable at the current 50k default; revisit if that stops
    // being true.
    const evictionTarget = getEvictionTargetKeys();
    for (const oldestKey of store.keys()) {
      if (store.size <= evictionTarget) break;
      store.delete(oldestKey);
    }
  }

  return false;
}

/** Clears in-memory rate limit state between tests. */
export function resetRateLimitsForTests(): void {
  store.clear();
  cachedMaxStoreKeys = null;
}
