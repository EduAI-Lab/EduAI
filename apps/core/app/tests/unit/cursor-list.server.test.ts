import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  parseCursorParams,
  splitPage,
} from "~/lib/cursor-list.server";

describe("parseCursorParams", () => {
  it("defaults to no cursor and DEFAULT_LIST_LIMIT when neither param is given", () => {
    expect(parseCursorParams(new URLSearchParams())).toEqual({
      cursor: null,
      limit: DEFAULT_LIST_LIMIT,
    });
  });

  it("reads a cursor and limit from the query string", () => {
    expect(parseCursorParams(new URLSearchParams("cursor=abc123&limit=10"))).toEqual({
      cursor: "abc123",
      limit: 10,
    });
  });

  it("clamps an oversized limit to MAX_LIST_LIMIT", () => {
    expect(parseCursorParams(new URLSearchParams("limit=99999")).limit).toBe(MAX_LIST_LIMIT);
  });

  it("falls back to the default for a non-positive or non-numeric limit", () => {
    expect(parseCursorParams(new URLSearchParams("limit=0")).limit).toBe(DEFAULT_LIST_LIMIT);
    expect(parseCursorParams(new URLSearchParams("limit=-5")).limit).toBe(DEFAULT_LIST_LIMIT);
    expect(parseCursorParams(new URLSearchParams("limit=abc")).limit).toBe(DEFAULT_LIST_LIMIT);
  });

  it("treats a blank cursor as absent", () => {
    expect(parseCursorParams(new URLSearchParams("cursor=")).cursor).toBeNull();
  });
});

describe("splitPage", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row-${i + 1}` }));

  it("returns all rows with a null nextCursor when there is no lookahead row", () => {
    expect(splitPage(rows(3), 5)).toEqual({ page: rows(3), nextCursor: null });
  });

  it("trims the lookahead row and sets nextCursor to the last page row's id", () => {
    const { page, nextCursor } = splitPage(rows(6), 5);
    expect(page).toEqual(rows(5));
    expect(nextCursor).toBe("row-5");
  });

  it("returns an empty page with a null cursor for an empty input", () => {
    expect(splitPage([], 5)).toEqual({ page: [], nextCursor: null });
  });
});
