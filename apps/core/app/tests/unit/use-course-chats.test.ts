import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatDetail, useCourseChats, useUnitChats } from "~/hooks/api/use-course-chats";

const chat = {
  id: "chat-1",
  title: "Week 1",
  ownerId: "user-1",
  ownerName: "Alice",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const unitChat = {
  ...chat,
  courseId: "course-1",
  courseCode: "CS101",
  courseName: "Intro",
};

const message = { messageId: "m1", role: "user", content: "hi", position: 0 };

const chatDetail = {
  id: "chat-1",
  title: "Week 1",
  systemPrompt: null,
  adhdAssist: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messages: [message],
  nextCursor: null,
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

describe("useCourseChats", () => {
  it("fetches the first page of chats for a course", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [chat], nextCursor: null }));

    const { result } = renderHook(() => useCourseChats("course-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chats).toEqual([chat]);
    expect(result.current.hasMore).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith("/api/courses/course-1/chats", expect.anything());
  });

  it("does nothing when courseId is undefined", async () => {
    const { result } = renderHook(() => useCourseChats(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.chats).toEqual([]);
  });

  it("does nothing when enabled is false", async () => {
    const { result } = renderHook(() => useCourseChats("course-1", false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces a failed fetch as an error", async () => {
    mockFetch.mockResolvedValue(errResponse(403, "Forbidden"));

    const { result } = renderHook(() => useCourseChats("course-1"));

    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.loading).toBe(false);
    expect(result.current.chats).toEqual([]);
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("boom");

    const { result } = renderHook(() => useCourseChats("course-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch chats"));
  });

  it("exposes hasMore and loads the next cursor page, appending results", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ chats: [chat], nextCursor: "cursor-2" }));

    const { result } = renderHook(() => useCourseChats("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    const chat2 = { ...chat, id: "chat-2" };
    mockFetch.mockResolvedValueOnce(okJson({ chats: [chat2], nextCursor: null }));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.chats).toEqual([chat, chat2]);
    expect(result.current.hasMore).toBe(false);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/courses/course-1/chats?cursor=cursor-2",
      expect.anything(),
    );
  });

  it("loadMore is a no-op when there is no next cursor", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [chat], nextCursor: null }));

    const { result } = renderHook(() => useCourseChats("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetch).toHaveBeenCalledTimes(calls);
  });

  it("surfaces a loadMore failure as an error without an Error instance", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ chats: [chat], nextCursor: "cursor-2" }));
    const { result } = renderHook(() => useCourseChats("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockRejectedValueOnce("bad cursor");

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe("Failed to load more chats");
    expect(result.current.loadingMore).toBe(false);
  });

  it("refetch re-runs the query", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [chat], nextCursor: null }));
    const { result } = renderHook(() => useCourseChats("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("useUnitChats", () => {
  it("fetches chats for a unit and url-encodes the department", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [unitChat], nextCursor: null }));

    const { result } = renderHook(() => useUnitChats("Computer Science"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chats).toEqual([unitChat]);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/units/Computer%20Science/chats",
      expect.anything(),
    );
  });

  it("does nothing when department is undefined", async () => {
    const { result } = renderHook(() => useUnitChats(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when enabled is false", async () => {
    const { result } = renderHook(() => useUnitChats("cs", false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces a failed fetch as an error", async () => {
    mockFetch.mockResolvedValue(errResponse(500, "Server error"));

    const { result } = renderHook(() => useUnitChats("cs"));

    await waitFor(() => expect(result.current.error).toBe("Server error"));
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("boom");

    const { result } = renderHook(() => useUnitChats("cs"));

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch chats"));
  });

  it("loads more chats via cursor and appends", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ chats: [unitChat], nextCursor: "next" }));
    const { result } = renderHook(() => useUnitChats("cs"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const unitChat2 = { ...unitChat, id: "chat-2" };
    mockFetch.mockResolvedValueOnce(okJson({ chats: [unitChat2], nextCursor: null }));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.chats).toEqual([unitChat, unitChat2]);
    expect(result.current.hasMore).toBe(false);
  });

  it("loadMore is a no-op when there is no next cursor", async () => {
    mockFetch.mockResolvedValue(okJson({ chats: [unitChat], nextCursor: null }));
    const { result } = renderHook(() => useUnitChats("cs"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetch).toHaveBeenCalledTimes(calls);
  });

  it("surfaces a loadMore failure as an error without an Error instance", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ chats: [unitChat], nextCursor: "next" }));
    const { result } = renderHook(() => useUnitChats("cs"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockRejectedValueOnce("bad cursor");

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe("Failed to load more chats");
  });
});

describe("useChatDetail", () => {
  it("returns null chat and does not fetch when chatId is null", async () => {
    const { result } = renderHook(() => useChatDetail(null));

    expect(result.current.chat).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches chat detail by id", async () => {
    mockFetch.mockResolvedValue(okJson(chatDetail));

    const { result } = renderHook(() => useChatDetail("chat-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chat).toEqual(chatDetail);
    expect(result.current.hasMore).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/chat-1", expect.anything());
  });

  it("surfaces a failed fetch as an error", async () => {
    mockFetch.mockResolvedValue(errResponse(404, "Not found"));

    const { result } = renderHook(() => useChatDetail("chat-1"));

    await waitFor(() => expect(result.current.error).toBe("Not found"));
    expect(result.current.chat).toBeNull();
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("boom");

    const { result } = renderHook(() => useChatDetail("chat-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch chat"));
  });

  it("loads more messages via cursor and prepends existing messages", async () => {
    const detailWithCursor = { ...chatDetail, nextCursor: "cursor-2" };
    mockFetch.mockResolvedValueOnce(okJson(detailWithCursor));

    const { result } = renderHook(() => useChatDetail("chat-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    const message2 = { messageId: "m2", role: "assistant", content: "hi back", position: 1 };
    mockFetch.mockResolvedValueOnce(
      okJson({ ...chatDetail, messages: [message2], nextCursor: null }),
    );

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.chat?.messages).toEqual([message, message2]);
    expect(result.current.hasMore).toBe(false);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/chats/chat-1?cursor=cursor-2",
      expect.anything(),
    );
  });

  it("loadMore is a no-op when there is no next cursor", async () => {
    mockFetch.mockResolvedValue(okJson(chatDetail));
    const { result } = renderHook(() => useChatDetail("chat-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetch).toHaveBeenCalledTimes(calls);
  });

  it("surfaces a loadMore failure as an error without an Error instance", async () => {
    const detailWithCursor = { ...chatDetail, nextCursor: "cursor-2" };
    mockFetch.mockResolvedValueOnce(okJson(detailWithCursor));
    const { result } = renderHook(() => useChatDetail("chat-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockRejectedValueOnce("bad cursor");

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe("Failed to load more messages");
    expect(result.current.loadingMore).toBe(false);
  });

  it("clears the chat when chatId becomes null", async () => {
    mockFetch.mockResolvedValue(okJson(chatDetail));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useChatDetail(id), {
      initialProps: { id: "chat-1" },
    });

    await waitFor(() => expect(result.current.chat).toEqual(chatDetail));

    rerender({ id: null });

    await waitFor(() => expect(result.current.chat).toBeNull());
  });
});
