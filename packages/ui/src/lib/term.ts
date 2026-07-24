// Canonical academic-term model shared across Core, AI Tutor, and Question Maker.
//
// Term is a UBC session code — W1/W2/S1/S2 — paired with the session's
// ACADEMIC year, not the calendar year it starts in. This is the single
// source of truth for parsing, labelling, ordering, and grouping courses by
// term across every EduAI app. Do not fork this logic.
//
//   W1 = Winter Term 1 (Sep–Dec)   W2 = Winter Term 2 (Jan–Apr)
//   S1 = Summer Term 1 (May–Jun)   S2 = Summer Term 2 (Jul–Aug)
//
// UBC's academic year begins in September: session `2026W1` (Sep–Dec 2026)
// is immediately followed by `2026W2` (Jan–Apr *2027*) — same year label,
// later calendar year. So a W2 session is always attributed to the PREVIOUS
// calendar year: a course running Jan–Apr 2026 is `2025W2`, not `2026W2`
// (#1088). `termInfoFromDate` is the one place that does this attribution —
// use it instead of pairing `termFromMonth` with `date.getFullYear()`.

export const TERM_CODES = ["W1", "W2", "S1", "S2"] as const

export type TermCode = (typeof TERM_CODES)[number]

const TERM_LABELS: Record<TermCode, string> = {
  W1: "Winter Term 1",
  W2: "Winter Term 2",
  S1: "Summer Term 1",
  S2: "Summer Term 2",
}

// Chronological rank of a term *within its academic year label*. The UBC
// academic year runs Summer (May) → Winter Term 1 (Sep) → Winter Term 2 (Jan
// of the *next* calendar year, same label), so for a single `year` value the
// order S1 < S2 < W1 < W2 is real chronological order — not just a vocabulary
// convention — as long as `year` is the academic-year label produced by
// `termInfoFromDate`, not a raw calendar year.
const TERM_RANK: Record<TermCode, number> = { S1: 0, S2: 1, W1: 2, W2: 3 }

export function isTermCode(value: unknown): value is TermCode {
  return typeof value === "string" && (TERM_CODES as readonly string[]).includes(value)
}

/**
 * Map a JS month index (0–11) to its UBC term code. Used internally by
 * `termFromDate`; prefer that (or `normalizeTerm`) whenever a real `Date`
 * is available, since a raw month index carries no timezone information.
 *
 * This alone does NOT tell you the academic year — pairing it with
 * `date.getFullYear()` gives the CALENDAR year, which is wrong for W2
 * (Jan–Apr belongs to the previous academic year). Use `termInfoFromDate`
 * when you need both term and year from a date.
 */
export function termFromMonth(month: number): TermCode {
  if (month >= 8) return "W1" // Sep–Dec
  if (month >= 4 && month <= 5) return "S1" // May–Jun
  if (month >= 6 && month <= 7) return "S2" // Jul–Aug
  return "W2" // Jan–Apr
}

// Terms are UBC-local (Vancouver), not UTC. `Date#getMonth()` reads the
// JS runtime's local timezone, which differs by environment (server process
// TZ, or a browser's OS setting) and can bucket a date near a month
// boundary into the wrong term. Always derive a term from a real Date via
// this timezone, mirroring Core's `ubcTermFromDate` in term.server.ts.
//
// This is the single owner of the Vancouver zone constant — a fixed value,
// not an env-configurable one. An env override here would only ever reach
// Core: bundlers don't expose `process.env` to browser code by default, so
// a `UBC_TIMEZONE` override would apply on the server but silently not in
// the browser, letting the two derivations drift apart. Core's
// `term.server.ts` imports this rather than redeclaring it, so both stay
// identical by construction.
export const UBC_TIME_ZONE = "America/Vancouver"

function monthInUbcTimeZone(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: UBC_TIME_ZONE,
      month: "numeric",
    }).format(date),
  )
}

