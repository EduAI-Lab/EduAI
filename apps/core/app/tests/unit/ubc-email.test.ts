import { describe, it, expect } from "vitest";
import { isUbcEmail } from "~/lib/auth/ubc-email";

describe("isUbcEmail (#567)", () => {
  it("accepts the bare ubc.ca domain (staff/faculty)", () => {
    expect(isUbcEmail("prof@ubc.ca")).toBe(true);
  });

  it("accepts UBC subdomains (students, mail, alumni, departments)", () => {
    for (const email of [
      "stu@student.ubc.ca",
      "user@mail.ubc.ca",
      "grad@alumni.ubc.ca",
      "dev@cs.ubc.ca",
    ]) {
      expect(isUbcEmail(email)).toBe(true);
    }
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(isUbcEmail("  Prof@UBC.CA  ")).toBe(true);
    expect(isUbcEmail("Stu@Student.UBC.ca")).toBe(true);
  });

  it("rejects non-UBC domains", () => {
    for (const email of ["a@gmail.com", "b@example.com", "c@test.local"]) {
      expect(isUbcEmail(email)).toBe(false);
    }
  });

  it("rejects look-alike domains that merely contain ubc.ca", () => {
    for (const email of ["a@ubc.ca.evil.com", "b@notubc.ca", "c@myubc.ca", "d@ubc.cabal.com"]) {
      expect(isUbcEmail(email)).toBe(false);
    }
  });

  it("rejects malformed, empty, and nullish values", () => {
    for (const email of ["", "no-at-sign", "ubc.ca", null, undefined]) {
      expect(isUbcEmail(email)).toBe(false);
    }
  });

  it("rejects emails with multiple @ signs", () => {
    expect(isUbcEmail("a@evil.com@student.ubc.ca")).toBe(false);
  });
});
