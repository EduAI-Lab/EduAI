// No GET /api/courses/:id endpoint — detail data comes from the route loader.
import { useLoaderData } from 'react-router'
import type { Course } from './use-courses'

export interface CourseDetail extends Course {
  ragTopK?: number | null
  ragSimilarityThreshold?: number | null
  instructor?: { id: string; name: string; email: string }
  tas?: Array<{ id: string; userId: string; user: { id: string; name: string; email: string } }>
}

export function useCourseDetail<T extends CourseDetail = CourseDetail>() {
  return useLoaderData<{ course: T }>()
}
