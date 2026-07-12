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

export function CoursesTaView({ courses }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading="My Courses" subheading="Courses you are assisting" />

      <CourseListView<Course>
        courses={courses}
        gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        getKey={(course) => course.id}
        getTermInfo={(course) => ({ term: course.term, year: course.year })}
        getSearchText={(course) => `${course.name} ${course.code}`}
        filterGroups={[
          buildStatusFilterGroup<Course>((c) => c.isPublished),
          buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
          buildDepartmentFilterGroup<Course>((c) => c.department),
        ]}
        emptyState={<EmptyCourses message="You have no courses assigned yet." />}
        noResultsState={<EmptyCourses message="No courses match your search." />}
        renderCard={(course, index) => (
          <CourseCard
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
        )}
      />
    </div>
  )
}
