/**
 * Unit tests for `canvasService` (#1546): Canvas integration client, including
 * the test-mode fallback branches in `connectCanvasWithFallback`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("../../services/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

vi.mock("../../services/canvasDefaults", () => ({
  getCanvasDefaultUrl: () => "https://canvas.default.test",
}));

import { canvasService } from "../../services/canvasService";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("canvasService.getIntegration", () => {
  it("returns the integration on success", async () => {
    get.mockResolvedValue({
      data: { data: { canvasUrl: "u", isTestMode: false, isConnected: true } },
    });
    const integration = await canvasService.getIntegration();
    expect(integration).toEqual({ canvasUrl: "u", isTestMode: false, isConnected: true });
  });

  it("returns null and swallows errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockRejectedValue(new Error("down"));
    await expect(canvasService.getIntegration()).resolves.toBeNull();
  });
});

describe("canvasService.connectCanvas", () => {
  it("posts credentials and returns the integration", async () => {
    post.mockResolvedValue({
      data: { data: { canvasUrl: "u", isTestMode: true, isConnected: true } },
    });
    const result = await canvasService.connectCanvas("u", "key", true);
    expect(post).toHaveBeenCalledWith("/api/canvas/connect", {
      canvasUrl: "u",
      apiKey: "key",
      isTestMode: true,
    });
    expect(result.isTestMode).toBe(true);
  });
});

describe("canvasService.disconnectCanvas", () => {
  it("deletes the integration", async () => {
    del.mockResolvedValue({});
    await canvasService.disconnectCanvas();
    expect(del).toHaveBeenCalledWith("/api/canvas/disconnect");
  });
});

describe("canvasService.getCourses / getQuizzes / getQuizQuestions / getQuestionBanks / getQuestionBankQuestions", () => {
  it("all fall back to an empty array when data is missing", async () => {
    get.mockResolvedValue({ data: {} });
    await expect(canvasService.getCourses()).resolves.toEqual([]);
    await expect(canvasService.getQuizzes(1)).resolves.toEqual([]);
    await expect(canvasService.getQuizQuestions(1, 2)).resolves.toEqual([]);
    await expect(canvasService.getQuestionBanks(1)).resolves.toEqual([]);
    await expect(canvasService.getQuestionBankQuestions(1, 2)).resolves.toEqual([]);
  });

  it("getCourses returns data when present", async () => {
    get.mockResolvedValue({ data: { data: [{ id: 1, name: "C", course_code: "C1" }] } });
    await expect(canvasService.getCourses()).resolves.toEqual([
      { id: 1, name: "C", course_code: "C1" },
    ]);
  });
});

describe("canvasService.exportAssessment / getCourseMapping / importQuiz / importQuestionBank", () => {
  it("exportAssessment posts and unwraps data", async () => {
    post.mockResolvedValue({
      data: { data: { quizId: 1, quizTitle: "Q", questionsCreated: 5, canvasUrl: "u" } },
    });
    const result = await canvasService.exportAssessment(10, 20);
    // Quizzes publish by default so Canvas actually lists them (#1556).
    expect(post).toHaveBeenCalledWith("/api/canvas/export/10", {
      canvasCourseId: 20,
      published: true,
    });
    expect(result.quizId).toBe(1);
  });

  it("exportAssessment leaves the quiz a draft when published is false", async () => {
    post.mockResolvedValue({ data: { data: { quizId: 2 } } });
    await canvasService.exportAssessment(10, 20, { published: false });
    expect(post).toHaveBeenCalledWith("/api/canvas/export/10", {
      canvasCourseId: 20,
      published: false,
    });
  });

  it("getCourseLink reports a linked course with its mapping", async () => {
    get.mockResolvedValue({ data: { data: { canvasCourseId: 5, canvasCourseName: "Canvas 5" } } });
    await expect(canvasService.getCourseLink(1)).resolves.toEqual({
      status: "linked",
      mapping: { canvasCourseId: 5, canvasCourseName: "Canvas 5" },
    });
  });

  it.each([[null], [{ canvasCourseId: null }]])(
    "getCourseLink reports unlinked for mapping %s",
    async (mapping) => {
      get.mockResolvedValue({ data: { data: mapping } });
      await expect(canvasService.getCourseLink(1)).resolves.toEqual({ status: "unlinked" });
    },
  );

  it("getCourseLink keeps a request failure distinct from an unlinked course", async () => {
    get.mockRejectedValue(new Error("boom"));
    await expect(canvasService.getCourseLink(1)).resolves.toEqual({ status: "unknown" });
  });

  it("getCourseMapping returns null on error", async () => {
    get.mockRejectedValue(new Error("nope"));
    await expect(canvasService.getCourseMapping(1)).resolves.toBeNull();
  });

  it("getCourseMapping returns data on success", async () => {
    get.mockResolvedValue({ data: { data: { canvasCourseId: 5 } } });
    await expect(canvasService.getCourseMapping(1)).resolves.toEqual({ canvasCourseId: 5 });
  });

  it("importQuiz posts options merged with local course id", async () => {
    post.mockResolvedValue({
      data: { data: { assessmentId: 1, assessmentName: "A", questionsImported: 3, sectionId: 9 } },
    });
    await canvasService.importQuiz(1, 2, 3, { primaryTopicId: 7, assessmentName: "A" });
    expect(post).toHaveBeenCalledWith("/api/canvas/import/1/quizzes/2", {
      localCourseId: 3,
      primaryTopicId: 7,
      assessmentName: "A",
    });
  });

  it("importQuestionBank posts the target bank options", async () => {
    post.mockResolvedValue({ data: { data: { bankId: "b", created: 1, updated: 0, skipped: 0 } } });
    await canvasService.importQuestionBank(1, 2, 3, { primaryTopicId: "7", targetBankId: "b1" });
    expect(post).toHaveBeenCalledWith("/api/canvas/import/1/banks/2", {
      localCourseId: 3,
      primaryTopicId: "7",
      targetBankId: "b1",
    });
  });
});

describe("canvasService.prefersTestMode", () => {
  it("reads VITE_CANVAS_TEST_MODE", () => {
    vi.stubEnv("VITE_CANVAS_TEST_MODE", "true");
    expect(canvasService.prefersTestMode()).toBe(true);
  });

  it("is false for any other value", () => {
    vi.stubEnv("VITE_CANVAS_TEST_MODE", "false");
    expect(canvasService.prefersTestMode()).toBe(false);
  });
});

describe("canvasService.connectCanvasWithFallback", () => {
  it("uses test mode directly when preferTestMode is set", async () => {
    post.mockResolvedValue({
      data: { data: { canvasUrl: "u", isTestMode: true, isConnected: true } },
    });
    const result = await canvasService.connectCanvasWithFallback("", "", { preferTestMode: true });
    expect(result.usedTestMode).toBe(true);
    expect(post).toHaveBeenCalledWith("/api/canvas/connect", {
      canvasUrl: "https://canvas.default.test",
      apiKey: "test-key",
      isTestMode: true,
    });
  });

  it("connects live when it succeeds", async () => {
    post.mockResolvedValue({
      data: { data: { canvasUrl: "live", isTestMode: false, isConnected: true } },
    });
    const result = await canvasService.connectCanvasWithFallback("live-url", "live-key");
    expect(result.usedTestMode).toBe(false);
    expect(post).toHaveBeenCalledWith("/api/canvas/connect", {
      canvasUrl: "live-url",
      apiKey: "live-key",
      isTestMode: false,
    });
  });

  it("falls back to test mode in DEV when the live connect fails", async () => {
    vi.stubEnv("DEV", true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    post.mockRejectedValueOnce(new Error("live failed")).mockResolvedValueOnce({
      data: { data: { canvasUrl: "fallback", isTestMode: true, isConnected: true } },
    });

    const result = await canvasService.connectCanvasWithFallback("live-url", "live-key");
    expect(result.usedTestMode).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("rethrows when not DEV and test mode isn't preferred", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CANVAS_TEST_MODE", "false");
    post.mockRejectedValue(new Error("live failed"));
    await expect(canvasService.connectCanvasWithFallback("live-url", "live-key")).rejects.toThrow(
      "live failed",
    );
  });
});
