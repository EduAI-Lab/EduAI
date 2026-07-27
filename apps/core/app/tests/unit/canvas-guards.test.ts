import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canLinkCanvasRoster,
  canManageCanvasIntegration,
  isCanvasLinkRosterRateLimited,
  isCanvasSyncRateLimited,
  resetCanvasRateLimitsForTests,
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks repeated sync requests inside the window", () => {
    const userId = `sync-rate-limit-${Date.now()}`;
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
    expect(isCanvasSyncRateLimited(userId)).toBe(true);
  });

  it("scopes the rate limit per user (does not leak into a different userId's bucket)", () => {
    const userA = `sync-rate-limit-a-${Date.now()}`;
    const userB = `sync-rate-limit-b-${Date.now()}`;
    expect(isCanvasSyncRateLimited(userA)).toBe(false);
    expect(isCanvasSyncRateLimited(userA)).toBe(true);
    // userB has never synced, so their own bucket must still be empty.
    expect(isCanvasSyncRateLimited(userB)).toBe(false);
  });

  it("allows a request again once the window has fully elapsed", () => {
    const userId = `sync-rate-limit-window-${Date.now()}`;
    vi.useFakeTimers();
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
    expect(isCanvasSyncRateLimited(userId)).toBe(true);
    // SYNC_RATE_WINDOW_MS default (no env override) is 30_000ms.
    vi.advanceTimersByTime(30_001);
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
  });

  it("treats a hit exactly at the window boundary (age == windowMs) as expired", () => {
    const userId = `sync-rate-limit-boundary-${Date.now()}`;
    vi.useFakeTimers();
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
    expect(isCanvasSyncRateLimited(userId)).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
  });
});

describe("isCanvasLinkRosterRateLimited", () => {
  it("blocks once the default limit (10) is exceeded, scoped per user", () => {
    const userId = `link-rate-limit-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
    }
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(true);

    const otherUserId = `link-rate-limit-other-${Date.now()}`;
    // A different user must have their own independent bucket.
    expect(isCanvasLinkRosterRateLimited(otherUserId)).toBe(false);
  });
});

describe("resetCanvasRateLimitsForTests", () => {
  it("clears in-memory rate-limit state so a previously blocked user is allowed again", () => {
    const userId = `reset-rate-limit-${Date.now()}`;
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
    expect(isCanvasSyncRateLimited(userId)).toBe(true);
    resetCanvasRateLimitsForTests();
    expect(isCanvasSyncRateLimited(userId)).toBe(false);
  });
});
