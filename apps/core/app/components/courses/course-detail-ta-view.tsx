import { IconCalendar } from '@tabler/icons-react'
import { Card, CardContent } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import {
  CourseMaterialsUpload,
  type CourseMaterial,
} from '~/components/course-materials-upload'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import { usePolicies } from '~/hooks/api/use-policies'

interface Props {
  course: CourseDetail
  topics: CourseTopic[]
  materials: CourseMaterial[]
  isUploading?: boolean
  materialsError?: string | null
  materialsSuccess?: string | null
  onFileSelect: (file: File) => void
}

export function CourseDetailTaView({
  course,
  topics,
  materials,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
}: Props) {
  const { policies } = usePolicies()
  // §2 gate: a TA sees upload/delete controls only when tas.canManageMaterials
  // is on (default true). When off, materials are read-only (mirrors backend).
  const canManageMaterials = policies['tas.canManageMaterials'] ?? true

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">{course.code}</h1>
        <p className="text-xl text-muted-foreground mt-1">{course.name}</p>
        <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <IconCalendar className="w-4 h-4" />
            {course.term} {course.year}
          </div>
          <Badge variant={course.isActive ? 'default' : 'secondary'}>
            {course.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          {/* No Enrollments tab for TA — §6 */}
        </TabsList>

        <TabsContent value="overview" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <Card>
            <CardContent className="pt-6 grid gap-4">
              {course.description && <p>{course.description}</p>}
              {course.aiInstructions && (
                <div className="bg-muted/50 rounded p-3 text-sm">
                  <p className="font-medium mb-1">AI Instructions</p>
                  <p className="text-muted-foreground">{course.aiInstructions}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {canManageMaterials ? (
            <CourseMaterialsUpload
              materials={materials}
              isUploading={isUploading}
              error={materialsError}
              success={materialsSuccess}
              onFileSelect={onFileSelect}
            />
          ) : materials.length === 0 ? (
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
                    <span className="text-sm font-medium">{m.title}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{m.mimeType}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="topics" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          {/* TA reads topics — no add/delete controls (§8) */}
          {topics.length === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                No topics yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {topics.map((t) => (
                <Card key={t.id}>
                  <CardContent className="py-3 text-sm">{t.name}</CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
