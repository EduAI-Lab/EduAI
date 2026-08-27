/**
 * Unit tests for `useQmPermissions` / `useQmPermissionsForCourse` (#1546):
 * derives permission booleans from auth user + course access, delegating the
 * actual rules to `@/lib/rbac`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const useAuthMock = vi.fn();
const useCourseAccessMock = vi.fn();
const resolvePlatformCourseAccess = vi.fn();

const permissionFns = vi.hoisted(() => {
  const names = [
    "canCreateQuestion",
    "canApproveVariant",
    "canManageAssessment",
    "canViewAssessment",
    "canExportAssessment",
    "canRunAiReview",
    "canUseVariantWorkflow",
    "canManageCanvasIntegration",
    "canLinkCourse",
    "canTriageBugReports",
    "canEditDraftVariant",
    "canDeleteVariant",
  ];
  const fns: Record<string, (...args: unknown[]) => string> = {};
  for (const name of names) {
    fns[name] = () => `${name}-result`;
  }
  return fns;
});

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/useCourseAccess", () => ({
  useCourseAccess: (id: unknown) => useCourseAccessMock(id),
}));
vi.mock("@/lib/rbac", () => ({
  resolvePlatformCourseAccess: (...args: unknown[]) => resolvePlatformCourseAccess(...args),
}));
vi.mock("@/lib/rbac/permissions", () => permissionFns);

import { useQmPermissions, useQmPermissionsForCourse } from "@/hooks/useQmPermissions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resolvePlatformCourseAccess.mockReset();
});

describe("useQmPermissions", () => {
  it("resolves platform-role access when no courseAccess argument is passed", () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", role: "INSTRUCTOR", authorizedUnits: ["A"] } });
    resolvePlatformCourseAccess.mockReturnValue("instructor");

    const { result } = renderHook(() => useQmPermissions());

    expect(resolvePlatformCourseAccess).toHaveBeenCalledWith({
      id: "u1",
      role: "INSTRUCTOR",
      authorizedUnits: ["A"],
    });
    expect(result.current.access).toBe("instructor");
    expect(result.current.canCreateQuestion).toBe("canCreateQuestion-result");
  });

  it("uses the passed courseAccess (including null) without resolving platform access", () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", role: "TA" } });
    const { result } = renderHook(() => useQmPermissions(null));
    expect(resolvePlatformCourseAccess).not.toHaveBeenCalled();
    expect(result.current.access).toBeNull();
  });

  it("returns a null qmUser when unauthenticated", () => {
    useAuthMock.mockReturnValue({ user: null });
    resolvePlatformCourseAccess.mockReturnValue(null);
    const { result } = renderHook(() => useQmPermissions());
    expect(result.current.user).toBeNull();
    expect(result.current.canEditResource({})).toBe(false);
    expect(result.current.canDeleteResource({})).toBe(false);
  });

  it("delegates canEditResource/canDeleteResource to rbac helpers when authenticated", () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    resolvePlatformCourseAccess.mockReturnValue("instructor");
    const { result } = renderHook(() => useQmPermissions());
    const resource = { createdBy: "u1" };
    expect(result.current.canEditResource(resource)).toBe("canEditDraftVariant-result");
    expect(result.current.canDeleteResource(resource)).toBe("canDeleteVariant-result");
  });
});

describe("useQmPermissionsForCourse", () => {
  it("passes undefined access while courseId is null", () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", role: "TA" } });
    resolvePlatformCourseAccess.mockReturnValue("ta");
    useCourseAccessMock.mockReturnValue({ access: null, isLoading: false });

    const { result } = renderHook(() => useQmPermissionsForCourse(null));
    expect(result.current.hasCourseAccess).toBe(false);
    expect(result.current.accessLoading).toBe(false);
  });

  it("treats access as null while course access is loading", () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", role: "TA" } });
    useCourseAccessMock.mockReturnValue({ access: "ta", isLoading: true });

    const { result } = renderHook(() => useQmPermissionsForCourse(5));
    expect(result.current.hasCourseAccess).toBe(false);
    expect(result.current.accessLoading).toBe(true);
  });

  it("reports hasCourseAccess once loaded with a resolved level", () => {
    useAuthMock.mockReturnValue({ user: { id: "u1", role: "TA" } });
    useCourseAccessMock.mockReturnValue({ access: "ta", isLoading: false });

    const { result } = renderHook(() => useQmPermissionsForCourse(5));
    expect(result.current.hasCourseAccess).toBe(true);
    expect(result.current.courseAccess).toBe("ta");
  });
});
