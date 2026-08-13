// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  user: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  enrollment: { findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/courses/enrollments.server", () => ({
  addEnrollment: vi.fn(),
  updateEnrollmentRole: vi.fn(),
  deactivateEnrollment: vi.fn(),
}));

vi.mock("~/lib/bug-reports/server", () => ({
  updateBugReportStatus: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  resolveAdminCourseId: vi.fn(),
  getAccessibleCourse: vi.fn(),
  resolveAdminUserId: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-write-confirmation.server", () => ({
  registerWritePreview: vi.fn(),
  consumeWritePreview: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  createCourseTopic: vi.fn(),
  updateCourseTopic: vi.fn(),
  deleteCourseTopic: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-invitations.server", () => ({
  createAdminInvitation: vi.fn(),
  resendAdminInvitation: vi.fn(),
  revokeAdminInvitation: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-canvas.server", () => ({
  connectCanvasForUser: vi.fn(),
  disconnectCanvasForUser: vi.fn(),
  linkCanvasRosterForUser: vi.fn(),
  syncCanvasForUser: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-platform.server", () => ({
  addAdminCourseTA: vi.fn(),
  createAdminAiModel: vi.fn(),
  createAdminAiProvider: vi.fn(),
  createAdminCourse: vi.fn(),
  deleteAdminAiModel: vi.fn(),
  deleteAdminAiProvider: vi.fn(),
  deleteAdminCourse: vi.fn(),
  deleteAdminCourseMaterial: vi.fn(),
  removeAdminCourseTA: vi.fn(),
  renameAdminCourseMaterial: vi.fn(),
  setAdminCoursePublished: vi.fn(),
  startAdminCourseReEmbed: vi.fn(),
  syncAdminCanvasMaterials: vi.fn(),
  triggerAdminCronJob: vi.fn(),
  updateAdminAiModel: vi.fn(),
  updateAdminAiProvider: vi.fn(),
  updateAdminCourse: vi.fn(),
  updateAdminCourseEmbeddingSettings: vi.fn(),
  updateAdminCourseRagSettings: vi.fn(),
  updateAdminCronSchedule: vi.fn(),
  updateAdminPolicy: vi.fn(),
}));

import { Prisma } from "@prisma/client";
import {
  addEnrollment,
  deactivateEnrollment,
  updateEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import { updateBugReportStatus } from "~/lib/bug-reports/server";
import { resolveAdminCourseId, resolveAdminUserId, getAccessibleCourse } from "~/lib/agent-tools/admin-context.server";
import {
  registerWritePreview,
  consumeWritePreview,
} from "~/lib/agent-tools/admin-write-confirmation.server";
import { createCourseTopic, updateCourseTopic, deleteCourseTopic } from "~/lib/courses/server";
import {
  createAdminInvitation,
  resendAdminInvitation,
  revokeAdminInvitation,
} from "~/lib/agent-tools/admin-invitations.server";
import {
  connectCanvasForUser,
  disconnectCanvasForUser,
  linkCanvasRosterForUser,
  syncCanvasForUser,
} from "~/lib/agent-tools/admin-canvas.server";
import {
  addAdminCourseTA,
  createAdminAiModel,
  createAdminAiProvider,
  createAdminCourse,
  deleteAdminAiModel,
  deleteAdminAiProvider,
  deleteAdminCourse,
  deleteAdminCourseMaterial,
  removeAdminCourseTA,
  renameAdminCourseMaterial,
  setAdminCoursePublished,
  startAdminCourseReEmbed,
  syncAdminCanvasMaterials,
  triggerAdminCronJob,
  updateAdminAiModel,
  updateAdminAiProvider,
  updateAdminCourse,
  updateAdminCourseEmbeddingSettings,
  updateAdminCourseRagSettings,
  updateAdminCronSchedule,
  updateAdminPolicy,
} from "~/lib/agent-tools/admin-platform.server";
import {
  createAdminUser,
  deleteAdminUser,
  updateAdminBugReportStatus,
  updateAdminUser,
  userRefValidationError,
  runAdminWriteTool,
  runConfirmedAdminWriteTool,
  createAdminCourseTopic,
  updateAdminCourseTopic,
  deleteAdminCourseTopic,
  createAdminInvitationMutation,
  revokeAdminInvitationMutation,
  resendAdminInvitationMutation,
  connectAdminCanvas,
  syncAdminCanvasCourses,
  disconnectAdminCanvas,
  linkAdminCanvasRoster,
  createAdminCourseMutation,
  updateAdminCourseMutation,
  deleteAdminCourseMutation,
  publishAdminCourseMutation,
  unpublishAdminCourseMutation,
  updateAdminCourseRagSettingsMutation,
  renameAdminCourseMaterialMutation,
  deleteAdminCourseMaterialMutation,
  updateAdminCourseEmbeddingSettingsMutation,
  startAdminCourseReEmbedMutation,
  syncAdminCanvasMaterialsMutation,
  addAdminCourseTAMutation,
  removeAdminCourseTAMutation,
  updateAdminPolicyMutation,
  createAdminAiProviderMutation,
  updateAdminAiProviderMutation,
  deleteAdminAiProviderMutation,
  createAdminAiModelMutation,
  updateAdminAiModelMutation,
  deleteAdminAiModelMutation,
  triggerAdminCronJobMutation,
  updateAdminCronScheduleMutation,
} from "~/lib/agent-tools/admin-mutations.server";

const ADMIN = { id: "admin-1", role: "ADMIN" };
const STUDENT = { id: "student-1", role: "STUDENT" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof prismaMock) => unknown)(prismaMock) : arg,
  );
  prismaMock.$executeRaw.mockResolvedValue(undefined);
});

