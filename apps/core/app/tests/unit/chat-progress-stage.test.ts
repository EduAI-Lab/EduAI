import { describe, it, expect } from "vitest";
import {
  CHAT_PROGRESS_ASSIST_PREP_MS,
  CHAT_PROGRESS_IN_FLIGHT_CAP,
  CHAT_PROGRESS_ROUTING_MS,
  activeToolNameFromMessage,
  assistantMessageHasText,
  computeTimedChatProgress,
  estimateExpectedResponseMs,
  formatChatProgressElapsed,
  hasIncompleteEduaiDiagramFence,
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

  it("prefers in-progress tools over generating when text already exists", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 30_000,
        hasAssistantText: true,
        hasRoutedModel: true,
        activeToolName: "getInformation",
        adhdAssist: true,
      }),
    ).toBe("searching_materials");
  });

  it("maps unknown in-progress tools to working", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 2_000,
        hasAssistantText: false,
        hasRoutedModel: true,
        activeToolName: "listUsers",
        adhdAssist: false,
      }),
    ).toBe("working");
  });

  it("uses generating when text exists and no tool is active", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 30_000,
        hasAssistantText: true,
        hasRoutedModel: true,
        activeToolName: null,
        adhdAssist: true,
      }),
    ).toBe("generating");
  });

  it("uses generating while awaiting post-tool follow-up tokens", () => {
    expect(
      resolveChatProgressStageId({
        elapsedMs: 8_000,
        hasAssistantText: true,
        hasRoutedModel: true,
        activeToolName: null,
        adhdAssist: false,
        awaitingFollowup: true,
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

  it("returns a stable stage floor for waiting_for_model", () => {
    const waiting = resolveChatProgressStage({
      elapsedMs: 1_000,
      hasAssistantText: false,
      hasRoutedModel: true,
      activeToolName: null,
      adhdAssist: false,
    });
    expect(waiting.id).toBe("waiting_for_model");
    expect(waiting.progress).toBeGreaterThan(0);
    expect(waiting.label).toMatch(/Waiting for model/i);
  });

  it("uses an Assist label that covers TTFT and oversight, not oversight-only", () => {
    const stage = resolveChatProgressStage({
      elapsedMs: CHAT_PROGRESS_ASSIST_PREP_MS,
      hasAssistantText: false,
      hasRoutedModel: true,
      activeToolName: null,
      adhdAssist: true,
    });
    expect(stage.id).toBe("preparing_assist");
    expect(stage.label).toMatch(/Working on Assist reply/i);
  });
});

describe("formatChatProgressElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatChatProgressElapsed(0)).toBe("0s");
    expect(formatChatProgressElapsed(12_400)).toBe("12s");
    expect(formatChatProgressElapsed(65_000)).toBe("1m 5s");
  });
});

describe("estimateExpectedResponseMs / computeTimedChatProgress", () => {
  it("expects cloud models to be faster than local 32B", () => {
    const cloud = estimateExpectedResponseMs({
      modelId: "google:gemini-2.5-flash",
      adhdAssist: false,
    });
    const local32 = estimateExpectedResponseMs({
      modelId: "vllm:qwen2.5-32b-instruct",
      adhdAssist: false,
    });
    const assist32 = estimateExpectedResponseMs({
      modelId: "vllm:qwen2.5-32b-instruct",
      adhdAssist: true,
    });
    expect(cloud).toBeLessThan(local32);
    expect(local32).toBeLessThan(assist32);
  });

  it("fills the bar as elapsed approaches the expected duration", () => {
    const expectedMs = 20_000;
    const early = computeTimedChatProgress({
      elapsedMs: 2_000,
      expectedMs,
      stageFloor: 18,
    });
    const mid = computeTimedChatProgress({
      elapsedMs: 10_000,
      expectedMs,
      stageFloor: 18,
    });
    const atExpected = computeTimedChatProgress({
      elapsedMs: expectedMs,
      expectedMs,
      stageFloor: 18,
    });

    expect(early.percent).toBeLessThan(mid.percent);
    expect(mid.percent).toBeLessThan(atExpected.percent);
    expect(atExpected.percent).toBeLessThanOrEqual(90);
    expect(early.timingLabel).toMatch(/About .* left/i);
    expect(early.isOverExpected).toBe(false);
  });

  it("never hits 100% while in flight and labels overruns honestly", () => {
    const over = computeTimedChatProgress({
      elapsedMs: 60_000,
      expectedMs: 20_000,
      stageFloor: 18,
    });
    expect(over.percent).toBeLessThanOrEqual(CHAT_PROGRESS_IN_FLIGHT_CAP);
    expect(over.percent).toBeLessThan(100);
    expect(over.isOverExpected).toBe(true);
    expect(over.timingLabel).toMatch(/longer than usual/i);
  });

  it("respects the stage floor so tool stages still nudge the bar", () => {
    const timed = computeTimedChatProgress({
      elapsedMs: 500,
      expectedMs: 40_000,
      stageFloor: 38,
    });
    expect(timed.percent).toBeGreaterThanOrEqual(38);
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

  it("defers while an eduai-diagram fence is still open", () => {
    const openFence = `${complete}\n\n\`\`\`eduai-diagram\nprocess-flow\nA — incomplete`;
    expect(hasIncompleteEduaiDiagramFence(openFence)).toBe(true);
    expect(shouldApplyAssistiveDisplayTransform(openFence, true)).toBe(false);

    const closedFence = `${complete}\n\n\`\`\`eduai-diagram\nprocess-flow\nA — done\n\`\`\``;
    expect(hasIncompleteEduaiDiagramFence(closedFence)).toBe(false);
    expect(shouldApplyAssistiveDisplayTransform(closedFence, true)).toBe(true);
  });

  it("ignores unrelated open code fences after a closed eduai-diagram", () => {
    const withTrailingCode = `${complete}

\`\`\`eduai-diagram
process-flow
A — done
\`\`\`

\`\`\`js
console.log("still open`;
    expect(hasIncompleteEduaiDiagramFence(withTrailingCode)).toBe(false);
    expect(shouldApplyAssistiveDisplayTransform(withTrailingCode, true)).toBe(
      true,
    );
  });
});

describe("assistantMessageHasText — object content", () => {
  it("reads .text from object content when parts lack text", () => {
    expect(
      assistantMessageHasText({
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: { toolName: "getInformation", state: "result" },
          },
        ],
        content: { text: "From content object" },
      }),
    ).toBe(true);
  });
});
