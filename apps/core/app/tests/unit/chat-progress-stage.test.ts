import { describe, it, expect } from "vitest";
import {
  CHAT_PROGRESS_ASSIST_PREP_MS,
  CHAT_PROGRESS_ROUTING_MS,
  activeToolNameFromMessage,
  assistantMessageHasText,
  formatChatProgressElapsed,
  resolveChatProgressStage,
  resolveChatProgressStageId,
  shouldApplyAssistiveDisplayTransform,
} from "~/components/chat/chat-progress-stage";

describe("resolveChatProgressStage — #1171", () => {
  it("starts in routing before the routed-model header arrives", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 100,
        hasAssistantText: false,
        hasRoutedModel: false,
        activeToolName: null,
        adhdAssist: false,
      }),
    ).toBe("routing");
  });

  it("moves to waiting_for_model after routing window or routed header", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: CHAT_PROGRESS_ROUTING_MS,
        hasAssistantText: false,
        hasRoutedModel: false,
        activeToolName: null,
        adhdAssist: false,
      }),
    ).toBe("waiting_for_model");

    expect(
      resolveChatProgressStageId({
        elapsedMs: 50,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: null,
        adhdAssist: false,
      }),
    ).toBe("waiting_for_model");
  });

  it("surfaces RAG / web tool activity ahead of the generic wait label", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 2_000,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: "getInformation",
        adhdAssist: false,
      }),
    ).toBe("searching_materials");

    expect(
      resolveChatProgressStageId({
        elapsedMs: 2_000,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: "webSearch",
        adhdAssist: true,
      }),
    ).toBe("searching_web");
  });

  it("prefers generating once assistant text is visible", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 30_000,
        hasAssistantText: true,
        hasRoutedModel: true,
        activeToolName: "getInformation",
        adhdAssist: true,
      }),
    ).toBe("generating");
  });

  it("acknowledges Assist buffering after a long silent wait", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: CHAT_PROGRESS_ASSIST_PREP_MS,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: null,
        adhdAssist: true,
      }),
    ).toBe("preparing_assist");

    expect(
      resolveChatProgressStageId({
        elapsedMs: CHAT_PROGRESS_ASSIST_PREP_MS,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: null,
        adhdAssist: false,
      }),
    ).toBe("waiting_for_model");
  });

  it("returns stage bookmarks rather than a fake wall-clock percent", () => {
    const waiting = resolveChatProgressStage({
      elapsedMs: 1_000,
      hasAssistantText: false,
      hasRoutedModel: true,
      activeToolName: null,
      adhdAssist: false,
    });
    const later = resolveChatProgressStage({
      elapsedMs: 20_000,
      hasAssistantText: false,
      hasRoutedModel: true,
      activeToolName: null,
      adhdAssist: false,
    });
    expect(waiting.id).toBe("waiting_for_model");
    expect(later.id).toBe("waiting_for_model");
    expect(waiting.progress).toBe(later.progress);
    expect(waiting.label).toMatch(/Waiting for model/i);
  });
});

describe("formatChatProgressElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatChatProgressElapsed(0)).toBe("0s");
    expect(formatChatProgressElapsed(12_400)).toBe("12s");
    expect(formatChatProgressElapsed(65_000)).toBe("1m 5s");
  });
});

describe("assistantMessageHasText / activeToolNameFromMessage", () => {
  it("detects text parts and string content", () => {
    expect(
      assistantMessageHasText({
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
      }),
    ).toBe(true);
    expect(
      assistantMessageHasText({ role: "assistant", content: "  hi  " }),
    ).toBe(true);
    expect(
      assistantMessageHasText({
        role: "assistant",
        parts: [{ type: "text", text: "   " }],
      }),
    ).toBe(false);
    expect(assistantMessageHasText({ role: "user", content: "hi" })).toBe(false);
  });

  it("returns only in-progress tool invocations (not completed ones)", () => {
    expect(
      activeToolNameFromMessage({
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: { toolName: "getInformation", state: "call" },
          },
        ],
      }),
    ).toBe("getInformation");

    expect(
      activeToolNameFromMessage({
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: { toolName: "webSearch", state: "result" },
          },
        ],
      }),
    ).toBeNull();
  });

  it("lets Assist prep win after RAG tools finish (#1171 review)", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: CHAT_PROGRESS_ASSIST_PREP_MS,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: activeToolNameFromMessage({
          role: "assistant",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: { toolName: "getInformation", state: "result" },
            },
          ],
        }),
        adhdAssist: true,
      }),
    ).toBe("preparing_assist");
  });
});

describe("shouldApplyAssistiveDisplayTransform", () => {
  const complete = `**Top summary**
- Point

**Next?** Want to continue?`;

  it("always applies when not streaming", () => {
    expect(shouldApplyAssistiveDisplayTransform("partial", false)).toBe(true);
  });

  it("applies mid-stream only when Top summary + Next? are both present", () => {
    expect(shouldApplyAssistiveDisplayTransform(complete, true)).toBe(true);
    expect(
      shouldApplyAssistiveDisplayTransform("**Top summary**\n- Point", true),
    ).toBe(false);
    expect(shouldApplyAssistiveDisplayTransform("hello", true)).toBe(false);
  });
});
