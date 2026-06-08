import { useState } from 'react'
import { IconTrash, IconPlus, IconUsers, IconCalendar, IconUserCheck } from '@tabler/icons-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  CourseMaterialsUpload,
  type CourseMaterial,
} from '~/components/course-materials-upload'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseTopic } from '~/hooks/api/use-course-topics'
import type { CourseEnrollment } from '~/hooks/api/use-course-enrollments'
import type { CourseTA } from '~/hooks/api/use-course-tas'
import { canManageTopics, canManageInstructors } from '~/lib/rbac'
import type { CourseAccess } from '~/lib/rbac'
import { useUsers } from '~/hooks/api/use-users'

interface Props {
  course: CourseDetail
  access: CourseAccess
  topics: CourseTopic[]
  enrollments: CourseEnrollment[]
  materials: CourseMaterial[]
  tas: CourseTA[]
  isUploading?: boolean
  materialsError?: string | null
  materialsSuccess?: string | null
  onFileSelect: (file: File) => void
  onCreateTopic: (name: string) => Promise<void>
  onDeleteTopic: (id: string) => Promise<void>
  onAssignProfessor: (professorId: string) => Promise<void>
  onAddTA: (userId: string) => Promise<void>
  onRemoveTA: (userId: string) => Promise<void>
}

export function CourseDetailManagerView({
  course,
  access,
  topics,
  enrollments,
  materials,
  tas,
  isUploading = false,
  materialsError = null,
  materialsSuccess = null,
  onFileSelect,
  onCreateTopic,
  onDeleteTopic,
  onAssignProfessor,
  onAddTA,
  onRemoveTA,
}: Props) {
  const [newTopic, setNewTopic] = useState('')
  const [staffError, setStaffError] = useState<string | null>(null)
  const [staffSuccess, setStaffSuccess] = useState<string | null>(null)
  const [selectedProfId, setSelectedProfId] = useState<string>('')
  const [selectedTAId, setSelectedTAId] = useState<string>('')
  const canManage = canManageTopics(access)
  const canManageStaff = canManageInstructors(access)

  const { users } = useUsers()
  const professors = users.filter((u) => u.role === 'PROFESSOR' && u.isActive)
  const availableTAs = users.filter(
    (u) => u.role === 'TA' && u.isActive && !tas.some((ta) => ta.userId === u.id)
  )

  const handleTopicCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTopic.trim()) return
    await onCreateTopic(newTopic.trim())
    setNewTopic('')
  }

  const handleAssignProfessor = async () => {
    if (!selectedProfId) return
    setStaffError(null)
    setStaffSuccess(null)
    try {
      await onAssignProfessor(selectedProfId)
      setStaffSuccess('Professor assigned successfully')
      setSelectedProfId('')
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Failed to assign professor')
    }
  }

  const handleAddTA = async () => {
    if (!selectedTAId) return
    setStaffError(null)
    setStaffSuccess(null)
    try {
      await onAddTA(selectedTAId)
      setStaffSuccess('TA added successfully')
      setSelectedTAId('')
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Failed to add TA')
    }
  }

  const handleRemoveTA = async (userId: string) => {
    setStaffError(null)
    setStaffSuccess(null)
    try {
      await onRemoveTA(userId)
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Failed to remove TA')
    }
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
          {canManageStaff && <TabsTrigger value="staff">Staff</TabsTrigger>}
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

        {canManageStaff && (
          <TabsContent value="staff" forceMount className="data-[state=inactive]:hidden flex-1 outline-none">
            <div className="flex flex-col gap-6">
              <CardHeader className="px-0 pt-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <IconUserCheck className="w-4 h-4" />
                  Course Staff
                </CardTitle>
              </CardHeader>

              {staffError && (
                <p className="text-sm text-destructive">{staffError}</p>
              )}
              {staffSuccess && (
                <p className="text-sm text-green-600">{staffSuccess}</p>
              )}

              {/* Professor assignment */}
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Professor</p>
                {course.professor && (
                  <Card>
                    <CardContent className="flex items-center justify-between py-3">
                      <div>
                        <span className="text-sm font-medium">{course.professor.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{course.professor.email}</span>
                      </div>
                      <Badge>Current</Badge>
                    </CardContent>
                  </Card>
                )}
                <div className="flex gap-2">
                  <Select value={selectedProfId} onValueChange={setSelectedProfId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a professor to assign" />
                    </SelectTrigger>
                    <SelectContent>
                      {professors.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAssignProfessor} disabled={!selectedProfId}>
                    Assign
                  </Button>
                </div>
              </div>

              {/* TA management */}
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Teaching Assistants</p>
                {tas.length === 0 ? (
                  <Card>
                    <CardContent className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                      No TAs assigned.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {tas.map((ta) => (
                      <Card key={ta.id}>
                        <CardContent className="flex items-center justify-between py-3">
                          <div>
                            <span className="text-sm font-medium">{ta.user.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{ta.user.email}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove TA"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleRemoveTA(ta.userId)}
                          >
                            <IconTrash className="w-4 h-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Select value={selectedTAId} onValueChange={setSelectedTAId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a TA to add" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTAs.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddTA} disabled={!selectedTAId}>
                    <IconPlus className="w-4 h-4 mr-1" />
                    Add TA
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
