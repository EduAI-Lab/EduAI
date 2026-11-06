import { describe, expect, it } from "vitest";
import { publishedCount, treeCounts } from "~/lib/tree-counts";

const rows = [{ isPublished: true }, { isPublished: false }];

describe("treeCounts", () => {
  it("prefers the server's unfiltered counts and leaves the page's published rows out", () => {
    const counts = treeCounts({ data: rows, total: 2, unfilteredTotal: 12, publishedTotal: 5 });
    expect(counts).toEqual({ all: 12, publishedOffPage: 4 });
  });

  it("falls back to the page when the server sends no counts", () => {
    expect(treeCounts({ data: rows, total: 2 })).toEqual({ all: 2, publishedOffPage: 0 });
  });

  it("adds the page's live published rows back on top", () => {
    const counts = { all: 12, publishedOffPage: 4 };
    expect(publishedCount(counts, rows)).toBe(5);
    expect(publishedCount(counts, [{ isPublished: true }, { isPublished: true }])).toBe(6);
  });
});
