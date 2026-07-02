import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CoursesAdminView } from '~/components/courses/courses-admin-view'
import { CoursesUnitAdminView } from '~/components/courses/courses-unit-admin-view'
import { CoursesInstructorView } from '~/components/courses/courses-instructor-view'
import { CoursesMixedView } from '~/components/courses/courses-mixed-view'
import type { Course } from '~/hooks/api/use-courses'

// The instructor view gates Create/Publish/Delete on usePolicies(); the controls
// stay hidden until policies load. Default the hook to the loaded state so the
// policy-default tests assert post-fetch behavior; the loading test overrides it.
vi.mock('~/hooks/api/use-policies', () => ({
  usePolicies: vi.fn(() => ({ policies: {}, isLoading: false })),
}))
import { usePolicies } from '~/hooks/api/use-policies'
const mockedUsePolicies = vi.mocked(usePolicies)

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

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// Some tests below pin the system clock (fake timers) to make term-grouping
// deterministic. Always restore real timers after each test so a fake clock
// never leaks into unrelated tests.
afterEach(() => {
  vi.useRealTimers()
})

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

// CoursesInstructorView
describe('CoursesInstructorView', () => {
  beforeEach(() => {
    mockedUsePolicies.mockReturnValue({ policies: {}, isLoading: false } as never)
  })

  it('shows "Create Course" button when policies are loaded and the default is on', () => {
    // Policies loaded with no overrides → the `?? true` defaults apply, so
    // create is on.
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

  it('hides "Create Course" until policies load (no permission flash)', () => {
    mockedUsePolicies.mockReturnValue({ policies: {}, isLoading: true } as never)
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
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

  it('groups older-term courses under "Previous Terms"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const oldCourse = { ...PUBLISHED_COURSE, id: 'old1', code: 'COSC 999', startDate: '2020-01-01', endDate: '2020-04-15' }
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
    expect(screen.getByText(/previous terms/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 999')).toBeInTheDocument()
  })

  it('groups not-yet-started courses under "Upcoming Terms"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const futureCourse = { ...PUBLISHED_COURSE, id: 'future1', code: 'COSC 555', startDate: '2026-01-01', endDate: '2026-04-15' }
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
    expect(screen.getByText(/upcoming terms/i)).toBeInTheDocument()
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
    expect(screen.getByText(/enrolled/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
    expect(screen.queryByText(/assisting/i)).not.toBeInTheDocument()
  })

  it('shows both sections when the user has both TA and student courses', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, STUDENT_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={['stu1']}
      />
    )
    expect(screen.getByText(/assisting/i)).toBeInTheDocument()
    expect(screen.getByText(/enrolled/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
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

  it('groups older-term courses under "Previous Terms" in the assisting section', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const oldTa = { ...TA_COURSE, id: 'ta-old', code: 'COSC 300', startDate: '2020-01-01', endDate: '2020-04-15' }
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, oldTa]}
        taCourseIds={['ta1', 'ta-old']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText(/previous terms/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 300')).toBeInTheDocument()
  })

  it('groups not-yet-started courses under "Upcoming Terms" in the assisting section', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    const futureTa = { ...TA_COURSE, id: 'ta-future', code: 'COSC 305', startDate: '2026-01-01', endDate: '2026-04-15' }
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, futureTa]}
        taCourseIds={['ta1', 'ta-future']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText(/upcoming terms/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 305')).toBeInTheDocument()
  })

  it('does not show a "Previous Terms" or "Upcoming Terms" heading when all courses are current', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-10-15'))
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.queryByText(/previous terms/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/upcoming terms/i)).not.toBeInTheDocument()
  })
})
