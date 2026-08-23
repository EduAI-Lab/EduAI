/**
 * Shared helpers for the isolated #919 loadtest fixture users.
 * Kept free of Prisma so unit tests can import it without a DB.
 */

export function emailForVu(n: number): string {
  return `loadtest.vu-${String(n).padStart(3, "0")}@eduai.local`;
}

/**
 * 8-digit UBC-format student numbers in the 2xxxxxxx range, away from
 * prisma/seed.ts demo students (10000001–10000005). A linked number is
 * what the current onboarding loader treats as "already done."
 */
export function studentNumberForVu(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`VU index must be a positive integer, got ${n}`);
  }
  const id = 20_000_000 + n;
  if (id > 29_999_999) {
    throw new Error(`LOADTEST_VUS too large for 8-digit student numbers: ${n}`);
  }
  return String(id);
}
