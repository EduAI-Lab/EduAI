/** CDK `-c` values arrive as number (defaults) or string (CLI). */
export type AlarmThresholdInput = number | string;

/** Shared so bin/app.ts and the unit test cannot drift. */
export function requirePositiveThreshold(name: string, raw: AlarmThresholdInput): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return n;
}
