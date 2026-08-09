// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    assistiveEvent: {
      create: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import {
  recordResponseComplianceEvent,
  sanitizeClientMetrics,
  isAssistiveClientEventType,
} from "~/lib/assistive-events.server";

const db = prisma as unknown as {
  assistiveEvent: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordResponseComplianceEvent", () => {
  it("persists derived metrics without assistant text", async () => {
    await recordResponseComplianceEvent({
      userId: "u1",
      chatId: "c1",
      adhdAssist: true,
      assistantText: "**Top summary**\n- A\n\n**Next?** More?",
      extras: { model: "google:gemini-2.5-flash", finishReason: "stop" },
    });

    expect(db.assistiveEvent.create).toHaveBeenCalledOnce();
    const arg = db.assistiveEvent.create.mock.calls[0][0];
    expect(arg.data.userId).toBe("u1");
    expect(arg.data.chatId).toBe("c1");
    expect(arg.data.adhdAssist).toBe(true);
    expect(arg.data.eventType).toBe("response_compliance");
    expect(arg.data.metricsJson).toMatchObject({
      topSummary: true,
      nextLine: true,
      structuralPass: true,
      model: "google:gemini-2.5-flash",
      finishReason: "stop",
    });
    expect(JSON.stringify(arg.data.metricsJson)).not.toContain("Top summary");
  });

  it("persists oversight timing and token fields", async () => {
    await recordResponseComplianceEvent({
      userId: "u1",
      chatId: "c1",
      adhdAssist: true,
      assistantText: "**Top summary**\n- A\n\n**Next?** More?",
      extras: {
        wordCap: 120,
        oversightDurationMs: 842,
        oversightPromptTokens: 90,
        oversightCompletionTokens: 40,
        oversightMethod: "deterministic",
        preStructuralPass: false,
      },
    });

    expect(db.assistiveEvent.create.mock.calls[0][0].data.metricsJson).toMatchObject({
      oversightDurationMs: 842,
      oversightPromptTokens: 90,
      oversightCompletionTokens: 40,
      oversightMethod: "deterministic",
      preStructuralPass: false,
    });
  });

  it("persists responseProfile and profileStructuralPass without message text", async () => {
    await recordResponseComplianceEvent({
      userId: "u1",
      chatId: "c1",
      adhdAssist: true,
      assistantText:
        "That's a separate question from dishwashing. Want to come back to the dish steps first?",
      extras: {
        wordCap: 120,
        responseProfile: "redirect",
        profileStructuralPass: true,
      },
    });

    const metricsJson = db.assistiveEvent.create.mock.calls[0][0].data.metricsJson;
    expect(metricsJson).toMatchObject({
      responseProfile: "redirect",
      profileStructuralPass: true,
    });
    expect(JSON.stringify(metricsJson)).not.toContain("dishwashing");
  });

  it("stamps the policy version, tool usage, and urgency/source metrics on Assist turns", async () => {
    await recordResponseComplianceEvent({
      userId: "u1",
      chatId: "c1",
      adhdAssist: true,
      assistantText: "**Top summary**\n- A\n\n**Sources** ch.2\n\n**Next?** More?",
      extras: { toolsUsed: true },
    });

    const metricsJson = db.assistiveEvent.create.mock.calls[0][0].data.metricsJson;
    expect(metricsJson).toMatchObject({
      policyVersion: "2.3",
      toolsUsed: true,
      hasSources: true,
      noUrgency: true,
    });
  });

  it("does not stamp a policy version on baseline (non-Assist) turns", async () => {
    await recordResponseComplianceEvent({
      userId: "u1",
      chatId: "c1",
      adhdAssist: false,
      assistantText: "Plain baseline answer.",
    });

    const metricsJson = db.assistiveEvent.create.mock.calls[0][0].data.metricsJson;
    expect(metricsJson.policyVersion).toBeNull();
  });
});

describe("sanitizeClientMetrics", () => {
  it("keeps allowed scalar fields and drops unknown keys", () => {
    expect(
      sanitizeClientMetrics({
        durationMs: 1200.4,
        path: "/dashboard",
        secret: "nope",
        content: "should not store",
      }),
    ).toEqual({
      durationMs: 1200,
      path: "/dashboard",
    });
  });
});

describe("isAssistiveClientEventType", () => {
  it("accepts known client event types", () => {
    expect(isAssistiveClientEventType("expand_click")).toBe(true);
    expect(isAssistiveClientEventType("response_compliance")).toBe(false);
  });
});
