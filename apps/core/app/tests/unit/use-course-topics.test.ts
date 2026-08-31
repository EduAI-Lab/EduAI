import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCourseTopics } from "~/hooks/api/use-course-topics";

const topic = {
  id: "topic-1",
  courseId: "course-1",
  name: "Week 1",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function topicsResponse(topics: unknown[]) {
  return new Response(JSON.stringify({ topics }), { status: 200 });
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCourseTopics", () => {
  it("fetches the topic list for the course on mount", async () => {
    mockFetch.mockResolvedValueOnce(topicsResponse([topic]));

    const { result } = renderHook(() => useCourseTopics("course-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.topics).toEqual([topic]);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("/api/courses/course-1/topics");
  });

  it("surfaces a failed list read as an error and leaves the list empty", async () => {
    mockFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.loading).toBe(false);
    expect(result.current.topics).toEqual([]);
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValueOnce("network down");

    const { result } = renderHook(() => useCourseTopics("course-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch topics"));
    expect(result.current.loading).toBe(false);
  });

  it("skips the fetch entirely when courseId is empty", async () => {
    const { result } = renderHook(() => useCourseTopics(""));

    // No await needed: the effect returns before touching state, so this
    // assertion is checking the fetch was never issued, not a timing race.
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.topics).toEqual([]);
  });

  it("createTopic POSTs the new topic and appends it locally", async () => {
    mockFetch
      .mockResolvedValueOnce(topicsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify(topic), { status: 201 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: unknown;
    await act(async () => {
      created = await result.current.createTopic("Week 1");
    });

    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/courses/course-1/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Week 1" }),
    });
    expect(created).toEqual(topic);
    expect(result.current.topics).toEqual([topic]);
  });

  it("createTopic throws the server error message on failure", async () => {
    mockFetch
      .mockResolvedValueOnce(topicsResponse([]))
      .mockResolvedValueOnce(new Response("duplicate name", { status: 409 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.createTopic("Week 1")).rejects.toThrow("duplicate name");
    expect(result.current.topics).toEqual([]);
  });

  it("deleteTopic DELETEs and filters the removed topic out locally", async () => {
    mockFetch
      .mockResolvedValueOnce(topicsResponse([topic]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteTopic("topic-1");
    });

    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/courses/course-1/topics", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: "topic-1" }),
    });
    expect(result.current.topics).toEqual([]);
  });

  it("deleteTopic throws the server error message on failure and leaves the list untouched", async () => {
    mockFetch
      .mockResolvedValueOnce(topicsResponse([topic]))
      .mockResolvedValueOnce(new Response("in use", { status: 409 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.deleteTopic("topic-1")).rejects.toThrow("in use");
    expect(result.current.topics).toEqual([topic]);
  });

  /**
   * `editTopic` was a stub that always threw, on a stale comment claiming #299
   * had left no PATCH endpoint — it had in fact shipped one. These pin the real
   * call (#1624 review).
   */
  it("editTopic PATCHes the topic and replaces the row from the response", async () => {
    const renamed = { ...topic, name: "Recursion" };
    mockFetch
      .mockResolvedValueOnce(topicsResponse([topic]))
      .mockResolvedValueOnce(new Response(JSON.stringify(renamed), { status: 200 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.editTopic("topic-1", "Recursion");
    });

    expect(mockFetch).toHaveBeenLastCalledWith("/api/courses/course-1/topics/topic-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Recursion" }),
    });
    // Replaced from the response, not patched locally — the server trims the
    // name, so echoing the request would drift from what was stored.
    expect(result.current.topics).toEqual([renamed]);
  });

  it("editTopic throws the server error message and leaves the list untouched", async () => {
    mockFetch
      .mockResolvedValueOnce(topicsResponse([topic]))
      .mockResolvedValueOnce(new Response("TOPIC_ALREADY_EXISTS", { status: 409 }));

    const { result } = renderHook(() => useCourseTopics("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.editTopic("topic-1", "Week 2")).rejects.toThrow(
      "TOPIC_ALREADY_EXISTS",
    );
    expect(result.current.topics).toEqual([topic]);
  });
});
