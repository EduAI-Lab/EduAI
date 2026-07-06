// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/logging.server", () => ({
  logSystemError: vi.fn().mockResolvedValue(undefined),
}));

import { cascadeDeleteToExtensions } from "~/lib/courses/cascadeDelete.server";
import { logSystemError } from "~/lib/logging.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EDUAI_API_KEY", "test-service-key");
  vi.stubEnv("QM_BACKEND_URL", "http://qm.test");
  vi.stubEnv("AI_TUTOR_SERVER_URL", "http://ai-tutor.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cascadeDeleteToExtensions", () => {
  it("calls both extensions' internal delete endpoints with the service key", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    await cascadeDeleteToExtensions("course-1");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://qm.test/api/internal/courses/course-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer test-service-key" },
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "http://ai-tutor.test/api/internal/courses/course-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer test-service-key" },
      }),
    );
    expect(logSystemError).not.toHaveBeenCalled();
  });

  it("logs but does not throw when one extension responds with a non-2xx status", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("http://qm.test")) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(cascadeDeleteToExtensions("course-1")).resolves.toBeUndefined();

    expect(logSystemError).toHaveBeenCalledTimes(1);
    expect(logSystemError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "API",
        code: "CASCADE_DELETE_EXTENSION_FAILED",
        details: expect.objectContaining({ courseId: "course-1", extension: "question-maker", status: 500 }),
      }),
    );
  });

  it("logs but does not throw when an extension is unreachable", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(cascadeDeleteToExtensions("course-1")).resolves.toBeUndefined();

    expect(logSystemError).toHaveBeenCalledTimes(2);
  });

  it("skips an extension whose base URL is not configured, without logging", async () => {
    vi.stubEnv("AI_TUTOR_SERVER_URL", "");
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    await cascadeDeleteToExtensions("course-1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://qm.test/api/internal/courses/course-1",
      expect.anything(),
    );
    expect(logSystemError).not.toHaveBeenCalled();
  });

  it("skips both extensions and never throws when EDUAI_API_KEY is unset", async () => {
    vi.stubEnv("EDUAI_API_KEY", "");
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await cascadeDeleteToExtensions("course-1");

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
