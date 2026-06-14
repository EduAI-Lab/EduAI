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
  it("allows students and TAs", () => {
    expect(canLinkCanvasRoster("STUDENT")).toBe(true);
    expect(canLinkCanvasRoster("TA")).toBe(true);
  });

  it("denies instructors and admins", () => {
    expect(canLinkCanvasRoster("INSTRUCTOR")).toBe(false);
    expect(canLinkCanvasRoster("ADMIN")).toBe(false);
  });
});

describe("isCanvasSyncRateLimited", () => {
  it("blocks repeated sync requests inside the window", () => {
    const userId = `sync-rate-limit-${Date.now()}`;
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
    expect(isCanvasSyncRateLimited(userId)).toBe(true);
  });
});
