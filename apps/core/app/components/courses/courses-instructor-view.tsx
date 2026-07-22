import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { IconBook, IconPlus } from '@tabler/icons-react'
import {
  Button,
  Card,
  CardContent,
  CourseCard,
  CourseListView,
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
  buildStatusFilterGroup,
  buildTermFilterGroup,
  buildDepartmentFilterGroup,
  defaultColorIndexForCourse,
} from '@eduai/ui'
import { TERM_CODES, termName, termFromDate, termInfoFromDate } from '@eduai/ui'
import { useDisciplines } from '~/hooks/api/use-disciplines'
import { DepartmentCombobox } from '~/components/courses/department-combobox'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'
import { buildDateListSections } from '~/lib/courses/date-list-sections'
import {
  PolicyTooltip,
  usePolicyGate,
  DEFAULT_POLICY_DISABLED_MESSAGE,
} from '~/components/policy/policy-gate'

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
  const [selectedTerm, setSelectedTerm] = useState<string>(() => termFromDate(new Date()))
  const { options: departmentOptions, loading: deptLoading } = useDisciplines()

  const { isEnabled } = usePolicyGate()
  // Mirror the backend policy gates. Instead of hiding controls an admin turned
  // off (which reads as a bug ΓÇö issue #807), we keep them visible but greyed-out
  // with a tooltip. While policies load these report enabled, so an admin-on
  // control never flickers to disabled.
  const canCreate = isEnabled('instructors.canCreateCourses')
  const canPublish = isEnabled('instructors.canPublishCourses')
  const canDelete = isEnabled('instructors.canDeleteCourses')

  // Safety cleanup: if the Radix DropdownMenuΓåÆDialog lifecycle race left
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
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <PageHeading heading="My Courses" subheading="Courses you are teaching" />

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
                      {selectedDept || 'ΓÇö'}
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
        groupSections={buildDateListSections}
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
            colorIndex={defaultColorIndexForCourse(course.id)}
            href={`/courses/${course.id}`}
            LinkComponent={Link}
            actions={{
              // ┬º2 / issue #807: keep publish & delete visible but greyed-out
              // when the instructor's policy flag is off, so the missing action
              // reads as "admin turned this off", not a bug.
              showPublish: true,
              isPublished: course.isPublished,
              onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
              publishDisabled: !canPublish,
              publishDisabledReason: DEFAULT_POLICY_DISABLED_MESSAGE,
              showEdit: true,
              onEdit: () => setTimeout(() => setEditingCourse(course), 0),
              showDelete: true,
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
              Delete <strong>{deletingCourse?.code} ΓÇö {deletingCourse?.name}</strong>? This cannot be undone.
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