describe("createAdminUser", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await createAdminUser(STUDENT, {
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("creates user for admin", async () => {
    prismaMock.user.create.mockResolvedValue({
      id: "u1",
      email: "test@example.com",
      name: "Test User",
      role: "STUDENT",
      isActive: true,
      createdAt: new Date(),
    });

    const result = await createAdminUser(ADMIN, {
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
    });

    expect(result).toMatchObject({ ok: true, mutation: true, dataSource: "database" });
    expect(prismaMock.user.create).toHaveBeenCalled();
  });
});

describe("updateAdminUser", () => {
  it("blocks self-deactivation", async () => {
    const result = await updateAdminUser(ADMIN, ADMIN.id, { isActive: false });
    expect(result).toEqual({ error: "CANNOT_DEACTIVATE_SELF" });
  });

  it("blocks self role change", async () => {
    const result = await updateAdminUser(ADMIN, ADMIN.id, { role: "STUDENT" });
    expect(result).toEqual({ error: "CANNOT_CHANGE_OWN_ROLE" });
  });

  it("rejects empty update payload", async () => {
    const result = await updateAdminUser(ADMIN, "u2", {});
    expect(result).toMatchObject({
      error: "VALIDATION_ERROR",
      fields: { body: "at least one field to update is required" },
    });
  });
});

describe("deleteAdminUser", () => {
  it("blocks self-delete", async () => {
    const result = await deleteAdminUser(ADMIN, ADMIN.id);
    expect(result).toEqual({ error: "CANNOT_DELETE_SELF" });
  });

  it("deletes other non-ADMIN users without a floor check", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    prismaMock.user.delete.mockResolvedValue({ id: "u2" });
    const result = await deleteAdminUser(ADMIN, "u2");
    expect(result).toMatchObject({ ok: true, deletedUserId: "u2" });
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });

  it("blocks deleting the last other active ADMIN (AUTH-04)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true });
    prismaMock.user.count.mockResolvedValue(0);
    const result = await deleteAdminUser(ADMIN, "admin-2");
    expect(result).toEqual({ error: "ADMIN_FLOOR_VIOLATION" });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("deletes an ADMIN when another active ADMIN remains", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true });
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.delete.mockResolvedValue({ id: "admin-2" });
    const result = await deleteAdminUser(ADMIN, "admin-2");
    expect(result).toMatchObject({ ok: true, deletedUserId: "admin-2" });
  });
});

describe("updateAdminBugReportStatus", () => {
  it("returns NOT_FOUND when report missing", async () => {
    vi.mocked(updateBugReportStatus).mockResolvedValue(null);
    const result = await updateAdminBugReportStatus(ADMIN, "missing", "RESOLVED");
    expect(result).toEqual({ error: "NOT_FOUND" });
  });

  it("returns mutation payload on success", async () => {
    vi.mocked(updateBugReportStatus).mockResolvedValue({ id: "b1", status: "RESOLVED" });
    const result = await updateAdminBugReportStatus(ADMIN, "b1", "RESOLVED");
    expect(result).toMatchObject({ ok: true, report: { id: "b1", status: "RESOLVED" } });
  });
});

describe("requireWriteConfirmation", () => {
  it("returns null when confirmed is true", async () => {
    const { requireWriteConfirmation } = await import("~/lib/agent-tools/admin-mutations.server");
    expect(requireWriteConfirmation(true)).toBeNull();
  });

  it("returns CONFIRMATION_REQUIRED when confirmed is false", async () => {
    const { requireWriteConfirmation } = await import("~/lib/agent-tools/admin-mutations.server");
    const result = requireWriteConfirmation(false);
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
  });
});

describe("createAdminEnrollment via addEnrollment", () => {
  it("delegates to addEnrollment after resolving course", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "c1",
      courseCode: "COSC 111",
    });
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "u1",
      email: "s@test.com",
      name: "Student",
    });
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "201",
      enrollment: { id: "e1", role: "STUDENT", userId: "u1", courseId: "c1", isActive: true },
    } as never);

    const prismaEnrollment = vi.fn().mockResolvedValue({
      id: "e1",
      role: "STUDENT",
      isActive: true,
      enrolledAt: new Date(),
      user: { email: "s@test.com", name: "Student" },
    });
    prismaMock.enrollment.findFirst = prismaEnrollment;

    const result = await createAdminEnrollment(ADMIN, {
      courseCode: "COSC 111",
      userId: "u1",
      role: "STUDENT",
    });

    expect(addEnrollment).toHaveBeenCalledWith("c1", { userId: "u1", role: "STUDENT" }, 4);
    expect(result).toMatchObject({ ok: true, writeSucceeded: true, verifiedEnrollment: { id: "e1" } });
  });
});

describe("updateAdminEnrollmentRole", () => {
  it("maps instructor floor violation", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "c1",
      courseCode: "COSC 111",
    });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({
      status: "409",
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    } as never);

    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });

    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    });
  });
});

