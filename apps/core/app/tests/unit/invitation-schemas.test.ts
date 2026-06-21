import { describe, it, expect } from "vitest";
import {
  createInvitationSchema,
  acceptInvitationSchema,
  invitableRolesFor,
} from "~/lib/invitations/schemas";

describe("createInvitationSchema", () => {
  it("accepts an INSTRUCTOR invite without units", () => {
    const r = createInvitationSchema.safeParse({
      email: "prof@ubc.ca",
      role: "INSTRUCTOR",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an ADMIN invite with an optional name", () => {
    const r = createInvitationSchema.safeParse({
      email: "admin@ubc.ca",
      name: "Ada Admin",
      role: "ADMIN",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a UNIT_ADMIN invite with at least one unit", () => {
    const r = createInvitationSchema.safeParse({
      email: "unit@ubc.ca",
      role: "UNIT_ADMIN",
      authorizedUnits: ["COSC", "MATH"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a STUDENT invite without units (unit-admin flow)", () => {
    const r = createInvitationSchema.safeParse({
      email: "s@ubc.ca",
      role: "STUDENT",
    });
    expect(r.success).toBe(true);
  });

  it("rejects TA (not platform-invitable)", () => {
    expect(
      createInvitationSchema.safeParse({ email: "ta@ubc.ca", role: "TA" }).success,
    ).toBe(false);
  });

  it("rejects units on a STUDENT invite", () => {
    const r = createInvitationSchema.safeParse({
      email: "s@ubc.ca",
      role: "STUDENT",
      authorizedUnits: ["COSC"],
    });
    expect(r.success).toBe(false);
  });

  it("requires units for UNIT_ADMIN", () => {
    const r = createInvitationSchema.safeParse({
      email: "unit@ubc.ca",
      role: "UNIT_ADMIN",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "authorizedUnits")).toBe(true);
    }
  });

  it("rejects units on a non-UNIT_ADMIN invite", () => {
    const r = createInvitationSchema.safeParse({
      email: "prof@ubc.ca",
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
        email: "unit@ubc.ca",
        role: "UNIT_ADMIN",
        authorizedUnits: ["NOTAUNIT"],
      }).success,
    ).toBe(false);
  });

  it("rejects a well-formed non-UBC email on the email path (#567)", () => {
    const r = createInvitationSchema.safeParse({ email: "prof@gmail.com", role: "INSTRUCTOR" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "email")).toBe(true);
    }
  });

  it("accepts UBC subdomains for both students and staff (#567)", () => {
    expect(
      createInvitationSchema.safeParse({ email: "stu@student.ubc.ca", role: "INSTRUCTOR" }).success,
    ).toBe(true);
    expect(
      createInvitationSchema.safeParse({ email: "dept@cs.ubc.ca", role: "INSTRUCTOR" }).success,
    ).toBe(true);
  });
});

describe("invitableRolesFor", () => {
  it("lets an ADMIN invite admins, unit admins, and instructors (no students)", () => {
    const roles = invitableRolesFor("ADMIN");
    expect([...roles]).toEqual(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR"]);
    expect(roles).not.toContain("STUDENT");
  });

  it("lets a UNIT_ADMIN invite instructors and students only", () => {
    expect([...invitableRolesFor("UNIT_ADMIN")]).toEqual(["INSTRUCTOR", "STUDENT"]);
  });

  it("lets any other role invite no one", () => {
    expect(invitableRolesFor("INSTRUCTOR")).toEqual([]);
    expect(invitableRolesFor("STUDENT")).toEqual([]);
    expect(invitableRolesFor(null)).toEqual([]);
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
