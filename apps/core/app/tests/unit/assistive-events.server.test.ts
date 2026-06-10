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
