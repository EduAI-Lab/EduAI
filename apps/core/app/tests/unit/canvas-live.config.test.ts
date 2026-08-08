import { describe, expect, it, vi } from "vitest";
import { verifyCanvasCredentials } from "~/lib/canvas/client.server";
import {
  CanvasLiveConfigError,
  assertApprovedTeacherCourse,
  loadCanvasLiveConfig,
} from "../live/canvas-live.config";

const validEnv = {
  CANVAS_LIVE_TESTS: "1",
  CANVAS_BASE_URL: "https://canvas.ubc.ca",
  CANVAS_TEST_COURSE_ID: "204888",
  CANVAS_TOKEN: "runtime-token-that-must-not-appear-in-errors",
  CANVAS_LIVE_CORE_USER_ID: "dev-instructor-id",
  CANVAS_LIVE_APPROVED_FILE_ID: "987654",
  ENCRYPTION_KEY: "live-test-encryption-key",
};

describe("Canvas live configuration", () => {
  it("skips when the explicit opt-in flag is absent", () => {
    expect(loadCanvasLiveConfig({})).toEqual({
      enabled: false,
      reason: "CANVAS_LIVE_TESTS is not set to 1",
    });
  });

  it("fails without a token and does not echo secret-bearing values", () => {
    const env = { ...validEnv, CANVAS_TOKEN: undefined };
    expect(() => loadCanvasLiveConfig(env)).toThrow("CANVAS_TOKEN or CANVAS_TOKEN_FILE");
    try {
      loadCanvasLiveConfig(env);
    } catch (error) {
      expect(String(error)).not.toContain(validEnv.CANVAS_TOKEN);
    }
  });

  it("rejects a non-allowlisted host", () => {
    expect(() => loadCanvasLiveConfig({ ...validEnv, CANVAS_BASE_URL: "https://canvas.example.com" })).toThrow(
      CanvasLiveConfigError,
    );
    expect(() => loadCanvasLiveConfig({ ...validEnv, CANVAS_BASE_URL: "https://canvas.example.com" })).toThrow(
      "not an allowlisted Canvas host",
    );
  });

  it("rejects a course other than the approved sandbox", () => {
    expect(() => loadCanvasLiveConfig({ ...validEnv, CANVAS_TEST_COURSE_ID: "1" })).toThrow(
      "approved sandbox course",
    );
  });

  it("reports missing teacher access without falling back to another course", () => {
    expect(() => assertApprovedTeacherCourse(["204887", "204889"], "204888")).toThrow(
      "not in the token owner's teacher course list",
    );
  });

  it("reports invalid tokens as authentication failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(verifyCanvasCredentials("http://localhost:8080", "secret-token", fetchImpl)).rejects.toThrow(
      "Invalid Canvas API token",
    );
  });

  it("reports Canvas 5xx and transport failures without unbounded retries", async () => {
    const serverErrorFetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(verifyCanvasCredentials("http://localhost:8080", "secret-token", serverErrorFetch)).rejects.toThrow(
      "Canvas returned 503",
    );

    const timeoutFetch = vi.fn().mockRejectedValue(new Error("timed out"));
    await expect(verifyCanvasCredentials("http://localhost:8080", "secret-token", timeoutFetch)).rejects.toThrow(
      "Could not reach Canvas",
    );
    expect(timeoutFetch).toHaveBeenCalledOnce();
  });
});
