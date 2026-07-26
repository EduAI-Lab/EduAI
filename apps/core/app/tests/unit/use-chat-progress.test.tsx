import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

  it("stays visible in compact mode once assistant text exists", () => {
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

    expect(result.current.showProgressIndicator).toBe(true);
    expect(result.current.compactProgress).toBe(true);
    expect(result.current.hasAssistantText).toBe(true);
    expect(result.current.stage.id).toBe("generating");
  });

  it("detects in-progress tool parts for the Searching stage", () => {
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
  });
});
