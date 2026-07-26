import { afterEach, describe, expect, it, vi } from "vitest";
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

// AUTH-05/CANVAS-13: `Number(env ?? fallback)` yields NaN for a non-numeric
// override, and `hits.length >= NaN` is always false, so the limiter never
// trips. These constants are read at module load, so each case re-imports
// the module under a stubbed env to exercise that read.
describe("Canvas rate limits — invalid env fails closed (AUTH-05/CANVAS-13)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back to the default sync limit (1) when CANVAS_SYNC_RATE_LIMIT is not numeric", async () => {
    vi.resetModules();
    vi.stubEnv("CANVAS_SYNC_RATE_LIMIT", "not-a-number");
    const { isCanvasSyncRateLimited: syncLimited } = await import("~/lib/canvas/guards.server");

    const userId = `sync-nan-${Date.now()}`;
    expect(syncLimited(userId)).toBe(false);
    expect(syncLimited(userId)).toBe(true);
  });

  it("falls back to the default link-roster limit (10) when CANVAS_LINK_ROSTER_RATE_LIMIT is an empty string", async () => {
    vi.resetModules();
    vi.stubEnv("CANVAS_LINK_ROSTER_RATE_LIMIT", "");
    const { isCanvasLinkRosterRateLimited: linkLimited } = await import(
      "~/lib/canvas/guards.server"
    );

    const userId = `link-empty-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(linkLimited(userId)).toBe(false);
    }
    expect(linkLimited(userId)).toBe(true);
  });
});
