import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, CourseListView, PageHeading } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'
import { CourseCardCustomizePopover } from '~/components/courses/course-card-customize-popover'
import { CourseCardScrollItem } from '~/components/courses/course-card-scroll-item'
import { useCourseCardPreferences } from '~/hooks/use-course-card-preferences'
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
} from '~/lib/courses/course-card-preferences'

interface Props {
  courses: Course[]
}

function EmptyCourses({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-8">
        <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}

export function CoursesStudentView({ courses }: Props) {
  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences()

  // Route already filters to enrolled + published; keep gate for tests/direct usage
  const visible = courses.filter((c) => c.isPublished)

  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading="My Courses" subheading="Your enrolled courses" />

      <CourseListView<Course>
        courses={visible}
        gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        getKey={(course) => course.id}
        getTermInfo={(course) => ({ term: course.term, year: course.year })}
        getSearchText={(course) => `${course.name} ${course.code}`}
        emptyState={<EmptyCourses message="No published courses available yet." />}
        noResultsState={<EmptyCourses message="No courses match your search." />}
        renderCard={(course, index) => {
          const preference = getCoursePreference(course.id)
          const accentColor = resolveCourseAccentColor(course.id, preference)
          const displayName = getCourseDisplayName(course.name, preference)

          return (
            <CourseCardScrollItem index={index}>
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
                extraBadges={['Enrolled']}
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
        }}
      />
    </div>
  )
}
