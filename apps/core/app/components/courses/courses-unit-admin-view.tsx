import { useState, useEffect, useMemo } from 'react'
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
  defaultColorIndexForCourse,
} from '@eduai/ui'
import { TERM_CODES, termName, termInfoFromDate } from '@eduai/ui'
import { useDisciplines } from '~/hooks/api/use-disciplines'
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

export function CoursesUnitAdminView({ courses, authorizedUnits, instructors = [], onCreateCourse, onEditCourse, onDeleteCourse, onPublishToggle }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const { options: departmentOptions, getLabel: getDepartmentLabel, loading: deptLoading } = useDisciplines()
  // Only show departments that are in the user's authorized units. Memoized so
  // the array keeps a stable ref across renders (it feeds effect deps below).
  const authorizedUnitSet = useMemo(() => new Set(authorizedUnits), [authorizedUnits])
  const authorizedDepts = useMemo(
    () => departmentOptions.filter((d) => authorizedUnitSet.has(d.code)),
    [departmentOptions, authorizedUnitSet],
  )
  const { isEnabled } = usePolicyGate()
  // §2 / issue #807: keep the delete control visible but greyed-out when
  // unitAdmins.canDeleteCourses is off (mirrors the deleteCourse 403), so the
  // disabled state reads as an admin choice rather than a missing feature.
  const canDelete = isEnabled('unitAdmins.canDeleteCourses')
  const [selectedDept, setSelectedDept] = useState<string>(authorizedDepts[0]?.code ?? '')
  const [selectedTerm, setSelectedTerm] = useState<string>(() => termInfoFromDate(new Date()).term)
  const [selectedInstructor, setSelectedInstructor] = useState<string>('')
  const [editDept, setEditDept] = useState<string>('')

  useEffect(() => {
    setEditDept(editingCourse?.department ?? '')
  }, [editingCourse])

  // Default the create-form department to the first authorized unit once the
  // disciplines list has loaded (the list is fetched async, §541).
  useEffect(() => {
    if (!selectedDept && authorizedDepts.length > 0) {
      setSelectedDept(authorizedDepts[0].code)
    }
  }, [authorizedDepts, selectedDept])

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
    setSelectedTerm(termInfoFromDate(new Date()).term)
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
                New courses will be assigned to one of your authorized course codes.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="ua-name">Course name</Label>
                <Input id="ua-name" name="name" placeholder="Introduction to Computer Science" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-dept">Course Code</Label>
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
                    placeholder="Select course code"
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
                      {TERM_CODES.map((code) => (
                        <SelectItem key={code} value={code}>{termName(code)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Year</Label>
                  {/* Academic-year label, not calendar year — matches selectedTerm's default (#1088). */}
                  <Input name="year" type="number" defaultValue={termInfoFromDate(new Date()).year} required />
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
              <p className="text-muted-foreground">No courses in {unitLabel} yet.</p>
              {authorizedDepts.length > 0 && (
                <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                  <IconPlus className="w-4 h-4 mr-2" />
                  Create first course
                </Button>
              )}
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
            colorIndex={defaultColorIndexForCourse(course.id)}
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
                  departments={authorizedDepts}
                  value={editDept}
                  onValueChange={setEditDept}
                  placeholder="No course code"
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
