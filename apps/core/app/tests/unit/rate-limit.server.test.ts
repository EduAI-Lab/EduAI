import { describe, it, expect, vi, afterEach } from "vitest";
import { isRateLimited, parseEnvInt, resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetRateLimitsForTests();
});

describe("parseEnvInt", () => {
  it("returns the fallback when the value is undefined", () => {
    expect(parseEnvInt(undefined, 20)).toBe(20);
  });

  it("returns the fallback — not 0 — when the value is an empty string", () => {
    // Number(process.env.X ?? fallback) only guards null/undefined; an
    // empty string skips the fallback and parses to 0.
    expect(parseEnvInt("", 20)).toBe(20);
  });

  it("returns the fallback when the value is not a finite number", () => {
    expect(parseEnvInt("not-a-number", 20)).toBe(20);
  });

  it("parses a valid numeric string", () => {
    expect(parseEnvInt("42", 20)).toBe(42);
  });
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

  // AUTH-05: `Number(env ?? 300)` turns a non-numeric override into NaN, and
  // `hits.length >= NaN` is always false, so the limiter never trips. The
  // default parameter must go through `parseEnvInt` and fail closed to the
  // 300 default instead.
  it("falls back to the 300 default (fail-closed) when SESSION_VALIDATE_RATE_LIMIT is not numeric", () => {
    vi.stubEnv("SESSION_VALIDATE_RATE_LIMIT", "not-a-number");
    for (let i = 0; i < 300; i++) {
      expect(isRateLimited("10.0.0.8")).toBe(false);
    }
    expect(isRateLimited("10.0.0.8")).toBe(true);
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

  it("does not treat RATE_LIMIT_MAX_KEYS='' as a cap of 0", async () => {
    vi.resetModules();
    vi.stubEnv("RATE_LIMIT_MAX_KEYS", "");
    const { isRateLimited: isRateLimitedBounded } = await import(
      "~/lib/auth/rate-limit.server"
    );

    // A cap of 0 would trigger eviction on every single insert. With the
    // empty string falling back to the 50k default, a handful of keys
    // should coexist untouched.
    isRateLimitedBounded("k1", 5, 60_000);
    isRateLimitedBounded("k2", 5, 60_000);
    expect(isRateLimitedBounded("k1", 1, 60_000)).toBe(true);
  });

  it("evicts below the cap (not just back to it) so a sweep isn't re-triggered on the very next insert", async () => {
    vi.resetModules();
    vi.stubEnv("RATE_LIMIT_MAX_KEYS", "10");
    const { isRateLimited: isRateLimitedBounded } = await import(
      "~/lib/auth/rate-limit.server"
    );

    // Fill past the cap once, forcing the oldest-key fallback eviction.
    for (let i = 0; i < 11; i++) {
      isRateLimitedBounded(`hot-${i}`, 5, 60_000);
    }

    // The most recently inserted keys should have survived the eviction and
    // still be tracked as repeat callers (not reset to fresh).
    expect(isRateLimitedBounded("hot-10", 1, 60_000)).toBe(true);
  });
});
