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
import { TERM_CODES, termName, termFromDate, termInfoFromDate } from '@eduai/ui'
import { useDisciplines } from '~/hooks/api/use-disciplines'
import { DepartmentCombobox } from '~/components/courses/department-combobox'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'
import { CourseCardCustomizePopover } from '~/components/courses/course-card-customize-popover'
import { useCourseCardPreferences } from '~/hooks/use-course-card-preferences'
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
  type CourseCardPreference,
} from '~/lib/courses/course-card-preferences'
import {
  PolicyTooltip,
  usePolicyGate,
  DEFAULT_POLICY_DISABLED_MESSAGE,
  type PolicyKey,
} from '~/components/policy/policy-gate'

interface Instructor {
  id: string
  name: string | null
  email: string
}

/** Effective role this view is rendered for — one config/branch per role (#1087 Group A). */
export type CoursesRole = 'admin' | 'unit-admin' | 'instructor' | 'mixed'

interface MutableRoleProps {
  courses: Course[]
  instructors?: Instructor[]
  onCreateCourse: (data: CreateCourseInput) => Promise<void>
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
  onDeleteCourse: (id: string) => Promise<void>
  onPublishToggle: (id: string, publish: boolean) => Promise<void>
}

interface AdminViewProps extends MutableRoleProps {
  role: 'admin'
}

interface UnitAdminViewProps extends MutableRoleProps {
  role: 'unit-admin'
  /** Already filtered to this unit's courses by the route. */
  authorizedUnits: string[]
}

interface InstructorViewProps extends MutableRoleProps {
  role: 'instructor'
}

interface MixedViewProps {
  role: 'mixed'
  courses: Course[]
  taCourseIds: string[]
  enrolledCourseIds: string[]
}

export type CoursesViewProps = AdminViewProps | UnitAdminViewProps | InstructorViewProps | MixedViewProps

/**
 * Shared per-role config for the parts of the list that are purely
 * declarative — heading text, which filter dimensions to show (and in what
 * order), how sections are grouped, and which card actions apply (with their
 * policy gates). Anything too entangled to express here (create-form fields,
 * dialog copy, unit-admin's authorized-department logic) stays as a small
 * per-role render branch below instead of being forced into this shape.
 */
interface CardActionConfig {
  showPublish: boolean
  publishPolicyFlag?: PolicyKey
  showEdit: boolean
  showDelete: boolean
  deletePolicyFlag?: PolicyKey
}

interface RoleListConfig {
  heading: string
  /** Department filter uses friendly labels (admin/unit-admin) vs raw codes (instructor). */
  departmentOptionLabel: boolean
  cardActions: CardActionConfig
}

export const COURSES_ROLE_CONFIG: Record<'admin' | 'unit-admin' | 'instructor', RoleListConfig> = {
  admin: {
    heading: 'Courses',
    departmentOptionLabel: true,
    cardActions: { showPublish: true, showEdit: true, showDelete: true },
  },
  'unit-admin': {
    heading: 'Courses',
    departmentOptionLabel: true,
    // §2 / issue #807: delete stays visible, greyed when the policy is off.
    cardActions: { showPublish: true, showEdit: true, showDelete: true, deletePolicyFlag: 'unitAdmins.canDeleteCourses' },
  },
  instructor: {
    heading: 'My Courses',
    departmentOptionLabel: false,
    // §2 / issue #807: keep publish & delete visible but greyed-out when the
    // instructor's policy flag is off, so the missing action reads as "admin
    // turned this off", not a bug.
    cardActions: {
      showPublish: true,
      publishPolicyFlag: 'instructors.canPublishCourses',
      showEdit: true,
      showDelete: true,
      deletePolicyFlag: 'instructors.canDeleteCourses',
    },
  },
}

const NO_RESULTS_TEXT = 'No courses match your search.'

function NoResultsCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-8">
        <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{NO_RESULTS_TEXT}</p>
      </CardContent>
    </Card>
  )
}

