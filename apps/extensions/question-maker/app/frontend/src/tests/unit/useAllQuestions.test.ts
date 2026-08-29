/**
 * Unit tests for `useAllQuestions` (#1546): fetch-on-mount/deps-change with
 * paginated vs fetch-all modes, error handling, and stale-response guarding.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getQuestions = vi.fn();
const getQuestionsPage = vi.fn();

vi.mock("@/services/questionService", () => ({
  questionService: {
    getQuestions: (...args: unknown[]) => getQuestions(...args),
    getQuestionsPage: (...args: unknown[]) => getQuestionsPage(...args),
  },
}));

import { useAllQuestions } from "@/hooks/useAllQuestions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAllQuestions", () => {
  it("fetches all questions (unpaginated) on mount", async () => {
    getQuestions.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const { result } = renderHook(() => useAllQuestions());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.questions).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.current.total).toBe(2);
    expect(getQuestionsPage).not.toHaveBeenCalled();
  });

  it("falls back to an empty array when getQuestions returns a non-array", async () => {
    getQuestions.mockResolvedValue(null);
    const { result } = renderHook(() => useAllQuestions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.questions).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("uses getQuestionsPage when limit is provided", async () => {
    getQuestionsPage.mockResolvedValue({ items: [{ id: 1 }], total: 5 });

    const { result } = renderHook(() => useAllQuestions({ limit: 10, offset: 0 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getQuestionsPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 }),
    );
    expect(result.current.questions).toEqual([{ id: 1 }]);
    expect(result.current.total).toBe(5);
    expect(getQuestions).not.toHaveBeenCalled();
  });

  it("sets an error and clears results when the fetch fails", async () => {
    getQuestions.mockRejectedValue({ response: { data: { error: "server exploded" } } });

    const { result } = renderHook(() => useAllQuestions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("server exploded");
    expect(result.current.questions).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("falls back to err.message when no response error is present", async () => {
    getQuestions.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useAllQuestions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("network down");
  });

  it("refetch re-invokes the fetch and updates state", async () => {
    getQuestions.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    const { result } = renderHook(() => useAllQuestions());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.questions).toHaveLength(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.questions).toHaveLength(2);
    expect(getQuestions).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when courseId changes", async () => {
    getQuestions.mockResolvedValue([]);
    const { rerender } = renderHook(({ courseId }) => useAllQuestions({ courseId }), {
      initialProps: { courseId: 1 },
    });

    await waitFor(() => expect(getQuestions).toHaveBeenCalledTimes(1));

    rerender({ courseId: 2 });
    await waitFor(() => expect(getQuestions).toHaveBeenCalledTimes(2));
    expect(getQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ courseId: 2 }));
  });

  it("ignores a stale response when a newer request has since started", async () => {
    let resolveFirst: (v: any) => void = () => {};
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    getQuestions.mockReturnValueOnce(firstPromise).mockResolvedValueOnce([{ id: "second" }]);

    const { result, rerender } = renderHook(({ search }) => useAllQuestions({ search }), {
      initialProps: { search: "a" },
    });

    rerender({ search: "b" });
    await waitFor(() => expect(result.current.questions).toEqual([{ id: "second" }]));

    // Resolve the stale first request after the second has already landed.
    await act(async () => {
      resolveFirst([{ id: "stale" }]);
    });

    expect(result.current.questions).toEqual([{ id: "second" }]);
  });
});
