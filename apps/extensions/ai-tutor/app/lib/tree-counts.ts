/**
 * Counts for a staff tree list that a search or page never narrows. Published
 * rows on the loaded page are left out of `publishedOffPage`, so a live publish
 * toggle on the page can be added back on top.
 */
export type TreeCounts = { all: number; publishedOffPage: number };

export function treeCounts(page: {
  data: { isPublished?: boolean }[];
  total: number;
  unfilteredTotal?: number;
  publishedTotal?: number;
}): TreeCounts {
  const onPage = page.data.filter((row) => row.isPublished).length;
  return {
    all: page.unfilteredTotal ?? page.total,
    publishedOffPage: Math.max(0, (page.publishedTotal ?? onPage) - onPage),
  };
}

export function publishedCount(counts: TreeCounts, rows: { isPublished?: boolean }[]) {
  return counts.publishedOffPage + rows.filter((row) => row.isPublished).length;
}
