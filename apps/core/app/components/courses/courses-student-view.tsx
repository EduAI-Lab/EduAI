import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading, SegmentedControl } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'
import { CourseCardCustomizePopover } from '~/components/courses/course-card-customize-popover'
import { CourseCardScrollItem } from '~/components/courses/course-card-scroll-item'
import { ScrollReveal } from '~/components/motion/scroll-reveal'
import { useCourseCardPreferences } from '~/hooks/use-course-card-preferences'
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
} from '~/lib/courses/course-card-preferences'
import {
  filterCoursesByTermBucket,
  type TermBucket,
} from '~/lib/courses/term-filter'

interface Props {
  courses: Course[]
}

const TERM_FILTER_OPTIONS: { value: TermBucket; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 't1', label: 'Term 1' },
  { value: 't2', label: 'Term 2' },
]

export function CoursesStudentView({ courses }: Props) {
  const [termFilter, setTermFilter] = useState<TermBucket>('all')
  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences()

  // Route already filters to enrolled + published; keep gate for tests/direct usage
  const visible = courses.filter((c) => c.isPublished)
  const filtered = useMemo(
    () => filterCoursesByTermBucket(visible, termFilter),
    [visible, termFilter],
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading="My Courses" subheading="Your enrolled courses" />

      {visible.length > 0 && (
        <ScrollReveal index={0} parallax={false}>
          <SegmentedControl
            value={termFilter}
            onValueChange={(value) => setTermFilter(value as TermBucket)}
            options={TERM_FILTER_OPTIONS}
            ariaLabel="Filter courses by term"
          />
        </ScrollReveal>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No published courses available yet.</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No courses in this term.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course, index) => {
            const preference = getCoursePreference(course.id)
            const accentColor = resolveCourseAccentColor(course.id, preference)
            const displayName = getCourseDisplayName(course.name, preference)

            return (
              <CourseCardScrollItem key={course.id} index={index}>
                <CourseCard
                  id={course.id}
                  code={course.code}
                  name={course.name}
                  displayName={displayName}
                  description={course.description}
                  term={course.term}
                  year={course.year}
                  isPublished={course.isPublished}
                  department={course.department}
                  extraBadges={["Enrolled"]}
                  accentColor={accentColor}
                  heroAction={
                    <CourseCardCustomizePopover
                      courseName={course.name}
                      courseCode={course.code}
                      preference={preference}
                      onApply={(update) => setCoursePreference(course.id, update)}
                    />
                  }
                  href={`/courses/${course.id}`}
                  LinkComponent={Link}
                />
              </CourseCardScrollItem>
            )
          })}
        </div>
      )}
    </div>
  )
}
