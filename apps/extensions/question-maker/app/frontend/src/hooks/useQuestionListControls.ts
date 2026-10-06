/**
 * Shared search/filter/sort state for the server-side question list surfaces
 * (course Questions tab and bank detail page — #1762). Search is debounced 300ms
 * before it reaches the server; filter and sort changes take effect immediately.
 * Any criteria change resets the caller's page offset via `resetOffset` so paging
 * never shows a stale page for a new filter set.
 */
import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_QUESTION_FILTERS,
  type QuestionFilters,
  type QuestionSort,
} from "../components/question-bank/QuestionFilterToolbar";

export interface UseQuestionListControlsReturn {
  search: string;
  setSearch: (value: string) => void;
  debouncedSearch: string;
  filters: QuestionFilters;
  updateFilters: (next: QuestionFilters) => void;
  sortBy: QuestionSort;
  updateSort: (next: QuestionSort) => void;
  reset: () => void;
}

export function useQuestionListControls(resetOffset: () => void): UseQuestionListControlsReturn {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<QuestionFilters>(EMPTY_QUESTION_FILTERS);
  const [sortBy, setSortBy] = useState<QuestionSort>("newest");

  const updateFilters = useCallback(
    (next: QuestionFilters) => {
      setFilters(next);
      resetOffset();
    },
    [resetOffset],
  );

  const updateSort = useCallback(
    (next: QuestionSort) => {
      setSortBy(next);
      resetOffset();
    },
    [resetOffset],
  );

  useEffect(() => {
    const next = search.trim();
    if (next === debouncedSearch) return;
    const handle = window.setTimeout(() => {
      setDebouncedSearch(next);
      resetOffset();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search, debouncedSearch, resetOffset]);

  const reset = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setFilters(EMPTY_QUESTION_FILTERS);
    setSortBy("newest");
  }, []);

  return { search, setSearch, debouncedSearch, filters, updateFilters, sortBy, updateSort, reset };
}
