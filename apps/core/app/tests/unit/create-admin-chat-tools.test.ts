// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAccessibleCourses: vi.fn(),
  listAdminBugReportsForChat: vi.fn(),
  listAdminCourseEnrollments: vi.fn(),
  listAdminCourseTopics: vi.fn(),
  getAdminCourseTopic: vi.fn(),
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
    createAdminCourseTopic: vi.fn(),
    updateAdminCourseTopic: vi.fn(),
    deleteAdminCourseTopic: vi.fn(),
  };
});

import { createAdminChatTools } from "~/lib/agent-tools/create-admin-chat-tools";
import { agentReadyEndpoints } from "~/lib/agent-readiness/manifest";
import {
  listAdminCourseEnrollments,
  listAdminCourseTopics,
  resolveAdminCourseId,
} from "~/lib/agent-tools/admin-context.server";
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

describe("createAdminChatTools manifest coverage", () => {
  it("exposes every adminChatTool named on a ready endpoint", () => {
    const tools = createAdminChatTools(ctx);
    const expected = new Set(
      agentReadyEndpoints()
        .map((e) => e.adminChatTool)
        .filter((name): name is string => Boolean(name)),
    );
    for (const name of expected) {
      expect(tools, `missing tool ${name}`).toHaveProperty(name);
    }
  });
});

describe("createAdminChatTools read execute", () => {
  it("listCourseTopics resolves course then lists topics", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "course-1",
      courseCode: "COSC 111",
    });
    vi.mocked(listAdminCourseTopics).mockResolvedValue({
      dataSource: "database",
      courseId: "course-1",
      courseCode: "COSC 111",
      topics: [],
      count: 0,
      queriedAt: new Date().toISOString(),
    });

    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourseTopics.execute({ courseCode: "COSC 111" }, { toolCallId: "test", messages: [] });
    expect(resolveAdminCourseId).toHaveBeenCalled();
    expect(listAdminCourseTopics).toHaveBeenCalledWith(ADMIN, "course-1");
    expect(result).toMatchObject({ count: 0, dataSource: "database" });
  });

  it("listCourseEnrollments passes userId/userEmail through for an exact roster lookup", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "course-1",
      courseCode: "COSC 111",
    });
    vi.mocked(listAdminCourseEnrollments).mockResolvedValue({
      dataSource: "database",
      courseId: "course-1",
      courseCode: "COSC 111",
      enrollments: [],
      count: 0,
      total: 0,
      truncated: false,
      queriedAt: new Date().toISOString(),
    } as never);

    const tools = createAdminChatTools(ctx);
    await tools.listCourseEnrollments.execute(
      { courseCode: "COSC 111", userEmail: "student@test.com" },
      { toolCallId: "test", messages: [] },
    );

    expect(listAdminCourseEnrollments).toHaveBeenCalledWith(
      ADMIN,
      "course-1",
      expect.objectContaining({ userEmail: "student@test.com" }),
    );
  });

  it("returns CONFIRMATION_REQUIRED for createCourseTopic when confirmed is false", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.createCourseTopic.execute(
      {
        confirmed: false,
        courseCode: "COSC 111",
        name: "New Topic",
      },
      { toolCallId: "test", messages: [] },
    );
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
  });

  it("returns CONFIRMATION_REQUIRED for createInvitation when confirmed is false", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.createInvitation.execute(
      {
        confirmed: false,
        email: "invite@test.com",
        role: "INSTRUCTOR",
      },
      { toolCallId: "test", messages: [] },
    );
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
  });
});

describe("createAdminChatTools write execute", () => {
  it("returns CONFIRMATION_REQUIRED for createUser when confirmed is false", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.createUser.execute(
      {
        confirmed: false,
        name: "Test User",
        email: "test@example.com",
        role: "STUDENT",
        idempotencyKey: "create-test-user",
      },
      { toolCallId: "test", messages: [] },
    );
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
    expect(createAdminUser).not.toHaveBeenCalled();
  });

  it("returns user ref validation error without crashing for updateUser", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.updateUser.execute(
      {
        confirmed: true,
        name: "Updated",
      },
      { toolCallId: "test", messages: [] },
    );
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
  beforeEach(async () => {
    const { resetWritePreviewsForTests } = await import(
      "~/lib/agent-tools/admin-write-confirmation.server"
    );
    resetWritePreviewsForTests();
  });

  it("registers a preview and does not mutate when confirmed is false", async () => {
    const run = vi.fn().mockResolvedValue({ writeSucceeded: true });
    const result = await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      false,
      run,
      { email: "a@test.com" },
    );
    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
  });

  it("rejects confirmed=true without a matching preview", async () => {
    const run = vi.fn().mockResolvedValue({ writeSucceeded: true });
    const result = await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      true,
      run,
      { email: "a@test.com" },
    );
    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
  });

  it("runs the mutation after matching confirmed=false then confirmed=true on a later turn", async () => {
    vi.mocked(createAdminUser).mockResolvedValue({
      writeSucceeded: true,
      ok: true,
      dataSource: "database",
      mutation: true,
      appliedAt: new Date().toISOString(),
    });

    const payload = { name: "A", email: "a@test.com", role: "STUDENT" };
    await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      false,
      () =>
        createAdminUser(ADMIN, {
          name: "A",
          email: "a@test.com",
          role: "STUDENT",
        }),
      payload,
      "turn-preview",
    );

    const sameTurn = await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      true,
      () =>
        createAdminUser(ADMIN, {
          name: "A",
          email: "a@test.com",
          role: "STUDENT",
        }),
      payload,
      "turn-preview",
    );
    expect(createAdminUser).not.toHaveBeenCalled();
    expect(sameTurn).toMatchObject({
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
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
      payload,
      "turn-confirm",
    );
    expect(createAdminUser).toHaveBeenCalled();
    expect(result).toMatchObject({ writeSucceeded: true });
  });

  it("rejects confirmed=true when the payload differs from the preview", async () => {
    await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      false,
      async () => ({ writeSucceeded: true }),
      { email: "a@test.com" },
    );
    const run = vi.fn().mockResolvedValue({ writeSucceeded: true });
    const result = await runConfirmedAdminWriteTool(
      "createUser",
      ADMIN,
      true,
      run,
      { email: "b@test.com" },
    );
    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
  });
});
