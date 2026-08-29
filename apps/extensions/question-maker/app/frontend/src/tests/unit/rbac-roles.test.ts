import { describe, expect, it } from "vitest";
import { canAccessQm } from "@/lib/rbac/roles";

describe("canAccessQm", () => {
  it("allows instructors and admins", () => {
    expect(canAccessQm("INSTRUCTOR")).toBe(true);
    expect(canAccessQm("ADMIN")).toBe(true);
    expect(canAccessQm("UNIT_ADMIN")).toBe(true);
  });

  it("allows platform students through for course-level TA resolution", () => {
    expect(canAccessQm("STUDENT")).toBe(true);
    expect(canAccessQm("TA")).toBe(false);
  });

  it("blocks missing role", () => {
    expect(canAccessQm(undefined)).toBe(false);
    expect(canAccessQm(null)).toBe(false);
  });
});
