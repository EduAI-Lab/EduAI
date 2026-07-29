/**
 * Unit tests for the shared server-side pagination helpers (#1041, #1125).
 *
 * These four helpers are the whole contract every admin list endpoint shares,
 * so the behaviour worth locking in is the rejection matrix: paging is required
 * (no full-list fallback), `?ids=` bypasses paging and therefore cannot be
 * combined with it, and the id batch is capped so the escape hatch can't become
 * a full-table read. Clamping — not rejecting — out-of-range paging keeps stale
 * `?page=0` links working.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_IDS_PER_REQUEST,
  MAX_PAGE_SIZE,
  normalizePagination,
  paginatedResponse,
  parseIdsParam,
  parsePaginationParams,
  parseSearchParam,
  unpagedResponse,
} from "~/lib/pagination.server";

const params = (qs: string) => new URLSearchParams(qs);

async function bodyOf(response: Response) {
  return JSON.parse(await response.text());
}

describe("normalizePagination", () => {
  it("defaults to the first page at the default size", () => {
    expect(normalizePagination()).toEqual({
      safePage: 1,
      safePageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
    });
  });

  it("computes skip from the 1-based page", () => {
    expect(normalizePagination(3, 25)).toEqual({ safePage: 3, safePageSize: 25, skip: 50 });
  });

  it("clamps a stale page=0 link to the first page rather than erroring", () => {
    expect(normalizePagination(0, 25)).toMatchObject({ safePage: 1, skip: 0 });
  });

  it("clamps pageSize to MAX_PAGE_SIZE so a caller cannot ask for the whole table", () => {
    expect(normalizePagination(1, 5000).safePageSize).toBe(MAX_PAGE_SIZE);
  });

  it("clamps pageSize up to at least one row", () => {
    expect(normalizePagination(1, 0).safePageSize).toBe(1);
  });

  it("floors fractional paging", () => {
    expect(normalizePagination(2.7, 10.9)).toMatchObject({ safePage: 2, safePageSize: 10 });
  });

  it("falls back to defaults for non-finite input", () => {
    expect(normalizePagination(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      safePage: 1,
      safePageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
    });
  });
});

describe("parsePaginationParams", () => {
  it("returns clamped pagination plus Prisma's skip/take for a valid request", () => {
    const result = parsePaginationParams(params("page=2&pageSize=10"));

    expect(result).toEqual({
      pagination: { page: 2, pageSize: 10, skip: 10, take: 10 },
    });
  });

  it("400s with PAGINATION_REQUIRED when page is missing — there is no full-list fallback", async () => {
    const result = parsePaginationParams(params("pageSize=25"));

    expect("response" in result).toBe(true);
    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error ?? body.code).toBe("PAGINATION_REQUIRED");
    expect(JSON.stringify(body)).toContain("page");
  });

  it("400s with PAGINATION_REQUIRED when pageSize is missing", async () => {
    const result = parsePaginationParams(params("page=1"));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    expect(JSON.stringify(await bodyOf(response))).toContain("PAGINATION_REQUIRED");
  });

  it("400s with PAGINATION_REQUIRED when both are missing", async () => {
    const result = parsePaginationParams(params(""));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    expect(JSON.stringify(await bodyOf(response))).toContain("PAGINATION_REQUIRED");
  });

  it("400s with PAGINATION_INVALID for a present-but-unparseable value", async () => {
    const result = parsePaginationParams(params("page=abc&pageSize=25"));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    // Distinct from REQUIRED: the param was sent, it just isn't a number.
    expect(JSON.stringify(await bodyOf(response))).toContain("PAGINATION_INVALID");
  });

  it("clamps rather than rejecting an out-of-range but numeric page", () => {
    const result = parsePaginationParams(params("page=0&pageSize=9999"));

    expect(result).toEqual({
      pagination: { page: 1, pageSize: MAX_PAGE_SIZE, skip: 0, take: MAX_PAGE_SIZE },
    });
  });
});

describe("parseIdsParam", () => {
  it("returns null when ?ids= is absent, leaving the caller on the paged path", () => {
    expect(parseIdsParam(params("page=1&pageSize=25"))).toEqual({ ids: null });
  });

  it("parses, trims, and dedupes a comma-separated set", () => {
    expect(parseIdsParam(params("ids=a,%20b%20,a,c"))).toEqual({ ids: ["a", "b", "c"] });
  });

  it("400s with IDS_AND_PAGE_EXCLUSIVE when combined with page", async () => {
    const result = parseIdsParam(params("ids=a&page=1"));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    expect(JSON.stringify(await bodyOf(response))).toContain("IDS_AND_PAGE_EXCLUSIVE");
  });

  it("400s with IDS_AND_PAGE_EXCLUSIVE when combined with pageSize", async () => {
    const result = parseIdsParam(params("ids=a&pageSize=25"));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    expect(JSON.stringify(await bodyOf(response))).toContain("IDS_AND_PAGE_EXCLUSIVE");
  });

  it("400s with IDS_EMPTY when the param is present but has no usable id", async () => {
    const result = parseIdsParam(params("ids=%20,%20,"));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    expect(JSON.stringify(await bodyOf(response))).toContain("IDS_EMPTY");
  });

  it("accepts exactly MAX_IDS_PER_REQUEST ids", () => {
    const ids = Array.from({ length: MAX_IDS_PER_REQUEST }, (_, i) => `id${i}`);

    expect(parseIdsParam(params(`ids=${ids.join(",")}`))).toEqual({ ids });
  });

  it("400s with IDS_TOO_MANY one id past the cap, so the escape hatch can't become a full-table read", async () => {
    const ids = Array.from({ length: MAX_IDS_PER_REQUEST + 1 }, (_, i) => `id${i}`);

    const result = parseIdsParam(params(`ids=${ids.join(",")}`));

    const response = (result as { response: Response }).response;
    expect(response.status).toBe(400);
    expect(JSON.stringify(await bodyOf(response))).toContain("IDS_TOO_MANY");
  });

  it("counts the cap after dedupe — 200 unique ids sent twice still passes", () => {
    const ids = Array.from({ length: MAX_IDS_PER_REQUEST }, (_, i) => `id${i}`);

    const result = parseIdsParam(params(`ids=${[...ids, ...ids].join(",")}`));

    expect(result).toEqual({ ids });
  });
});

describe("parseSearchParam", () => {
  it("returns null when absent", () => {
    expect(parseSearchParam(params(""))).toBeNull();
  });

  it("normalizes a whitespace-only query to null so it doesn't become a LIKE %%", () => {
    expect(parseSearchParam(params("search=%20%20"))).toBeNull();
  });

  it("trims a real query", () => {
    expect(parseSearchParam(params("search=%20algebra%20"))).toBe("algebra");
  });
});

describe("paginatedResponse", () => {
  it("emits the shared envelope as JSON", async () => {
    const response = paginatedResponse([{ id: "a" }], 137, { page: 2, pageSize: 25 });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await bodyOf(response)).toEqual({
      data: [{ id: "a" }],
      total: 137,
      page: 2,
      pageSize: 25,
    });
  });

  it("merges filter-independent aggregates from `extra` alongside the envelope", async () => {
    const response = paginatedResponse([], 0, { page: 1, pageSize: 25 }, {
      stats: { total: 142, active: 130, byRole: {} },
    });

    const body = await bodyOf(response);
    // `total` tracks the caller's filters; `stats` deliberately does not.
    expect(body.total).toBe(0);
    expect(body.stats).toEqual({ total: 142, active: 130, byRole: {} });
  });
});

describe("unpagedResponse", () => {
  it("describes the returned set so clients can parse one response type", async () => {
    const response = unpagedResponse([{ id: "a" }, { id: "b" }]);

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      data: [{ id: "a" }, { id: "b" }],
      total: 2,
      page: 1,
      pageSize: 2,
    });
  });

  it("reports an empty lookup as a zero-length page rather than omitting the fields", async () => {
    expect(await bodyOf(unpagedResponse([]))).toEqual({
      data: [],
      total: 0,
      page: 1,
      pageSize: 0,
    });
  });
});
