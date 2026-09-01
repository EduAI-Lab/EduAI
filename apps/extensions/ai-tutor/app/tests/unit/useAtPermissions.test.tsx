import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "~/hooks/useLocalUser";

let mockUser: AuthUser | null = null;

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser }),
}));

import { useAtPermissions } from "~/hooks/useAtPermissions";

describe("useAtPermissions", () => {
  it("returns a null user and no permissions when logged out", () => {
    mockUser = null;
    const { result } = renderHook(() => useAtPermissions());

    expect(result.current.user).toBeNull();
    expect(result.current.access).toBeNull();
    expect(result.current.canManageContent).toBe(false);
    expect(result.current.canAccessAdminConsole).toBe(false);
    expect(result.current.canSubmitBugReport).toBe(false);
    expect(result.current.isTaReadOnly).toBe(false);
  });

  it("grants instructor-level permissions for an INSTRUCTOR", () => {
    mockUser = { id: "u1", name: "Instr", role: "INSTRUCTOR" };
    const { result } = renderHook(() => useAtPermissions());

    expect(result.current.access).toBe("instructor");
    expect(result.current.canManageContent).toBe(true);
    expect(result.current.canPublishContent).toBe(true);
    expect(result.current.canManageTopics).toBe(true);
    expect(result.current.canManageEnrollments).toBe(true);
    expect(result.current.canAssignTaRole).toBe(true);
    expect(result.current.canViewCourseSubmissions).toBe(true);
    expect(result.current.canViewCourseAnalytics).toBe(true);
    expect(result.current.usesInstructorShell).toBe(true);
    expect(result.current.canAccessAdminConsole).toBe(false);
    expect(result.current.canSubmitBugReport).toBe(true);
    expect(result.current.isTaReadOnly).toBe(false);
  });

  it("marks TA as read-only but still on the instructor shell", () => {
    mockUser = { id: "u2", name: "TA", role: "TA" };
    const { result } = renderHook(() => useAtPermissions());

    expect(result.current.access).toBe("ta");
    expect(result.current.canManageContent).toBe(false);
    expect(result.current.usesInstructorShell).toBe(true);
    expect(result.current.isTaReadOnly).toBe(true);
    expect(result.current.canViewCourseSubmissions).toBe(true);
  });

  it("grants admin console access only to ADMIN", () => {
    mockUser = { id: "u3", name: "Admin", role: "ADMIN" };
    const { result } = renderHook(() => useAtPermissions());

    expect(result.current.access).toBe("admin");
    expect(result.current.canAccessAdminConsole).toBe(true);
  });

  it("restricts STUDENT permissions", () => {
    mockUser = { id: "u4", name: "Stu", role: "STUDENT" };
    const { result } = renderHook(() => useAtPermissions());

    expect(result.current.access).toBe("student");
    expect(result.current.canManageContent).toBe(false);
    expect(result.current.canViewCourseSubmissions).toBe(false);
    expect(result.current.usesInstructorShell).toBe(false);
    expect(result.current.canSubmitBugReport).toBe(true);
  });

  it("never allows creating a course, regardless of role", () => {
    mockUser = { id: "u5", name: "Admin", role: "ADMIN" };
    const { result } = renderHook(() => useAtPermissions());
    expect(result.current.canCreateCourse).toBe(false);
  });
});
