import { IconBook, IconCalendar } from '@tabler/icons-react'
import { Card, CardContent } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseMaterial } from '~/hooks/api/use-course-materials'
import type { CourseTopic } from '~/hooks/api/use-course-topics'

interface Props {
  course: CourseDetail
  materials: CourseMaterial[]
  topics: CourseTopic[]
}

export function CourseDetailStudentView({ course, materials, topics }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">{course.code}</h1>
        <p className="text-xl text-muted-foreground mt-1">{course.name}</p>
        <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <IconCalendar className="w-4 h-4" />
            {course.term} {course.year}
          </div>
          <Badge variant="default">Enrolled</Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          {/* No Topics management tab, no Enrollments tab for students — §8, §6 */}
        </TabsList>

        <TabsContent value="overview" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <Card>
            <CardContent className="pt-6 grid gap-4">
              {course.description ? (
                <p>{course.description}</p>
              ) : (
                <p className="text-muted-foreground">No description provided.</p>
              )}
              {topics.length > 0 && (
                <div>
                  <p className="font-medium mb-2 text-sm">Course Topics</p>
                  <div className="flex flex-wrap gap-2">
                    {topics.map((t) => (
                      <Badge key={t.id} variant="secondary">{t.name}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {/* Read-only — no upload (§7) */}
          {materials.length === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                No materials available yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {materials.map((m) => (
                <Card key={m.id}>
                  <CardContent className="flex items-center gap-2 py-3">
                    <IconBook className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{m.title}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{m.mimeType}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
