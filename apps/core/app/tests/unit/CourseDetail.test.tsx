import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CourseDetailManagerView } from '~/components/courses/course-detail-manager-view'
import { CourseDetailTaView } from '~/components/courses/course-detail-ta-view'
import { CourseDetailStudentView } from '~/components/courses/course-detail-student-view'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import type { CourseMaterial } from '~/hooks/api/use-course-materials'
import type { CourseTopic } from '~/hooks/api/use-course-topics'

// TabsContent uses forceMount so all content is always in DOM.

vi.mock('~/hooks/use-api-keys', () => ({
  useApiKeys: () => ({ apiKeys: {} }),
}))

vi.mock('~/components/course-materials-upload', () => ({
  CourseMaterialsUpload: () => <div data-testid="upload-widget">Upload widget</div>,
}))

// No PolicyProvider is rendered, so usePolicyGate falls back to the empty
// context and every flag resolves to its code default — which is what these
// assertions expect (e.g. tas.canManageTopics defaults off → greyed).

const COURSE: CourseDetail = {
  id: 'c1',
  code: 'COSC 101',
  name: 'Intro to CS',
  description: 'A great course',
  term: 'Fall',
  year: 2025,
  isActive: true,
  aiInstructions: 'Be helpful',
  instructorId: 'user-instructor',
  department: 'COSC',
  startDate: '2025-09-01',
  endDate: '2025-12-15',
  isPublished: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const MATERIAL: CourseMaterial = {
  id: 'm1',
  courseId: 'c1',
  title: 'Lecture 1',
  mimeType: 'application/pdf',
  fileSize: 1024,
  status: 'READY',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  processedAt: null,
}

const TOPIC: CourseTopic = {
  id: 't1',
  courseId: 'c1',
  name: 'Variables',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const NOOP = async () => {}
const onFileSelect = vi.fn()
const STAFF_PROPS = {
  tas: [],
  instructors: [],
  onAssignInstructor: NOOP,
  onAddTA: NOOP,
  onRemoveTA: NOOP,
  onEnrollStudent: NOOP,
  onRemoveEnrollment: NOOP,
}

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// Manager view (admin / unit / instructor)
describe('CourseDetailManagerView', () => {
  it('shows all four tabs including Enrollments', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /materials/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /topics/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /enrollments/i })).toBeInTheDocument()
  })

  it('renders "Upload material" button in Materials content', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.getAllByRole('button', { name: /upload material/i }).length).toBeGreaterThan(0)
  })

  it('shows topic "Add" form in Topics content for instructor', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.getByPlaceholderText(/new topic name/i)).toBeInTheDocument()
    // Exact match: the staff tab also renders an "Add TAs" search-select button
    // (#1042), which would also match a loose /add/i query.
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('does NOT show topic "Add" form for unit access (no canManageTopics false path needed — unit CAN manage)', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="unit"
        topics={[TOPIC]}
        enrollments={[]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    // unit access can manage topics
    expect(screen.getByPlaceholderText(/new topic name/i)).toBeInTheDocument()
  })

  it('shows remove control for student enrollments when instructor can manage students', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[
          {
            id: 'enr-1',
            courseId: 'c1',
            userId: 'student-1',
            userEmail: 'student@test.com',
            userName: 'Student One',
            studentNumber: null,
            role: 'STUDENT',
            isActive: true,
            enrolledAt: null,
          },
        ]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.getByRole('button', { name: /remove student/i })).toBeInTheDocument()
  })

  it('shows student number when enrollment includes one', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[
          {
            id: 'enr-1',
            courseId: 'c1',
            userId: 'student-1',
            userEmail: 'student@test.com',
            userName: 'Student One',
            studentNumber: '12345678',
            role: 'STUDENT',
            isActive: true,
            enrolledAt: null,
          },
        ]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.getByText(/Student #12345678/)).toBeInTheDocument()
  })

  it('does not show instructor section on Enrollments tab', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[
          {
            id: 'enr-inst',
            courseId: 'c1',
            userId: 'user-instructor',
            userEmail: 'inst@test.com',
            userName: 'Dr. Instructor',
            studentNumber: null,
            role: 'INSTRUCTOR',
            isActive: true,
            enrolledAt: null,
          },
        ]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.queryByText('No instructors enrolled.')).not.toBeInTheDocument()
    expect(screen.queryByText('Dr. Instructor')).not.toBeInTheDocument()
  })
})

// TA view
const TA_PROPS = {
  onCreateTopic: NOOP,
  onDeleteTopic: NOOP,
}

describe('CourseDetailTaView', () => {
  it('does NOT show Enrollments tab (§6)', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[]}
        materials={[]}
        onFileSelect={onFileSelect}
        {...TA_PROPS}
      />
    )
    expect(screen.queryByRole('tab', { name: /enrollments/i })).not.toBeInTheDocument()
  })

  it('renders "Upload material" button in Materials content', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[]}
        materials={[]}
        onFileSelect={onFileSelect}
        {...TA_PROPS}
      />
    )
    expect(screen.getAllByRole('button', { name: /upload material/i }).length).toBeGreaterThan(0)
  })

  it('shows the topic add form greyed-out (disabled, not hidden) when canManageTopics is off (#807)', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[TOPIC]}
        materials={[]}
        onFileSelect={onFileSelect}
        {...TA_PROPS}
      />
    )
    // §807: the form stays visible but inert so the TA sees the capability exists.
    const input = screen.getByPlaceholderText(/new topic name/i)
    expect(input).toBeInTheDocument()
    expect(input).toBeDisabled()
  })

  it('shows topic names read-only', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[TOPIC]}
        materials={[]}
        onFileSelect={onFileSelect}
        {...TA_PROPS}
      />
    )
    // Topic name appears in both the hero quick-chips and the Topics tab
    expect(screen.getAllByText('Variables').length).toBeGreaterThan(0)
  })
})

// Student view
describe('CourseDetailStudentView', () => {
  it('does NOT show Enrollments tab', () => {
    wrap(<CourseDetailStudentView course={COURSE} materials={[]} topics={[]} />)
    expect(screen.queryByRole('tab', { name: /enrollments/i })).not.toBeInTheDocument()
  })

  it('does NOT render upload widget', () => {
    wrap(<CourseDetailStudentView course={COURSE} materials={[]} topics={[]} />)
    expect(screen.queryByTestId('upload-widget')).not.toBeInTheDocument()
  })

  it('does NOT render upload widget for students when upload policy is disabled even if onFileSelect is provided', () => {
  wrap(
    <CourseDetailStudentView
      course={COURSE}
      materials={[]}
      topics={[]}
      onFileSelect={onFileSelect}
    />
  )

  expect(screen.queryByTestId('upload-widget')).not.toBeInTheDocument()
})

  it('does NOT have a Topics management tab', () => {
    wrap(<CourseDetailStudentView course={COURSE} materials={[]} topics={[TOPIC]} />)
    expect(screen.queryByRole('tab', { name: /^topics$/i })).not.toBeInTheDocument()
    // Topic names shown as badges in Overview
    expect(screen.getByText('Variables')).toBeInTheDocument()
  })

  it('shows materials read-only with preview for ready files', () => {
    wrap(
      <CourseDetailStudentView
        course={COURSE}
        materials={[MATERIAL]}
        topics={[]}
      />
    )
    expect(screen.getByRole('button', { name: 'Lecture 1' })).toBeInTheDocument()
  })
})
