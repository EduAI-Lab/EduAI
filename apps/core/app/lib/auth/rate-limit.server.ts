const store = new Map<string, number[]>();

// Bounds the store (#990): a plain unbounded Map leaks memory in a
// single-process deployment, since a key with one hit and no return visit is
// never removed. STALE_ENTRY_MS is comfortably larger than any configured
// window so a sweep never evicts a key with an active hit count.
const MAX_STORE_KEYS = Number(process.env.RATE_LIMIT_MAX_KEYS ?? 50_000);
const STALE_ENTRY_MS = 60 * 60_000;

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
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return true;
  }
  hits.push(now);
  store.set(key, hits);

  if (store.size > MAX_STORE_KEYS) {
    evictStaleEntries(now);
    // Sweep alone may not be enough if every key is still "hot" — fall back
    // to evicting the oldest-inserted keys until back under the cap.
    for (const oldestKey of store.keys()) {
      if (store.size <= MAX_STORE_KEYS) break;
      store.delete(oldestKey);
    }
  }

  return false;
}

/** Clears in-memory rate limit state between tests. */
export function resetRateLimitsForTests(): void {
  store.clear();
}
