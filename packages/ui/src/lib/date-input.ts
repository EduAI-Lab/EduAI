// Conversions between an `<input type="date">`-shaped string ("YYYY-MM-DD")
// and a `Date`.
//
// Both directions exist to keep code away from the two standard traps:
//
//   new Date("2026-09-01")           // UTC midnight => Aug 31 in Vancouver
//   date.toISOString().slice(0, 10)  // same shift, in reverse
//
// A date field carries a bare calendar day with no timezone attached. What
// the user picked *is* the day, so both functions work in the host's local
// time and never touch UTC.

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a "YYYY-MM-DD" field value into a local-midnight `Date`, or null when
 * the value is absent or not a real calendar day.
 */
export function parseDateInputValue(value: string | null | undefined): Date | null {
  const match = value?.trim().match(DATE_INPUT_PATTERN);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // Rejects overflow the pattern cannot catch ("2026-02-30" rolls forward to
  // Mar 2), so a malformed day is null rather than a silently shifted date.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

/** Render a `Date` as the "YYYY-MM-DD" string a date field expects. */
export function formatDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
