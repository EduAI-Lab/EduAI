import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { IconPlus, IconEdit, IconTrash, IconBook, IconCalendar, IconEye, IconEyeOff } from '@tabler/icons-react'
import { Button } from '@eduai/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@eduai/ui'
import { Badge } from '@eduai/ui'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@eduai/ui'
import { Input } from '@eduai/ui'
import { Label } from '@eduai/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui'
import { Textarea } from '@eduai/ui'
import { UNIT_OPTIONS, getDepartmentLabel } from '~/lib/units'
import { DepartmentCombobox } from '~/components/courses/department-combobox'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'

interface Instructor {
  id: string
  name: string | null
  email: string
}

interface Props {
  courses: Course[]
  instructors?: Instructor[]
  onCreateCourse: (data: CreateCourseInput) => Promise<void>
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
  onDeleteCourse: (id: string) => Promise<void>
  onPublishToggle: (id: string, publish: boolean) => Promise<void>
}

export function CoursesAdminView({ courses, instructors = [], onCreateCourse, onEditCourse, onDeleteCourse, onPublishToggle }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [createDept, setCreateDept] = useState<string>('')
  const [selectedTerm, setSelectedTerm] = useState<string>('Fall')
  const [selectedInstructor, setSelectedInstructor] = useState<string>('')
  const [editDept, setEditDept] = useState<string>('')

  useEffect(() => {
    setEditDept(editingCourse?.department ?? '')
  }, [editingCourse])

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const codeSuffix = (fd.get('codeSuffix') as string).trim()
    const code = `${createDept} ${codeSuffix}`
    await onCreateCourse({
      name: fd.get('name') as string,
      code,
      section: fd.get('section') as string,
      term: selectedTerm,
      year: parseInt(fd.get('year') as string),
      startDate: fd.get('startDate') as string,
      department: createDept,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
      instructorUserIds: selectedInstructor ? [selectedInstructor] : [],
    })
    setCreateDept('')
    setSelectedTerm('Fall')
    setSelectedInstructor('')
    setCreateOpen(false)
  }

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingCourse) return
    const fd = new FormData(e.currentTarget)
    await onEditCourse(editingCourse.id, {
      name: fd.get('name') as string,
      code: fd.get('code') as string,
      department: editDept || null,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
    })
    setEditingCourse(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Courses</h2>
          <p className="text-muted-foreground">Manage all courses in the system</p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="w-4 h-4 mr-2" />
              Create Course
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Course</DialogTitle>
              <DialogDescription>Create a new course for the current academic term.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="create-name">Course Name</Label>
                <Input id="create-name" name="name" placeholder="Introduction to Computer Science" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-dept">Department</Label>
                <DepartmentCombobox
                  departments={[...UNIT_OPTIONS]}
                  value={createDept}
                  onValueChange={setCreateDept}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-code">Course Number</Label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                    {createDept || '—'}
                  </span>
                  <Input id="create-code" name="codeSuffix" placeholder="101" className="font-mono" required />
                </div>
                {createDept && (
                  <p className="text-xs text-muted-foreground">
                    Full code: <span className="font-mono">{createDept} 101</span>
                  </p>
                )}
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
                <Label>Instructor</Label>
                <Select value={selectedInstructor} onValueChange={setSelectedInstructor} required>
                  <SelectTrigger><SelectValue placeholder="Select instructor" /></SelectTrigger>
                  <SelectContent>
                    {instructors.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name ?? i.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>AI Instructions</Label>
                <Textarea name="aiInstructions" rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={!selectedInstructor || !createDept}>Create Course</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No courses yet.</p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <IconPlus className="w-4 h-4 mr-2" />
              Create Your First Course
            </Button>
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
                    <Button variant="ghost" size="icon" onClick={() => setEditingCourse(course)}>
                      <IconEdit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeletingCourse(course)}
                    >
                      <IconTrash className="w-4 h-4" />
                    </Button>
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
                <Label>Course Name</Label>
                <Input name="name" defaultValue={editingCourse.name} required />
              </div>
              <div className="grid gap-2">
                <Label>Code</Label>
                <Input name="code" defaultValue={editingCourse.code} required />
              </div>
              <div className="grid gap-2">
                <Label>Department</Label>
                <DepartmentCombobox
                  departments={[...UNIT_OPTIONS]}
                  value={editDept}
                  onValueChange={setEditDept}
                  placeholder="No department"
                />
              </div>
              <div className="grid gap-2">
                <Label>AI Instructions</Label>
                <Textarea name="aiInstructions" defaultValue={editingCourse.aiInstructions} rows={2} />
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
