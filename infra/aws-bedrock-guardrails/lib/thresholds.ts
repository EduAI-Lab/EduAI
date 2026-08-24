/** Shared so bin/app.ts and the unit test cannot drift. */
export function requirePositiveThreshold(name: string, raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return n;
}
