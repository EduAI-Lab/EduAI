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
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createTopic: (name: string) => Promise<Topic>;
};

const sortTopics = (items: Topic[]) =>
  [...items].toSorted((a: Topic, b: Topic) => a.name.localeCompare(b.name));

export function useCourseTopics(courseOfferingId: number | null): CourseTopicsState {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadTopics = useCallback(async () => {
    if (!courseOfferingId) {
      setTopics([]);
      setError(null);
      return;
    }

    // Capture this call's id; only commit results if no later call has
    // started in the meantime. Every state write below is gated on this.
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const fetched = await api.topicsForCourse(courseOfferingId);
      if (requestId === requestIdRef.current) {
        setTopics(sortTopics(fetched));
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error('Failed to load topics', err);
        setError('Could not load topics for this course.');
        setTopics([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
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
      return created;
    },
    [courseOfferingId],
  );

  const refresh = useCallback(async () => {
    await loadTopics();
  }, [loadTopics]);

  return {
    topics,
    loading,
    error,
    refresh,
    createTopic,
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