/**
 * Map a calendar date to its UBC term code using the America/Vancouver
 * timezone boundary. This is the authoritative date→term derivation —
 * prefer it over `termFromMonth` whenever a real `Date` is available.
 */
export function termFromDate(date: Date): TermCode {
  return termFromMonth(monthInUbcTimeZone(date) - 1)
}

/**
 * Map a calendar date to its UBC term code *and* academic-year label in one
 * step — the authoritative way to derive both from a date. A W2 session
 * (Jan–Apr) is attributed to the PREVIOUS calendar year, since it's the
 * second half of the academic year that began the previous September
 * (Jan–Apr 2026 => `{ term: "W2", year: 2025 }`). Every other term's label
 * year equals its calendar year.
 *
 * Used for both course-creation defaults ("what term/year is it right now?")
 * and current-term detection in course lists — see `groupCoursesByTerm`.
 */
export function termInfoFromDate(date: Date): { term: TermCode; year: number } {
  const term = termFromMonth(date.getMonth())
  const year = term === "W2" ? date.getFullYear() - 1 : date.getFullYear()
  return { term, year }
}

/**
 * Best-effort normalization of a legacy free-form term value to a canonical
 * `TermCode`. When a start date is available it is authoritative (unambiguous);
 * otherwise a season/label string is parsed. Returns null when nothing matches.
 *
 * Note: this returns only the term code, not its academic year — a caller
 * pairing the result with a year derived from the same `startDate` must use
 * `termInfoFromDate`'s attribution (W2 => previous calendar year), not
 * `startDate.getFullYear()` directly.
 */
export function normalizeTerm(
  raw?: string | null,
  startDate?: string | Date | null,
): TermCode | null {
  if (startDate != null) {
    // A bare "YYYY-MM-DD" string names a calendar date, not an instant. Parsing
    // it as UTC midnight and re-deriving via the Vancouver offset can shift it
    // into the previous day (and term) near a month boundary — read the month
    // straight from the string instead of round-tripping through a timezone.
    if (typeof startDate === "string") {
      const dateOnly = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (dateOnly) return termFromMonth(Number(dateOnly[2]) - 1)
    }
    const date = startDate instanceof Date ? startDate : new Date(startDate)
    if (!Number.isNaN(date.getTime())) return termFromDate(date)
  }
  if (typeof raw !== "string") return null
  const s = raw.trim().toUpperCase()
  if (!s) return null
  if (isTermCode(s)) return s
  if (/\bW1\b|WINTER TERM 1/.test(s)) return "W1"
  if (/\bW2\b|WINTER TERM 2/.test(s)) return "W2"
  if (/\bS1\b|SUMMER TERM 1/.test(s)) return "S1"
  if (/\bS2\b|SUMMER TERM 2/.test(s)) return "S2"
  if (/FALL|AUTUMN/.test(s)) return "W1"
  if (/SPRING/.test(s)) return "W2"
  if (/SUMMER/.test(s)) return "S1"
  if (/WINTER/.test(s)) return "W2"
  return null
}

/** Long human label for a term code, e.g. "Winter Term 1". */
export function termName(term: TermCode): string {
  return TERM_LABELS[term]
}

/**
 * Compact UBC-native label, e.g. "2026W1". `year` is taken as-is (the
 * caller's academic-year label — see `termInfoFromDate` for how to derive it
 * from a date) and is not itself reinterpreted here. Falls back to the raw
 * parts when uncanonical.
 */
export function termLabel(term?: string | null, year?: number | string | null): string {
  const code = isTermCode(term) ? term : normalizeTerm(term)
  if (code && year != null) return `${year}${code}`
  if (code) return code
  if (year != null) return String(year)
  const raw = typeof term === "string" ? term.trim() : ""
  return raw || "No term scheduled"
}

