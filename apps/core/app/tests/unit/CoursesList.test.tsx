import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CoursesView, type CoursesViewProps } from '~/components/courses/courses-view'
import { PolicyProvider, type PolicyValues } from '~/components/policy/policy-gate'
import type { Course } from '~/hooks/api/use-courses'

// Thin per-role wrappers over the single role-gated `CoursesView` (#1087 Group A)
// so the test bodies below (unchanged) exercise each role exactly as before.
function CoursesAdminView(props: Omit<Extract<CoursesViewProps, { role: 'admin' }>, 'role'>) {
  return <CoursesView role="admin" {...props} />
}
function CoursesUnitAdminView(props: Omit<Extract<CoursesViewProps, { role: 'unit-admin' }>, 'role'>) {
  return <CoursesView role="unit-admin" {...props} />
}
function CoursesInstructorView(props: Omit<Extract<CoursesViewProps, { role: 'instructor' }>, 'role'>) {
  return <CoursesView role="instructor" {...props} />
}
function CoursesMixedView(props: Omit<Extract<CoursesViewProps, { role: 'mixed' }>, 'role'>) {
  return <CoursesView role="mixed" {...props} />
}

// §541: department labels/options now come from the DB-backed useDisciplines
// hook (previously the static UNIT_OPTIONS). Stub it with a fixed list so the
// views render labels synchronously in tests.
vi.mock('~/hooks/api/use-disciplines', () => {
  const DISCIPLINES = [
    { code: 'COSC', name: 'Computer Science' },
    { code: 'MATH', name: 'Mathematics' },
    { code: 'STAT', name: 'Statistics' },
  ]
  return {
    useDisciplines: () => ({
      disciplines: DISCIPLINES,
      options: DISCIPLINES.map((d) => ({ code: d.code, label: d.name })),
      getLabel: (code: string) => DISCIPLINES.find((d) => d.code === code)?.name ?? code,
      loading: false,
      error: null,
    }),
  }
})

const PUBLISHED_COURSE: Course = {
  id: 'c1',
  code: 'COSC 101',
  name: 'Intro to CS',
  description: null,
  term: 'Fall',
  year: 2025,
  isActive: true,
  isPublished: true,
  aiInstructions: '',
  instructorId: 'prof-1',
  department: 'COSC',
  startDate: '2025-09-01',
  endDate: '2025-12-15',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const DRAFT_COURSE: Course = {
  ...PUBLISHED_COURSE,
  id: 'c2',
  code: 'COSC 201',
  name: 'Data Structures',
  isPublished: false,
}

const MATH_COURSE: Course = {
  ...PUBLISHED_COURSE,
  id: 'c3',
  code: 'MATH 101',
  name: 'Calculus I',
  department: 'MATH',
}

const NOOP = async () => {}

function wrap(ui: React.ReactElement, policies: PolicyValues = {}) {
  return render(
    <MemoryRouter>
      <PolicyProvider policies={policies}>{ui}</PolicyProvider>
    </MemoryRouter>
  )
}

// Some tests below pin the system clock (fake timers) to make term-grouping
// deterministic. Always restore real timers after each test so a fake clock
// never leaks into unrelated tests.
afterEach(() => {
  vi.useRealTimers()
})

// Radix <Select> reads these DOM APIs while opening/positioning its portal
// content; jsdom doesn't implement them. Stub with no-ops so Select
// interactions in the tests below don't throw.
beforeAll(() => {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

/** Opens the "Course actions" dropdown for a card (Radix DropdownMenu — opens on pointerdown). */
function openCourseActions(button: HTMLElement = screen.getByRole('button', { name: /course actions/i })) {
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false })
}

/** Opens our custom `DepartmentCombobox` and clicks an option (selection fires on mousedown, not click). */
function chooseDepartmentCombobox(comboboxTrigger: HTMLElement, optionLabel: string) {
  fireEvent.click(comboboxTrigger)
  fireEvent.mouseDown(screen.getByText(optionLabel))
}

/** Opens a Radix <Select> trigger and picks an option by its accessible (role="option") name. */
async function chooseSelectOption(trigger: HTMLElement, optionName: RegExp) {
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

function submitButtonFor(name: RegExp): HTMLElement {
  return screen.getAllByRole('button', { name }).find((b) => b.getAttribute('type') === 'submit')!
}

/** The "Start date" field has no <Label htmlFor>, so it isn't reachable via getByLabelText. */
function startDateInput(): HTMLInputElement {
  return document.querySelector('input[name="startDate"]') as HTMLInputElement
}

// CoursesAdminView
describe('CoursesAdminView', () => {
  it('shows "Create Course" button', () => {
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByRole('button', { name: /create course/i })).toBeInTheDocument()
  })

  it('renders both published and draft courses', () => {
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE, DRAFT_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText('COSC 201')).toBeInTheDocument()
  })

  it('shows a course actions menu button per course', () => {
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    // Each card has a "Course actions" 3-dot dropdown button
    expect(screen.getByRole('button', { name: /course actions/i })).toBeInTheDocument()
  })
})

