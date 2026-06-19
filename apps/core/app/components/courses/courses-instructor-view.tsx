import { useState } from 'react'
import { Link } from 'react-router'
import { IconPlus, IconEdit, IconTrash, IconBook, IconCalendar, IconEye, IconEyeOff } from '@tabler/icons-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { UNIT_OPTIONS, getDepartmentLabel } from '~/lib/units'
import { DepartmentCombobox } from '~/components/courses/department-combobox'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'
import { usePolicies } from '~/hooks/api/use-policies'

interface Props {
  courses: Course[]
  onCreateCourse: (data: CreateCourseInput) => Promise<void>
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
  onDeleteCourse: (id: string) => Promise<void>
  onPublishToggle: (id: string, publish: boolean) => Promise<void>
}

export function CoursesInstructorView({ courses, onCreateCourse, onEditCourse, onDeleteCourse, onPublishToggle }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [selectedDept, setSelectedDept] = useState<string>('')
  const [selectedTerm, setSelectedTerm] = useState<string>('Fall')

  const { policies } = usePolicies()
  // Mirror the backend policy gates so the UI never offers an action the server
  // will 403. Defaults match the policy defaults (create/publish/delete are on).
  const canCreate = policies['instructors.canCreateCourses'] ?? true
  const canPublish = policies['instructors.canPublishCourses'] ?? true
  const canDelete = policies['instructors.canDeleteCourses'] ?? true

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const codeSuffix = (fd.get('codeSuffix') as string).trim()
    const code = selectedDept ? `${selectedDept} ${codeSuffix}` : codeSuffix
    await onCreateCourse({
      name: fd.get('name') as string,
      code,
      section: fd.get('section') as string,
      term: selectedTerm,
      year: parseInt(fd.get('year') as string),
      startDate: fd.get('startDate') as string,
      department: selectedDept || undefined,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
      // The server auto-enrolls the requesting instructor as the course
      // instructor, so no explicit assignment is needed here.
      instructorUserIds: [],
    })
    setSelectedDept('')
    setSelectedTerm('Fall')
    setCreateOpen(false)
  }

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingCourse) return
    const fd = new FormData(e.currentTarget)
    await onEditCourse(editingCourse.id, {
      name: fd.get('name') as string,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
    })
    setEditingCourse(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">My Courses</h2>
          <p className="text-muted-foreground">Courses you are teaching</p>
        </div>

        {canCreate && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus className="w-4 h-4 mr-2" />
                Create Course
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Course</DialogTitle>
                <DialogDescription>
                  You will be assigned as the instructor for this course.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="ins-name">Course Name</Label>
                  <Input id="ins-name" name="name" placeholder="Introduction to Computer Science" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ins-dept">Department</Label>
                  <DepartmentCombobox
                    departments={UNIT_OPTIONS}
                    value={selectedDept}
                    onValueChange={setSelectedDept}
                    placeholder="No department"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ins-code">Course Number</Label>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                      {selectedDept || '—'}
                    </span>
                    <Input
                      id="ins-code"
                      name="codeSuffix"
                      placeholder="101"
                      className="font-mono"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Section</Label>
                    <Input name="section" placeholder="01" defaultValue="01" required />
                  </div>
                  <div className="grid gap-2">
                    <Label>Start Date</Label>
                    <Input name="startDate" type="date" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Term</Label>
                    <Select value={selectedTerm} onValueChange={setSelectedTerm}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Fall">Fall</SelectItem>
                        <SelectItem value="Spring">Spring</SelectItem>
                        <SelectItem value="Summer">Summer</SelectItem>
                        <SelectItem value="Winter">Winter</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Year</Label>
                    <Input name="year" type="number" defaultValue={new Date().getFullYear()} required />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>AI Instructions</Label>
                  <Textarea name="aiInstructions" rows={2} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit">Create Course</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses assigned yet.</p>
            {canCreate && (
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
                Create First Course
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <Link to={`/courses/${course.id}`} className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">{course.code}</CardTitle>
                    <CardDescription className="mt-1 line-clamp-2">{course.name}</CardDescription>
                  </Link>
                  <div className="flex gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                    {canPublish && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={course.isPublished ? 'Unpublish' : 'Publish'}
                        onClick={() => onPublishToggle(course.id, !course.isPublished)}
                      >
                        {course.isPublished
                          ? <IconEyeOff className="w-4 h-4 text-muted-foreground" />
                          : <IconEye className="w-4 h-4 text-blue-600" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingCourse(course)}
                    >
                      <IconEdit className="w-4 h-4" />
                    </Button>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingCourse(course)}
                      >
                        <IconTrash className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <IconCalendar className="w-4 h-4" />
                    {course.term} {course.year}
                  </div>
                  {course.department && (
                    <Badge variant="outline">{getDepartmentLabel(course.department)}</Badge>
                  )}
                  <Badge variant={course.isPublished ? 'default' : 'secondary'}>
                    {course.isPublished ? 'Published' : 'Draft'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!deletingCourse} onOpenChange={(open) => !open && setDeletingCourse(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Course</DialogTitle>
            <DialogDescription>
              Delete <strong>{deletingCourse?.code} — {deletingCourse?.name}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCourse(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deletingCourse) {
                  await onDeleteCourse(deletingCourse.id)
                  setDeletingCourse(null)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCourse} onOpenChange={(open) => !open && setEditingCourse(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Course</DialogTitle></DialogHeader>
          {editingCourse && (
            <form onSubmit={handleEdit} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Course Name</Label>
                <Input id="edit-name" name="name" defaultValue={editingCourse.name} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-ai">AI Instructions</Label>
                <Textarea id="edit-ai" name="aiInstructions" defaultValue={editingCourse.aiInstructions} rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingCourse(null)}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
