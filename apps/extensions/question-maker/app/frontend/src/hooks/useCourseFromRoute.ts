/**
 * Hook that resolves the course from URL params (`:courseId`).
 * Returns the Course object, loading state, and not-found state.
 * Used by CourseDetailPage to ensure the course is valid and accessible.
 */
import { useMemo } from 'react';
import { useParams } from 'react-router';
import { Course } from '../types/question';
import { useDisplayCourses } from './useDisplayCourses';

interface UseCourseFromRouteResult {
  course: Course | null;
  courseId: number | null;
  isLoading: boolean;
  notFound: boolean;
}

export function useCourseFromRoute(): UseCourseFromRouteResult {
  const { courseId: courseIdParam } = useParams<{ courseId: string }>();
  const { displayCourses, isLoading } = useDisplayCourses();

  return useMemo<UseCourseFromRouteResult>(() => {
    // Parse courseId from URL param
    if (!courseIdParam) {
      return { course: null, courseId: null, isLoading: false, notFound: true };
    }

    const courseId = Number(courseIdParam);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      return { course: null, courseId: null, isLoading: false, notFound: true };
    }

    // Still loading courses
    if (isLoading) {
      return { course: null, courseId, isLoading: true, notFound: false };
    }

    // Look up course by id in the accessible list
    const course = displayCourses.find((c) => c.id === courseId);
    if (!course) {
      return { course: null, courseId, isLoading: false, notFound: true };
    }

    return { course, courseId, isLoading: false, notFound: false };
  }, [courseIdParam, displayCourses, isLoading]);
}
