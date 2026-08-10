import { describe, expect, it } from "vitest";
import {
  indexInteractions,
  takeMatch,
} from "../../../scripts/research/backfill-match.mjs";

describe("backfill takeMatch", () => {
  it("matches userId::query when userId is present", () => {
    const index = indexInteractions([
      {
        id: "a",
        userId: "u1",
        query: "hello",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "b",
        userId: "u2",
        query: "hello",
        createdAt: "2026-07-15T12:00:01.000Z",
      },
    ]);

    expect(takeMatch(index, "hello", "u2")?.id).toBe("b");
    expect(takeMatch(index, "hello", "u1")?.id).toBe("a");
  });

  it("does not use ::query for rows that have userId when run lacks userId and prompt is shared", () => {
    const index = indexInteractions([
      {
        id: "a",
        userId: "u1",
        query: "shared prompt",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "b",
        userId: "u2",
        query: "shared prompt",
        createdAt: "2026-07-15T12:00:01.000Z",
      },
    ]);

    expect(
      takeMatch(index, "shared prompt", null, {
        runTimestamp: "2026-07-15T12:00:00.500Z",
      }),
    ).toBeNull();
  });

  it("allows query-only match when the prompt is unique and within the time window", () => {
    const index = indexInteractions([
      {
        id: "only",
        userId: "u1",
        query: "unique prompt",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ]);

    expect(
      takeMatch(index, "unique prompt", null, {
        runTimestamp: "2026-07-15T12:00:30.000Z",
        windowMs: 60_000,
      })?.id,
    ).toBe("only");
  });

  it("rejects query-only match outside the time window", () => {
    const index = indexInteractions([
      {
        id: "only",
        userId: "u1",
        query: "unique prompt",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ]);

    expect(
      takeMatch(index, "unique prompt", null, {
        runTimestamp: "2026-07-15T12:05:00.000Z",
        windowMs: 60_000,
      }),
    ).toBeNull();
  });

  it("requires userId for non-unique prompts (regression: empty ::query lookup)", () => {
    const index = indexInteractions([
      {
        id: "a",
        userId: "u1",
        query: "hello",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ]);

    // With userId → match; without userId and unique prompt → still allowed.
    expect(takeMatch(index, "hello", "u1")?.id).toBe("a");

    const index2 = indexInteractions([
      {
        id: "a",
        userId: "u1",
        query: "hello",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ]);
    expect(takeMatch(index2, "hello", null)?.id).toBe("a");
  });

  it("without runTimestamp, userId::query falls back to plain FIFO order (unchanged behavior)", () => {
    const index = indexInteractions([
      {
        id: "old",
        userId: "service",
        query: "repeated prompt",
        createdAt: "2026-07-15T09:00:00.000Z",
      },
      {
        id: "new",
        userId: "service",
        query: "repeated prompt",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ]);

    expect(takeMatch(index, "repeated prompt", "service")?.id).toBe("old");
    expect(takeMatch(index, "repeated prompt", "service")?.id).toBe("new");
  });

  it("regression (2026-08-10 Track A backfill): with runTimestamp, userId::query picks the closest-in-time row instead of blind FIFO", () => {
    // Reproduces the real failure: a fixed synthetic userId (research
    // service-key calls) reused the same prompt text across an earlier,
    // unrelated run (09:00-ish) and the run actually being backfilled
    // (12:00-ish). Plain FIFO matched every row in the run being backfilled
    // to the stale earlier run's rows -- confirmed live via a suspiciously
    // uniform ~90min offset between issuedAtIso and the matched createdAt.
    const index = indexInteractions([
      {
        id: "stale-earlier-run",
        userId: "service",
        query: "What is object-oriented programming?",
        createdAt: "2026-07-15T09:00:00.000Z",
      },
      {
        id: "this-run",
        userId: "service",
        query: "What is object-oriented programming?",
        createdAt: "2026-07-15T12:00:05.000Z",
      },
    ]);

    const match = takeMatch(index, "What is object-oriented programming?", "service", {
      runTimestamp: "2026-07-15T12:00:00.000Z",
      windowMs: 60_000,
    });
    expect(match?.id).toBe("this-run");
  });

  it("userId::query with runTimestamp still respects windowMs as a hard cutoff", () => {
    const index = indexInteractions([
      {
        id: "too-far",
        userId: "service",
        query: "hello",
        createdAt: "2026-07-15T09:00:00.000Z",
      },
    ]);

    expect(
      takeMatch(index, "hello", "service", {
        runTimestamp: "2026-07-15T12:00:00.000Z",
        windowMs: 60_000,
      }),
    ).toBeNull();
  });

  it("userId::query with runTimestamp and multiple candidates within window picks the nearest, not just the first", () => {
    const index = indexInteractions([
      {
        id: "far",
        userId: "service",
        query: "hello",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "near",
        userId: "service",
        query: "hello",
        createdAt: "2026-07-15T12:00:29.000Z",
      },
    ]);

    const match = takeMatch(index, "hello", "service", {
      runTimestamp: "2026-07-15T12:00:30.000Z",
      windowMs: 60_000,
    });
    expect(match?.id).toBe("near");
  });

  it("userId::query with runTimestamp and 3+ candidates picks the overall nearest, not just the second-closest checked first", () => {
    const index = indexInteractions([
      { id: "far-before", userId: "service", query: "hello", createdAt: "2026-07-15T11:00:00.000Z" },
      { id: "far-after", userId: "service", query: "hello", createdAt: "2026-07-15T13:00:00.000Z" },
      { id: "nearest", userId: "service", query: "hello", createdAt: "2026-07-15T12:00:03.000Z" },
      { id: "second-nearest", userId: "service", query: "hello", createdAt: "2026-07-15T12:00:10.000Z" },
    ]);

    const match = takeMatch(index, "hello", "service", {
      runTimestamp: "2026-07-15T12:00:00.000Z",
      windowMs: 60_000,
    });
    expect(match?.id).toBe("nearest");
  });

  it("userId::query with a runTimestamp but NO windowMs is still bounded by the same 60s default as the query-only path (not unbounded)", () => {
    // Regression: omitting windowMs must not mean "any distance is
    // acceptable" -- a runTimestamp-bearing caller with no explicit window
    // could otherwise silently accept an arbitrarily stale "closest of a
    // bad set" candidate (verified pre-fix: a 6-year-stale single candidate
    // was matched when windowMs was omitted).
    const index = indexInteractions([
      {
        id: "years-stale",
        userId: "service",
        query: "hello",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]);

    expect(
      takeMatch(index, "hello", "service", {
        runTimestamp: "2026-07-15T12:00:00.000Z",
        // windowMs deliberately omitted
      }),
    ).toBeNull();
  });

  it("userId::query rejects (not FIFO-falls-back) when runTimestamp is given but no candidate has a parseable createdAt", () => {
    // A candidate that can't be time-verified against runTimestamp must not
    // be accepted just because it's the only/oldest one -- that would
    // silently defeat the whole point of this branch for exactly the
    // callers most likely to trigger it (a run export using field names
    // toMs() doesn't recognize, e.g. a stray non-ISO createdAt value).
    const index = indexInteractions([
      { id: "no-timestamp", userId: "service", query: "hello", createdAt: null },
    ]);

    expect(
      takeMatch(index, "hello", "service", {
        runTimestamp: "2026-07-15T12:00:00.000Z",
        windowMs: 60_000,
      }),
    ).toBeNull();
  });

  it("userId::query with a mix of dated and undated candidates ignores the undated one and matches the dated one", () => {
    const index = indexInteractions([
      { id: "undated", userId: "service", query: "hello", createdAt: null },
      { id: "dated", userId: "service", query: "hello", createdAt: "2026-07-15T12:00:01.000Z" },
    ]);

    const match = takeMatch(index, "hello", "service", {
      runTimestamp: "2026-07-15T12:00:00.000Z",
      windowMs: 60_000,
    });
    expect(match?.id).toBe("dated");
  });

  it("a window-rejected userId::query candidate is NOT consumed -- stays available for a later, better-matching lookup", () => {
    const index = indexInteractions([
      { id: "too-far", userId: "service", query: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
    ]);

    // First lookup: outside the window, correctly rejected.
    expect(
      takeMatch(index, "hello", "service", {
        runTimestamp: "2026-07-15T12:00:00.000Z",
        windowMs: 60_000,
      }),
    ).toBeNull();

    // The row must still be sitting in the index, untouched by the
    // rejected attempt -- a later lookup with no window should still find
    // it (proves rejection didn't silently consume it).
    expect(takeMatch(index, "hello", "service")?.id).toBe("too-far");
  });

  it("regression: a row matched via userId::query is also removed from byQueryOnly, so a later query-only lookup for the same prompt can't match it a second time", () => {
    // Pre-fix, the userId::query branch only removed the chosen row from
    // byUserQuery, never from byQueryOnly. If a second run row for the same
    // prompt text arrives WITHOUT a userId, the query-only path would see
    // the (still-there) single remaining byQueryOnly entry as "unique" and
    // match the SAME DB row a second time -- duplicating its tokens/energy
    // across two run rows with no error anywhere.
    const index = indexInteractions([
      {
        id: "shared-row",
        userId: "service",
        query: "hello",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ]);

    const first = takeMatch(index, "hello", "service", {
      runTimestamp: "2026-07-15T12:00:00.000Z",
      windowMs: 60_000,
    });
    expect(first?.id).toBe("shared-row");

    // Second lookup, same prompt, no userId this time -- must NOT re-match
    // the row already consumed above.
    const second = takeMatch(index, "hello", null, {
      runTimestamp: "2026-07-15T12:00:01.000Z",
      windowMs: 60_000,
    });
    expect(second).toBeNull();
  });
});
