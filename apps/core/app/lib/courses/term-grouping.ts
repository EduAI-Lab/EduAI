const TERM_DATE_RANGES: Record<string, { startMonth: number; endMonth: number }> = {
  Winter: { startMonth: 0, endMonth: 3 }, // Jan - Apr
  Spring: { startMonth: 0, endMonth: 3 }, // alias of Winter
  Summer: { startMonth: 4, endMonth: 7 }, // May - Aug
  Fall: { startMonth: 8, endMonth: 11 },  // Sep - Dec
}

function isCurrentTerm(term: string, year: number, now: Date): boolean {
  const range = TERM_DATE_RANGES[term]
  if (!range) return false
  return (
    year === now.getFullYear() &&
    now.getMonth() >= range.startMonth &&
    now.getMonth() <= range.endMonth
  )
}

/**
 * Splits courses into the term containing today's date ("current") and
 * everything else ("previous"), using fixed calendar-month ranges per term
 * name. `now` is injectable for testing; defaults to the real current time.
 */
export function groupCoursesByTerm<T extends { term: string; year: number }>(
  courses: T[],
  now: Date = new Date(),
): { current: T[]; previous: T[] } {
  const current: T[] = []
  const previous: T[] = []
  for (const course of courses) {
    if (isCurrentTerm(course.term, course.year, now)) {
      current.push(course)
    } else {
      previous.push(course)
    }
  }
  return { current, previous }
}
