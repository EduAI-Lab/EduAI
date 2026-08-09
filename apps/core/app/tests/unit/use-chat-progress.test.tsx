import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatProgress } from "~/components/chat/use-chat-progress";

type ToolState = "call" | "result";

describe("useChatProgress — #1171", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears startedAt when loading ends", () => {
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

    expect(result.current.startedAt).not.toBeNull();
    expect(result.current.showProgressIndicator).toBe(true);

    rerender({ isLoading: false });
    expect(result.current.startedAt).toBeNull();
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

    // Parent must not need a timer tick — status stays hidden across pauses.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.showProgressIndicator).toBe(false);

    rerender({ content: "Partial more" });
    expect(result.current.showProgressIndicator).toBe(false);
  });

  it("shows status for in-progress tools even when text already exists", () => {
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

    expect(result.current.activeToolName).toBe("getInformation");
    expect(result.current.showProgressIndicator).toBe(true);
    expect(result.current.compactProgress).toBe(true);
  });

  it("keeps compact status after a tool finishes until follow-up tokens", () => {
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
      {
        initialProps: {
          toolState: "call" as ToolState,
          content: "Earlier",
        },
      },
    );

    expect(result.current.activeToolName).toBe("getInformation");

    // Immediate first paint after tool completion — no effect-flush gap/flicker.
    rerender({ toolState: "result", content: "Earlier" });
    expect(result.current.showProgressIndicator).toBe(true);
    expect(result.current.compactProgress).toBe(true);
    expect(result.current.awaitingFollowup).toBe(true);
    expect(result.current.activeToolName).toBeNull();

    rerender({ toolState: "result", content: "Earlier\n\nFollow-up" });
    expect(result.current.showProgressIndicator).toBe(false);
  });

  it("treats omitted tool-invocation state as in-progress", () => {
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
                toolInvocation: { toolName: "getInformation" },
              },
            ],
          },
        ],
        adhdAssist: false,
        streamingRoutedRegistryId: "vllm:qwen",
      }),
    );

    expect(result.current.activeToolName).toBe("getInformation");
    expect(result.current.showProgressIndicator).toBe(true);
  });

  it("detects unknown in-progress tools for the Working stage", () => {
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

    expect(result.current.activeToolName).toBe("listUsers");
    expect(result.current.showProgressIndicator).toBe(true);
  });

  it("rebases the deadline when entering post-tool follow-up", () => {
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
          streamingRoutedRegistryId: "vllm:qwen2.5-32b-instruct",
        }),
      {
        initialProps: {
          toolState: "call" as ToolState,
          content: "Earlier",
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    const beforeFollowup = result.current.deadlineMs;

    rerender({ toolState: "result", content: "Earlier" });
    expect(result.current.awaitingFollowup).toBe(true);
    expect(result.current.showProgressIndicator).toBe(true);
    // Rebased short window — not stuck on the huge full-turn estimate alone.
    expect(result.current.deadlineMs).toBeGreaterThan(20_000);
    expect(result.current.deadlineMs).toBeLessThan(beforeFollowup + 20_000);
  });

  it("grows the deadline when the estimate increases (routed model)", () => {
    const { result, rerender } = renderHook(
      ({ routed }) =>
        useChatProgress({
          isLoading: true,
          messages: [{ id: "u1", role: "user", content: "hi" }],
          adhdAssist: false,
          selectedModel: "auto",
          streamingRoutedRegistryId: routed,
        }),
      { initialProps: { routed: null as string | null } },
    );

    const before = result.current.deadlineMs;

    rerender({ routed: "vllm:qwen2.5-32b-instruct" });
    expect(result.current.deadlineMs).toBeGreaterThanOrEqual(before);
  });

  it("freezes the estimate to the picker value at request start, ignoring later picker changes (pre-header path)", () => {
    const { result, rerender } = renderHook(
      ({ selectedModel }) =>
        useChatProgress({
          isLoading: true,
          messages: [{ id: "u1", role: "user", content: "hi" }],
          adhdAssist: false,
          selectedModel,
          // No streamingRoutedRegistryId yet — X-Routed-Model hasn't arrived.
          streamingRoutedRegistryId: null,
        }),
      { initialProps: { selectedModel: "google:gemini" } },
    );

    const fastEstimate = result.current.typicalExpectedMs;

    // User flips the picker mid-flight, before the routed-model header lands.
    rerender({ selectedModel: "vllm:qwen2.5-32b-instruct" });

    expect(result.current.typicalExpectedMs).toBe(fastEstimate);
  });

  it("uses the live picker value for the next request after the previous one settles", () => {
    const { result, rerender } = renderHook(
      ({ isLoading, selectedModel }) =>
        useChatProgress({
          isLoading,
          messages: [{ id: "u1", role: "user", content: "hi" }],
          adhdAssist: false,
          selectedModel,
          streamingRoutedRegistryId: null,
        }),
      {
        initialProps: { isLoading: true, selectedModel: "google:gemini" },
      },
    );

    const fastEstimate = result.current.typicalExpectedMs;

    rerender({ isLoading: false, selectedModel: "google:gemini" });
    rerender({ isLoading: true, selectedModel: "vllm:qwen2.5-32b-instruct" });

    expect(result.current.typicalExpectedMs).toBeGreaterThan(fastEstimate);
  });
});
