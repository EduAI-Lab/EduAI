/**
 * Hook for fetching the authenticated user's questions with loading/error tracking.
 * When no courseId is passed, the backend returns all of the user's questions across courses.
 */
import { useState, useEffect, useCallback } from 'react';
import { Question } from '../types/question';
import { questionService } from '../services/questionService';

export function useAllQuestions(options?: { courseId?: number; search?: string }) {
  const courseId = options?.courseId;
  const search = options?.search;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await questionService.getQuestions({ courseId, search });
      setQuestions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch questions');
    } finally {
      setIsLoading(false);
    }
  }, [courseId, search]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  return {
    questions,
    isLoading,
    error,
    refetch: fetchQuestions,
  };
}
