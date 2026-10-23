/**
 * Client-safe helpers for API access grants (#2039). The server rules live in
 * `access-grants.server.ts`; these only shape what the screens show.
 */

/** UBC term ends (month is 0-based): Winter T2 (Apr 30), Summer (Aug 31), Winter T1 (Dec 31). */
const TERM_ENDS: ReadonlyArray<{ month: number; day: number }> = [
  { month: 3, day: 30 },
  { month: 7, day: 31 },
  { month: 11, day: 31 },
];

/** A grant this close to its start would end almost at once, so the next term end is used. */
const MIN_DEFAULT_GRANT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The default end date for a new grant: the first term end at least two weeks
 * away, as `YYYY-MM-DD` (local date).
 */
export function defaultGrantEndDate(today: Date = new Date()): string {
  const earliest = new Date(today.getTime() + MIN_DEFAULT_GRANT_DAYS * DAY_MS);
  for (let year = today.getFullYear(); ; year += 1) {
    for (const { month, day } of TERM_ENDS) {
      const end = new Date(year, month, day);
      if (end.getTime() >= earliest.getTime()) return toDateInputValue(end);
    }
  }
}

/** `YYYY-MM-DD` for a date input, in local time. */
export function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The end of the chosen day in local time, as an ISO string, so a grant "until
 * Dec 31" lasts through Dec 31.
 */
export function endOfDayIso(dateInputValue: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInputValue);
  if (!match) return null;
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

/** Seconds from `now` until a grant ends, less a minute of slack for the round trip. */
export function secondsUntilGrantEnds(expiresAt: string | Date, now: Date = new Date()): number {
  const end = new Date(expiresAt).getTime();
  return Math.max(0, Math.floor((end - now.getTime()) / 1000) - 60);
}

const compact = new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 });

/** "1.2K / 200K" style usage against a limit. */
export function formatUsage(used: number, limit: number): string {
  return `${compact.format(used)} / ${compact.format(limit)}`;
}

/** Share of a limit used, 0–100, for progress bars. */
export function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}