export function CoursesView(props: CoursesViewProps) {
  switch (props.role) {
    case 'admin':
      return <AdminCoursesBody {...props} />
    case 'unit-admin':
      return <UnitAdminCoursesBody {...props} />
    case 'instructor':
      return <InstructorCoursesBody {...props} />
    case 'mixed':
      return <MixedCoursesBody {...props} />
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

function AdminCoursesBody({ courses, instructors = [], onCreateCourse, onEditCourse, onDeleteCourse, onPublishToggle }: AdminViewProps) {
  const config = COURSES_ROLE_CONFIG.admin
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [createDept, setCreateDept] = useState<string>('')
  const [selectedTerm, setSelectedTerm] = useState<string>(() => termFromDate(new Date()))
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
    setSelectedTerm(termFromDate(new Date()))
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeading heading={config.heading} subheading="Manage all courses in the system" />

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
        noResultsState={<NoResultsCard />}
        renderCard={(course) => (
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
              showPublish: config.cardActions.showPublish,
              isPublished: course.isPublished,
              onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
              showEdit: config.cardActions.showEdit,
              onEdit: () => setTimeout(() => setEditingCourse(course), 0),
              showDelete: config.cardActions.showDelete,
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

// ---------------------------------------------------------------------------
// Unit admin
// ---------------------------------------------------------------------------

function UnitAdminCoursesBody({
  courses,
  authorizedUnits,
  instructors = [],
  onCreateCourse,
  onEditCourse,
  onDeleteCourse,
  onPublishToggle,
}: UnitAdminViewProps) {
  const config = COURSES_ROLE_CONFIG['unit-admin']
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
  const canDelete = config.cardActions.deletePolicyFlag
    ? isEnabled(config.cardActions.deletePolicyFlag)
    : true
  const [selectedDept, setSelectedDept] = useState<string>(authorizedDepts[0]?.code ?? '')
  const [selectedTerm, setSelectedTerm] = useState<string>(() => termFromDate(new Date()))
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
    setSelectedTerm(termFromDate(new Date()))
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeading heading={config.heading} subheading={<>Managing: <span className="font-medium">{unitLabel}</span></>} />

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
        noResultsState={<NoResultsCard />}
        renderCard={(course) => (
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
              showPublish: config.cardActions.showPublish,
              isPublished: course.isPublished,
              onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
              showEdit: config.cardActions.showEdit,
              onEdit: () => setTimeout(() => setEditingCourse(course), 0),
              // §2 / issue #807: delete stays visible, greyed when the policy is off.
              showDelete: config.cardActions.showDelete,
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

// ---------------------------------------------------------------------------
// Instructor
// ---------------------------------------------------------------------------

function InstructorCoursesBody({ courses, onCreateCourse, onEditCourse, onDeleteCourse, onPublishToggle }: InstructorViewProps) {
  const config = COURSES_ROLE_CONFIG.instructor
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [selectedDept, setSelectedDept] = useState<string>('')
  const [selectedTerm, setSelectedTerm] = useState<string>(() => termFromDate(new Date()))
  const { options: departmentOptions, loading: deptLoading } = useDisciplines()

  const { isEnabled } = usePolicyGate()
  // Mirror the backend policy gates. Instead of hiding controls an admin turned
  // off (which reads as a bug — issue #807), we keep them visible but greyed-out
  // with a tooltip. While policies load these report enabled, so an admin-on
  // control never flickers to disabled.
  const canCreate = isEnabled('instructors.canCreateCourses')
  const canPublish = config.cardActions.publishPolicyFlag
    ? isEnabled(config.cardActions.publishPolicyFlag)
    : true
  const canDelete = config.cardActions.deletePolicyFlag
    ? isEnabled(config.cardActions.deletePolicyFlag)
    : true

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
    setSelectedTerm(termFromDate(new Date()))
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
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeading heading={config.heading} subheading="Courses you are teaching" />

        {!canCreate ? (
          <PolicyTooltip flag="instructors.canCreateCourses">
            <Button>
              <IconPlus className="w-4 h-4 mr-2" />
              Create course
            </Button>
          </PolicyTooltip>
        ) : (
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
                  <Label htmlFor="ins-dept">Course Code</Label>
                  <DepartmentCombobox
                    departments={departmentOptions}
                    value={selectedDept}
                    onValueChange={setSelectedDept}
                    placeholder="No course code"
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

      <CourseListView<Course>
        courses={courses}
        gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        getKey={(course) => course.id}
        getTermInfo={(course) => ({ term: course.term, year: course.year, startDate: course.startDate })}
        getSearchText={(course) => `${course.name} ${course.code}`}
        filterGroups={[
          buildStatusFilterGroup<Course>((c) => c.isPublished),
          buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
          buildDepartmentFilterGroup<Course>((c) => c.department),
        ]}
        emptyState={
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">You have no courses assigned yet.</p>
              {canCreate ? (
                <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                  <IconPlus className="w-4 h-4 mr-2" />
                  Create first course
                </Button>
              ) : (
                <PolicyTooltip flag="instructors.canCreateCourses">
                  <Button className="mt-4">
                    <IconPlus className="w-4 h-4 mr-2" />
                    Create first course
                  </Button>
                </PolicyTooltip>
              )}
            </CardContent>
          </Card>
        }
        noResultsState={<NoResultsCard />}
        renderCard={(course) => (
          <CourseCard
            id={course.id}
            code={course.code}
            name={course.name}
            description={course.description}
            term={course.term}
            year={course.year}
            isPublished={course.isPublished}
            department={course.department}
            colorIndex={defaultColorIndexForCourse(course.id)}
            href={`/courses/${course.id}`}
            LinkComponent={Link}
            actions={{
              showPublish: config.cardActions.showPublish,
              isPublished: course.isPublished,
              onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
              publishDisabled: !canPublish,
              publishDisabledReason: DEFAULT_POLICY_DISABLED_MESSAGE,
              showEdit: config.cardActions.showEdit,
              onEdit: () => setTimeout(() => setEditingCourse(course), 0),
              showDelete: config.cardActions.showDelete,
              onDelete: () => setTimeout(() => setDeletingCourse(course), 0),
              deleteDisabled: !canDelete,
              deleteDisabledReason: DEFAULT_POLICY_DISABLED_MESSAGE,
            }}
          />
        )}
      />

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

// ---------------------------------------------------------------------------
// Mixed (TA-assisting + enrolled) — read-only, dual-section
// ---------------------------------------------------------------------------

function MixedCourseSection({
  heading,
  subheading,
  courses,
  extraBadges,
  getCoursePreference,
  setCoursePreference,
}: {
  heading: string
  subheading: string
  courses: Course[]
  extraBadges: string[]
  getCoursePreference: (courseId: string) => CourseCardPreference | undefined
  setCoursePreference: (courseId: string, update: CourseCardPreference | null) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading heading={heading} subheading={subheading} />
      <CourseListView<Course>
        courses={courses}
        gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        getKey={(course) => course.id}
        getTermInfo={(course) => ({ term: course.term, year: course.year, startDate: course.startDate })}
        getSearchText={(course) => `${course.name} ${course.code}`}
        filterGroups={[
          buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
          buildDepartmentFilterGroup<Course>((c) => c.department),
          buildStatusFilterGroup<Course>((c) => c.isPublished),
        ]}
        noResultsState={<NoResultsCard />}
        renderCard={(course) => {
          const preference = getCoursePreference(course.id)
          const accentColor = resolveCourseAccentColor(course.id, preference)
          const displayName = getCourseDisplayName(course.name, preference)
          return (
            <CourseCard
              id={course.id}
              code={course.code}
              name={course.name}
              displayName={displayName}
              description={course.description}
              term={course.term}
              year={course.year}
              isPublished={course.isPublished}
              department={course.department}
              extraBadges={extraBadges}
              colorIndex={defaultColorIndexForCourse(course.id)}
              accentColor={accentColor}
              heroAction={
                <CourseCardCustomizePopover
                  courseName={course.name}
                  courseCode={course.code}
                  preference={preference}
                  onApply={(update) => setCoursePreference(course.id, update)}
                />
              }
              href={`/courses/${course.id}`}
              LinkComponent={Link}
            />
          )
        }}
      />
    </div>
  )
}

function MixedCoursesBody({ courses, taCourseIds, enrolledCourseIds }: MixedViewProps) {
  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences()
  const assisting = courses.filter((c) => taCourseIds.includes(c.id))
  const enrolled = courses.filter(
    (c) => enrolledCourseIds.includes(c.id) && c.isPublished,
  )

  if (assisting.length === 0 && enrolled.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading heading="My Courses" subheading="Your courses" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses yet.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {assisting.length > 0 && (
        <MixedCourseSection
          heading="Courses You Are Assisting In"
          subheading="Courses where you are a TA"
          courses={assisting}
          extraBadges={['TA']}
          getCoursePreference={getCoursePreference}
          setCoursePreference={setCoursePreference}
        />
      )}
      {enrolled.length > 0 && (
        <MixedCourseSection
          heading="Courses You Are Enrolled In"
          subheading="Courses you are taking as a student"
          courses={enrolled}
          extraBadges={['Enrolled']}
          getCoursePreference={getCoursePreference}
          setCoursePreference={setCoursePreference}
        />
      )}
    </div>
  )
}