describe("deactivateAdminEnrollment", () => {
  it("delegates to deactivateEnrollment", async () => {
    const { deactivateAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "c1",
      courseCode: "COSC 111",
    });
    vi.mocked(deactivateEnrollment).mockResolvedValue({
      status: "204",
      role: "STUDENT",
    } as never);

    const result = await deactivateAdminEnrollment(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
    });

    expect(deactivateEnrollment).toHaveBeenCalledWith("c1", "e1");
    expect(result).toMatchObject({ ok: true });
  });
});

describe("isAdminWriteToolName", () => {
  it("returns true for a known write tool name", async () => {
    const { isAdminWriteToolName } = await import("~/lib/agent-tools/admin-mutations.server");
    expect(isAdminWriteToolName("createUser")).toBe(true);
  });

  it("returns false for a read-only or unknown tool name", async () => {
    const { isAdminWriteToolName } = await import("~/lib/agent-tools/admin-mutations.server");
    expect(isAdminWriteToolName("listUsers")).toBe(false);
  });
});

describe("createAdminUser rethrows unexpected errors", () => {
  it("rethrows a non-P2002 error", async () => {
    prismaMock.user.create.mockRejectedValue(new Error("db exploded"));
    await expect(
      createAdminUser(ADMIN, { name: "Test User", email: "a@example.com", role: "STUDENT" }),
    ).rejects.toThrow("db exploded");
  });
});

describe("updateAdminUser rethrows unexpected errors", () => {
  it("rethrows a non-P2025/P2002 error", async () => {
    prismaMock.user.update.mockRejectedValue(new Error("db exploded"));
    await expect(updateAdminUser(ADMIN, "u2", { name: "New Name" })).rejects.toThrow("db exploded");
  });
});

describe("deleteAdminUser rethrows unexpected errors", () => {
  it("rethrows a non-P2025/P2003 error", async () => {
    prismaMock.$transaction.mockRejectedValue(new Error("db exploded"));
    await expect(deleteAdminUser(ADMIN, "u2")).rejects.toThrow("db exploded");
  });
});

describe("userRefValidationError", () => {
  it("returns null when userId is provided", () => {
    expect(userRefValidationError({ userId: "u1" })).toBeNull();
  });

  it("returns null when userEmail is provided", () => {
    expect(userRefValidationError({ userEmail: "a@test.com" })).toBeNull();
  });

  it("returns a validation failure when neither is provided", () => {
    const result = userRefValidationError({});
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "VALIDATION_ERROR",
      fields: { user: "userId or userEmail required — call listUsers first" },
    });
  });

  it("treats whitespace-only values as absent", () => {
    const result = userRefValidationError({ userId: "   ", userEmail: "  " });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });
});

describe("runAdminWriteTool", () => {
  it("returns the result unchanged on success", async () => {
    const result = await runAdminWriteTool("createUser", ADMIN, async () => ({
      dataSource: "database",
      mutation: true,
      writeSucceeded: true,
      appliedAt: new Date().toISOString(),
      ok: true,
    }));
    expect(result).toMatchObject({ ok: true, writeSucceeded: true });
  });

  it("maps a result with an error field to a failure", async () => {
    const result = await runAdminWriteTool("createUser", ADMIN, async () => ({
      error: "SOME_ERROR",
    }));
    expect(result).toMatchObject({ writeSucceeded: false, error: "SOME_ERROR" });
  });

  it("marks writeSucceeded:false results without an error as WRITE_FAILED", async () => {
    const result = await runAdminWriteTool("createUser", ADMIN, async () => ({
      dataSource: "database",
      mutation: true,
      writeSucceeded: false,
      appliedAt: new Date().toISOString(),
    }));
    expect(result).toMatchObject({ writeSucceeded: false, error: "WRITE_FAILED" });
  });
});

describe("runConfirmedAdminWriteTool", () => {
  it("registers a preview and requires confirmation when confirmed is false", async () => {
    const run = vi.fn();
    const result = await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      false,
      run,
      { a: 1 },
      "turn-1",
    );
    expect(registerWritePreview).toHaveBeenCalledWith(
      ADMIN.id,
      "createUser",
      { __tool: "createUser", a: 1 },
      undefined,
      "turn-1",
    );
    expect(result).toMatchObject({ writeSucceeded: false, error: "CONFIRMATION_REQUIRED" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects same-turn confirmation without consuming further", async () => {
    vi.mocked(consumeWritePreview).mockReturnValue("same_turn");
    const run = vi.fn();
    const result = await runConfirmedAdminWriteTool("createUser", ADMIN, true, run, {}, "turn-1");
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
      message: expect.stringContaining("same-generation"),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects confirmation when no matching preview exists", async () => {
    vi.mocked(consumeWritePreview).mockReturnValue("missing");
    const run = vi.fn();
    const result = await runConfirmedAdminWriteTool("createUser", ADMIN, true, run);
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
      message: expect.stringContaining("No matching preview"),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the write when confirmed and a matching preview was consumed", async () => {
    vi.mocked(consumeWritePreview).mockReturnValue("ok");
    const run = vi.fn().mockResolvedValue({
      dataSource: "database",
      mutation: true,
      writeSucceeded: true,
      appliedAt: new Date().toISOString(),
      ok: true,
    });
    const result = await runConfirmedAdminWriteTool("createUser", ADMIN, true, run, { a: 1 });
    expect(run).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, writeSucceeded: true });
  });
});