// CoursesAdminView — form submission, delete, publish, and empty-state flows
describe('CoursesAdminView — mutation flows', () => {
  const INSTRUCTORS = [{ id: 'i1', name: 'Prof X', email: 'x@example.edu' }]

  it('submits the create form and calls onCreateCourse with the assembled data', async () => {
    const onCreateCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesAdminView
        courses={[]}
        instructors={INSTRUCTORS}
        onCreateCourse={onCreateCourse}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    fireEvent.change(screen.getByLabelText('Course name'), { target: { value: 'New Course' } })

    const combos = screen.getAllByRole('combobox')
    chooseDepartmentCombobox(combos[0], 'Computer Science')

    fireEvent.change(screen.getByLabelText('Course number'), { target: { value: '250' } })
    fireEvent.change(startDateInput(), { target: { value: '2025-09-01' } })

    await chooseSelectOption(screen.getAllByRole('combobox')[2], /prof x/i)

    fireEvent.click(submitButtonFor(/create course/i))

    await waitFor(() => expect(onCreateCourse).toHaveBeenCalledTimes(1))
    expect(onCreateCourse).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Course',
        code: 'COSC 250',
        section: '01',
        department: 'COSC',
        instructorUserIds: ['i1'],
      })
    )
  })

  it('disables the create submit button until department and instructor are chosen', async () => {
    wrap(
      <CoursesAdminView
        courses={[]}
        instructors={INSTRUCTORS}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    expect(submitButtonFor(/create course/i)).toBeDisabled()

    const combos = screen.getAllByRole('combobox')
    chooseDepartmentCombobox(combos[0], 'Computer Science')
    expect(submitButtonFor(/create course/i)).toBeDisabled()

    await chooseSelectOption(screen.getAllByRole('combobox')[2], /prof x/i)
    expect(submitButtonFor(/create course/i)).not.toBeDisabled()
  })

  it('closes the create dialog on Cancel without calling onCreateCourse', () => {
    const onCreateCourse = vi.fn()
    wrap(
      <CoursesAdminView
        courses={[]}
        instructors={INSTRUCTORS}
        onCreateCourse={onCreateCourse}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    expect(screen.getByText('Create new course')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText('Create new course')).not.toBeInTheDocument()
    expect(onCreateCourse).not.toHaveBeenCalled()
  })

  it('opens the edit dialog via the course actions menu, edits the name, and calls onEditCourse', async () => {
    const onEditCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={onEditCourse}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /edit course/i }))
    await waitFor(() => expect(screen.getByDisplayValue(PUBLISHED_COURSE.name)).toBeInTheDocument())

    fireEvent.change(screen.getByDisplayValue(PUBLISHED_COURSE.name), { target: { value: 'Renamed Course' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onEditCourse).toHaveBeenCalledTimes(1))
    expect(onEditCourse).toHaveBeenCalledWith(
      PUBLISHED_COURSE.id,
      expect.objectContaining({ name: 'Renamed Course', code: PUBLISHED_COURSE.code, department: 'COSC' })
    )
  })

  it('closes the edit dialog on Cancel without calling onEditCourse', async () => {
    const onEditCourse = vi.fn()
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={onEditCourse}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /edit course/i }))
    await waitFor(() => expect(screen.getByText('Edit course')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(screen.queryByText('Edit course')).not.toBeInTheDocument())
    expect(onEditCourse).not.toHaveBeenCalled()
  })

  it('cancels the delete confirmation without calling onDeleteCourse', async () => {
    const onDeleteCourse = vi.fn()
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={onDeleteCourse}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete course/i }))
    await waitFor(() => expect(screen.getByText('Delete course')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(screen.queryByText('Delete course')).not.toBeInTheDocument())
    expect(onDeleteCourse).not.toHaveBeenCalled()
  })

  it('confirms deletion and calls onDeleteCourse with the course id', async () => {
    const onDeleteCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={onDeleteCourse}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete course/i }))
    await waitFor(() => expect(screen.getByText('Delete course')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(onDeleteCourse).toHaveBeenCalledWith(PUBLISHED_COURSE.id))
  })

  it('toggles a published course to unpublished via the actions menu', () => {
    const onPublishToggle = vi.fn()
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={onPublishToggle}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /unpublish course/i }))
    expect(onPublishToggle).toHaveBeenCalledWith(PUBLISHED_COURSE.id, false)
  })

  it('toggles a draft course to published via the actions menu', () => {
    const onPublishToggle = vi.fn()
    wrap(
      <CoursesAdminView
        courses={[DRAFT_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={onPublishToggle}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /publish course/i }))
    expect(onPublishToggle).toHaveBeenCalledWith(DRAFT_COURSE.id, true)
  })

  it('shows the zero-courses empty state and opens the create dialog from it', () => {
    wrap(
      <CoursesAdminView
        courses={[]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('No courses yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create your first course/i }))
    expect(screen.getByText('Create new course')).toBeInTheDocument()
  })

  it('shows the no-results state when the search text matches nothing', () => {
    wrap(
      <CoursesAdminView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.change(screen.getByLabelText(/search courses/i), { target: { value: 'nonexistent xyz' } })
    expect(screen.getByText('No courses match your search.')).toBeInTheDocument()
  })
})

// CoursesUnitAdminView
describe('CoursesUnitAdminView', () => {
  it('shows "Create Course" button for authorized unit', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByRole('button', { name: /create course/i })).toBeInTheDocument()
  })

  it('shows authorized unit label including department name', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText(/managing/i)).toBeInTheDocument()
    expect(screen.getAllByText(/computer science/i).length).toBeGreaterThanOrEqual(1)
  })

  it('renders only courses passed to it (route already filters by unit)', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.queryByText('MATH 101')).not.toBeInTheDocument()
  })

  it('shows a course actions menu button per course', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    // Each card has a "Course actions" 3-dot dropdown button
    expect(screen.getByRole('button', { name: /course actions/i })).toBeInTheDocument()
  })

  it('disables Create Course when no authorized units match departments', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={[]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByRole('button', { name: /create course/i })).toBeDisabled()
  })
})

