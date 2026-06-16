// STUB: all enrollment operations pending #305 (enrollment API for Core)
import { FIXTURE_ENROLLMENTS } from './fixtures/courses/enrollments'

export const STUB_ONLY = {
  enrollments: true, // pending #305
} as const

export interface CourseEnrollment {
  id: string
  courseId: string
  userId: string
  userEmail: string
  userName: string
  role: 'INSTRUCTOR' | 'TA' | 'STUDENT'
  isActive: boolean
  enrolledAt: string
}

export function useCourseEnrollments(_courseId: string) {
  return {
    enrollments: FIXTURE_ENROLLMENTS,
    loading: false,
    error: null,
    enroll: async (_userId: string, _role: CourseEnrollment['role']): Promise<void> => {
      console.warn('enroll is a stub — pending #305')
      throw new Error('Enrollment management not yet available')
    },
    removeEnrollment: async (_enrollmentId: string): Promise<void> => {
      console.warn('removeEnrollment is a stub — pending #305')
      throw new Error('Enrollment management not yet available')
    },
    updateRole: async (_enrollmentId: string, _role: CourseEnrollment['role']): Promise<void> => {
      console.warn('updateRole is a stub — pending #305')
      throw new Error('Enrollment management not yet available')
    },
  }
}