describe("createAdminUser additional branches", () => {
  it("returns validation error for invalid input", async () => {
    const result = await createAdminUser(ADMIN, {
      name: "A",
      email: "not-an-email",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("returns EMAIL_ALREADY_EXISTS on unique constraint violation", async () => {
    prismaMock.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    );
    const result = await createAdminUser(ADMIN, {
      name: "Test User",
      email: "dup@example.com",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "EMAIL_ALREADY_EXISTS" });
  });
});

describe("updateAdminUser additional branches", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminUser(STUDENT, "u2", { name: "New Name" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns validation error for invalid input", async () => {
    const result = await updateAdminUser(ADMIN, "u2", { email: "not-an-email" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("returns USER_NOT_FOUND when authorizedUnits target user does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await updateAdminUser(ADMIN, "u2", { authorizedUnits: ["CS"] });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("returns ROLE_MISMATCH when authorizedUnits target is not UNIT_ADMIN", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "STUDENT" });
    const result = await updateAdminUser(ADMIN, "u2", { authorizedUnits: ["CS"] });
    expect(result).toEqual({ error: "ROLE_MISMATCH" });
  });

  it("allows authorizedUnits update when target role is UNIT_ADMIN", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "UNIT_ADMIN" });
    prismaMock.user.update.mockResolvedValue({
      id: "u2",
      email: "a@test.com",
      name: "A",
      role: "UNIT_ADMIN",
      isActive: true,
      authorizedUnits: ["CS"],
      updatedAt: new Date(),
    });
    const result = await updateAdminUser(ADMIN, "u2", { authorizedUnits: ["CS"] });
    expect(result).toMatchObject({ ok: true, user: { authorizedUnits: ["CS"] } });
  });

  it("allows authorizedUnits update when role is being changed to UNIT_ADMIN in the same call", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "STUDENT" });
    prismaMock.user.update.mockResolvedValue({
      id: "u2",
      email: "a@test.com",
      name: "A",
      role: "UNIT_ADMIN",
      isActive: true,
      authorizedUnits: ["CS"],
      updatedAt: new Date(),
    });
    const result = await updateAdminUser(ADMIN, "u2", { role: "UNIT_ADMIN", authorizedUnits: ["CS"] });
    expect(result).toMatchObject({ ok: true });
  });

  it("returns USER_NOT_FOUND when update target no longer exists (P2025)", async () => {
    prismaMock.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "x" }),
    );
    const result = await updateAdminUser(ADMIN, "u2", { name: "New Name" });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("returns EMAIL_ALREADY_EXISTS on unique constraint violation (P2002)", async () => {
    prismaMock.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    );
    const result = await updateAdminUser(ADMIN, "u2", { email: "dup@test.com" });
    expect(result).toEqual({ error: "EMAIL_ALREADY_EXISTS" });
  });

  it("updates a user successfully", async () => {
    prismaMock.user.update.mockResolvedValue({
      id: "u2",
      email: "a@test.com",
      name: "New Name",
      role: "STUDENT",
      isActive: true,
      authorizedUnits: [],
      updatedAt: new Date(),
    });
    const result = await updateAdminUser(ADMIN, "u2", { name: "New Name" });
    expect(result).toMatchObject({ ok: true, user: { name: "New Name" } });
  });
});

describe("deleteAdminUser additional branches", () => {
  it("returns USER_NOT_FOUND when target does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await deleteAdminUser(ADMIN, "missing");
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("maps P2025 to USER_NOT_FOUND", async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "x" }),
    );
    const result = await deleteAdminUser(ADMIN, "u2");
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("maps P2003 to CANNOT_DELETE_USER_WITH_DATA", async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" }),
    );
    const result = await deleteAdminUser(ADMIN, "u2");
    expect(result).toEqual({ error: "CANNOT_DELETE_USER_WITH_DATA" });
  });
});

describe("createAdminEnrollment additional branches", () => {
  it("returns Forbidden for non-admin", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    const result = await createAdminEnrollment(STUDENT, {
      courseId: "c1",
      userId: "u1",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a user resolution error", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" } as never);
    const result = await createAdminEnrollment(ADMIN, {
      userEmail: "missing@test.com",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
    expect(resolveAdminCourseId).not.toHaveBeenCalled();
  });

  it("propagates a course resolution error", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminUserId).mockResolvedValue({ userId: "u1", email: "a@test.com", name: "A" });
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" } as never);
    const result = await createAdminEnrollment(ADMIN, {
      courseId: "missing",
      userId: "u1",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(getAccessibleCourse).not.toHaveBeenCalled();
  });

  it("propagates a course access gate error", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminUserId).mockResolvedValue({ userId: "u1", email: "a@test.com", name: "A" });
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await createAdminEnrollment(ADMIN, {
      courseId: "c1",
      userId: "u1",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "Forbidden" });
    expect(addEnrollment).not.toHaveBeenCalled();
  });

  it("returns the mapped failure when addEnrollment fails validation", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminUserId).mockResolvedValue({ userId: "u1", email: "a@test.com", name: "A" });
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "422",
      error: "VALIDATION_ERROR",
      fields: { role: "invalid" },
    } as never);
    const result = await createAdminEnrollment(ADMIN, {
      courseId: "c1",
      userId: "u1",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it("returns VERIFY_FAILED when the enrollment is not visible after write", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminUserId).mockResolvedValue({ userId: "u1", email: "a@test.com", name: "A" });
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "201",
      enrollment: { id: "e1" },
    } as never);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    const result = await createAdminEnrollment(ADMIN, {
      courseId: "c1",
      userId: "u1",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "VERIFY_FAILED" });
  });
});

