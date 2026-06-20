import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCourseEnrollments } from '~/hooks/api/use-course-enrollments'

describe('useCourseEnrollments', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads enrollments from GET /api/courses/:id/enrollments', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          enrollments: [
            {
              id: 'enr-1',
              studentId: 'user-1',
              studentEmail: 'student@test.com',
              studentName: 'Student One',
              studentNumber: null,
              role: 'STUDENT',
              isActive: true,
              enrolledAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const { result } = renderHook(() => useCourseEnrollments('course-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.enrollments).toEqual([
      {
        id: 'enr-1',
        courseId: 'course-1',
        userId: 'user-1',
        userEmail: 'student@test.com',
        userName: 'Student One',
        studentNumber: null,
        role: 'STUDENT',
        isActive: true,
        enrolledAt: '2025-01-01T00:00:00.000Z',
      },
    ])
    expect(fetch).toHaveBeenCalledWith('/api/courses/course-1/enrollments')
  })

  it('POSTs enroll and refetches', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ enrollments: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'enr-2' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ enrollments: [] }), { status: 200 }))

    const { result } = renderHook(() => useCourseEnrollments('course-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.enroll('user-2', 'STUDENT')
    })

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/courses/course-1/enrollments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'user-2', role: 'STUDENT' }),
      }),
    )
  })

  it('DELETEs enrollment by id', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            enrollments: [
              {
                id: 'enr-1',
                studentId: 'user-1',
                studentEmail: 'student@test.com',
                studentName: 'Student One',
                studentNumber: null,
                role: 'STUDENT',
                isActive: true,
                enrolledAt: null,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { result } = renderHook(() => useCourseEnrollments('course-1'))

    await waitFor(() => {
      expect(result.current.enrollments).toHaveLength(1)
    })

    await act(async () => {
      await result.current.removeEnrollment('enr-1')
    })

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/courses/course-1/enrollments/enr-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.current.enrollments).toHaveLength(0)
  })
})
