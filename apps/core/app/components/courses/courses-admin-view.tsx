import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { IconPlus, IconBook } from '@tabler/icons-react'
import {
  Button,
  Card, CardContent,
  CourseCard,
  CourseListView,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
  Input,
  Label,
  PageHeading,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea,
  buildStatusFilterGroup,
  buildTermFilterGroup,
  buildDepartmentFilterGroup,
} from '@eduai/ui'
import { TERM_CODES, termName, termFromMonth } from '@eduai/ui'
import { useDisciplines } from '~/hooks/api/use-disciplines'
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
  const [selectedTerm, setSelectedTerm] = useState<string>(() => termFromMonth(new Date().getMonth()))
  const [selectedInstructor, setSelectedInstructor] = useState<string>('')
  const [editDept, setEditDept] = useState<string>('')
  const { options: departmentOptions, getLabel: getDepartmentLabel, loading: deptLoading } = useDisciplines()

  useEffect(() => {
    setEditDept(editingCourse?.department ?? '')
  }, [editingCourse])

  // Safety cleanup: if the Radix DropdownMenu→Dialog lifecycle race left
  // pointer-events:none on <body>, clear it once the dialog is fully closed.
  useEffect(() => {
    if (!editingCourse) {
      document.body.style.pointerEvents = ''
    }
  }, [editingCourse])

  useEffect(() => {
    if (!deletingCourse) {
      document.body.style.pointerEvents = ''
    }
  }, [deletingCourse])

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
    setSelectedTerm(termFromMonth(new Date().getMonth()))
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
        <PageHeading heading="Courses" subheading="Manage all courses in the system" />

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="w-4 h-4 mr-2" />
              Create course
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create new course</DialogTitle>
              <DialogDescription>Create a new course for the current academic term.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="create-name">Course name</Label>
                <Input id="create-name" name="name" placeholder="Introduction to Computer Science" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-dept">Course Code</Label>
                <DepartmentCombobox
                  departments={departmentOptions}
                  value={createDept}
                  onValueChange={setCreateDept}
                  disabled={deptLoading}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-code">Course number</Label>
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
                  <Label>Start date</Label>
                  <Input name="startDate" type="date" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Term</Label>
                  <Select value={selectedTerm} onValueChange={setSelectedTerm}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TERM_CODES.map((code) => (
                        <SelectItem key={code} value={code}>{termName(code)}</SelectItem>
                      ))}
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
                <Label>AI instructions</Label>
                <Textarea name="aiInstructions" rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={!selectedInstructor || !createDept}>Create course</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <CourseListView<Course>
        courses={courses}
        gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        getKey={(course) => course.id}
        getTermInfo={(course) => ({ term: course.term, year: course.year })}
        getSearchText={(course) => `${course.name} ${course.code}`}
        filterGroups={[
          buildStatusFilterGroup<Course>((c) => c.isPublished),
          buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
          buildDepartmentFilterGroup<Course>((c) => c.department, {
            optionLabel: getDepartmentLabel,
          }),
        ]}
        emptyState={
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No courses yet.</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
                Create your first course
              </Button>
            </CardContent>
          </Card>
        }
        noResultsState={
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No courses match your search.</p>
            </CardContent>
          </Card>
        }
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
            departmentLabel={course.department ? getDepartmentLabel(course.department) : undefined}
            colorIndex={index}
            href={`/courses/${course.id}`}
            LinkComponent={Link}
            actions={{
              showPublish: true,
              isPublished: course.isPublished,
              onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
              showEdit: true,
              onEdit: () => setTimeout(() => setEditingCourse(course), 0),
              showDelete: true,
              onDelete: () => setTimeout(() => setDeletingCourse(course), 0),
            }}
          />
        )}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deletingCourse} onOpenChange={(open) => !open && setDeletingCourse(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete course</DialogTitle>
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

      {/* Edit dialog */}
      <Dialog open={!!editingCourse} onOpenChange={(open) => !open && setEditingCourse(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit course</DialogTitle></DialogHeader>
          {editingCourse && (
            <form onSubmit={handleEdit} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Course name</Label>
                <Input name="name" defaultValue={editingCourse.name} required />
              </div>
              <div className="grid gap-2">
                <Label>Code</Label>
                <Input name="code" defaultValue={editingCourse.code} required />
              </div>
              <div className="grid gap-2">
                <Label>Course Code</Label>
                <DepartmentCombobox
                  departments={departmentOptions}
                  value={editDept}
                  onValueChange={setEditDept}
                  placeholder="No course code"
                  disabled={deptLoading}
                />
              </div>
              <div className="grid gap-2">
                <Label>AI instructions</Label>
                <Textarea name="aiInstructions" defaultValue={editingCourse.aiInstructions} rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingCourse(null)}>Cancel</Button>
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