describe("updateAdminEnrollmentRole additional branches", () => {
  it("returns Forbidden for non-admin", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    const result = await updateAdminEnrollmentRole(STUDENT, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a course resolution error", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" } as never);
    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "missing",
      enrollmentId: "e1",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(updateEnrollmentRole).not.toHaveBeenCalled();
  });

  it("maps a 403 forbidden result", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({ status: "403", error: "FORBIDDEN" } as never);
    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "FORBIDDEN" });
  });

  it("maps a 404 not-found result", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({ status: "404" } as never);
    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "NOT_FOUND" });
  });

  it("maps a 200 success result", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({
      status: "200",
      enrollment: { id: "e1", role: "STUDENT" },
      previousRole: "TA",
    } as never);
    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ ok: true, writeSucceeded: true, previousRole: "TA" });
  });

  it("maps an unrecognized result shape to UNKNOWN", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({} as never);
    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "UNKNOWN" });
  });
});

describe("deactivateAdminEnrollment additional branches", () => {
  it("returns Forbidden for non-admin", async () => {
    const { deactivateAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    const result = await deactivateAdminEnrollment(STUDENT, { courseId: "c1", enrollmentId: "e1" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a course resolution error", async () => {
    const { deactivateAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" } as never);
    const result = await deactivateAdminEnrollment(ADMIN, { courseId: "missing", enrollmentId: "e1" });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(deactivateEnrollment).not.toHaveBeenCalled();
  });

  it("maps a 409 conflict result", async () => {
    const { deactivateAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(deactivateEnrollment).mockResolvedValue({
      status: "409",
      error: "INSTRUCTOR_FLOOR_VIOLATION",
    } as never);
    const result = await deactivateAdminEnrollment(ADMIN, { courseId: "c1", enrollmentId: "e1" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "INSTRUCTOR_FLOOR_VIOLATION" });
  });
});

describe("updateAdminBugReportStatus additional branches", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminBugReportStatus(STUDENT, "b1", "RESOLVED");
    expect(result).toEqual({ error: "Forbidden" });
  });
});

describe("createAdminCourseTopic", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await createAdminCourseTopic(STUDENT, { courseId: "c1", name: "Loops" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a course resolution error", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" } as never);
    const result = await createAdminCourseTopic(ADMIN, { courseId: "missing", name: "Loops" });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(createCourseTopic).not.toHaveBeenCalled();
  });

  it("creates a topic on success", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(createCourseTopic).mockResolvedValue({
      status: "201",
      topic: { id: "t1", name: "Loops" },
    } as never);
    const result = await createAdminCourseTopic(ADMIN, { courseId: "c1", name: "Loops" });
    expect(result).toMatchObject({ ok: true, topic: { id: "t1", name: "Loops" } });
  });

  it("returns COURSE_NOT_FOUND when create reports 404", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "404" } as never);
    const result = await createAdminCourseTopic(ADMIN, { courseId: "c1", name: "Loops" });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns TOPIC_ALREADY_EXISTS when create reports 409", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "409", existingId: "t0" } as never);
    const result = await createAdminCourseTopic(ADMIN, { courseId: "c1", name: "Loops" });
    expect(result).toEqual({ error: "TOPIC_ALREADY_EXISTS", existingId: "t0" });
  });

  it("returns a validation failure for any other status", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "422" } as never);
    const result = await createAdminCourseTopic(ADMIN, { courseId: "c1", name: "" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
  });
});

describe("updateAdminCourseTopic", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminCourseTopic(STUDENT, { courseId: "c1", topicId: "t1", name: "Loops" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a course resolution error", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" } as never);
    const result = await updateAdminCourseTopic(ADMIN, {
      courseId: "missing",
      topicId: "t1",
      name: "Loops",
    });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("renames a topic on success", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateCourseTopic).mockResolvedValue({
      status: "200",
      topic: { id: "t1", name: "Recursion" },
    } as never);
    const result = await updateAdminCourseTopic(ADMIN, {
      courseId: "c1",
      topicId: "t1",
      name: "Recursion",
    });
    expect(result).toMatchObject({ ok: true, topic: { name: "Recursion" } });
  });

  it("returns TOPIC_NOT_FOUND when update reports 404", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "404" } as never);
    const result = await updateAdminCourseTopic(ADMIN, { courseId: "c1", topicId: "missing", name: "X" });
    expect(result).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns TOPIC_ALREADY_EXISTS when update reports 409", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "409", existingId: "t0" } as never);
    const result = await updateAdminCourseTopic(ADMIN, { courseId: "c1", topicId: "t1", name: "Dup" });
    expect(result).toEqual({ error: "TOPIC_ALREADY_EXISTS", existingId: "t0" });
  });

  it("returns a validation failure for any other status", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "422" } as never);
    const result = await updateAdminCourseTopic(ADMIN, { courseId: "c1", topicId: "t1", name: "" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
  });
});

