/**
 * Splits courses into three buckets based on real start/end dates:
 * "upcoming" (hasn't started), "current" (started, and either still within
 * its end date or has no end date set), and "previous" (past its end date).
 * `now` is injectable for testing; defaults to the real current time.
 */

/**
 * Normalizes a Date to a numeric timestamp representing midnight UTC of its
 * UTC calendar day, dropping the time-of-day component. This ensures
 * date-only ISO strings (parsed as UTC midnight) and real-time `Date`
 * instances (which carry local wall-clock time) are compared on the same
 * UTC calendar-day basis, regardless of server/browser timezone.
 */
function toUtcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function groupCoursesByDate<T extends { startDate: string | Date; endDate?: string | Date | null }>(
  courses: T[],
  now: Date = new Date(),
): { previous: T[]; current: T[]; upcoming: T[] } {
  const previous: T[] = []
  const current: T[] = []
  const upcoming: T[] = []

  const nowDay = toUtcDayStart(now)

  for (const course of courses) {
    const startDay = toUtcDayStart(new Date(course.startDate))
    const endDay = course.endDate ? toUtcDayStart(new Date(course.endDate)) : null

    if (nowDay < startDay) {
      upcoming.push(course)
    } else if (endDay !== null && nowDay > endDay) {
      previous.push(course)
    } else {
      current.push(course)
    }
  }

  return { previous, current, upcoming }
}
