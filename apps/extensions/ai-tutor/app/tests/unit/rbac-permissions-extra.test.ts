import { describe, expect, it } from "vitest";
import {
  canAccessAdminConsole,
  canGradeSubmissions,
  canManageTopics,
  canPublishContent,
  canViewCourseStudentMetrics,
  canViewTeachingContent,
  getRoleViewLabel,
  isInstructorRole,
  isPlatformAdmin,
  isStudentRole,
  isTaPlatformRole,
  isUnitAdmin,
  usesInstructorShell,
} from "~/lib/rbac/permissions";

describe("role predicate helpers", () => {
  it("identify each role correctly", () => {
    expect(isPlatformAdmin({ id: "1", role: "ADMIN" })).toBe(true);
    expect(isPlatformAdmin({ id: "1", role: "STUDENT" })).toBe(false);
    expect(isUnitAdmin({ id: "1", role: "UNIT_ADMIN" })).toBe(true);
    expect(isUnitAdmin({ id: "1", role: "ADMIN" })).toBe(false);
    expect(isInstructorRole({ id: "1", role: "INSTRUCTOR" })).toBe(true);
    expect(isInstructorRole({ id: "1", role: "TA" })).toBe(false);
    expect(isTaPlatformRole({ id: "1", role: "TA" })).toBe(true);
    expect(isTaPlatformRole({ id: "1", role: "STUDENT" })).toBe(false);
    expect(isStudentRole({ id: "1", role: "STUDENT" })).toBe(true);
    expect(isStudentRole({ id: "1", role: "TA" })).toBe(false);
  });

  it("handle null/undefined users", () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(usesInstructorShell(null)).toBe(false);
    expect(usesInstructorShell({ id: "1", role: undefined as any })).toBe(false);
  });
});

describe("usesInstructorShell", () => {
  it("is true for instructor, unit admin, and TA", () => {
    expect(usesInstructorShell({ id: "1", role: "INSTRUCTOR" })).toBe(true);
    expect(usesInstructorShell({ id: "1", role: "UNIT_ADMIN" })).toBe(true);
    expect(usesInstructorShell({ id: "1", role: "TA" })).toBe(true);
  });

  it("is false for admin and student", () => {
    expect(usesInstructorShell({ id: "1", role: "ADMIN" })).toBe(false);
    expect(usesInstructorShell({ id: "1", role: "STUDENT" })).toBe(false);
  });
});

describe("content/topics/publish permissions", () => {
  it("mirror canManageContent", () => {
    expect(canPublishContent({ id: "1", role: "INSTRUCTOR" })).toBe(true);
    expect(canManageTopics({ id: "1", role: "INSTRUCTOR" })).toBe(true);
    expect(canPublishContent({ id: "1", role: "STUDENT" })).toBe(false);
    expect(canManageTopics({ id: "1", role: "TA" })).toBe(false);
  });

  it("canViewTeachingContent mirrors usesInstructorShell", () => {
    expect(canViewTeachingContent({ id: "1", role: "TA" })).toBe(true);
    expect(canViewTeachingContent({ id: "1", role: "STUDENT" })).toBe(false);
  });
});

describe("canGradeSubmissions", () => {
  it("allows staff roles and denies students", () => {
    expect(canGradeSubmissions({ id: "1", role: "INSTRUCTOR" })).toBe(true);
    expect(canGradeSubmissions({ id: "1", role: "TA" })).toBe(true);
    expect(canGradeSubmissions({ id: "1", role: "UNIT_ADMIN" })).toBe(true);
    expect(canGradeSubmissions({ id: "1", role: "ADMIN" })).toBe(true);
    expect(canGradeSubmissions({ id: "1", role: "STUDENT" })).toBe(false);
  });

  it("accepts a pre-resolved access to avoid recomputation", () => {
    expect(canGradeSubmissions({ id: "1", role: "STUDENT" }, "instructor")).toBe(true);
    expect(canGradeSubmissions({ id: "1", role: "INSTRUCTOR" }, null)).toBe(false);
  });
});

describe("canViewCourseStudentMetrics", () => {
  it("mirrors canViewCourseAnalytics", () => {
    expect(canViewCourseStudentMetrics({ id: "1", role: "TA" })).toBe(true);
    expect(canViewCourseStudentMetrics({ id: "1", role: "STUDENT" })).toBe(false);
  });
});

describe("canAccessAdminConsole", () => {
  it("is admin-only", () => {
    expect(canAccessAdminConsole({ id: "1", role: "ADMIN" })).toBe(true);
    expect(canAccessAdminConsole({ id: "1", role: "UNIT_ADMIN" })).toBe(false);
    expect(canAccessAdminConsole(null)).toBe(false);
  });
});

describe("getRoleViewLabel", () => {
  it("labels every known role and falls back to User", () => {
    expect(getRoleViewLabel("ADMIN")).toBe("Administrator");
    expect(getRoleViewLabel("UNIT_ADMIN")).toBe("Unit administrator");
    expect(getRoleViewLabel("INSTRUCTOR")).toBe("Instructor");
    expect(getRoleViewLabel("TA")).toBe("Teaching assistant");
    expect(getRoleViewLabel("STUDENT")).toBe("Student");
    expect(getRoleViewLabel(undefined)).toBe("User");
    expect(getRoleViewLabel("BOGUS")).toBe("User");
  });
});
