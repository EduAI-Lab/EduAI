import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]
}

export function CoursesTaView({ courses }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading="My Courses" subheading="Courses you are assisting" />

      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses assigned yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course, index) => (
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
