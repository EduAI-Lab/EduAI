/**
 * Splits courses into three buckets based on real start/end dates:
 * "upcoming" (hasn't started), "current" (started, and either still within
 * its end date or has no end date set), and "previous" (past its end date).
 * `now` is injectable for testing; defaults to the real current time.
 */
export function groupCoursesByDate<T extends { startDate: string | Date; endDate?: string | Date | null }>(
  courses: T[],
  now: Date = new Date(),
): { previous: T[]; current: T[]; upcoming: T[] } {
  const previous: T[] = []
  const current: T[] = []
  const upcoming: T[] = []

  for (const course of courses) {
    const start = new Date(course.startDate)
    const end = course.endDate ? new Date(course.endDate) : null

    if (now < start) {
      upcoming.push(course)
    } else if (end && now > end) {
      previous.push(course)
    } else {
      current.push(course)
    }
  }

  return { previous, current, upcoming }
}
