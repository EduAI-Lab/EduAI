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

  it("hides status while assistant text is streaming (no inter-token flicker)", () => {
    const { result, rerender } = renderHook(
      ({ content }) =>
        useChatProgress({
          isLoading: true,
          messages: [
            { id: "u1", role: "user", content: "hi" },
            { id: "a1", role: "assistant", content },
          ],
          adhdAssist: false,
          streamingRoutedRegistryId: "google:gemini",
        }),
      { initialProps: { content: "Partial" } },
    );

    expect(result.current.showProgressIndicator).toBe(false);

    // Long pause between tokens must NOT re-show status (slow local models).
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.showProgressIndicator).toBe(false);

    rerender({ content: "Partial more" });
    expect(result.current.showProgressIndicator).toBe(false);
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

  it("keeps compact Generating… after a tool finishes until follow-up tokens", () => {
    const { result, rerender } = renderHook(
      ({ toolState, content }) =>
        useChatProgress({
          isLoading: true,
          messages: [
            { id: "u1", role: "user", content: "hi" },
            {
              id: "a1",
              role: "assistant",
              content,
              parts: [
                { type: "text", text: content },
                {
                  type: "tool-invocation",
                  toolInvocation: {
                    toolName: "getInformation",
                    state: toolState,
                  },
                },
              ],
            },
          ],
          adhdAssist: true,
          streamingRoutedRegistryId: "vllm:qwen",
        }),
      { initialProps: { toolState: "call" as const, content: "Earlier" } },
    );

    expect(result.current.stage.id).toBe("searching_materials");

    rerender({ toolState: "result", content: "Earlier" });
    expect(result.current.showProgressIndicator).toBe(true);
    expect(result.current.compactProgress).toBe(true);
    expect(result.current.stage.id).toBe("generating");

    rerender({ toolState: "result", content: "Earlier\n\nFollow-up" });
    expect(result.current.showProgressIndicator).toBe(false);
  });

  it("maps unknown in-progress tools to Working…", () => {
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
                  toolName: "listUsers",
                  state: "call",
                },
              },
            ],
          },
        ],
        adhdAssist: false,
        streamingRoutedRegistryId: "google:gemini",
      }),
    );

    expect(result.current.stage.id).toBe("working");
    expect(result.current.stage.label).toMatch(/Working/i);
    expect(result.current.showProgressIndicator).toBe(true);
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
