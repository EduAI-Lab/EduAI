import { z } from "zod";
import { describe, it, expect } from "vitest";
import {
  getFieldErrors,
  getFieldError,
  getFormErrorMessage,
  validateField,
} from "~/lib/form-utils";

const testSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

describe("getFieldErrors", () => {
  it("returns an empty object when validation passes", () => {
    const result = testSchema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(getFieldErrors(result)).toEqual({});
  });

  it("returns errors keyed by field name when validation fails", () => {
    const result = testSchema.safeParse({ email: "not-an-email", password: "short" });
    const errors = getFieldErrors(result);
    expect(errors.email).toContain("Invalid email");
    expect(errors.password).toContain("Password must be at least 8 characters");
  });
});

describe("getFieldError", () => {
  it("returns undefined when there are no errors for the field", () => {
    expect(getFieldError({} as any, "email")).toBeUndefined();
  });

  it("returns the first error message for a field", () => {
    const fieldErrors = { email: ["Invalid email", "Another error"] } as any;
    expect(getFieldError(fieldErrors, "email")).toBe("Invalid email");
  });
});

describe("getFormErrorMessage", () => {
  it("returns an empty string when validation passes", () => {
    const result = testSchema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(getFormErrorMessage(result)).toBe("");
  });

  it("returns all error messages joined by ', ' when validation fails", () => {
    const result = testSchema.safeParse({ email: "bad", password: "x" });
    const message = getFormErrorMessage(result);
    expect(message).toContain("Invalid email");
    expect(message).toContain("Password must be at least 8 characters");
  });
});

describe("validateField", () => {
  const emailSchema = z.string().email("Invalid email");

  it("returns isValid: true for a valid value", () => {
    expect(validateField(emailSchema, "user@example.com")).toEqual({ isValid: true });
  });

  it("returns isValid: false with an error message for an invalid value", () => {
    const result = validateField(emailSchema, "not-an-email");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Invalid email");
  });

  it("returns the fallback error message when no message is provided", () => {
    const strictSchema = z.string().refine(() => false);
    const result = validateField(strictSchema, "anything");
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });
});