// CoursesUnitAdminView — form submission, delete, publish, and empty-state flows
describe('CoursesUnitAdminView — mutation flows', () => {
  const INSTRUCTORS = [{ id: 'i1', name: 'Prof X', email: 'x@example.edu' }]

  it('shows a readonly course-code field when there is exactly one authorized department', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    const readonlyField = screen.getByDisplayValue('Computer Science (COSC)')
    expect(readonlyField).toHaveAttribute('readonly')
    // Only the department combobox for "no results"? No — a hidden input carries the value.
    expect(document.querySelector('input[type="hidden"][name="department"]')).toHaveValue('COSC')
  })

  it('shows a department combobox (not readonly) when multiple departments are authorized', async () => {
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={['COSC', 'MATH']}
        instructors={INSTRUCTORS}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    expect(screen.queryByDisplayValue(/^Computer Science \(COSC\)$/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })

  it('submits the create form using the selected department when multiple are authorized', async () => {
    const onCreateCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={['COSC', 'MATH']}
        instructors={INSTRUCTORS}
        onCreateCourse={onCreateCourse}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    fireEvent.change(screen.getByLabelText('Course name'), { target: { value: 'Linear Algebra' } })

    const combos = screen.getAllByRole('combobox')
    chooseDepartmentCombobox(combos[0], 'Mathematics')

    fireEvent.change(screen.getByLabelText('Course number'), { target: { value: '200' } })
    fireEvent.change(startDateInput(), { target: { value: '2025-09-01' } })
    await chooseSelectOption(screen.getAllByRole('combobox')[2], /prof x/i)

    fireEvent.click(submitButtonFor(/create course/i))
    await waitFor(() => expect(onCreateCourse).toHaveBeenCalledTimes(1))
    expect(onCreateCourse).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Linear Algebra', code: 'MATH 200', department: 'MATH' })
    )
  })

  it('submits the create form using the single authorized department automatically', async () => {
    const onCreateCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={['COSC']}
        instructors={INSTRUCTORS}
        onCreateCourse={onCreateCourse}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    fireEvent.change(screen.getByLabelText('Course name'), { target: { value: 'Intro CS' } })
    fireEvent.change(screen.getByLabelText('Course number'), { target: { value: '110' } })
    fireEvent.change(startDateInput(), { target: { value: '2025-09-01' } })
    await chooseSelectOption(screen.getAllByRole('combobox')[1], /prof x/i)

    fireEvent.click(submitButtonFor(/create course/i))
    await waitFor(() => expect(onCreateCourse).toHaveBeenCalledTimes(1))
    expect(onCreateCourse).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COSC 110', department: 'COSC' })
    )
  })

  it('opens the edit dialog via the course actions menu and calls onEditCourse', async () => {
    const onEditCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={onEditCourse}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /edit course/i }))
    await waitFor(() => expect(screen.getByDisplayValue(PUBLISHED_COURSE.name)).toBeInTheDocument())
    fireEvent.change(screen.getByDisplayValue(PUBLISHED_COURSE.name), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onEditCourse).toHaveBeenCalledTimes(1))
    expect(onEditCourse).toHaveBeenCalledWith(PUBLISHED_COURSE.id, expect.objectContaining({ name: 'Renamed' }))
  })

  it('confirms deletion and calls onDeleteCourse with the course id', async () => {
    const onDeleteCourse = vi.fn().mockResolvedValue(undefined)
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={onDeleteCourse}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete course/i }))
    await waitFor(() => expect(screen.getByText('Delete course')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(onDeleteCourse).toHaveBeenCalledWith(PUBLISHED_COURSE.id))
  })

  it('cancels the delete confirmation without calling onDeleteCourse', async () => {
    const onDeleteCourse = vi.fn()
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={onDeleteCourse}
        onPublishToggle={NOOP}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete course/i }))
    await waitFor(() => expect(screen.getByText('Delete course')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(screen.queryByText('Delete course')).not.toBeInTheDocument())
    expect(onDeleteCourse).not.toHaveBeenCalled()
  })

  it('toggles publish state via the actions menu', () => {
    const onPublishToggle = vi.fn()
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={onPublishToggle}
      />
    )
    openCourseActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /unpublish course/i }))
    expect(onPublishToggle).toHaveBeenCalledWith(PUBLISHED_COURSE.id, false)
  })

  it('greys out delete (data-disabled) when unitAdmins.canDeleteCourses is off (#807)', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />,
      { 'unitAdmins.canDeleteCourses': false }
    )
    openCourseActions()
    expect(screen.getByRole('menuitem', { name: /delete course/i })).toHaveAttribute('data-disabled')
  })

  it('shows the zero-courses empty state without a create button when no departments are authorized', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={[]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText(/no courses in .* yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create first course/i })).not.toBeInTheDocument()
  })

  it('shows the zero-courses empty state with a working create button when a department is authorized', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /create first course/i }))
    expect(screen.getByText('Create course')).toBeInTheDocument()
  })

  it('shows the no-results state when the search text matches nothing', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[PUBLISHED_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    fireEvent.change(screen.getByLabelText(/search courses/i), { target: { value: 'nonexistent xyz' } })
    expect(screen.getByText('No courses match your search.')).toBeInTheDocument()
  })
})

