import { Link } from 'react-router'
import { IconBook, IconCalendar } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import type { Course } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]
}

export function CoursesStudentView({ courses }: Props) {
  // Students only see published courses (§5 isPublished gate, §19 cross-cutting)
  const visible = courses.filter((c) => c.isPublished)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold">My Courses</h2>
        <p className="text-muted-foreground">Your enrolled courses</p>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No published courses available yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((course) => (
            <Card key={course.id} className="hover:shadow-md transition-shadow">
              <Link to={`/courses/${course.id}`} className="block">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{course.code}</CardTitle>
                  <CardDescription>{course.name}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <IconCalendar className="w-4 h-4" />
                      {course.term} {course.year}
                    </div>
                    <Badge variant="default">Enrolled</Badge>
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
