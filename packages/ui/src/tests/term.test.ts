import { describe, expect, it } from "vitest";

import {
  compareByTerm,
  groupCoursesByTerm,
  isTermCode,
  normalizeTerm,
  termFromDate,
  termFromMonth,
  termLabel,
  termLabelLong,
  termName,
  termSortKey,
  TERM_CODES,
} from "../lib/term";
import { UBC_TERM_BOUNDARY_CASES } from "../lib/term-boundary-fixtures";

describe("term codes", () => {
  it("exposes the four UBC codes", () => {
    expect(TERM_CODES).toEqual(["W1", "W2", "S1", "S2"]);
  });

  it("isTermCode guards canonical values only", () => {
    expect(isTermCode("W1")).toBe(true);
    expect(isTermCode("Fall")).toBe(false);
    expect(isTermCode(null)).toBe(false);
  });
});

describe("termFromMonth", () => {
  it("maps months to UBC terms", () => {
    expect(termFromMonth(8)).toBe("W1"); // Sep
    expect(termFromMonth(11)).toBe("W1"); // Dec
    expect(termFromMonth(0)).toBe("W2"); // Jan
    expect(termFromMonth(3)).toBe("W2"); // Apr
    expect(termFromMonth(4)).toBe("S1"); // May
    expect(termFromMonth(6)).toBe("S2"); // Jul
  });
});

describe("termFromDate", () => {
  it.each(UBC_TERM_BOUNDARY_CASES)(
    "maps %s to %s in America/Vancouver, not UTC (#1010)",
    (iso, expected) => {
      expect(termFromDate(new Date(iso))).toBe(expected);
    },
  );
});

describe("normalizeTerm", () => {
  it("prefers start date when present (authoritative)", () => {
    expect(normalizeTerm("Fall", "2026-09-05")).toBe("W1");
    // Date wins even if the string disagrees.
    expect(normalizeTerm("Summer", "2026-01-10")).toBe("W2");
  });

  it("buckets a midnight-UTC month-boundary start date by Vancouver time, not UTC", () => {
    // 2026-09-01T00:00:00Z is still 2026-08-31 evening in Vancouver (S2),
    // not September (W1) — the exact divergence fixed in #1010.
    expect(normalizeTerm(null, "2026-09-01T00:00:00Z")).toBe("S2");
  });

  it("passes through canonical codes", () => {
    expect(normalizeTerm("w1")).toBe("W1");
    expect(normalizeTerm("S2")).toBe("S2");
  });

  it("maps legacy season strings", () => {
    expect(normalizeTerm("Fall")).toBe("W1");
    expect(normalizeTerm("Autumn")).toBe("W1");
    expect(normalizeTerm("Spring")).toBe("W2");
    expect(normalizeTerm("Summer")).toBe("S1");
    expect(normalizeTerm("Winter")).toBe("W2");
  });

  it("returns null when nothing matches", () => {
    expect(normalizeTerm("")).toBeNull();
    expect(normalizeTerm(null)).toBeNull();
    expect(normalizeTerm("gibberish")).toBeNull();
  });
});

describe("labels", () => {
  it("compact label is UBC-native", () => {
    expect(termLabel("W1", 2026)).toBe("2026W1");
    expect(termLabel("Fall", 2026)).toBe("2026W1"); // normalized
    expect(termLabel(null, 2026)).toBe("2026");
    expect(termLabel(null, null)).toBe("No term scheduled");
  });

  it("long label reads as a heading", () => {
    expect(termLabelLong("W1", 2026)).toBe("Winter Term 1 2026");
    expect(termLabelLong("S2", 2025)).toBe("Summer Term 2 2025");
    expect(termName("W2")).toBe("Winter Term 2");
  });
});

describe("ordering", () => {
  it("start date is authoritative for sort", () => {
    const a = { term: "W1", year: 2026, startDate: "2026-09-01" };
    const b = { term: "W2", year: 2026, startDate: "2027-01-05" };
    // b starts later → sorts first (most recent).
    expect(compareByTerm(a, b)).toBeGreaterThan(0);
  });

  it("falls back to correct UBC intra-year ordering (S1<S2<W1<W2)", () => {
    const key = (term: string) => termSortKey({ term, year: 2026 });
    expect(key("S1")).toBeLessThan(key("S2"));
    expect(key("S2")).toBeLessThan(key("W1"));
    expect(key("W1")).toBeLessThan(key("W2"));
  });

  it("later year outranks earlier regardless of term", () => {
    expect(termSortKey({ term: "S1", year: 2027 })).toBeGreaterThan(
      termSortKey({ term: "W2", year: 2026 }),
    );
  });
});

describe("groupCoursesByTerm", () => {
  it("groups by canonical label, most recent first", () => {
    const courses = [
      { id: 1, term: "W1", year: 2025, startDate: "2025-09-01" },
      { id: 2, term: "W1", year: 2026, startDate: "2026-09-01" },
      { id: 3, term: "Fall", year: 2026, startDate: "2026-09-02" }, // same group as #2
    ];
    const groups = groupCoursesByTerm(courses);
    expect(groups.map((g) => g.label)).toEqual(["2026W1", "2025W1"]);
    expect(groups[0].labelLong).toBe("Winter Term 1 2026");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it("supports an accessor for nested term info", () => {
    const courses = [{ meta: { term: "S1", year: 2026 } }];
    const groups = groupCoursesByTerm(courses, (c) => c.meta);
    expect(groups[0].label).toBe("2026S1");
  });
});
