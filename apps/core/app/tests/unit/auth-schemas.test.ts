import { describe, it, expect } from "vitest";
import {
  signInSchema,
  signUpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
  createUserSchema,
  updateUserSchema,
} from "~/lib/auth/schemas";

describe("signInSchema", () => {
  it("accepts valid input", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.com", password: "12345678" }).success,
    ).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(signInSchema.safeParse({ email: "bad", password: "12345678" }).success).toBe(false);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(false);
  });

  it("allows an optional rememberMe flag", () => {
    expect(
      signInSchema.safeParse({
        email: "a@b.com",
        password: "12345678",
        rememberMe: true,
      }).success,
    ).toBe(true);
  });
});

describe("signUpSchema", () => {
  const valid = {
    name: "Ada",
    email: "ada@ubc.ca",
    password: "12345678",
    confirmPassword: "12345678",
  };

  it("accepts valid input", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a too-short name", () => {
    expect(signUpSchema.safeParse({ ...valid, name: "A" }).success).toBe(false);
  });

  it("rejects mismatched passwords on confirmPassword path", () => {
    const r = signUpSchema.safeParse({ ...valid, confirmPassword: "different1" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const mismatch = r.error.issues.find((i) => i.path[0] === "confirmPassword");
      expect(mismatch?.message).toBe("Passwords don't match");
    }
  });

  it("rejects a well-formed non-UBC email on the email path (#567)", () => {
    const r = signUpSchema.safeParse({ ...valid, email: "ada@gmail.com" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "email")).toBe(true);
    }
  });

  it("accepts a UBC student subdomain (#567)", () => {
    expect(signUpSchema.safeParse({ ...valid, email: "ada@student.ubc.ca" }).success).toBe(true);
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("rejects mismatched passwords", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "12345678",
        confirmPassword: "abcdefgh",
        token: "tok",
      }).success,
    ).toBe(false);
  });

  it("accepts matching passwords and a token", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "12345678",
        confirmPassword: "12345678",
        token: "tok",
      }).success,
    ).toBe(true);
  });
});

describe("changePasswordSchema", () => {
  it("requires a non-empty currentPassword", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "",
        newPassword: "12345678",
        confirmPassword: "12345678",
      }).success,
    ).toBe(false);
  });

  it("requires newPassword and confirmPassword to match", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "old",
        newPassword: "12345678",
        confirmPassword: "different",
      }).success,
    ).toBe(false);
  });

  it("accepts a valid payload", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "old",
        newPassword: "12345678",
        confirmPassword: "12345678",
      }).success,
    ).toBe(true);
  });
});

describe("updateProfileSchema", () => {
  it("accepts valid profile data", () => {
    expect(updateProfileSchema.safeParse({ name: "Ada", email: "a@b.com" }).success).toBe(true);
  });

  it("rejects a too-short name", () => {
    expect(updateProfileSchema.safeParse({ name: "A", email: "a@b.com" }).success).toBe(false);
  });
});

describe("createUserSchema", () => {
  it("rejects an invalid role", () => {
    expect(
      createUserSchema.safeParse({
        name: "Ada",
        email: "a@b.com",
        role: "INVALID",
      }).success,
    ).toBe(false);
  });

  it("defaults isActive to true", () => {
    const r = createUserSchema.safeParse({
      name: "Ada",
      email: "a@b.com",
      role: "STUDENT",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.isActive).toBe(true);
  });

  it("accepts every valid role", () => {
    for (const role of ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"] as const) {
      expect(
        createUserSchema.safeParse({ name: "Ada", email: "a@b.com", role }).success,
      ).toBe(true);
    }
  });
});

describe("updateUserSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateUserSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an invalid role", () => {
    expect(updateUserSchema.safeParse({ role: "BAD" }).success).toBe(false);
  });

  it("rejects an empty name when provided", () => {
    expect(updateUserSchema.safeParse({ name: "A" }).success).toBe(false);
  });
});
