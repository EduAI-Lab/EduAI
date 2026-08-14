import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchChatTranscript, useChatHistory } from "~/hooks/api/use-chat-history";

const historyItem = {
  id: "chat-1",
  title: "Week 1",
  preview: "hello",
  courseId: "course-1",
  courseCode: "CS101",
  courseName: "Intro",
  userId: "user-1",
  userName: "Alice",
  userEmail: "alice@example.com",
  messageCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const transcript = {
  chat: {
    id: "chat-1",
    title: "Week 1",
    systemPrompt: null,
    adhdAssist: false,
    courseId: "course-1",
    courseCode: "CS101",
    courseName: "Intro",
    ownerId: "user-1",
    ownerName: "Alice",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  messages: [{ role: "user", content: "hi" }],
  canEdit: true,
};

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errResponse(status: number, text: string) {
  return {
    ok: false,
    status,
    headers: { get: () => "application/json" },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve({}),
  } as unknown as Response;
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

describe("useChatHistory", () => {
  it("fetches chats with no filters", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [historyItem] }));

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chats).toEqual([historyItem]);
    expect(mockFetch).toHaveBeenCalledWith("/api/chats", expect.anything());
  });

  it("builds the query string from courseId, userId, scope, and limit", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [] }));

    const { result } = renderHook(() =>
      useChatHistory({ courseId: "course-1", userId: "user-1", scope: "all", limit: 10 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("courseId=course-1");
    expect(url).toContain("userId=user-1");
    expect(url).toContain("scope=all");
    expect(url).toContain("limit=10");
  });

  it("does not fetch and reports not loading when disabled", async () => {
    const { result } = renderHook(() => useChatHistory({ enabled: false }));

    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces a failed fetch as an error", async () => {
    mockFetch.mockResolvedValue(errResponse(403, "Forbidden"));

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.chats).toEqual([]);
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("boom");

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.error).toBe("Failed to load chat history"));
  });

  it("refresh imperatively re-runs the query", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [historyItem] }));
    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    expect(result.current.isLoading).toBe(false);
  });

  it("refresh surfaces server error text on failure", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ chats: [historyItem] }));
    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockFetch.mockResolvedValueOnce(errResponse(500, "boom server"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe("boom server");
  });

  it("refetches when filters change", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [] }));
    const { result, rerender } = renderHook(
      ({ courseId }: { courseId: string }) => useChatHistory({ courseId }),
      { initialProps: { courseId: "course-1" } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = mockFetch.mock.calls.length;

    rerender({ courseId: "course-2" });

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(before));
    const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0] as string;
    expect(url).toContain("courseId=course-2");
  });
});

describe("fetchChatTranscript", () => {
  it("returns the transcript on success", async () => {
    mockFetch.mockResolvedValue(okJson(transcript));

    const result = await fetchChatTranscript("chat-1");

    expect(result).toEqual(transcript);
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/chat-1/messages", expect.anything());
  });

  it("returns null when the fetch fails", async () => {
    mockFetch.mockResolvedValue(errResponse(403, "Forbidden"));

    const result = await fetchChatTranscript("chat-1");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const result = await fetchChatTranscript("chat-1");

    expect(result).toBeNull();
  });
});
