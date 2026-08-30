/**
 * Unit tests for authService.findOrCreateUser without a real DB or network needed.
 * Mocks the Prisma client only — no demo-course seeding happens on the
 * login path anymore (see tests/helpers/seedCoursesFixture.js for the retired
 * seeding logic, now a test-only fixture).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: { user: { upsert } },
}));

const {
  findOrCreateUser,
  forgetUserRow,
  resetUserRowCacheForTests,
  USER_ROW_CACHE_MAX,
  USER_ROW_CACHE_TTL_MS,
} = await import("../../src/services/authService.js");

// The cache knobs are env-configurable, so the timing/size assertions below
// derive from the resolved values rather than hardcoding the defaults.
const cacheEnabled = USER_ROW_CACHE_TTL_MS > 0 && USER_ROW_CACHE_MAX > 0;

describe("findOrCreateUser", () => {
  beforeEach(() => {
    upsert.mockReset();
    resetUserRowCacheForTests();
  });

  it("upserts the local row without returning it", async () => {
    upsert.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice" });

    const result = await findOrCreateUser({ id: "u1", email: "a@b.com", name: "Alice" });

    expect(result).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
  });

  it("creates a local user row when none exists", async () => {
    const newUser = { id: "u2", email: "b@c.com", name: "Bob" };
    upsert.mockResolvedValue(newUser);

    await findOrCreateUser({ id: "u2", email: "b@c.com", name: "Bob" });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u2" },
        update: {},
        create: expect.objectContaining({ id: "u2", email: "b@c.com" }),
      }),
    );
  });

  it("stores null for name when not provided", async () => {
    const newUser = { id: "u7", email: "g@h.com", name: null };
    upsert.mockResolvedValue(newUser);

    await findOrCreateUser({ id: "u7", email: "g@h.com" });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ name: null }),
      }),
    );
  });
});

/**
 * The upsert is `update: {}` by design, so once the row exists every repeat is
 * a write that changes nothing. requireAuth runs on ~80 handlers, so the id is
 * memoized and the upsert skipped in the steady state (#1388).
 */
