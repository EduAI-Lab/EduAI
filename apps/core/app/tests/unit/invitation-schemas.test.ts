import { describe, it, expect } from "vitest";
import {
  createInvitationSchema,
  acceptInvitationSchema,
} from "~/lib/invitations/schemas";

describe("createInvitationSchema", () => {
  it("accepts an INSTRUCTOR invite without units", () => {
    const r = createInvitationSchema.safeParse({
      email: "prof@test.local",
      role: "INSTRUCTOR",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an ADMIN invite with an optional name", () => {
    const r = createInvitationSchema.safeParse({
      email: "admin@test.local",
      name: "Ada Admin",
      role: "ADMIN",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a UNIT_ADMIN invite with at least one unit", () => {
    const r = createInvitationSchema.safeParse({
      email: "unit@test.local",
      role: "UNIT_ADMIN",
      authorizedUnits: ["COSC", "MATH"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects TA and STUDENT (not platform-invitable)", () => {
    expect(
      createInvitationSchema.safeParse({ email: "ta@test.local", role: "TA" }).success,
    ).toBe(false);
    expect(
      createInvitationSchema.safeParse({ email: "s@test.local", role: "STUDENT" }).success,
    ).toBe(false);
  });

  it("requires units for UNIT_ADMIN", () => {
    const r = createInvitationSchema.safeParse({
      email: "unit@test.local",
      role: "UNIT_ADMIN",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "authorizedUnits")).toBe(true);
    }
  });

  it("rejects units on a non-UNIT_ADMIN invite", () => {
    const r = createInvitationSchema.safeParse({
      email: "prof@test.local",
      role: "INSTRUCTOR",
      authorizedUnits: ["COSC"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid email and an unknown unit code", () => {
    expect(
      createInvitationSchema.safeParse({ email: "nope", role: "ADMIN" }).success,
    ).toBe(false);
    expect(
      createInvitationSchema.safeParse({
        email: "unit@test.local",
        role: "UNIT_ADMIN",
        authorizedUnits: ["NOTAUNIT"],
      }).success,
    ).toBe(false);
  });
});

describe("acceptInvitationSchema", () => {
  const valid = {
    token: "abc",
    name: "New User",
    password: "supersecret",
    confirmPassword: "supersecret",
  };

  it("accepts a valid payload", () => {
    expect(acceptInvitationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(
      acceptInvitationSchema.safeParse({ ...valid, password: "short", confirmPassword: "short" })
        .success,
    ).toBe(false);
  });

  it("rejects mismatched passwords on the confirmPassword path", () => {
    const r = acceptInvitationSchema.safeParse({ ...valid, confirmPassword: "different1" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const mismatch = r.error.issues.find((i) => i.path[0] === "confirmPassword");
      expect(mismatch?.message).toBe("Passwords don't match");
    }
  });

  it("rejects a missing token", () => {
    expect(
      acceptInvitationSchema.safeParse({ ...valid, token: "" }).success,
    ).toBe(false);
  });
});
