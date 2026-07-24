/**
 * Hook for fetching the authenticated user's questions with loading/error tracking.
 * When no courseId is passed, the backend returns questions across courses.
 *
 * Pass `limit`/`offset` to load one server page (UI pagination — #1040 review).
 * Omit them to page-loop fetch-all (dashboard / builders; throws above the safety cap).
 */
import { useState, useEffect, useCallback } from 'react';
import { Question } from '../types/question';
import { questionService } from '../services/questionService';

export function useAllQuestions(options?: {
  courseId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const courseId = options?.courseId;
  const search = options?.search;
  const limit = options?.limit;
  const offset = options?.offset ?? 0;
  const paginated = limit !== undefined && limit > 0;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (paginated) {
        const page = await questionService.getQuestionsPage({
          courseId,
          search,
          limit,
          offset,
        });
        setQuestions(page.items);
        setTotal(page.total);
      } else {
        const data = await questionService.getQuestions({ courseId, search });
        const items = Array.isArray(data) ? data : [];
        setQuestions(items);
        setTotal(items.length);
      }
    } catch (err: any) {
      setQuestions([]);
      setTotal(0);
      setError(err.response?.data?.error || err.message || 'Failed to fetch questions');
    } finally {
      setIsLoading(false);
    }
  }, [courseId, search, limit, offset, paginated]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  return {
    questions,
    total,
    isLoading,
    error,
    refetch: fetchQuestions,
  };
}
