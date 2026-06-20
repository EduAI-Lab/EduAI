import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]
}

export function CoursesStudentView({ courses }: Props) {
  // Route already filters to enrolled + published; keep gate for tests/direct usage
  const visible = courses.filter((c) => c.isPublished)

  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading="My Courses" subheading="Your enrolled courses" />

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No published courses available yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((course, index) => (
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
              colorIndex={index}
              href={`/courses/${course.id}`}
              LinkComponent={Link}
            />
          ))}
        </div>
      )}
    </div>
  )
}
