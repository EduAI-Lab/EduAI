/**
 * Hook for fetching the authenticated user's question statistics with loading/error tracking.
 */
import { useState, useEffect, useCallback } from 'react';
import { QuestionStats } from '../types/question';
import { questionService } from '../services/questionService';

export function useQuestionStats() {
  const [stats, setStats] = useState<QuestionStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await questionService.getQuestionStats();
      setStats(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch question stats');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: fetchStats,
  };
}
