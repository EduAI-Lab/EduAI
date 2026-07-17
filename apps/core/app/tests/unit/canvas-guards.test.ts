import { describe, expect, it } from "vitest";
import {
  canLinkCanvasRoster,
  canManageCanvasIntegration,
  isCanvasSyncRateLimited,
} from "~/lib/canvas/guards.server";

describe("canManageCanvasIntegration", () => {
  it("allows instructors and admins", () => {
    expect(canManageCanvasIntegration("INSTRUCTOR")).toBe(true);
    expect(canManageCanvasIntegration("ADMIN")).toBe(true);
  });

  it("denies students and TAs", () => {
    expect(canManageCanvasIntegration("STUDENT")).toBe(false);
    expect(canManageCanvasIntegration("TA")).toBe(false);
  });
});

describe("canLinkCanvasRoster", () => {
  it("allows students (platform role only; TAs checked via enrollment role)", () => {
    expect(canLinkCanvasRoster("STUDENT")).toBe(true);
  });

  it("denies instructors, admins, and unit admins", () => {
    expect(canLinkCanvasRoster("INSTRUCTOR")).toBe(false);
    expect(canLinkCanvasRoster("ADMIN")).toBe(false);
    expect(canLinkCanvasRoster("UNIT_ADMIN")).toBe(false);
  });
});

describe("isCanvasSyncRateLimited", () => {
  it("blocks repeated sync requests inside the window", () => {
    const userId = `sync-rate-limit-${Date.now()}`;
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
    expect(isCanvasSyncRateLimited(userId)).toBe(true);
  });
});
