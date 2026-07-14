import type { CourseListSection } from '@eduai/ui'
import { groupCoursesByDate } from '~/lib/courses/term-grouping'

/** Date-bucket sections for CourseListView (current, then upcoming, then previous). */
export function buildDateListSections<T extends { startDate: string | Date; endDate?: string | Date | null }>(
  courses: T[],
  now: Date = new Date(),
): CourseListSection<T>[] {
  const { previous, current, upcoming } = groupCoursesByDate(courses, now)
  const sections: CourseListSection<T>[] = []

  if (current.length > 0) {
    sections.push({ key: 'current', items: current })
  }
  if (upcoming.length > 0) {
    sections.push({
      key: 'upcoming',
      title: 'Upcoming Terms',
      headerVariant: 'simple',
      items: upcoming,
    })
  }
  if (previous.length > 0) {
    sections.push({
      key: 'previous',
      title: 'Previous Terms',
      headerVariant: 'simple',
      items: previous,
    })
  }

  return sections
}
