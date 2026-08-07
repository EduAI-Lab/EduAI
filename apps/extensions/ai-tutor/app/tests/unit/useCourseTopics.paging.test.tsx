/**
 * Tests for the paged topic hook (#1207).
 *
 * Topic `<Select>` dropdowns need their saved value present, so this hook keeps
 * a large single read but must still expose the true `total` and a way to reach
 * past the first page — otherwise a course's later topics are unreachable and
 * unmentioned.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const topicsForCourse = vi.fn();
const createTopic = vi.fn();

vi.mock('~/lib/api', () => ({
  default: {
    topicsForCourse: (...args: unknown[]) => topicsForCourse(...args),
    createTopic: (...args: unknown[]) => createTopic(...args),
  },
}));

import { useCourseTopics } from '~/hooks/useCourseTopics';

const topic = (id: string, name: string) => ({ id, name });

describe('useCourseTopics paging', () => {
  beforeEach(() => {
    topicsForCourse.mockReset();
    createTopic.mockReset();
  });

  it('exposes the server total, not the loaded length', async () => {
    topicsForCourse.mockResolvedValue({
      data: [topic('a', 'Alpha')],
      total: 250,
      page: 1,
      pageSize: 200,
    });

    const { result } = renderHook(() => useCourseTopics(1));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.topics).toHaveLength(1);
    expect(result.current.total).toBe(250);
  });

  it('requests page 1 on load', async () => {
    topicsForCourse.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 200 });

    const { result } = renderHook(() => useCourseTopics(7));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(topicsForCourse).toHaveBeenCalledWith(7, { page: 1 });
  });

  it('loadMore appends the next page', async () => {
    topicsForCourse
      .mockResolvedValueOnce({
        data: [topic('a', 'Alpha')],
        total: 2,
        page: 1,
        pageSize: 1,
      })
      .mockResolvedValueOnce({
        data: [topic('b', 'Beta')],
        total: 2,
        page: 2,
        pageSize: 1,
      });

    const { result } = renderHook(() => useCourseTopics(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(topicsForCourse).toHaveBeenLastCalledWith(1, { page: 2 });
    expect(result.current.topics.map((t) => t.name)).toEqual(['Alpha', 'Beta']);
  });

  it('loadMore is a no-op once everything is loaded', async () => {
    topicsForCourse.mockResolvedValue({
      data: [topic('a', 'Alpha')],
      total: 1,
      page: 1,
      pageSize: 200,
    });

    const { result } = renderHook(() => useCourseTopics(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let more: boolean | undefined;
    await act(async () => {
      more = await result.current.loadMore();
    });

    expect(more).toBe(false);
    expect(topicsForCourse).toHaveBeenCalledTimes(1);
  });

  it('does not double-append a topic that shifted across the page boundary', async () => {
    // An optimistic insert can push a row onto the next page, so the merge has
    // to dedupe by id rather than trusting the pages to be disjoint.
    topicsForCourse
      .mockResolvedValueOnce({ data: [topic('a', 'Alpha')], total: 3, page: 1, pageSize: 1 })
      .mockResolvedValueOnce({
        data: [topic('a', 'Alpha'), topic('b', 'Beta')],
        total: 3,
        page: 2,
        pageSize: 1,
      });

    const { result } = renderHook(() => useCourseTopics(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.topics.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('createTopic bumps the total so the "N of M" hint stays honest', async () => {
    topicsForCourse.mockResolvedValue({
      data: [topic('a', 'Alpha')],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    createTopic.mockResolvedValue(topic('z', 'Zeta'));

    const { result } = renderHook(() => useCourseTopics(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTopic('Zeta');
    });

    expect(result.current.total).toBe(2);
    expect(result.current.topics.map((t) => t.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('drops a loadMore response that lands after the course changed', async () => {
    // The picker can switch offerings while page 2 is still in flight. Without
    // the request-id guard the old course's topics append into the new one's
    // list and drag its `total` along with them.
    let releaseSlowPage2: ((value: unknown) => void) | undefined;
    topicsForCourse.mockImplementation((courseId: number, { page }: { page: number }) => {
      if (courseId === 1 && page === 1) {
        return Promise.resolve({ data: [topic('a', 'Alpha')], total: 2, page: 1, pageSize: 1 });
      }
      if (courseId === 1 && page === 2) {
        return new Promise((resolve) => {
          releaseSlowPage2 = resolve;
        });
      }
      return Promise.resolve({ data: [topic('z', 'Zeta')], total: 1, page: 1, pageSize: 1 });
    });

    const { result, rerender } = renderHook(({ id }) => useCourseTopics(id), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let morePromise: Promise<boolean>;
    act(() => {
      morePromise = result.current.loadMore();
    });

    // Switch courses while page 2 is still pending, then let it land.
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.topics.map((t) => t.id)).toEqual(['z']));

    await act(async () => {
      releaseSlowPage2?.({ data: [topic('b', 'Beta')], total: 2, page: 2, pageSize: 1 });
      await morePromise;
    });

    expect(result.current.topics.map((t) => t.id)).toEqual(['z']);
    expect(result.current.total).toBe(1);
    expect(result.current.loadingMore).toBe(false);
  });

  it('resets the total when the fetch fails', async () => {
    topicsForCourse.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useCourseTopics(1));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.total).toBe(0);
  });
});
