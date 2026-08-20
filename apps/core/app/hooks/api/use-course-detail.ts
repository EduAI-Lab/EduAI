// Browser detail data comes from the route loader, whose DTO mirrors the
// role-aware GET /api/courses/:id contract without exposing private fields.
import { useLoaderData } from "react-router";
import type { Course } from "./use-courses";

export interface CourseDetail extends Omit<Course, "aiInstructions"> {
  aiInstructions?: string;
  ragTopK?: number | null;
  ragSimilarityThreshold?: number | null;
  responseStyleTags?: string[];
  /** Instructor-facing course-scope classifier toggle; hidden from students. */
  courseScopeGuardrailEnabled?: boolean;
  /** Set by the course detail loader for students — raw aiInstructions are staff-only. */
  hasAiConfig?: boolean;
  instructor?: { id?: string; name: string; email: string } | null;
  externalSource?: string | null;
  externalId?: string | null;
  tas?: Array<{ id: string; userId: string; user: { id: string; name: string; email: string } }>;
}

export function useCourseDetail<T extends CourseDetail = CourseDetail>() {
  return useLoaderData<{ course: T }>();
}
