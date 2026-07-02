import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { IconBook, IconPlus } from '@tabler/icons-react'
import {
  Button,
  Card,
  CardContent,
  CourseCard,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  PageHeading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@eduai/ui'
import { useDisciplines } from '~/hooks/api/use-disciplines'
import { DepartmentCombobox } from '~/components/courses/department-combobox'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'
import { usePolicies } from '~/hooks/api/use-policies'
import { groupCoursesByTerm } from '~/lib/courses/term-grouping'

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
  const { options: departmentOptions, loading: deptLoading } = useDisciplines()

  const { policies, isLoading: policiesLoading } = usePolicies()
  // Mirror the backend policy gates so the UI never offers an action the server
  // will 403. Stay restrictive until policies load — otherwise a disabled flag
  // would briefly flash Create/Publish/Delete before the fetch resolves.
  const canCreate = !policiesLoading && (policies['instructors.canCreateCourses'] ?? true)
  const canPublish = !policiesLoading && (policies['instructors.canPublishCourses'] ?? true)
  const canDelete = !policiesLoading && (policies['instructors.canDeleteCourses'] ?? true)

  // Safety cleanup: if the Radix DropdownMenu→Dialog lifecycle race left
  // pointer-events:none on <body>, clear it once no dialog is open.
  useEffect(() => {
    if (!editingCourse && !deletingCourse) {
      document.body.style.pointerEvents = ''
    }
  }, [editingCourse, deletingCourse])

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
      <div className="flex items-start justify-between gap-4">
        <PageHeading heading="My Courses" subheading="Courses you are teaching" />

        {canCreate && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus className="w-4 h-4 mr-2" />
                Create course
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create course</DialogTitle>
                <DialogDescription>
                  You will be assigned as the instructor for this course.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="ins-name">Course name</Label>
                  <Input id="ins-name" name="name" placeholder="Introduction to Computer Science" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ins-dept">Department</Label>
                  <DepartmentCombobox
                    departments={departmentOptions}
                    value={selectedDept}
                    onValueChange={setSelectedDept}
                    placeholder="No department"
                    disabled={deptLoading}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ins-code">Course number</Label>
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
                  <Label>AI instructions</Label>
                  <Textarea name="aiInstructions" rows={2} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit">Create course</Button>
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
                Create first course
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {(() => {
            const { current, previous } = groupCoursesByTerm(courses)
            const renderGrid = (list: typeof courses) => (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((course, index) => (
                  <CourseCard
                    key={course.id}
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
                    actions={{
                      showPublish: canPublish,
                      isPublished: course.isPublished,
                      onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
                      showEdit: true,
                      onEdit: () => setTimeout(() => setEditingCourse(course), 0),
                      showDelete: canDelete,
                      onDelete: () => setTimeout(() => setDeletingCourse(course), 0),
                    }}
                  />
                ))}
              </div>
            )
            return (
              <>
                {renderGrid(current)}
                {previous.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">Previous Terms</h3>
                    {renderGrid(previous)}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

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

      <Dialog open={!!editingCourse} onOpenChange={(open) => !open && setEditingCourse(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit course</DialogTitle></DialogHeader>
          {editingCourse && (
            <form onSubmit={handleEdit} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Course name</Label>
                <Input id="edit-name" name="name" defaultValue={editingCourse.name} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-ai">AI instructions</Label>
                <Textarea id="edit-ai" name="aiInstructions" defaultValue={editingCourse.aiInstructions} rows={2} />
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
