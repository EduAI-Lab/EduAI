const store = new Map<string, number[]>();

export function isRateLimited(
  ip: string,
  limit = Number(process.env.SESSION_VALIDATE_RATE_LIMIT ?? 300),
  windowMs = 60_000
): boolean {
  const now = Date.now();
  const hits = (store.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return true;
  hits.push(now);
  store.set(ip, hits);
  return false;
}
