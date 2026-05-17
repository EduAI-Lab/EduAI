import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  getFieldErrors,
  getFieldError,
  getFormErrorMessage,
  validateField,
} from "~/lib/form-utils";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Min 8 chars"),
});

describe("getFieldErrors", () => {
  it("returns an empty record when validation succeeds", () => {
    const result = schema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(getFieldErrors(result)).toEqual({});
  });

  it("groups multiple issues by field name", () => {
    const result = schema.safeParse({ email: "not-an-email", password: "x" });
    const errs = getFieldErrors(result) as Record<string, string[]>;
    expect(errs.email).toContain("Invalid email");
    expect(errs.password).toContain("Min 8 chars");
  });

  it("accumulates multiple messages for the same field", () => {
    const composite = z.object({
      name: z.string().min(2, "Too short").regex(/^[A-Z]/, "Must start with capital"),
    });
    const result = composite.safeParse({ name: "a" });
    const errs = getFieldErrors(result) as Record<string, string[]>;
    expect(errs.name?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getFieldError", () => {
  it("returns the first error message for a field", () => {
    const errs: Record<string, string[]> = {
      email: ["Bad email", "Also bad"],
      password: [],
    };
    expect(getFieldError(errs, "email")).toBe("Bad email");
  });

  it("returns undefined when the field has no errors", () => {
    const errs: Record<string, string[]> = { email: [], password: [] };
    expect(getFieldError(errs, "email")).toBeUndefined();
  });

  it("returns undefined when the field is missing", () => {
    expect(getFieldError({} as Record<string, string[]>, "email")).toBeUndefined();
  });
});

describe("getFormErrorMessage", () => {
  it("returns an empty string on success", () => {
    const result = schema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(getFormErrorMessage(result)).toBe("");
  });

  it("joins all error messages with a comma separator", () => {
    const result = schema.safeParse({ email: "bad", password: "x" });
    const msg = getFormErrorMessage(result);
    expect(msg).toContain("Invalid email");
    expect(msg).toContain("Min 8 chars");
    expect(msg).toContain(", ");
  });
});

describe("validateField", () => {
  const emailSchema = z.string().email("Invalid email");

  it("returns isValid true for valid input", () => {
    expect(validateField(emailSchema, "a@b.com")).toEqual({ isValid: true });
  });

  it("returns the schema error message for invalid input", () => {
    const result = validateField(emailSchema, "not-an-email");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Invalid email");
  });

  it("falls back to a default message when none is present", () => {
    const numberSchema = z.number();
    const result = validateField(numberSchema, "abc");
    expect(result.isValid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error?.length).toBeGreaterThan(0);
  });
});
