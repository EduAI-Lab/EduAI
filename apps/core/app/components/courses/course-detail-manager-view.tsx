import { useState } from 'react'
import { IconTrash, IconPlus, IconUsers, IconCalendar } from '@tabler/icons-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Input } from '~/components/ui/input'
import {
  CourseMaterialsUpload,
  type CourseMaterial,
} from '~/components/course-materials-upload'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import type { CourseEnrollment } from '~/hooks/api/use-course-enrollments'
import { canManageTopics } from '~/lib/rbac'
import type { CourseAccess } from '~/lib/rbac'

interface Props {
  course: CourseDetail
  access: CourseAccess
  topics: CourseTopic[]
  enrollments: CourseEnrollment[]
  materials: CourseMaterial[]
  isUploading?: boolean
  materialsError?: string | null
  materialsSuccess?: string | null
  onFileSelect: (file: File) => void
  onCreateTopic: (name: string) => Promise<void>
  onDeleteTopic: (id: string) => Promise<void>
}

export function CourseDetailManagerView({
  course,
  access,
  topics,
  enrollments,
  materials,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
  onCreateTopic,
  onDeleteTopic,
}: Props) {
  const [newTopic, setNewTopic] = useState('')
  const canManage = canManageTopics(access)

  const handleTopicCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTopic.trim()) return
    await onCreateTopic(newTopic.trim())
    setNewTopic('')
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
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
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
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
              {course.professor && (
                <p className="text-sm text-muted-foreground">
                  Instructor: {course.professor.name}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <CourseMaterialsUpload
            materials={materials}
            isUploading={isUploading}
            error={materialsError}
            success={materialsSuccess}
            onFileSelect={onFileSelect}
          />
        </TabsContent>

        <TabsContent value="topics" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <div className="flex flex-col gap-4">
            {canManage && (
              <form onSubmit={handleTopicCreate} className="flex gap-2">
                <Input
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="New topic name"
                />
                <Button type="submit" disabled={!newTopic.trim()}>
                  <IconPlus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </form>
            )}
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
                    <CardContent className="flex items-center justify-between py-3">
                      <span className="text-sm">{t.name}</span>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete topic"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDeleteTopic(t.id)}
                        >
                          <IconTrash className="w-4 h-4" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="enrollments" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
          <div className="flex flex-col gap-4">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-base flex items-center gap-2">
                <IconUsers className="w-4 h-4" />
                Enrolled Users
              </CardTitle>
            </CardHeader>
            {enrollments.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
                  No enrollments yet. (Enrollment API pending #305)
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {enrollments.map((e) => (
                  <Card key={e.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <div>
                        <span className="text-sm font-medium">{e.userName}</span>
                        <span className="text-xs text-muted-foreground ml-2">{e.userEmail}</span>
                      </div>
                      <Badge variant={e.role === 'INSTRUCTOR' ? 'default' : 'secondary'}>
                        {e.role}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