// CoursesInstructorView
describe('CoursesInstructorView', () => {
  it('shows "Create Course" button when the policy default is on', () => {
    // No overrides seeded → the `?? true` defaults apply, so create is on. Values
    // come from the SSR-seeded PolicyProvider, so this is the first-paint state —
    // there is no loading window and therefore no enabled↔disabled flicker.
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByRole('button', { name: /create course/i })).toBeInTheDocument()
  })

  it('greys out "Create Course" (not hides it) when instructors.canCreateCourses is off (#807)', () => {
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />,
      { 'instructors.canCreateCourses': false }
    )
    const btn = screen.getByRole('button', { name: /create course/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toBeDisabled()
  })

  it('shows a course actions menu button per course', () => {
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    // Actions are in a 3-dot dropdown per card
    expect(screen.getByRole('button', { name: /course actions/i })).toBeInTheDocument()
  })

  it('renders both published and draft courses', () => {
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE, DRAFT_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText('COSC 201')).toBeInTheDocument()
  })

  // #1087 Group A: instructor now uses the same term grouping as admin —
  // older/future terms render as their own term sections with a relative
  // subtitle ("Previous term" / "Upcoming term") instead of date buckets.
  it('labels older-term sections as "Previous term"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const oldCourse = { ...PUBLISHED_COURSE, id: 'old1', code: 'COSC 999', year: 2020, startDate: '2020-09-01', endDate: '2020-12-15' }
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE, oldCourse]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText(/previous term/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 999')).toBeInTheDocument()
  })

  it('labels future-term sections as "Upcoming term"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const futureCourse = { ...PUBLISHED_COURSE, id: 'future1', code: 'COSC 555', term: 'Winter', year: 2025, startDate: '2026-01-01', endDate: '2026-04-15' }
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE, futureCourse]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText(/upcoming term/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 555')).toBeInTheDocument()
  })

  it('labels the department field as "Course Code"', () => {
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    // The label is only in the DOM once the create dialog is open.
    fireEvent.click(screen.getByRole('button', { name: /create course/i }))
    expect(screen.getByText('Course Code')).toBeInTheDocument()
    expect(screen.queryByText('Department')).not.toBeInTheDocument()
  })
})

