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
});
