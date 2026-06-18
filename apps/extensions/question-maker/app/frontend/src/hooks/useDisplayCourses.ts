/**
 * Loads local QM courses plus the caller's Core course list, then filters to
 * Core-linked (and sandbox) courses when Core enrollments exist.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCourses } from './useCourses';
import { eduaiService } from '../services/eduaiService';
import { filterCoursesForCourseSelection, enrichCoursesWithCoreMetadata } from '../utils/courseDisplay';

export function useDisplayCourses() {
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const [coreCoursesLoaded, setCoreCoursesLoaded] = useState(false);
  const [coreCourses, setCoreCourses] = useState<Awaited<ReturnType<typeof eduaiService.listCourses>>>([]);

  useEffect(() => {
    let isMounted = true;

    const loadCoreCourses = async () => {
      try {
        const options = await eduaiService.listCourses();
        if (isMounted) {
          setCoreCourses(options);
        }
      } catch (err) {
        console.error('Failed to load Core courses for display filter', err);
        if (isMounted) {
          setCoreCourses([]);
        }
      } finally {
        if (isMounted) {
          setCoreCoursesLoaded(true);
        }
      }
    };

    void loadCoreCourses();

    return () => {
      isMounted = false;
    };
  }, []);

  const { courses: filteredCourses, showMockLabel } = useMemo(
    () => filterCoursesForCourseSelection(courses, coreCourses),
    [courses, coreCourses]
  );

  const displayCourses = useMemo(
    () => enrichCoursesWithCoreMetadata(filteredCourses, coreCourses),
    [filteredCourses, coreCourses]
  );

  return {
    courses,
    displayCourses,
    showMockLabel,
    hasCoreCourses: coreCourses.length > 0,
    isLoading: isCoursesLoading || !coreCoursesLoaded,
    fetchCourses,
  };
}

