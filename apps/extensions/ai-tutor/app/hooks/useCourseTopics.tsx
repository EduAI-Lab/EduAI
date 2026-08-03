/**
 * @file Per-course topic list state for the instructor UI.
 *
 * Responsibility: Loads, sorts, and mutates the topic collection for a
 *   given course offering, plus a Provider/consumer pair so descendants
 *   can share one instance instead of re-fetching.
 * Callers: Instructor course/lesson/activity editors.
 * Gotchas:
 *   - `requestIdRef` is a stale-response guard: each `loadTopics` invocation
 *     bumps the ref, and only the response whose captured id still matches
 *     the latest ref is allowed to write state. This prevents a slower
 *     earlier fetch from overwriting a faster later one when the
 *     `courseOfferingId` changes rapidly. Removing this counter is an easy
 *     way to reintroduce flicker/race bugs.
 * Related: `app/lib/api.ts` (`topicsForCourse`, `createTopic`).
 */

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from '../lib/api';
import type { Topic } from '../lib/types';

export type CourseTopicsState = {
  topics: Topic[];
  /**
   * Total topics on the course (#1207) — may exceed `topics.length` when the
   * course has more than one page of them. Consumers that display a count or a
   * "+N more" affordance must read this, not `topics.length`, or they silently
   * under-report.
   */
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createTopic: (name: string) => Promise<Topic>;
  /**
   * Append the next page of topics. Returns false when everything is loaded.
   * Used by the topic pickers so a course past one page is still fully
   * reachable rather than silently truncated.
   */
  loadMore: () => Promise<boolean>;
  /** True while `loadMore` is in flight. */
  loadingMore: boolean;
};

const sortTopics = (items: Topic[]) =>
  [...items].toSorted((a: Topic, b: Topic) => a.name.localeCompare(b.name));

export function useCourseTopics(courseOfferingId: number | null): CourseTopicsState {
  const [topics, setTopics] = useState<Topic[]>([]);
  // Start loading when an offering is selected so empty-topics UI does not
  // flash "Sync topics…" for one frame before the fetch effect runs (#1021).
  const [loading, setLoading] = useState(() => courseOfferingId != null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  // #1207: `total` is the course's full topic count; `loadedPage` tracks how
  // much of it we hold, so `loadMore` knows what to ask for next.
  const [total, setTotal] = useState(0);
  const [loadedPage, setLoadedPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadTopics = useCallback(async () => {
    if (!courseOfferingId) {
      setTopics([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Capture this call's id; only commit results if no later call has
    // started in the meantime. Every state write below is gated on this.
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // #1043: topics endpoint returns the pagination envelope. Server already
      // sorts by name; sortTopics stays as a stable tiebreak and to keep
      // optimistic inserts ordered. #1207: `total` is kept so consumers can
      // tell a full list from a first page.
      const fetched = await api.topicsForCourse(courseOfferingId, { page: 1 });
      if (requestId === requestIdRef.current) {
        setTopics(sortTopics(fetched.data));
        setTotal(fetched.total);
        setLoadedPage(1);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error('Failed to load topics', err);
        setError('Could not load topics for this course.');
        setTopics([]);
        setTotal(0);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [courseOfferingId]);

  // When the offering id changes, mark loading immediately (before paint of
  // the empty list) so Add Activity does not flash the sync hint.
  useEffect(() => {
    if (courseOfferingId != null) {
      setLoading(true);
    } else {
      setLoading(false);
      setTopics([]);
      setError(null);
    }
  }, [courseOfferingId]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const createTopic = useCallback(
    async (name: string) => {
      if (!courseOfferingId) {
        throw new Error('Course offering is not defined.');
      }

      const created = await api.createTopic(courseOfferingId, { name });
      setTopics((prev) => sortTopics([...prev, created]));
      setTotal((prev) => prev + 1);
      return created;
    },
    [courseOfferingId],
  );

  const refresh = useCallback(async () => {
    await loadTopics();
  }, [loadTopics]);

  /**
   * Append the next page (#1207). Returns false when nothing more exists, so a
   * caller can render "all N loaded" without tracking counts itself.
   *
   * Deduped by id on merge: `createTopic` inserts optimistically, which can
   * shift a row across the page boundary and make it arrive twice.
   */
  const loadMore = useCallback(async () => {
    if (!courseOfferingId) return false;
    if (topics.length >= total) return false;

    setLoadingMore(true);
    try {
      const nextPage = loadedPage + 1;
      const fetched = await api.topicsForCourse(courseOfferingId, { page: nextPage });
      setTopics((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return sortTopics([...prev, ...fetched.data.filter((t) => !seen.has(t.id))]);
      });
      setTotal(fetched.total);
      setLoadedPage(nextPage);
      return true;
    } catch (err) {
      console.error('Failed to load more topics', err);
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [courseOfferingId, loadedPage, topics.length, total]);

  return {
    topics,
    total,
    loading,
    error,
    refresh,
    createTopic,
    loadMore,
    loadingMore,
  };
}

const CourseTopicsContext = createContext<CourseTopicsState | null>(null);

type CourseTopicsProviderProps = {
  value: CourseTopicsState;
  children: ReactNode;
};

export function CourseTopicsProvider({ value, children }: CourseTopicsProviderProps) {
  return <CourseTopicsContext.Provider value={value}>{children}</CourseTopicsContext.Provider>;
}

export function useCourseTopicsContext() {
  const context = useContext(CourseTopicsContext);
  if (!context) {
    throw new Error('useCourseTopicsContext must be used within a CourseTopicsProvider.');
  }
  return context;
}
