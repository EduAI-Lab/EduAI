import type { TermCode } from "./term"

/**
 * Shared month-boundary test vectors for UBC term derivation (#1010).
 *
 * Terms are UBC-local (America/Vancouver), which trails UTC by 7–8 hours.
 * A date at midnight UTC on the 1st of a term-boundary month is still the
 * previous evening in Vancouver — i.e. still the *previous* term. These
 * cases fail under a naive UTC (or non-Vancouver local) month lookup, so
 * both packages/ui's `termFromDate` and Core's `ubcTermFromDate` are
 * exercised against this same list to keep the two derivations in sync.
 */
export const UBC_TERM_BOUNDARY_CASES: readonly (readonly [iso: string, expected: TermCode])[] = [
  ["2026-01-01T00:00:00Z", "W1"], // Vancouver: 2025-12-31 ~16:00 PST
  ["2026-05-01T00:00:00Z", "W2"], // Vancouver: 2026-04-30 ~17:00 PDT
  ["2026-07-01T00:00:00Z", "S1"], // Vancouver: 2026-06-30 ~17:00 PDT
  ["2026-09-01T00:00:00Z", "S2"], // Vancouver: 2026-08-31 ~17:00 PDT
  // Midday UTC is unambiguous in every real-world timezone — same term either way.
  ["2026-01-15T12:00:00Z", "W2"],
  ["2026-05-15T12:00:00Z", "S1"],
  ["2026-07-15T12:00:00Z", "S2"],
  ["2026-09-15T12:00:00Z", "W1"],
]
