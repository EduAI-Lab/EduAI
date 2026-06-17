import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postAssistiveClientEvent } from "~/lib/assistive-events.client";

describe("postAssistiveClientEvent", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 201 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs sanitized client events to /api/assistive-events", async () => {
    postAssistiveClientEvent({
      eventType: "re_orientation",
      adhdAssist: true,
      chatId: "cjld2cjxh0000qzrmn831i7rn",
      metrics: { durationMs: 420, path: "/chat" },
    });

    await Promise.resolve();

    expect(fetch).toHaveBeenCalledWith(
      "/api/assistive-events",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          eventType: "re_orientation",
          adhdAssist: true,
          chatId: "cjld2cjxh0000qzrmn831i7rn",
          metrics: { durationMs: 420, path: "/chat" },
        }),
      }),
    );
  });

  it("omits chatId when not provided", async () => {
    postAssistiveClientEvent({
      eventType: "task_initiation",
      adhdAssist: false,
    });

    await Promise.resolve();

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      eventType: "task_initiation",
      adhdAssist: false,
    });
  });
});
