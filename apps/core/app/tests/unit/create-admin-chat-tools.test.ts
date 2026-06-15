// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAccessibleCourses: vi.fn(),
  listAdminBugReportsForChat: vi.fn(),
  listAdminCourseEnrollments: vi.fn(),
  listAdminUsers: vi.fn(),
  resolveAdminCourseId: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-mutations.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/agent-tools/admin-mutations.server")>();
  return {
    ...actual,
    createAdminUser: vi.fn(),
    updateAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
    createAdminEnrollment: vi.fn(),
    updateAdminEnrollmentRole: vi.fn(),
    deactivateAdminEnrollment: vi.fn(),
    updateAdminBugReportStatus: vi.fn(),
  };
});

import { createAdminChatTools } from "~/lib/agent-tools/create-admin-chat-tools";
import {
  createAdminUser,
  runConfirmedAdminWriteTool,
  userRefValidationError,
} from "~/lib/agent-tools/admin-mutations.server";

const ADMIN = { id: "admin-1", role: "ADMIN" };
const ctx = {
  user: ADMIN,
  effectiveCourseId: "course-1",
  effectiveCourseCode: "COSC 111",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAdminChatTools write execute", () => {
  it("returns CONFIRMATION_REQUIRED for createUser when confirmed is false", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.createUser.execute({
      confirmed: false,
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
    });
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
    expect(createAdminUser).not.toHaveBeenCalled();
  });

  it("returns user ref validation error without crashing for updateUser", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.updateUser.execute({
      confirmed: true,
      name: "Updated",
    });
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "VALIDATION_ERROR",
    });
  });

  it("userRefValidationError matches tool execute behavior", () => {
    expect(userRefValidationError({})).toMatchObject({
      writeSucceeded: false,
      error: "VALIDATION_ERROR",
    });
    expect(userRefValidationError({ userEmail: "a@test.com" })).toBeNull();
  });
});

describe("runConfirmedAdminWriteTool", () => {
  it("delegates to mutation when confirmed", async () => {
    vi.mocked(createAdminUser).mockResolvedValue({
      writeSucceeded: true,
      ok: true,
      dataSource: "database",
      mutation: true,
      appliedAt: new Date().toISOString(),
    });

    const result = await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      true,
      () =>
        createAdminUser(ADMIN, {
          name: "A",
          email: "a@test.com",
          role: "STUDENT",
        }),
    );
    expect(createAdminUser).toHaveBeenCalled();
    expect(result).toMatchObject({ writeSucceeded: true });
  });
});
