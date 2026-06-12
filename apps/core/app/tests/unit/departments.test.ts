// @vitest-environment node

import { describe, it, expect } from "vitest";
import { DEPARTMENTS, DepartmentSchema } from "~/lib/departments";

describe("DepartmentSchema", () => {
  it.each(DEPARTMENTS.map((d) => d.code))("accepts known subject code %s", (code) => {
    expect(DepartmentSchema.parse(code)).toBe(code);
  });

  it("rejects unknown subject codes", () => {
    expect(DepartmentSchema.safeParse("BASKET").success).toBe(false);
  });

  it("rejects wrong casing (§19 — no silent ghost units)", () => {
    expect(DepartmentSchema.safeParse("cosc").success).toBe(false);
    expect(DepartmentSchema.safeParse("Cosc").success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(DepartmentSchema.safeParse(null).success).toBe(false);
    expect(DepartmentSchema.safeParse(42).success).toBe(false);
  });
});
