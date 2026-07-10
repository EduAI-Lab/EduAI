import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CoursesAdminView } from '~/components/courses/courses-admin-view'
import { CoursesUnitAdminView } from '~/components/courses/courses-unit-admin-view'
import { CoursesInstructorView } from '~/components/courses/courses-instructor-view'
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
import { PolicyProvider, type PolicyValues } from '~/components/policy/policy-gate'
import type { Course } from '~/hooks/api/use-courses'
import { UiPreferencesProvider } from '~/components/assistive/ui-preferences-provider'

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

const SPRING_COURSE: Course = {
  ...PUBLISHED_COURSE,
  id: 'c4',
  code: 'COSC 301',
  name: 'Algorithms',
  term: 'Spring',
}

const NOOP = async () => {}

function wrap(ui: React.ReactElement, policies: PolicyValues = {}) {
  return render(
    <MemoryRouter>
      <PolicyProvider policies={policies}>{ui}</PolicyProvider>
    </MemoryRouter>
  )
}

function wrapStudent(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <UiPreferencesProvider initialMotionReduced initialDensity="comfortable">
        {ui}
      </UiPreferencesProvider>
    </MemoryRouter>,
  )
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
})

// CoursesTaView
describe('CoursesTaView', () => {
  it('does NOT show "Create Course" button', () => {
    wrap(<CoursesTaView courses={[PUBLISHED_COURSE]} />)
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('shows no action buttons', () => {
    wrap(<CoursesTaView courses={[PUBLISHED_COURSE]} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

// CoursesStudentView
describe('CoursesStudentView', () => {
  it('does NOT show "Create Course" button', () => {
    wrapStudent(<CoursesStudentView courses={[PUBLISHED_COURSE]} />)
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('hides draft (unpublished) courses', () => {
    wrapStudent(<CoursesStudentView courses={[PUBLISHED_COURSE, DRAFT_COURSE]} />)
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.queryByText('COSC 201')).not.toBeInTheDocument()
  })

  it('shows empty state when no published courses', () => {
    wrapStudent(<CoursesStudentView courses={[DRAFT_COURSE]} />)
    expect(screen.getByText(/no published courses available/i)).toBeInTheDocument()
  })

  it('filters courses via the shared search box', () => {
    wrapStudent(<CoursesStudentView courses={[PUBLISHED_COURSE, SPRING_COURSE]} />)
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search courses'), { target: { value: '301' } })
    expect(screen.queryByText('COSC 101')).not.toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
  })
})
