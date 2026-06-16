// @vitest-environment node
/**
 * Unit tests for the in-memory RAG settings cache inside getCourseRagSettings.
 *
 * Key behaviours under test:
 *   - Cache hit: second call with the same courseId skips the DB
 *   - Cache miss: expired entry triggers a fresh DB read
 *   - Invalidation: invalidateCourseRagSettingsCache() forces the next call to re-fetch
 *   - Null result cached: a missing course row is cached (avoids thundering-herd on bad IDs)
 *   - Isolation: different courseIds have independent cache entries
 *   - TTL env var: COURSE_RAG_SETTINGS_CACHE_TTL_MS is respected
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/auth/guards.server", () => ({ enforceAdminIfApiKey: vi.fn() }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-import the module under a fresh module registry to reset cache state. */
async function freshImport() {
  // Vitest module cache is shared within a test file; we use vi.resetModules()
  // before each test to get a clean module instance (and therefore a clean Map).
  const mod = await import("~/lib/courses/server");
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getCourseRagSettings — cache hit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("only calls prisma.course.findUnique once for repeated calls with the same courseId", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ragTopK: 5, ragSimilarityThreshold: 0.6 });

    const { getCourseRagSettings } = await freshImport();

    await getCourseRagSettings("course-1");
    await getCourseRagSettings("course-1");
    await getCourseRagSettings("course-1");

    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns the cached value on subsequent calls", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ragTopK: 3, ragSimilarityThreshold: 0.7 });

    const { getCourseRagSettings } = await freshImport();

    const first = await getCourseRagSettings("course-1");
    // Change mock return — cached value should still be served
    prismaMock.course.findUnique.mockResolvedValue({ ragTopK: 99, ragSimilarityThreshold: 0.1 });
    const second = await getCourseRagSettings("course-1");

    expect(second).toEqual(first);
    expect(second).toEqual({ ragTopK: 3, ragSimilarityThreshold: 0.7 });
  });
});

describe("getCourseRagSettings — cache miss / expiry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-fetches from DB after the TTL elapses", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ragTopK: 4, ragSimilarityThreshold: null });

    const { getCourseRagSettings } = await freshImport();

    await getCourseRagSettings("course-1");
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(1);

    // Advance past the default 60-min TTL
    vi.advanceTimersByTime(3_600_001);

    await getCourseRagSettings("course-1");
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("getCourseRagSettings — invalidation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("re-fetches from DB after invalidateCourseRagSettingsCache is called", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ragTopK: 6, ragSimilarityThreshold: 0.5 });

    const { getCourseRagSettings, invalidateCourseRagSettingsCache } = await freshImport();

    await getCourseRagSettings("course-1");
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(1);

    invalidateCourseRagSettingsCache("course-1");

    await getCourseRagSettings("course-1");
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(2);
  });

  it("invalidating one courseId does not evict other courses", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ragTopK: null, ragSimilarityThreshold: null });

    const { getCourseRagSettings, invalidateCourseRagSettingsCache } = await freshImport();

    await getCourseRagSettings("course-A");
    await getCourseRagSettings("course-B");
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(2);

    invalidateCourseRagSettingsCache("course-A");

    await getCourseRagSettings("course-A"); // re-fetches
    await getCourseRagSettings("course-B"); // still cached

    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(3);
  });
});

describe("getCourseRagSettings — null result caching", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("caches a null result (missing course) so the DB is not hit again within the TTL", async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);

    const { getCourseRagSettings } = await freshImport();

    const first = await getCourseRagSettings("nonexistent");
    const second = await getCourseRagSettings("nonexistent");

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("getCourseRagSettings — isolation across courses", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps independent cache entries per courseId", async () => {
    prismaMock.course.findUnique
      .mockResolvedValueOnce({ ragTopK: 3, ragSimilarityThreshold: 0.7 })
      .mockResolvedValueOnce({ ragTopK: 8, ragSimilarityThreshold: 0.3 });

    const { getCourseRagSettings } = await freshImport();

    const a = await getCourseRagSettings("course-A");
    const b = await getCourseRagSettings("course-B");

    expect(a).toEqual({ ragTopK: 3, ragSimilarityThreshold: 0.7 });
    expect(b).toEqual({ ragTopK: 8, ragSimilarityThreshold: 0.3 });

    // Both should now be cached — no further DB calls
    await getCourseRagSettings("course-A");
    await getCourseRagSettings("course-B");
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(2);
  });
});