// CoursesMixedView
describe('CoursesMixedView', () => {
  const TA_COURSE: Course = { ...PUBLISHED_COURSE, id: 'ta1', code: 'COSC 301', name: 'TA Course' }
  const STUDENT_COURSE: Course = { ...PUBLISHED_COURSE, id: 'stu1', code: 'COSC 401', name: 'Student Course' }

  it('does NOT show "Create Course" button', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('shows only the "assisting" section when the user has TA courses only', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText(/assisting/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText('TA')).toBeInTheDocument()
    expect(screen.queryByText(/enrolled/i)).not.toBeInTheDocument()
  })

  it('shows only the "enrolled" section when the user has student courses only', () => {
    wrap(
      <CoursesMixedView
        courses={[STUDENT_COURSE]}
        taCourseIds={[]}
        enrolledCourseIds={['stu1']}
      />
    )
    expect(screen.getByRole('heading', { name: /courses you are enrolled in/i })).toBeInTheDocument()
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
    expect(screen.getByText('Enrolled')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /courses you are assisting in/i })).not.toBeInTheDocument()
  })

  it('shows both sections when the user has both TA and student courses', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, STUDENT_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={['stu1']}
      />
    )
    expect(screen.getByRole('heading', { name: /courses you are assisting in/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /courses you are enrolled in/i })).toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
    expect(screen.getByText('TA')).toBeInTheDocument()
    expect(screen.getByText('Enrolled')).toBeInTheDocument()
  })

  it('hides draft (unpublished) courses from the enrolled section', () => {
    wrap(
      <CoursesMixedView
        courses={[STUDENT_COURSE, { ...STUDENT_COURSE, id: 'stu2', code: 'COSC 402', isPublished: false }]}
        taCourseIds={[]}
        enrolledCourseIds={['stu1', 'stu2']}
      />
    )
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
    expect(screen.queryByText('COSC 402')).not.toBeInTheDocument()
  })

  it('shows empty state when the user has neither TA nor enrolled courses', () => {
    wrap(<CoursesMixedView courses={[]} taCourseIds={[]} enrolledCourseIds={[]} />)
    expect(screen.getByText(/no courses/i)).toBeInTheDocument()
  })

  // #1087 Group A: mixed sections use the same term grouping as every other role.
  it('labels older-term sections as "Previous term" in the assisting section', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const oldTa = { ...TA_COURSE, id: 'ta-old', code: 'COSC 300', year: 2020, startDate: '2020-09-01', endDate: '2020-12-15' }
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, oldTa]}
        taCourseIds={['ta1', 'ta-old']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText(/previous term/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 300')).toBeInTheDocument()
  })

  it('labels future-term sections as "Upcoming term" in the assisting section', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const futureTa = { ...TA_COURSE, id: 'ta-future', code: 'COSC 305', term: 'Winter', year: 2025, startDate: '2026-01-01', endDate: '2026-04-15' }
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, futureTa]}
        taCourseIds={['ta1', 'ta-future']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText(/upcoming term/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 305')).toBeInTheDocument()
  })

  it('does not show a "Previous term" or "Upcoming term" subtitle when all courses are current', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.queryByText(/previous term/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/upcoming term/i)).not.toBeInTheDocument()
  })
})