describe("deleteAdminCourseTopic", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await deleteAdminCourseTopic(STUDENT, { courseId: "c1", topicId: "t1" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a course resolution error", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" } as never);
    const result = await deleteAdminCourseTopic(ADMIN, { courseId: "missing", topicId: "t1" });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns a validation failure when neither topicId nor name is given", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    const result = await deleteAdminCourseTopic(ADMIN, { courseId: "c1" });
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "VALIDATION_ERROR",
      fields: { topic: "topicId or name required" },
    });
    expect(deleteCourseTopic).not.toHaveBeenCalled();
  });

  it("deletes a topic on success", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204" } as never);
    const result = await deleteAdminCourseTopic(ADMIN, { courseId: "c1", topicId: "t1" });
    expect(result).toMatchObject({ ok: true, deleted: true });
  });

  it("returns TOPIC_NOT_FOUND when delete reports 404", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "404" } as never);
    const result = await deleteAdminCourseTopic(ADMIN, { courseId: "c1", name: "missing" });
    expect(result).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns a validation failure for any other status", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "422" } as never);
    const result = await deleteAdminCourseTopic(ADMIN, { courseId: "c1", topicId: "t1" });
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "VALIDATION_ERROR",
      fields: { topic: "topicId or name required" },
    });
  });
});

describe("createAdminInvitationMutation", () => {
  it("wraps a successful invitation", async () => {
    vi.mocked(createAdminInvitation).mockResolvedValue({ ok: true, invitationId: "i1" } as never);
    const result = await createAdminInvitationMutation(ADMIN, { email: "new@test.com", role: "STUDENT" });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true, invitationId: "i1" });
  });

  it("wraps a tool error", async () => {
    vi.mocked(createAdminInvitation).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await createAdminInvitationMutation(STUDENT, {
      email: "new@test.com",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "Forbidden" });
  });
});

