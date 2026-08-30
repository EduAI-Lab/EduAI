import { describe, expect, it } from "vitest";

import { formatDateInputValue, parseDateInputValue } from "../lib/date-input";

describe("parseDateInputValue", () => {
  it("reads the picked calendar day in the host timezone", () => {
    // `new Date("2026-09-01")` would be UTC midnight — Aug 31 in Vancouver.
    const date = parseDateInputValue("2026-09-01")!;
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(1);
  });

  it("returns null for empty or malformed input", () => {
    expect(parseDateInputValue("")).toBeNull();
    expect(parseDateInputValue("   ")).toBeNull();
    expect(parseDateInputValue(null)).toBeNull();
    expect(parseDateInputValue(undefined)).toBeNull();
    expect(parseDateInputValue("2026-09")).toBeNull();
    expect(parseDateInputValue("01/09/2026")).toBeNull();
  });

  it("rejects overflow dates instead of silently rolling them forward", () => {
    expect(parseDateInputValue("2026-02-30")).toBeNull();
    expect(parseDateInputValue("2026-13-01")).toBeNull();
    expect(parseDateInputValue("2026-00-10")).toBeNull();
  });
});

describe("formatDateInputValue", () => {
  it("formats a local date without shifting it across a timezone boundary", () => {
    // `toISOString()` would render this as 2026-08-31 anywhere west of UTC.
    expect(formatDateInputValue(new Date(2026, 8, 1))).toBe("2026-09-01");
  });

  it("zero-pads month and day", () => {
    expect(formatDateInputValue(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("round-trips with parseDateInputValue", () => {
    for (const value of ["2026-01-01", "2026-09-01", "2025-12-31", "2026-07-04"]) {
      expect(formatDateInputValue(parseDateInputValue(value)!)).toBe(value);
    }
  });
});
