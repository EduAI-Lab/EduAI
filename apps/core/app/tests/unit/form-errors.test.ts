import { describe, it, expect } from "vitest";

import { firstFieldError } from "~/lib/form-errors";

describe("firstFieldError", () => {
  it("returns the first field message from a zod flatten() payload", () => {
    const details = {
      formErrors: [],
      fieldErrors: { email: ["Email must be a UBC address (e.g. you@ubc.ca)"] },
    };
    expect(firstFieldError(details)).toMatch(/UBC address/);
  });

  it("skips empty field-error arrays and finds the next concrete message", () => {
    const details = {
      formErrors: [],
      fieldErrors: { name: [], email: ["Bad email"] },
    };
    expect(firstFieldError(details)).toBe("Bad email");
  });

  it("returns null when there are no field errors", () => {
    expect(firstFieldError({ formErrors: ["x"], fieldErrors: {} })).toBeNull();
  });

  it("returns null for malformed or missing input", () => {
    expect(firstFieldError(undefined)).toBeNull();
    expect(firstFieldError(null)).toBeNull();
    expect(firstFieldError("nope")).toBeNull();
    expect(firstFieldError({ fieldErrors: "nope" })).toBeNull();
  });
});
