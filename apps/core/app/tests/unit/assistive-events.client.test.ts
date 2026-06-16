import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postAssistiveEvent } from "~/lib/assistive-events.client";

describe("postAssistiveEvent", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 201 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/assistive-events with the payload", async () => {
    await postAssistiveEvent({
      eventType: "task_initiation",
      adhdAssist: true,
      metrics: { durationMs: 1200, success: true },
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/assistive-events",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "task_initiation",
          adhdAssist: true,
          metrics: { durationMs: 1200, success: true },
        }),
      }),
    );
  });

  it("includes chatId when provided", async () => {
    await postAssistiveEvent({
      eventType: "re_orientation",
      chatId: "cjld2cjxh0000qzrmn831i7rn",
      adhdAssist: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/assistive-events",
      expect.objectContaining({
        body: JSON.stringify({
          eventType: "re_orientation",
          chatId: "cjld2cjxh0000qzrmn831i7rn",
          adhdAssist: false,
        }),
      }),
    );
  });

  it("swallows network errors without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));

    await expect(
      postAssistiveEvent({ eventType: "mode_toggled", metrics: { fromMode: false, toMode: true } }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
