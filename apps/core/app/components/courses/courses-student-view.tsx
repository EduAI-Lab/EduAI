import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading, ToggleGroup, ToggleGroupItem } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'
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
        <ToggleGroup
          type="single"
          value={termFilter}
          onValueChange={(value) => {
            if (value) setTermFilter(value as TermBucket)
          }}
          aria-label="Filter courses by term"
          className="justify-start"
        >
          {TERM_FILTER_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
          {filtered.map((course) => (
            <CourseCard
              key={course.id}
              id={course.id}
              code={course.code}
              name={course.name}
              description={course.description}
              term={course.term}
              year={course.year}
              isPublished={course.isPublished}
              department={course.department}
              extraBadges={["Enrolled"]}
              colorIndex={visible.findIndex((c) => c.id === course.id)}
              href={`/courses/${course.id}`}
              LinkComponent={Link}
            />
          ))}
        </div>
      )}
    </div>
  )
}
