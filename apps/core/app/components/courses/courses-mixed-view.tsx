import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import {
  Card,
  CardContent,
  CourseCard,
  CourseListView,
  PageHeading,
  buildStatusFilterGroup,
  buildTermFilterGroup,
  buildDepartmentFilterGroup,
} from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'
import { buildDateListSections } from '~/lib/courses/date-list-sections'
import { CourseCardCustomizePopover } from '~/components/courses/course-card-customize-popover'
import { useCourseCardPreferences } from '~/hooks/use-course-card-preferences'
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
  type CourseCardPreference,
} from '~/lib/courses/course-card-preferences'

interface Props {
  courses: Course[]
  taCourseIds: string[]
  enrolledCourseIds: string[]
}

function CourseSection({
  heading,
  subheading,
  courses,
  extraBadges,
  getCoursePreference,
  setCoursePreference,
}: {
  heading: string
  subheading: string
  courses: Course[]
  extraBadges: string[]
  getCoursePreference: (courseId: string) => CourseCardPreference | undefined
  setCoursePreference: (courseId: string, update: CourseCardPreference | null) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading={heading} subheading={subheading} />
      <CourseListView<Course>
        courses={courses}
        gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        getKey={(course) => course.id}
        getTermInfo={(course) => ({ term: course.term, year: course.year, startDate: course.startDate })}
        groupSections={buildDateListSections}
        getSearchText={(course) => `${course.name} ${course.code}`}
        filterGroups={[
          buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
          buildDepartmentFilterGroup<Course>((c) => c.department),
          buildStatusFilterGroup<Course>((c) => c.isPublished),
        ]}
        noResultsState={
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No courses match your search.</p>
            </CardContent>
          </Card>
        }
        renderCard={(course, index) => {
          const preference = getCoursePreference(course.id)
          const accentColor = resolveCourseAccentColor(course.id, preference)
          const displayName = getCourseDisplayName(course.name, preference)
          return (
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
              extraBadges={extraBadges}
              colorIndex={index}
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
          )
        }}
      />
    </div>
  )
}

export function CoursesMixedView({ courses, taCourseIds, enrolledCourseIds }: Props) {
  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences()
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
        <CourseSection
          heading="Courses You Are Assisting In"
          subheading="Courses where you are a TA"
          courses={assisting}
          extraBadges={['TA']}
          getCoursePreference={getCoursePreference}
          setCoursePreference={setCoursePreference}
        />
      )}
      {enrolled.length > 0 && (
        <CourseSection
          heading="Courses You Are Enrolled In"
          subheading="Courses you are taking as a student"
          courses={enrolled}
          extraBadges={['Enrolled']}
          getCoursePreference={getCoursePreference}
          setCoursePreference={setCoursePreference}
        />
      )}
    </div>
  )
}
