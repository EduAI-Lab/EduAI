/**
 * Hook for fetching the authenticated user's assessments with loading/error tracking.
 * When no courseId is passed, the backend returns all of the user's assessments across courses.
 */
import { useState, useEffect, useCallback } from 'react';
import { Assessment } from '../types/question';
import { assessmentService } from '../services/assessmentService';

export function useAllAssessments(options?: { courseId?: number }) {
  const courseId = options?.courseId;

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAssessments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await assessmentService.getAssessments({ courseId });
      setAssessments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch assessments');
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  return {
    assessments,
    isLoading,
    error,
    refetch: fetchAssessments,
  };
}
