import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchChatSession, useChatSession } from "~/hooks/api/use-chat-sessions";

const session = {
  id: "chat-1",
  systemPrompt: null,
  title: "Week 1",
  adhdAssist: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChatSession", () => {
  it("returns null session and does not fetch when chatId is null", async () => {
    const { result } = renderHook(() => useChatSession(null));

    expect(result.current.session).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches the chat session by id", async () => {
    mockFetch.mockResolvedValue(okJson(session));

    const { result } = renderHook(() => useChatSession("chat-1"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toEqual(session);
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/chat-1", expect.anything());
  });

  it("surfaces a failed fetch as an error, clears session, and logs", async () => {
    mockFetch.mockResolvedValue(errResponse(404, "Not found"));

    const { result } = renderHook(() => useChatSession("chat-1"));

    await waitFor(() => expect(result.current.error).toBe("Not found"));
    expect(result.current.session).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("boom");

    const { result } = renderHook(() => useChatSession("chat-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to load chat"));
  });

  it("clears session and error when chatId becomes null", async () => {
    mockFetch.mockResolvedValue(okJson(session));
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useChatSession(id),
      { initialProps: { id: "chat-1" } },
    );

    await waitFor(() => expect(result.current.session).toEqual(session));

    rerender({ id: null });

    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.error).toBeNull();
  });

  it("deleteChatSession DELETEs the chat", async () => {
    mockFetch.mockResolvedValue(okJson(session));
    const { result } = renderHook(() => useChatSession("chat-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
      json: () => Promise.resolve(undefined),
    } as unknown as Response);

    await act(async () => {
      await result.current.deleteChatSession("chat-1");
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chats/chat-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteChatSession throws the server error message on failure", async () => {
    mockFetch.mockResolvedValue(okJson(session));
    const { result } = renderHook(() => useChatSession("chat-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockFetch.mockResolvedValueOnce(errResponse(409, "chat has dependents"));

    await expect(result.current.deleteChatSession("chat-1")).rejects.toThrow(
      "chat has dependents",
    );
  });
});

describe("fetchChatSession", () => {
  it("returns the session on success", async () => {
    mockFetch.mockResolvedValue(okJson(session));

    const result = await fetchChatSession("chat-1");

    expect(result).toEqual(session);
    expect(mockFetch).toHaveBeenCalledWith("/api/chats/chat-1", expect.anything());
  });

  it("returns null when the fetch fails", async () => {
    mockFetch.mockResolvedValue(errResponse(403, "Forbidden"));

    const result = await fetchChatSession("chat-1");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const result = await fetchChatSession("chat-1");

    expect(result).toBeNull();
  });
});
