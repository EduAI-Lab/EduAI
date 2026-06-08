import { describe, it, expect, vi, afterEach } from "vitest";
import { isRateLimited } from "~/lib/auth/rate-limit.server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("isRateLimited", () => {
  it("returns false on the first request from an IP", () => {
    expect(isRateLimited("10.0.0.1", 3, 60_000)).toBe(false);
  });

  it("returns false while the request count is at the limit", () => {
    isRateLimited("10.0.0.2", 3, 60_000);
    isRateLimited("10.0.0.2", 3, 60_000);
    expect(isRateLimited("10.0.0.2", 3, 60_000)).toBe(false);
  });

  it("returns true on the request that exceeds the limit", () => {
    isRateLimited("10.0.0.3", 2, 60_000);
    isRateLimited("10.0.0.3", 2, 60_000);
    expect(isRateLimited("10.0.0.3", 2, 60_000)).toBe(true);
  });

  it("tracks each IP address independently", () => {
    isRateLimited("10.0.0.4", 1, 60_000);
    expect(isRateLimited("10.0.0.4", 1, 60_000)).toBe(true);
    expect(isRateLimited("10.0.0.5", 1, 60_000)).toBe(false);
  });

  it("does not count hits that fall outside the time window", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);

    isRateLimited("10.0.0.6", 1, 1_000);
    vi.setSystemTime(start + 2_000); // advance past the 1 s window

    expect(isRateLimited("10.0.0.6", 1, 1_000)).toBe(false);
  });

  it("reads the limit from SESSION_VALIDATE_RATE_LIMIT when no explicit limit is passed", () => {
    vi.stubEnv("SESSION_VALIDATE_RATE_LIMIT", "2");
    isRateLimited("10.0.0.7");
    isRateLimited("10.0.0.7");
    expect(isRateLimited("10.0.0.7")).toBe(true);
  });
});
