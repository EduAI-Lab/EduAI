import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'
import { groupCoursesByDate } from '~/lib/courses/term-grouping'

interface Props {
  courses: Course[]
  taCourseIds: string[]
  enrolledCourseIds: string[]
}

function CourseGrid({ courses, extraBadges }: { courses: Course[]; extraBadges?: string[] }) {
  return (
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
          extraBadges={extraBadges}
          colorIndex={index}
          href={`/courses/${course.id}`}
          LinkComponent={Link}
        />
      ))}
    </div>
  )
}

function DateGroupedGrid({
  courses,
  extraBadges,
}: {
  courses: Course[]
  extraBadges?: string[]
}) {
  const { previous, current, upcoming } = groupCoursesByDate(courses)
  return (
    <div className="flex flex-col gap-4">
      <CourseGrid courses={current} extraBadges={extraBadges} />
      {upcoming.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Upcoming Terms</h3>
          <CourseGrid courses={upcoming} extraBadges={extraBadges} />
        </div>
      )}
      {previous.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Previous Terms</h3>
          <CourseGrid courses={previous} extraBadges={extraBadges} />
        </div>
      )}
    </div>
  )
}

export function CoursesMixedView({ courses, taCourseIds, enrolledCourseIds }: Props) {
  const assisting = courses.filter((c) => taCourseIds.includes(c.id))
  const enrolled = courses.filter(
    (c) => enrolledCourseIds.includes(c.id) && c.isPublished,
  )

  if (assisting.length === 0 && enrolled.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading heading="My Courses" subheading="Your courses" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses yet.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {assisting.length > 0 && (
        <div className="flex flex-col gap-4">
          <PageHeading heading="Courses You Are Assisting In" subheading="Courses where you are a TA" />
          <DateGroupedGrid courses={assisting} extraBadges={['TA']} />
        </div>
      )}
      {enrolled.length > 0 && (
        <div className="flex flex-col gap-4">
          <PageHeading heading="Courses You Are Enrolled In" subheading="Courses you are taking as a student" />
          <DateGroupedGrid courses={enrolled} extraBadges={['Enrolled']} />
        </div>
      )}
    </div>
  )
}
