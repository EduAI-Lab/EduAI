// Client helpers for API access grants (#2039).
import { describe, expect, it } from "vitest";

import {
  defaultGrantEndDate,
  endOfDayIso,
  formatUsage,
  secondsUntilGrantEnds,
  usagePercent,
} from "~/lib/api-keys/api-access";

describe("defaultGrantEndDate", () => {
  it.each([
    [new Date(2026, 9, 21), "2026-12-31"],
    [new Date(2026, 11, 20), "2027-04-30"],
    [new Date(2027, 0, 5), "2027-04-30"],
    [new Date(2027, 3, 20), "2027-08-31"],
    [new Date(2027, 5, 1), "2027-08-31"],
  ])("from %s picks the first term end at least two weeks away (%s)", (today, expected) => {
    expect(defaultGrantEndDate(today)).toBe(expected);
  });
});

describe("endOfDayIso", () => {
  it("is the last second of the chosen local day", () => {
    const iso = endOfDayIso("2026-12-31");
    expect(iso).not.toBeNull();
    const end = new Date(iso!);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([
      2026, 11, 31, 23,
    ]);
  });

  it("rejects anything that isn't a date input value", () => {
    expect(endOfDayIso("")).toBeNull();
    expect(endOfDayIso("31/12/2026")).toBeNull();
  });
});

describe("secondsUntilGrantEnds", () => {
  const now = new Date("2026-10-21T12:00:00Z");

  it("leaves a minute of slack before the grant ends", () => {
    expect(secondsUntilGrantEnds("2026-10-22T12:00:00Z", now)).toBe(24 * 60 * 60 - 60);
  });

  it("never goes negative", () => {
    expect(secondsUntilGrantEnds("2026-10-01T00:00:00Z", now)).toBe(0);
  });
});

describe("usage formatting", () => {
  it("shows compact usage against the limit", () => {
    expect(formatUsage(12, 200)).toBe("12 / 200");
    expect(formatUsage(3_400, 200_000)).toBe("3.4K / 200K");
  });

  it("caps the percentage at 100", () => {
    expect(usagePercent(50, 200)).toBe(25);
    expect(usagePercent(500, 200)).toBe(100);
    expect(usagePercent(1, 0)).toBe(100);
  });
});
