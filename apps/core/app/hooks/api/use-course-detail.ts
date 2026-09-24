// Browser detail data comes from the route loader, whose DTO mirrors the
// role-aware GET /api/courses/:id contract without exposing private fields.
import { useLoaderData } from "react-router";
import type { Course } from "./use-courses";

/** One instructor of record. `email` is null for student audiences (#1841). */
export interface CourseDetailInstructor {
  id: string;
  name: string;
  email: string | null;
  isPrimary: boolean;
}

export interface CourseDetail extends Omit<Course, "aiInstructions"> {
  aiInstructions?: string;
  ragTopK?: number | null;
  ragSimilarityThreshold?: number | null;
  responseStyleTags?: string[];
  /** Instructor-facing course-scope classifier toggle; hidden from students. */
  courseScopeGuardrailEnabled?: boolean;
  /** Set by the course detail loader for students — raw aiInstructions are staff-only. */
  hasAiConfig?: boolean;
  /** #1841: `email` is null for students, like every entry in `instructors`. */
  instructor?: { id?: string; name: string; email: string | null } | null;
  /**
   * #1841: every active instructor on the course. `instructor` above remains
   * the single course head for the consumers that already read it. Optional
   * because a payload serialized without `detail` carries neither.
   */
  instructors?: CourseDetailInstructor[];
  externalSource?: string | null;
  externalId?: string | null;
  tas?: Array<{ id: string; userId: string; user: { id: string; name: string; email: string } }>;
}

export function useCourseDetail<T extends CourseDetail = CourseDetail>() {
  return useLoaderData<{ course: T }>();
}
