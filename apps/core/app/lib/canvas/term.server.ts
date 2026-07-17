import { UBC_TIME_ZONE } from "@eduai/ui/term";

/**
 * UBC academic term codes derived from a course start date (Pacific time).
 *
 * - Sep–Dec: Winter Term 1 (W1)
 * - Jan–Apr: Winter Term 2 (W2)
 * - May–Jun: Summer Term 1 (S1)
 * - Jul–Aug: Summer Term 2 (S2)
 *
 * The zone (and its `UBC_TIMEZONE` env override) is owned by
 * `packages/ui/src/lib/term.ts` — see that file for why.
 */

function monthInUbcTimeZone(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: UBC_TIME_ZONE,
      month: "numeric",
    }).format(date),
  );
}

export function ubcTermFromDate(date: Date): string {
  const month = monthInUbcTimeZone(date);

  if (month >= 9 && month <= 12) return "W1";
  if (month >= 1 && month <= 4) return "W2";
  if (month >= 5 && month <= 6) return "S1";
  if (month >= 7 && month <= 8) return "S2";

  return "W1";
}

const UBC_TERM_START_MONTH: Record<string, number> = {
  W1: 9,
  W2: 1,
  S1: 5,
  S2: 7,
};

function ubcTermStartDate(year: number, code: string): Date {
  const month = UBC_TERM_START_MONTH[code] ?? 9;
  return new Date(Date.UTC(year, month - 1, 1, 7, 0, 0));
}

/** Infers a UBC term start from patterns like "2026 Winter" or "2026 W1". */
export function inferStartDateFromTermName(termName: string | null | undefined): Date | null {
  if (!termName?.trim()) {
    return null;
  }

  const yearMatch = termName.match(/\b(20\d{2})\b/);
  if (!yearMatch) {
    return null;
  }

  const year = Number(yearMatch[1]);
  const lower = termName.toLowerCase();

  if (/\bw1\b/.test(lower) || lower.includes("winter")) {
    return ubcTermStartDate(year, "W1");
  }
  if (/\bw2\b/.test(lower)) {
    return ubcTermStartDate(year, "W2");
  }
  if (/\bs1\b/.test(lower)) {
    return ubcTermStartDate(year, "S1");
  }
  if (/\bs2\b/.test(lower)) {
    return ubcTermStartDate(year, "S2");
  }

  return null;
}

/** Infers UBC term start from a term end date when Canvas omits `start_at`. */
export function inferUbcTermStartFromEndDate(endDate: Date): Date {
  const code = ubcTermFromDate(endDate);
  return ubcTermStartDate(endDate.getUTCFullYear(), code);
}
