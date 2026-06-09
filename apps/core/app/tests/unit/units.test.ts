// @vitest-environment node

import { describe, it, expect } from "vitest";
import { UNITS, UnitSchema, UNIT_LABELS } from "~/lib/units";

describe("UnitSchema", () => {
  it.each([...UNITS])("accepts known subject code %s", (code) => {
    expect(UnitSchema.parse(code)).toBe(code);
  });

  it("rejects unknown subject codes", () => {
    expect(UnitSchema.safeParse("BASKET").success).toBe(false);
  });

  it("rejects wrong casing (§19 — no silent ghost units)", () => {
    expect(UnitSchema.safeParse("cosc").success).toBe(false);
    expect(UnitSchema.safeParse("Cosc").success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(UnitSchema.safeParse(null).success).toBe(false);
    expect(UnitSchema.safeParse(42).success).toBe(false);
  });

  it("has a human-readable label for every subject code", () => {
    for (const code of UNITS) {
      expect(UNIT_LABELS[code]).toBeTruthy();
    }
  });
});
