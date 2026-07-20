import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }))

// Capture the onPublishToggle prop wired in by CoursesPage so tests can
// trigger it directly without going through the Radix DropdownMenu.
let capturedPublishToggle: ((id: string, publish: boolean) => Promise<void>) | null = null

vi.mock('~/components/courses/courses-admin-view', () => ({
  CoursesAdminView: (props: any) => {
    capturedPublishToggle = props.onPublishToggle
    return <div data-testid="admin-view" />
  },
}))
vi.mock('~/components/courses/courses-unit-admin-view', () => ({
  CoursesUnitAdminView: () => null,
}))
vi.mock('~/components/courses/courses-instructor-view', () => ({
  CoursesInstructorView: () => null,
}))
vi.mock('~/components/courses/courses-mixed-view', () => ({
  CoursesMixedView: () => null,
}))

vi.mock('~/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('~/components/site-header', () => ({ SiteHeader: () => null }))

// This branch routes the page chrome through CoreAppShell (which calls
// useCoreSidebarProps); stub it to render children only so the courses page
// under test isn't coupled to the shared shell.
vi.mock('~/components/layout/core-app-shell', () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>()
  return {
    ...actual,
    useLoaderData: () => ({
      user: { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com' },
      authorizedUnits: [],
      taCourseIds: [],
      enrolledCourseIds: [],
      instructors: [],
    }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  }
})

const mockUpdateCourse = vi.fn().mockResolvedValue(undefined)

vi.mock('~/hooks/api/use-courses', () => ({
  useCourses: () => ({
    courses: [
      {
        id: 'c1',
        code: 'COSC 101',
        name: 'Intro to CS',
        description: null,
        term: 'Fall',
        year: 2025,
        isActive: true,
        isPublished: true,
        aiInstructions: '',
        instructorId: null,
        department: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    // #1041: the hook now owns one page and the route renders TablePagination.
    total: 1,
    pagination: { pageIndex: 0, pageSize: 25 },
    setPagination: vi.fn(),
    loading: false,
    createCourse: vi.fn(),
    updateCourse: mockUpdateCourse,
    deleteCourse: vi.fn(),
  }),
}))

import CoursesPage from '~/routes/courses'

function wrap() {
  return render(
    <MemoryRouter>
      <CoursesPage />
    </MemoryRouter>,
  )
}

describe('CoursesPage — publish/unpublish confirmation', () => {
  beforeEach(() => {
    capturedPublishToggle = null
    mockUpdateCourse.mockClear()
    mockToastError.mockClear()
  })

  it('triggering unpublish opens a confirmation dialog without calling the API', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', false)
    })

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(mockUpdateCourse).not.toHaveBeenCalled()
  })

  it('dialog shows course label and unpublish-specific copy', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', false)
    })

    expect(screen.getByText(/unpublish "cosc 101 — intro to cs"/i)).toBeInTheDocument()
    expect(screen.getByText(/students will lose access to this course/i)).toBeInTheDocument()
  })

  it('confirming unpublish calls updateCourse with isPublished: false', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', false)
    })

    fireEvent.click(screen.getByRole('button', { name: /^unpublish$/i }))

    expect(mockUpdateCourse).toHaveBeenCalledWith('c1', { isPublished: false })
  })

  it('cancelling unpublish does not call updateCourse', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', false)
    })

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockUpdateCourse).not.toHaveBeenCalled()
  })

  it('triggering publish opens a confirmation dialog without calling the API', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', true)
    })

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(mockUpdateCourse).not.toHaveBeenCalled()
  })

  it('dialog shows course label and publish-specific copy', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', true)
    })

    expect(screen.getByText(/publish "cosc 101 — intro to cs"/i)).toBeInTheDocument()
    expect(screen.getByText(/students will be able to see this course/i)).toBeInTheDocument()
  })

  it('confirming publish calls updateCourse with isPublished: true', async () => {
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', true)
    })

    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))

    expect(mockUpdateCourse).toHaveBeenCalledWith('c1', { isPublished: true })
  })

  it('shows a toast error when updateCourse fails', async () => {
    mockUpdateCourse.mockRejectedValueOnce(new Error('network error'))
    wrap()

    await act(async () => {
      await capturedPublishToggle!('c1', false)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unpublish$/i }))
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/failed/i),
      )
    })
  })
})
