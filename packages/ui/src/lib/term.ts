// Canonical academic-term model shared across Core, AI Tutor, and Question Maker.
//
// Term is a UBC session code — W1/W2/S1/S2 — paired with the session start year.
// This is the single source of truth for parsing, labelling, ordering, and
// grouping courses by term across every EduAI app. Do not fork this logic.
//
//   W1 = Winter Term 1 (Sep–Dec)   W2 = Winter Term 2 (Jan–Apr)
//   S1 = Summer Term 1 (May–Jun)   S2 = Summer Term 2 (Jul–Aug)

export const TERM_CODES = ["W1", "W2", "S1", "S2"] as const

export type TermCode = (typeof TERM_CODES)[number]

const TERM_LABELS: Record<TermCode, string> = {
  W1: "Winter Term 1",
  W2: "Winter Term 2",
  S1: "Summer Term 1",
  S2: "Summer Term 2",
}

// Chronological rank of a term *within its session year*. The UBC academic year
// runs Summer (May) → Winter (Sep) → Winter Term 2 (Jan of the next calendar
// year), so for a single `year` value the order is S1 < S2 < W1 < W2.
const TERM_RANK: Record<TermCode, number> = { S1: 0, S2: 1, W1: 2, W2: 3 }

export function isTermCode(value: unknown): value is TermCode {
  return typeof value === "string" && (TERM_CODES as readonly string[]).includes(value)
}

/**
 * Map a JS month index (0–11) to its UBC term code. Used internally by
 * `termFromDate`; prefer that (or `normalizeTerm`) whenever a real `Date`
 * is available, since a raw month index carries no timezone information.
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
// This is the single owner of the Vancouver zone constant. Core's
// `term.server.ts` imports it rather than redeclaring it, so the
// `UBC_TIMEZONE` env override (deployments outside Vancouver) can't cause
// the two derivations to drift apart. `process` only exists in Node, so
// browser bundles fall back to the same default Core uses when the env
// var is unset.
export const UBC_TIME_ZONE =
  (typeof process !== "undefined" ? process.env?.UBC_TIMEZONE : undefined) ?? "America/Vancouver"

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
 * Best-effort normalization of a legacy free-form term value to a canonical
 * `TermCode`. When a start date is available it is authoritative (unambiguous);
 * otherwise a season/label string is parsed. Returns null when nothing matches.
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

/** Compact UBC-native label, e.g. "2026W1". Falls back to the raw parts when uncanonical. */
export function termLabel(term?: string | null, year?: number | string | null): string {
  const code = isTermCode(term) ? term : normalizeTerm(term)
  if (code && year != null) return `${year}${code}`
  if (code) return code
  if (year != null) return String(year)
  const raw = typeof term === "string" ? term.trim() : ""
  return raw || "No term scheduled"
}

/** Long label for headings, e.g. "Winter Term 1 2026". */
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
 * Numeric sort key, larger = more recent. Prefers the authoritative start date;
 * otherwise falls back to `year * 10 + termRank` using the correct UBC ordering.
 */
export function termSortKey(info: TermInfo): number {
  if (info.startDate != null) {
    const date = info.startDate instanceof Date ? info.startDate : new Date(info.startDate)
    const t = date.getTime()
    if (!Number.isNaN(t)) return t
  }
  const year = Number(info.year) || 0
  const code = isTermCode(info.term) ? info.term : normalizeTerm(info.term)
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
 * Group items by canonical term, most recent group first. `accessor` extracts
 * the term info from each item (defaults to treating the item as `TermInfo`).
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