describe("revokeAdminInvitationMutation", () => {
  it("wraps a successful revoke", async () => {
    vi.mocked(revokeAdminInvitation).mockResolvedValue({ ok: true } as never);
    const result = await revokeAdminInvitationMutation(ADMIN, "i1");
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("wraps a tool error", async () => {
    vi.mocked(revokeAdminInvitation).mockResolvedValue({ error: "NOT_FOUND" } as never);
    const result = await revokeAdminInvitationMutation(ADMIN, "missing");
    expect(result).toMatchObject({ writeSucceeded: false, error: "NOT_FOUND" });
  });
});

describe("resendAdminInvitationMutation", () => {
  it("wraps a successful resend", async () => {
    vi.mocked(resendAdminInvitation).mockResolvedValue({ ok: true } as never);
    const result = await resendAdminInvitationMutation(ADMIN, "i1");
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("wraps a tool error", async () => {
    vi.mocked(resendAdminInvitation).mockResolvedValue({ error: "NOT_FOUND" } as never);
    const result = await resendAdminInvitationMutation(ADMIN, "missing");
    expect(result).toMatchObject({ writeSucceeded: false, error: "NOT_FOUND" });
  });
});

describe("connectAdminCanvas", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await connectAdminCanvas(STUDENT, { canvasUrl: "https://canvas.test" });
    expect(result).toEqual({ error: "Forbidden" });
    expect(connectCanvasForUser).not.toHaveBeenCalled();
  });

  it("wraps a successful connect", async () => {
    vi.mocked(connectCanvasForUser).mockResolvedValue({ ok: true } as never);
    const result = await connectAdminCanvas(ADMIN, { canvasUrl: "https://canvas.test" });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("wraps a tool error", async () => {
    vi.mocked(connectCanvasForUser).mockResolvedValue({ error: "INVALID_URL" } as never);
    const result = await connectAdminCanvas(ADMIN, { canvasUrl: "bad" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "INVALID_URL" });
  });
});

describe("syncAdminCanvasCourses", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await syncAdminCanvasCourses(STUDENT, { canvasCourseIds: ["1"] });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("wraps a successful sync", async () => {
    vi.mocked(syncCanvasForUser).mockResolvedValue({ ok: true, synced: 1 } as never);
    const result = await syncAdminCanvasCourses(ADMIN, { canvasCourseIds: ["1"] });
    expect(result).toMatchObject({ writeSucceeded: true, synced: 1 });
  });

  it("wraps a tool error", async () => {
    vi.mocked(syncCanvasForUser).mockResolvedValue({ error: "SYNC_FAILED" } as never);
    const result = await syncAdminCanvasCourses(ADMIN, { canvasCourseIds: ["1"] });
    expect(result).toMatchObject({ writeSucceeded: false, error: "SYNC_FAILED" });
  });
});

describe("disconnectAdminCanvas", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await disconnectAdminCanvas(STUDENT, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("wraps a successful disconnect", async () => {
    vi.mocked(disconnectCanvasForUser).mockResolvedValue({ ok: true } as never);
    const result = await disconnectAdminCanvas(ADMIN, {});
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("wraps a tool error", async () => {
    vi.mocked(disconnectCanvasForUser).mockResolvedValue({ error: "NOT_CONNECTED" } as never);
    const result = await disconnectAdminCanvas(ADMIN, {});
    expect(result).toMatchObject({ writeSucceeded: false, error: "NOT_CONNECTED" });
  });
});

describe("linkAdminCanvasRoster", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await linkAdminCanvasRoster(STUDENT, { userId: "u1", studentNumber: "12345678" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns a validation failure when no user reference is given", async () => {
    const result = await linkAdminCanvasRoster(ADMIN, { studentNumber: "12345678" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
    expect(linkCanvasRosterForUser).not.toHaveBeenCalled();
  });

  it("wraps a successful link", async () => {
    vi.mocked(linkCanvasRosterForUser).mockResolvedValue({ ok: true } as never);
    const result = await linkAdminCanvasRoster(ADMIN, { userId: "u1", studentNumber: "12345678" });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("wraps a tool error", async () => {
    vi.mocked(linkCanvasRosterForUser).mockResolvedValue({ error: "USER_NOT_FOUND" } as never);
    const result = await linkAdminCanvasRoster(ADMIN, { userId: "missing", studentNumber: "12345678" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "USER_NOT_FOUND" });
  });
});

describe("platform mutation wrappers", () => {
  it("createAdminCourseMutation wraps success", async () => {
    vi.mocked(createAdminCourse).mockResolvedValue({ ok: true, course: { id: "c1" } } as never);
    const result = await createAdminCourseMutation(ADMIN, { code: "COSC 999", name: "New" });
    expect(createAdminCourse).toHaveBeenCalledWith(ADMIN, { code: "COSC 999", name: "New" });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true, course: { id: "c1" } });
  });

  it("createAdminCourseMutation wraps error", async () => {
    vi.mocked(createAdminCourse).mockResolvedValue({ error: "VALIDATION_ERROR" } as never);
    const result = await createAdminCourseMutation(ADMIN, {});
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
  });

  it("updateAdminCourseMutation delegates with opts and input", async () => {
    vi.mocked(updateAdminCourse).mockResolvedValue({ ok: true } as never);
    const opts = { courseId: "c1" };
    const input = { name: "Renamed" };
    const result = await updateAdminCourseMutation(ADMIN, opts, input);
    expect(updateAdminCourse).toHaveBeenCalledWith(ADMIN, opts, input);
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("deleteAdminCourseMutation delegates", async () => {
    vi.mocked(deleteAdminCourse).mockResolvedValue({ ok: true, deleted: true } as never);
    const result = await deleteAdminCourseMutation(ADMIN, { courseId: "c1" });
    expect(deleteAdminCourse).toHaveBeenCalledWith(ADMIN, { courseId: "c1" });
    expect(result).toMatchObject({ writeSucceeded: true, deleted: true });
  });

  it("publishAdminCourseMutation calls setAdminCoursePublished with true", async () => {
    vi.mocked(setAdminCoursePublished).mockResolvedValue({ ok: true, published: true } as never);
    const result = await publishAdminCourseMutation(ADMIN, { courseId: "c1" });
    expect(setAdminCoursePublished).toHaveBeenCalledWith(ADMIN, { courseId: "c1" }, true);
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("unpublishAdminCourseMutation calls setAdminCoursePublished with false", async () => {
    vi.mocked(setAdminCoursePublished).mockResolvedValue({ ok: true, published: false } as never);
    const result = await unpublishAdminCourseMutation(ADMIN, { courseId: "c1" });
    expect(setAdminCoursePublished).toHaveBeenCalledWith(ADMIN, { courseId: "c1" }, false);
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("updateAdminCourseRagSettingsMutation delegates", async () => {
    vi.mocked(updateAdminCourseRagSettings).mockResolvedValue({ ok: true } as never);
    const result = await updateAdminCourseRagSettingsMutation(ADMIN, { courseId: "c1" }, { chunkSize: 500 });
    expect(updateAdminCourseRagSettings).toHaveBeenCalledWith(ADMIN, { courseId: "c1" }, { chunkSize: 500 });
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("renameAdminCourseMaterialMutation delegates", async () => {
    vi.mocked(renameAdminCourseMaterial).mockResolvedValue({ ok: true } as never);
    const opts = { courseId: "c1", materialId: "m1", name: "New Name" };
    const result = await renameAdminCourseMaterialMutation(ADMIN, opts);
    expect(renameAdminCourseMaterial).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("deleteAdminCourseMaterialMutation delegates and wraps error", async () => {
    vi.mocked(deleteAdminCourseMaterial).mockResolvedValue({ error: "MATERIAL_NOT_FOUND" } as never);
    const opts = { courseId: "c1", materialId: "missing" };
    const result = await deleteAdminCourseMaterialMutation(ADMIN, opts);
    expect(deleteAdminCourseMaterial).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toMatchObject({ writeSucceeded: false, error: "MATERIAL_NOT_FOUND" });
  });

  it("updateAdminCourseEmbeddingSettingsMutation delegates", async () => {
    vi.mocked(updateAdminCourseEmbeddingSettings).mockResolvedValue({ ok: true } as never);
    const result = await updateAdminCourseEmbeddingSettingsMutation(ADMIN, { courseId: "c1" }, { model: "x" });
    expect(updateAdminCourseEmbeddingSettings).toHaveBeenCalledWith(ADMIN, { courseId: "c1" }, { model: "x" });
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("syncAdminCanvasMaterialsMutation delegates", async () => {
    vi.mocked(syncAdminCanvasMaterials).mockResolvedValue({ ok: true } as never);
    const opts = { courseId: "c1", canvasFileIds: ["f1"] };
    const result = await syncAdminCanvasMaterialsMutation(ADMIN, opts);
    expect(syncAdminCanvasMaterials).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("addAdminCourseTAMutation delegates", async () => {
    vi.mocked(addAdminCourseTA).mockResolvedValue({ ok: true } as never);
    const opts = { courseId: "c1", userId: "u1" };
    const result = await addAdminCourseTAMutation(ADMIN, opts);
    expect(addAdminCourseTA).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("removeAdminCourseTAMutation delegates and wraps error", async () => {
    vi.mocked(removeAdminCourseTA).mockResolvedValue({ error: "NOT_A_TA" } as never);
    const opts = { courseId: "c1", userId: "u1" };
    const result = await removeAdminCourseTAMutation(ADMIN, opts);
    expect(removeAdminCourseTA).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toMatchObject({ writeSucceeded: false, error: "NOT_A_TA" });
  });

  it("updateAdminPolicyMutation delegates", async () => {
    vi.mocked(updateAdminPolicy).mockResolvedValue({ ok: true } as never);
    const result = await updateAdminPolicyMutation(ADMIN, "allowSelfEnroll", true);
    expect(updateAdminPolicy).toHaveBeenCalledWith(ADMIN, "allowSelfEnroll", true);
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("createAdminAiProviderMutation delegates", async () => {
    vi.mocked(createAdminAiProvider).mockResolvedValue({ ok: true } as never);
    const result = await createAdminAiProviderMutation(ADMIN, { name: "openai" });
    expect(createAdminAiProvider).toHaveBeenCalledWith(ADMIN, { name: "openai" });
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("updateAdminAiProviderMutation delegates", async () => {
    vi.mocked(updateAdminAiProvider).mockResolvedValue({ ok: true } as never);
    const result = await updateAdminAiProviderMutation(ADMIN, "p1", { name: "openai2" });
    expect(updateAdminAiProvider).toHaveBeenCalledWith(ADMIN, "p1", { name: "openai2" });
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("deleteAdminAiProviderMutation delegates and wraps error", async () => {
    vi.mocked(deleteAdminAiProvider).mockResolvedValue({ error: "PROVIDER_IN_USE" } as never);
    const result = await deleteAdminAiProviderMutation(ADMIN, "p1");
    expect(deleteAdminAiProvider).toHaveBeenCalledWith(ADMIN, "p1");
    expect(result).toMatchObject({ writeSucceeded: false, error: "PROVIDER_IN_USE" });
  });

  it("createAdminAiModelMutation delegates", async () => {
    vi.mocked(createAdminAiModel).mockResolvedValue({ ok: true } as never);
    const result = await createAdminAiModelMutation(ADMIN, { name: "gpt" });
    expect(createAdminAiModel).toHaveBeenCalledWith(ADMIN, { name: "gpt" });
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("updateAdminAiModelMutation delegates", async () => {
    vi.mocked(updateAdminAiModel).mockResolvedValue({ ok: true } as never);
    const result = await updateAdminAiModelMutation(ADMIN, "m1", { name: "gpt2" });
    expect(updateAdminAiModel).toHaveBeenCalledWith(ADMIN, "m1", { name: "gpt2" });
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("deleteAdminAiModelMutation delegates and wraps error", async () => {
    vi.mocked(deleteAdminAiModel).mockResolvedValue({ error: "MODEL_IN_USE" } as never);
    const result = await deleteAdminAiModelMutation(ADMIN, "m1");
    expect(deleteAdminAiModel).toHaveBeenCalledWith(ADMIN, "m1");
    expect(result).toMatchObject({ writeSucceeded: false, error: "MODEL_IN_USE" });
  });

  it("triggerAdminCronJobMutation delegates", async () => {
    vi.mocked(triggerAdminCronJob).mockResolvedValue({ ok: true } as never);
    const result = await triggerAdminCronJobMutation(ADMIN, "reembed");
    expect(triggerAdminCronJob).toHaveBeenCalledWith(ADMIN, "reembed");
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("updateAdminCronScheduleMutation delegates", async () => {
    vi.mocked(updateAdminCronSchedule).mockResolvedValue({ ok: true } as never);
    const input = { jobName: "reembed", schedule: "0 0 * * *", scheduleLabel: "daily" };
    const result = await updateAdminCronScheduleMutation(ADMIN, input);
    expect(updateAdminCronSchedule).toHaveBeenCalledWith(ADMIN, input);
    expect(result).toMatchObject({ writeSucceeded: true });
  });
});

describe("startAdminCourseReEmbedMutation", () => {
  it("returns Forbidden for non-admin without calling the platform helper", async () => {
    const result = await startAdminCourseReEmbedMutation(STUDENT, { courseId: "c1" });
    expect(result).toEqual({ error: "Forbidden" });
    expect(startAdminCourseReEmbed).not.toHaveBeenCalled();
  });

  it("wraps a successful re-embed trigger", async () => {
    vi.mocked(startAdminCourseReEmbed).mockResolvedValue({ ok: true, jobId: "j1" } as never);
    const result = await startAdminCourseReEmbedMutation(ADMIN, { courseId: "c1" });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true, jobId: "j1" });
  });

  it("wraps a tool error", async () => {
    vi.mocked(startAdminCourseReEmbed).mockResolvedValue({ error: "ALREADY_RUNNING" } as never);
    const result = await startAdminCourseReEmbedMutation(ADMIN, { courseId: "c1" });
    expect(result).toMatchObject({ writeSucceeded: false, error: "ALREADY_RUNNING" });
  });
});
