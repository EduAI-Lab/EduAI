import { useCallback, useEffect, useState } from 'react';
import type { QmCourseAccess } from '@/lib/rbac';
import { courseService } from '@/services/courseService';

/** Fetches per-course access from GET /api/course/:id/access for UI gating. */
export function useCourseAccess(courseId: number | null | undefined) {
  const [access, setAccess] = useState<QmCourseAccess | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (courseId == null || !Number.isFinite(courseId) || courseId <= 0) {
      setAccess(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const level = await courseService.getCourseAccess(courseId);
      setAccess(level);
    } catch {
      setAccess(null);
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { access, isLoading, refresh };
}
