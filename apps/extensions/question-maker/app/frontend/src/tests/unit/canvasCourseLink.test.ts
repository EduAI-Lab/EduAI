/**
 * `getCourseMapping` answers a Core hiccup, a 500 and a dropped connection with
 * the same `null` a genuinely unlinked course returns. The course page hides
 * the Canvas tab, both import entry points and the bank-sync button on that
 * `null`, so one transient failure used to strip every Canvas affordance from a
 * linked course with nothing on screen to explain it (#1652 review).
 *
 * `getCourseLink` keeps the failure separate so a caller can hold the UI still.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();

vi.mock("../../services/api", () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

const { canvasService } = await import("../../services/canvasService");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canvasService.getCourseLink", () => {
  it("reports a linked course with its mapping", async () => {
    apiGet.mockResolvedValue({
      data: { data: { localCourseId: 5, canvasCourseId: 999, canvasCourseName: "CS 101" } },
    });

    await expect(canvasService.getCourseLink(5)).resolves.toEqual({
      status: "linked",
      mapping: { localCourseId: 5, canvasCourseId: 999, canvasCourseName: "CS 101" },
    });
  });

  it("reports an answered 'no link' as unlinked", async () => {
    apiGet.mockResolvedValue({ data: { data: null } });

    await expect(canvasService.getCourseLink(5)).resolves.toEqual({ status: "unlinked" });
  });

  it("reports a failed lookup as unknown, never as unlinked", async () => {
    apiGet.mockRejectedValue(Object.assign(new Error("Service Unavailable"), { status: 503 }));

    await expect(canvasService.getCourseLink(5)).resolves.toEqual({ status: "unknown" });
  });
});
