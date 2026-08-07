/**
 * Topic type used to tag questions and assessments within a course.
 */
export interface Topic {
  id: string;
  name: string;
  description?: string | null;
  courseId: number;
  createdAt: string;
  updatedAt: string;
}
