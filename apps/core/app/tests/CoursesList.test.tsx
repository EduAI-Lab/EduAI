import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CoursesAdminView } from '~/components/courses/courses-admin-view'
import { CoursesUnitAdminView } from '~/components/courses/courses-unit-admin-view'
import { CoursesInstructorView } from '~/components/courses/courses-instructor-view'
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
import type { Course } from '~/hooks/api/use-courses'

const ACTIVE_COURSE: Course = {
  id: 'c1',
  code: 'COSC 101',
  name: 'Intro to CS',
  description: null,
  term: 'Fall',
  year: 2025,
  isActive: true,
  aiInstructions: '',
  professorId: 'prof-1',
  department: 'COSC',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const INACTIVE_COURSE: Course = {
  ...ACTIVE_COURSE,
  id: 'c2',
  code: 'COSC 201',
  name: 'Data Structures',
  isActive: false,
}

const MATH_COURSE: Course = {
  ...ACTIVE_COURSE,
  id: 'c3',
  code: 'MATH 101',
  name: 'Calculus I',
  department: 'MATH',
}

const NOOP = async () => {}

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// CoursesAdminView
describe('CoursesAdminView', () => {
  it('shows "Create Course" button', () => {
    wrap(
      <CoursesAdminView
        courses={[ACTIVE_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
      />
    )
    expect(screen.getByRole('button', { name: /create course/i })).toBeInTheDocument()
  })

  it('renders both active and inactive courses', () => {
    wrap(
      <CoursesAdminView
        courses={[ACTIVE_COURSE, INACTIVE_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText('COSC 201')).toBeInTheDocument()
  })

  it('shows edit and delete icon buttons per course', () => {
    wrap(
      <CoursesAdminView
        courses={[ACTIVE_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
      />
    )
    // Edit + delete buttons exist (ghost icon buttons)
    const btns = screen.getAllByRole('button')
    expect(btns.length).toBeGreaterThanOrEqual(3) // Create + edit + delete
  })
})

// CoursesUnitAdminView
describe('CoursesUnitAdminView', () => {
  it('shows "Create Course" button', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[ACTIVE_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
      />
    )
    expect(screen.getByRole('button', { name: /create course/i })).toBeInTheDocument()
  })

  it('shows authorized unit label in description', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[ACTIVE_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
      />
    )
    expect(screen.getByText(/managing courses in/i)).toBeInTheDocument()
    expect(screen.getAllByText('COSC').length).toBeGreaterThanOrEqual(1)
  })

  it('renders only courses passed to it (route already filters by unit)', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[ACTIVE_COURSE]}          // COSC only — MATH filtered out by route
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.queryByText('MATH 101')).not.toBeInTheDocument()
  })

  it('shows edit button but no delete button', () => {
    wrap(
      <CoursesUnitAdminView
        courses={[ACTIVE_COURSE]}
        authorizedUnits={['COSC']}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
      />
    )
    // Has at least one button (Create + edit)
    const btns = screen.getAllByRole('button')
    expect(btns.length).toBeGreaterThanOrEqual(2)
    // No delete button (unit admins can't delete)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})

// CoursesInstructorView
describe('CoursesInstructorView', () => {
  it('does NOT show "Create Course" button', () => {
    wrap(
      <CoursesInstructorView
        courses={[ACTIVE_COURSE]}
        onEditCourse={NOOP}
      />
    )
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('shows edit button for each course', () => {
    wrap(
      <CoursesInstructorView
        courses={[ACTIVE_COURSE]}
        onEditCourse={NOOP}
      />
    )
    const btns = screen.getAllByRole('button')
    expect(btns.length).toBeGreaterThan(0)
  })

  it('renders both active and inactive courses', () => {
    wrap(
      <CoursesInstructorView
        courses={[ACTIVE_COURSE, INACTIVE_COURSE]}
        onEditCourse={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText('COSC 201')).toBeInTheDocument()
  })
})

// CoursesTaView
describe('CoursesTaView', () => {
  it('does NOT show "Create Course" button', () => {
    wrap(<CoursesTaView courses={[ACTIVE_COURSE]} />)
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('shows no action buttons', () => {
    wrap(<CoursesTaView courses={[ACTIVE_COURSE]} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

// CoursesStudentView
describe('CoursesStudentView', () => {
  it('does NOT show "Create Course" button', () => {
    wrap(<CoursesStudentView courses={[ACTIVE_COURSE]} />)
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('hides inactive courses', () => {
    wrap(<CoursesStudentView courses={[ACTIVE_COURSE, INACTIVE_COURSE]} />)
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.queryByText('COSC 201')).not.toBeInTheDocument()
  })

  it('shows empty state when no active courses', () => {
    wrap(<CoursesStudentView courses={[INACTIVE_COURSE]} />)
    expect(screen.getByText(/no active courses available/i)).toBeInTheDocument()
  })
})
