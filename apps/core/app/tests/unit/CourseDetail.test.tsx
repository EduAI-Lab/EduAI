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
  taUsers: [],
  onAssignInstructor: NOOP,
  onAddTA: NOOP,
  onRemoveTA: NOOP,
}

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// Manager view (admin / unit / instructor)
describe('CourseDetailManagerView', () => {
  it('shows enrolled users with student numbers when provided', () => {
    wrap(
      <CourseDetailManagerView
        course={COURSE}
        access="instructor"
        topics={[]}
        enrollments={[
          {
            id: 'e1',
            courseId: 'c1',
            userId: 'u1',
            userEmail: 'student1@example.com',
            userName: 'Student One',
            studentNumber: 'student_1',
            role: 'STUDENT',
            isActive: true,
            enrolledAt: '2025-01-01T00:00:00.000Z',
          },
        ]}
        materials={[]}
        onFileSelect={onFileSelect}
        onCreateTopic={NOOP}
        onDeleteTopic={NOOP}
        {...STAFF_PROPS}
      />
    )
    expect(screen.getByText('Student One')).toBeInTheDocument()
    expect(screen.getByText(/Student number: student_1/i)).toBeInTheDocument()
  })

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

  it('renders CourseMaterialsUpload widget in Materials content', () => {
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
    expect(screen.getByTestId('upload-widget')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
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
})

// TA view
describe('CourseDetailTaView', () => {
  it('does NOT show Enrollments tab', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[]}
        materials={[]}
        onFileSelect={onFileSelect}
      />
    )
    expect(screen.queryByRole('tab', { name: /enrollments/i })).not.toBeInTheDocument()
  })

  it('renders CourseMaterialsUpload widget in Materials content', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[]}
        materials={[]}
        onFileSelect={onFileSelect}
      />
    )
    expect(screen.getByTestId('upload-widget')).toBeInTheDocument()
  })

  it('does NOT show topic add form', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[TOPIC]}
        materials={[]}
        onFileSelect={onFileSelect}
      />
    )
    expect(screen.queryByPlaceholderText(/new topic name/i)).not.toBeInTheDocument()
  })

  it('shows topic names read-only', () => {
    wrap(
      <CourseDetailTaView
        course={COURSE}
        topics={[TOPIC]}
        materials={[]}
        onFileSelect={onFileSelect}
      />
    )
    expect(screen.getByText('Variables')).toBeInTheDocument()
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

  it('does NOT have a Topics management tab', () => {
    wrap(<CourseDetailStudentView course={COURSE} materials={[]} topics={[TOPIC]} />)
    expect(screen.queryByRole('tab', { name: /^topics$/i })).not.toBeInTheDocument()
    // Topic names shown as badges in Overview
    expect(screen.getByText('Variables')).toBeInTheDocument()
  })

  it('shows materials read-only with no action buttons', () => {
    wrap(
      <CourseDetailStudentView
        course={COURSE}
        materials={[MATERIAL]}
        topics={[]}
      />
    )
    expect(screen.getByText('Lecture 1')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
