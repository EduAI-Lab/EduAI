/**
 * Hook for fetching the authenticated user's questions with loading/error tracking.
 * When no courseId is passed, the backend returns questions across courses.
 *
 * Pass `limit`/`offset` to load one server page (UI pagination — #1040 review).
 * Omit them to page-loop fetch-all (dashboard / builders; throws above the safety cap).
 * Filters/sort/search are sent to the server so pagination totals stay correct.
 */
import { useState, useEffect, useCallback } from 'react';
import { Question } from '../types/question';
import { questionService } from '../services/questionService';
import type { QuestionFilters, QuestionSort } from '@/components/question-bank/QuestionFilterToolbar';

export type UseAllQuestionsOptions = {
  courseId?: number;
  search?: string;
  filters?: QuestionFilters;
  sortBy?: QuestionSort;
  limit?: number;
  offset?: number;
};

export function useAllQuestions(options?: UseAllQuestionsOptions) {
  const courseId = options?.courseId;
  const search = options?.search;
  const filters = options?.filters;
  const sortBy = options?.sortBy;
  const limit = options?.limit;
  const offset = options?.offset ?? 0;
  const paginated = limit !== undefined && limit > 0;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listOptions = {
    courseId,
    search,
    types: filters?.questionTypes,
    difficulties: filters?.difficulties,
    reasoningLevels: filters?.reasoningLevels,
    aiGenerated: filters?.aiGenerated,
    draftStatus: filters?.draftStatus,
    sortBy,
  };

  const fetchQuestions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (paginated) {
        const page = await questionService.getQuestionsPage({
          ...listOptions,
          limit,
          offset,
        });
        setQuestions(page.items);
        setTotal(page.total);
      } else {
        const data = await questionService.getQuestions(listOptions);
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
    // Serialize filter objects so identity changes don't thrash fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional keying via JSON
  }, [
    courseId,
    search,
    sortBy,
    limit,
    offset,
    paginated,
    JSON.stringify(filters?.questionTypes ?? []),
    JSON.stringify(filters?.difficulties ?? []),
    JSON.stringify(filters?.reasoningLevels ?? []),
    filters?.aiGenerated,
    filters?.draftStatus,
  ]);

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
