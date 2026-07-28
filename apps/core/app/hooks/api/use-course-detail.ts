// No GET /api/courses/:id endpoint — detail data comes from the route loader.
import { useLoaderData } from 'react-router'
import type { Course } from './use-courses'

export interface CourseDetail extends Omit<Course, 'aiInstructions'> {
  aiInstructions?: string
  courseScopeGuardrailEnabled?: boolean
  ragTopK?: number | null
  ragSimilarityThreshold?: number | null
  responseStyleTags?: string[]
  /** Set by the course detail loader for students — raw aiInstructions are staff-only. */
  hasAiConfig?: boolean
  instructor?: { id: string; name: string; email: string } | null
  externalSource?: string | null
  externalId?: string | null
  tas?: Array<{ id: string; userId: string; user: { id: string; name: string; email: string } }>
}

export function useCourseDetail<T extends CourseDetail = CourseDetail>() {
  return useLoaderData<{ course: T }>()
}
