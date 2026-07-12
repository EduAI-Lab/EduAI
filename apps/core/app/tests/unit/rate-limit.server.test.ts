import { describe, it, expect, vi, afterEach } from "vitest";
import { isRateLimited, resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetRateLimitsForTests();
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

// #990: the store must stay bounded even when many distinct keys never
// return, instead of growing forever as a slow memory leak.
describe("isRateLimited — bounded store (#990)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("evicts stale keys once the store exceeds RATE_LIMIT_MAX_KEYS", async () => {
    vi.resetModules();
    vi.stubEnv("RATE_LIMIT_MAX_KEYS", "3");
    const { isRateLimited: isRateLimitedBounded } = await import(
      "~/lib/auth/rate-limit.server"
    );

    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);

    // Three old keys that will never return...
    isRateLimitedBounded("stale-1", 5, 1_000);
    isRateLimitedBounded("stale-2", 5, 1_000);
    isRateLimitedBounded("stale-3", 5, 1_000);

    // ...advance well past STALE_ENTRY_MS (1h) so those keys are sweep-eligible.
    vi.setSystemTime(start + 61 * 60_000);

    // A fourth key pushes the store over the cap and triggers the sweep.
    isRateLimitedBounded("fresh-1", 5, 1_000);

    // The stale keys were evicted, so they behave like first-time callers again.
    expect(isRateLimitedBounded("stale-1", 1, 1_000)).toBe(false);
  });

  it("falls back to evicting the oldest key when every entry is still hot", async () => {
    vi.resetModules();
    vi.stubEnv("RATE_LIMIT_MAX_KEYS", "2");
    const { isRateLimited: isRateLimitedBounded } = await import(
      "~/lib/auth/rate-limit.server"
    );

    // Two hot keys, then a third — all within the window, so the sweep can't
    // reclaim anything and the oldest-inserted key ("hot-1") must be evicted.
    isRateLimitedBounded("hot-1", 5, 60_000);
    isRateLimitedBounded("hot-2", 5, 60_000);
    isRateLimitedBounded("hot-3", 5, 60_000);

    // hot-1's hit count was dropped by the fallback eviction, so it now reads
    // as a fresh key even though its most recent hit is still in-window.
    expect(isRateLimitedBounded("hot-1", 1, 60_000)).toBe(false);
  });
});
