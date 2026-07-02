const TERM_ORDER = ['Winter', 'Spring', 'Summer', 'Fall'] as const

function termRank(term: string): number {
  const index = TERM_ORDER.indexOf(term as (typeof TERM_ORDER)[number])
  return index === -1 ? -1 : index
}

/**
 * Splits courses into the latest (year, term) group present in the list
 * ("current") and everything else ("previous"). Ties within the same year
 * are broken using TERM_ORDER (Winter < Spring < Summer < Fall).
 */
export function groupCoursesByTerm<T extends { term: string; year: number }>(
  courses: T[],
): { current: T[]; previous: T[] } {
  if (courses.length === 0) return { current: [], previous: [] }

  let latestYear = -Infinity
  let latestRank = -Infinity
  for (const course of courses) {
    const rank = termRank(course.term)
    if (
      course.year > latestYear ||
      (course.year === latestYear && rank > latestRank)
    ) {
      latestYear = course.year
      latestRank = rank
    }
  }

  const current: T[] = []
  const previous: T[] = []
  for (const course of courses) {
    if (course.year === latestYear && termRank(course.term) === latestRank) {
      current.push(course)
    } else {
      previous.push(course)
    }
  }
  return { current, previous }
}
