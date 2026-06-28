import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { IconPlus, IconBook } from '@tabler/icons-react'
import {
  Button,
  Card, CardContent,
  CourseCard,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
  Input,
  Label,
  PageHeading,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Textarea,
} from '@eduai/ui'
import { UNIT_OPTIONS, getDepartmentLabel } from '~/lib/units'
import { DepartmentCombobox } from '~/components/courses/department-combobox'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'
import {
  usePolicyGate,
  DEFAULT_POLICY_DISABLED_MESSAGE,
} from '~/components/policy/policy-gate'

interface Instructor {
  id: string
  name: string | null
  email: string
}

interface Props {
  courses: Course[]         // already filtered to this unit's courses by the route
  authorizedUnits: string[] // e.g. ['COSC', 'MATH']
  instructors?: Instructor[]
  onCreateCourse: (data: CreateCourseInput) => Promise<void>
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
  onDeleteCourse: (id: string) => Promise<void>
  onPublishToggle: (id: string, publish: boolean) => Promise<void>
}

// Only show department options that are both canonical and in the user's authorized units
function useAuthorizedDepts(authorizedUnits: string[]) {
  return UNIT_OPTIONS.filter((d) => authorizedUnits.includes(d.code))
}

export function CoursesUnitAdminView({ courses, authorizedUnits, instructors = [], onCreateCourse, onEditCourse, onDeleteCourse, onPublishToggle }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const authorizedDepts = useAuthorizedDepts(authorizedUnits)
  const { isEnabled } = usePolicyGate()
  // §2 / issue #807: keep the delete control visible but greyed-out when
  // unitAdmins.canDeleteCourses is off (mirrors the deleteCourse 403), so the
  // disabled state reads as an admin choice rather than a missing feature.
  const canDelete = isEnabled('unitAdmins.canDeleteCourses')
  const [selectedDept, setSelectedDept] = useState<string>(authorizedDepts[0]?.code ?? '')
  const [selectedTerm, setSelectedTerm] = useState<string>('Fall')
  const [selectedInstructor, setSelectedInstructor] = useState<string>('')
  const [editDept, setEditDept] = useState<string>('')

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
    const dept = selectedDept
    const codeSuffix = (fd.get('codeSuffix') as string).trim()
    const code = dept ? `${dept} ${codeSuffix}` : codeSuffix
    await onCreateCourse({
      name: fd.get('name') as string,
      code,
      section: fd.get('section') as string,
      term: selectedTerm,
      year: parseInt(fd.get('year') as string),
      startDate: fd.get('startDate') as string,
      department: dept || undefined,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
      instructorUserIds: selectedInstructor ? [selectedInstructor] : [],
    })
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

  const unitLabel = authorizedDepts.length > 0
    ? authorizedDepts.map((d) => `${d.label} (${d.code})`).join(', ')
    : authorizedUnits.join(', ') || '—'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <PageHeading heading="Courses" subheading={<>Managing: <span className="font-medium">{unitLabel}</span></>} />

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button disabled={authorizedDepts.length === 0}>
              <IconPlus className="w-4 h-4 mr-2" />
              Create course
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create course</DialogTitle>
              <DialogDescription>
                New courses will be assigned to one of your authorized departments.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="ua-name">Course name</Label>
                <Input id="ua-name" name="name" placeholder="Introduction to Computer Science" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-dept">Department</Label>
                {authorizedDepts.length === 1 ? (
                  <>
                    <input type="hidden" name="department" value={authorizedDepts[0].code} />
                    <Input
                      id="ua-dept"
                      value={`${authorizedDepts[0].label} (${authorizedDepts[0].code})`}
                      readOnly
                      className="bg-muted"
                    />
                  </>
                ) : (
                  <DepartmentCombobox
                    departments={authorizedDepts}
                    value={selectedDept}
                    onValueChange={setSelectedDept}
                    placeholder="Select department"
                  />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-code">Course number</Label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                    {selectedDept || authorizedDepts[0]?.code || '—'}
                  </span>
                  <Input
                    id="ua-code"
                    name="codeSuffix"
                    placeholder="101"
                    className="font-mono"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The full course code will be e.g. <span className="font-mono">{selectedDept || authorizedDepts[0]?.code || 'DEPT'} 101</span>
                </p>
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
                <Button
                  type="submit"
                  disabled={!selectedInstructor || (authorizedDepts.length > 1 && !selectedDept)}
                >
                  Create course
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No courses in {unitLabel} yet.</p>
            {authorizedDepts.length > 0 && (
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
                Create first course
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course, index) => (
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
                // §2 / issue #807: delete stays visible, greyed when the policy is off.
                showDelete: true,
                onDelete: () => setTimeout(() => setDeletingCourse(course), 0),
                deleteDisabled: !canDelete,
                deleteDisabledReason: DEFAULT_POLICY_DISABLED_MESSAGE,
              }}
            />
          ))}
        </div>
      )}

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
                <Label>Department</Label>
                <DepartmentCombobox
                  departments={authorizedDepts}
                  value={editDept}
                  onValueChange={setEditDept}
                  placeholder="No department"
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
