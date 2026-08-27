import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockListCourseFacets } = vi.hoisted(() => ({
  mockListCourseFacets: vi.fn(),
}));

vi.mock("~/lib/api", () => ({
  default: {
    listCourseFacets: mockListCourseFacets,
  },
}));

import {
  clearCourseFacetsCache,
  EMPTY_COURSE_FACETS,
  loadCourseFacets,
} from "~/lib/course-facets";

describe("loadCourseFacets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCourseFacetsCache();
  });

  afterEach(() => {
    clearCourseFacetsCache();
  });

  it("returns the facets from the API", async () => {
    const facets = { terms: ["Fall"], statuses: ["PUBLISHED"], progress: [], coreUnavailable: false };
    mockListCourseFacets.mockResolvedValue(facets);
    await expect(loadCourseFacets()).resolves.toEqual(facets);
  });

  it("caches the result across calls within the TTL", async () => {
    mockListCourseFacets.mockResolvedValue(EMPTY_COURSE_FACETS);
    await loadCourseFacets();
    await loadCourseFacets();
    expect(mockListCourseFacets).toHaveBeenCalledTimes(1);
  });

  it("falls back to EMPTY_COURSE_FACETS when the API returns null/undefined", async () => {
    mockListCourseFacets.mockResolvedValue(null);
    await expect(loadCourseFacets()).resolves.toEqual(EMPTY_COURSE_FACETS);
  });

  it("does not cache a coreUnavailable response, so the next call retries", async () => {
    mockListCourseFacets.mockResolvedValueOnce({
      terms: [],
      statuses: [],
      progress: [],
      coreUnavailable: true,
    });
    const first = await loadCourseFacets();
    expect(first.coreUnavailable).toBe(true);

    mockListCourseFacets.mockResolvedValueOnce(EMPTY_COURSE_FACETS);
    const second = await loadCourseFacets();
    expect(second).toEqual(EMPTY_COURSE_FACETS);
    expect(mockListCourseFacets).toHaveBeenCalledTimes(2);
  });

  it("swallows API rejections and returns EMPTY_COURSE_FACETS, never caching the failure", async () => {
    mockListCourseFacets.mockRejectedValueOnce(new Error("network down"));
    await expect(loadCourseFacets()).resolves.toEqual(EMPTY_COURSE_FACETS);

    mockListCourseFacets.mockResolvedValueOnce({
      terms: ["Spring"],
      statuses: [],
      progress: [],
      coreUnavailable: false,
    });
    const second = await loadCourseFacets();
    expect(second.terms).toEqual(["Spring"]);
    expect(mockListCourseFacets).toHaveBeenCalledTimes(2);
  });

  it("clearCourseFacetsCache forces a refetch", async () => {
    mockListCourseFacets.mockResolvedValue(EMPTY_COURSE_FACETS);
    await loadCourseFacets();
    clearCourseFacetsCache();
    await loadCourseFacets();
    expect(mockListCourseFacets).toHaveBeenCalledTimes(2);
  });
});