/** Long label for headings, e.g. "Winter Term 1 2026" (`year` is the academic-year label, as in `termLabel`). */
export function termLabelLong(term?: string | null, year?: number | string | null): string {
  const code = isTermCode(term) ? term : normalizeTerm(term)
  if (code && year != null) return `${termName(code)} ${year}`
  if (code) return termName(code)
  if (year != null) return String(year)
  const raw = typeof term === "string" ? term.trim() : ""
  return raw || "No term scheduled"
}

export type TermInfo = {
  term?: string | null
  year?: number | string | null
  startDate?: string | Date | null
}

/**
 * Numeric sort key, larger = more recent. Always resolves to a
 * `year * 10 + termRank` value using the academic-year ordering
 * (S1 < S2 < W1 < W2 within a label year — see `TERM_RANK`).
 *
 * When a start date is present it is authoritative for BOTH term and year:
 * it's run through `termInfoFromDate` (so a Jan–Apr date correctly derives
 * the previous year's W2) rather than compared as a raw timestamp. This
 * matters because a raw-timestamp comparison and a rank-based comparison can
 * disagree — a Jan-dated W2 session sorts before a Sep-dated W1 session by
 * clock time, but the two may carry the same or a later academic-year label —
 * so both paths must agree on one ordering, not compete on different scales.
 * Falls back to the item's own `term`/`year` fields when no usable start date
 * is present.
 */
export function termSortKey(info: TermInfo): number {
  let code: TermCode | null
  let year: number
  if (info.startDate != null) {
    // A bare "YYYY-MM-DD" string names a calendar date, not an instant —
    // parsing it as UTC midnight and reading local fields can shift it into
    // the previous day (and term/year) near a boundary. Read the fields
    // straight from the string instead (same guard as `normalizeTerm`).
    const dateOnly =
      typeof info.startDate === "string"
        ? info.startDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
        : null
    if (dateOnly) {
      code = termFromMonth(Number(dateOnly[2]) - 1)
      const calendarYear = Number(dateOnly[1])
      year = code === "W2" ? calendarYear - 1 : calendarYear
      return year * 10 + TERM_RANK[code]
    }
    const date = info.startDate instanceof Date ? info.startDate : new Date(info.startDate)
    if (!Number.isNaN(date.getTime())) {
      const derived = termInfoFromDate(date)
      code = derived.term
      year = derived.year
    } else {
      code = isTermCode(info.term) ? info.term : normalizeTerm(info.term)
      year = Number(info.year) || 0
    }
  } else {
    code = isTermCode(info.term) ? info.term : normalizeTerm(info.term)
    year = Number(info.year) || 0
  }
  const rank = code ? TERM_RANK[code] : -1
  return year * 10 + rank
}

/** Compare two term-bearing items, most recent first. */
export function compareByTerm(a: TermInfo, b: TermInfo): number {
  return termSortKey(b) - termSortKey(a)
}

export type CourseTermGroup<T> = {
  /** Canonical compact label, e.g. "2026W1" or "No term scheduled". */
  label: string
  /** Long label suitable for section headings, e.g. "Winter Term 1 2026". */
  labelLong: string
  items: T[]
}

/**
 * Group items by canonical term, most recent group first (via `termSortKey`,
 * so a W2 item's start date correctly outranks the W1 that precedes it in
 * the same academic year). `accessor` extracts the term info from each item
 * (defaults to treating the item as `TermInfo`).
 */
export function groupCoursesByTerm<T>(
  items: T[],
  accessor: (item: T) => TermInfo = (item) => item as unknown as TermInfo,
): CourseTermGroup<T>[] {
  const groups = new Map<string, { sort: number; group: CourseTermGroup<T> }>()
  for (const item of items) {
    const info = accessor(item)
    const label = termLabel(info.term, info.year)
    const existing = groups.get(label)
    if (existing) {
      existing.group.items.push(item)
    } else {
      groups.set(label, {
        sort: termSortKey(info),
        group: { label, labelLong: termLabelLong(info.term, info.year), items: [item] },
      })
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => b.sort - a.sort)
    .map((entry) => entry.group)
}
