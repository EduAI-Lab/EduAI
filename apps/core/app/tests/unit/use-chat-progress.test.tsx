import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { CHAT_PROGRESS_TEXT_IDLE_MS } from "~/components/chat/chat-progress-stage";
import { useChatProgress } from "~/components/chat/use-chat-progress";

describe("useChatProgress — #1171", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets elapsed when loading ends", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) =>
        useChatProgress({
          isLoading,
          messages: [{ id: "u1", role: "user", content: "hi" }],
          adhdAssist: false,
          streamingRoutedRegistryId: "vllm:qwen",
        }),
      { initialProps: { isLoading: true } },
    );

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(1000);

    rerender({ isLoading: false });
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.showProgressIndicator).toBe(false);
  });

  it("hides status while assistant text is actively streaming", () => {
    const { result } = renderHook(() =>
      useChatProgress({
        isLoading: true,
        messages: [
          { id: "u1", role: "user", content: "hi" },
          { id: "a1", role: "assistant", content: "Partial" },
        ],
        adhdAssist: false,
        streamingRoutedRegistryId: "google:gemini",
      }),
    );

    expect(result.current.hasAssistantText).toBe(true);
    expect(result.current.showProgressIndicator).toBe(false);
    expect(result.current.compactProgress).toBe(false);
  });

  it("re-shows compact status after assistant text goes idle", () => {
    const { result } = renderHook(() =>
      useChatProgress({
        isLoading: true,
        messages: [
          { id: "u1", role: "user", content: "hi" },
          { id: "a1", role: "assistant", content: "Partial" },
        ],
        adhdAssist: false,
        streamingRoutedRegistryId: "google:gemini",
      }),
    );

    act(() => {
      vi.advanceTimersByTime(CHAT_PROGRESS_TEXT_IDLE_MS + 250);
    });

    expect(result.current.showProgressIndicator).toBe(true);
    expect(result.current.compactProgress).toBe(true);
    expect(result.current.stage.id).toBe("generating");
  });

  it("shows Searching… for in-progress tools even when text already exists", () => {
    const { result } = renderHook(() =>
      useChatProgress({
        isLoading: true,
        messages: [
          { id: "u1", role: "user", content: "hi" },
          {
            id: "a1",
            role: "assistant",
            content: "Earlier tokens",
            parts: [
              { type: "text", text: "Earlier tokens" },
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "getInformation",
                  state: "call",
                },
              },
            ],
          },
        ],
        adhdAssist: true,
        streamingRoutedRegistryId: "vllm:qwen",
      }),
    );

    expect(result.current.stage.id).toBe("searching_materials");
    expect(result.current.showProgressIndicator).toBe(true);
    expect(result.current.compactProgress).toBe(true);
  });

  it("detects in-progress tool parts for the Searching stage before text", () => {
    const { result } = renderHook(() =>
      useChatProgress({
        isLoading: true,
        messages: [
          { id: "u1", role: "user", content: "hi" },
          {
            id: "a1",
            role: "assistant",
            content: "",
            parts: [
              {
                type: "tool-invocation",
                toolInvocation: {
                  toolName: "getInformation",
                  state: "call",
                },
              },
            ],
          },
        ],
        adhdAssist: true,
        streamingRoutedRegistryId: "vllm:qwen",
      }),
    );

    expect(result.current.stage.id).toBe("searching_materials");
    expect(result.current.compactProgress).toBe(false);
    expect(result.current.showProgressIndicator).toBe(true);
  });
});