describe("findOrCreateUser user row cache", () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice" });
    resetUserRowCacheForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(!cacheEnabled)("skips the upsert on a repeat call for the same user", async () => {
    const coreUser = { id: "u1", email: "a@b.com", name: "Alice" };

    await findOrCreateUser(coreUser);
    await findOrCreateUser(coreUser);
    await findOrCreateUser(coreUser);

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it.skipIf(!cacheEnabled || USER_ROW_CACHE_MAX < 2)("upserts once per distinct user", async () => {
    await findOrCreateUser({ id: "u1", email: "a@b.com" });
    await findOrCreateUser({ id: "u2", email: "b@c.com" });
    await findOrCreateUser({ id: "u1", email: "a@b.com" });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.map(([arg]) => arg.where.id)).toEqual(["u1", "u2"]);
  });

  it.skipIf(!cacheEnabled)("re-upserts after forgetUserRow evicts the entry", async () => {
    await findOrCreateUser({ id: "u1", email: "a@b.com" });
    forgetUserRow("u1");
    await findOrCreateUser({ id: "u1", email: "a@b.com" });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it.skipIf(!cacheEnabled)(
    "repairs a deleted row before the first FK-dependent write when the cache is bypassed",
    async () => {
      let localRowExists = false;
      upsert.mockImplementation(async ({ create }) => {
        localRowExists = true;
        return create;
      });
      const createDependentRecord = vi.fn(async ({ data }) => {
        if (!localRowExists) throw new Error("P2003");
        return data;
      });
      const coreUser = { id: "u1", email: "a@b.com" };

      await findOrCreateUser(coreUser);
      localRowExists = false;
      await findOrCreateUser(coreUser); // live cache hit does no DB work
      expect(upsert).toHaveBeenCalledTimes(1);

      await findOrCreateUser(coreUser, { skipCache: true });
      await expect(createDependentRecord({ data: { userId: coreUser.id } })).resolves.toEqual({
        userId: coreUser.id,
      });
      expect(upsert).toHaveBeenCalledTimes(2);
    },
  );

  it("retries the upsert when the first attempt fails", async () => {
    upsert.mockRejectedValueOnce(new Error("db down"));

    await expect(findOrCreateUser({ id: "u1", email: "a@b.com" })).rejects.toThrow("db down");
    await findOrCreateUser({ id: "u1", email: "a@b.com" });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it.skipIf(!cacheEnabled)("upserts again once the entry goes stale", async () => {
    vi.useFakeTimers();

    await findOrCreateUser({ id: "u1", email: "a@b.com" });
    vi.advanceTimersByTime(USER_ROW_CACHE_TTL_MS + 1);
    await findOrCreateUser({ id: "u1", email: "a@b.com" });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("returns nothing on either path so callers do not rely on the row", async () => {
    const first = await findOrCreateUser({ id: "u1", email: "a@b.com" });
    const second = await findOrCreateUser({ id: "u1", email: "a@b.com" });

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
  });
});

/** Reimports authService with `env` applied, then restores the previous values. */
async function importWithEnv(env) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  vi.resetModules();
  try {
    return await import("../../src/services/authService.js");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  }
}

/**
 * The cache knobs are read once at import, so these cases reimport the module
 * under a controlled environment rather than mutating the live constants.
 */
describe("user row cache configuration", () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice" });
  });

  it("falls back to the defaults when the env vars are absent, blank, or not numeric", async () => {
    const absent = await importWithEnv({
      USER_ROW_CACHE_TTL_MS: undefined,
      USER_ROW_CACHE_MAX: undefined,
    });
    expect(absent.USER_ROW_CACHE_TTL_MS).toBe(15 * 60_000);
    expect(absent.USER_ROW_CACHE_MAX).toBe(5_000);

    const blank = await importWithEnv({ USER_ROW_CACHE_TTL_MS: "   ", USER_ROW_CACHE_MAX: "" });
    expect(blank.USER_ROW_CACHE_TTL_MS).toBe(15 * 60_000);
    expect(blank.USER_ROW_CACHE_MAX).toBe(5_000);

    const invalid = await importWithEnv({
      USER_ROW_CACHE_TTL_MS: "soon",
      USER_ROW_CACHE_MAX: "-1",
    });
    expect(invalid.USER_ROW_CACHE_TTL_MS).toBe(15 * 60_000);
    expect(invalid.USER_ROW_CACHE_MAX).toBe(5_000);
  });

  it('honours an explicit 0 as "disable the cache" rather than falling back', async () => {
    const disabled = await importWithEnv({ USER_ROW_CACHE_TTL_MS: "0" });
    expect(disabled.USER_ROW_CACHE_TTL_MS).toBe(0);

    await disabled.findOrCreateUser({ id: "u1", email: "a@b.com" });
    await disabled.findOrCreateUser({ id: "u1", email: "a@b.com" });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("never exceeds USER_ROW_CACHE_MAX, dropping expired entries before live ones", async () => {
    vi.useFakeTimers();
    try {
      const bounded = await importWithEnv({
        USER_ROW_CACHE_MAX: "2",
        USER_ROW_CACHE_TTL_MS: "1000",
      });

      // u1 goes stale, so the size-bound sweep can reclaim its slot without
      // evicting anyone still live.
      await bounded.findOrCreateUser({ id: "u1", email: "a@b.com" });
      vi.advanceTimersByTime(1001);
      await bounded.findOrCreateUser({ id: "u2", email: "b@c.com" });
      await bounded.findOrCreateUser({ id: "u3", email: "c@d.com" });
      upsert.mockClear();

      // u2 and u3 are still memoized; u1 was reclaimed and has to upsert again.
      await bounded.findOrCreateUser({ id: "u2", email: "b@c.com" });
      await bounded.findOrCreateUser({ id: "u3", email: "c@d.com" });
      expect(upsert).not.toHaveBeenCalled();

      await bounded.findOrCreateUser({ id: "u1", email: "a@b.com" });
      expect(upsert).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the map when the bound is hit and every entry is still live", async () => {
    const bounded = await importWithEnv({
      USER_ROW_CACHE_MAX: "2",
      USER_ROW_CACHE_TTL_MS: "600000",
    });

    await bounded.findOrCreateUser({ id: "u1", email: "a@b.com" });
    await bounded.findOrCreateUser({ id: "u2", email: "b@c.com" });
    await bounded.findOrCreateUser({ id: "u3", email: "c@d.com" });
    upsert.mockClear();

    // Nothing was reclaimable, so the whole map was flushed: every user pays
    // one extra idempotent upsert, which is the documented trade for not
    // pulling in an LRU dependency.
    await bounded.findOrCreateUser({ id: "u2", email: "b@c.com" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
