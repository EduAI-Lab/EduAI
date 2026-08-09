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
  resolveAdminUserId: vi.fn(),
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
    createAdminInvitationMutation: vi.fn(),
    revokeAdminInvitationMutation: vi.fn(),
    resendAdminInvitationMutation: vi.fn(),
    connectAdminCanvas: vi.fn(),
    syncAdminCanvasCourses: vi.fn(),
    disconnectAdminCanvas: vi.fn(),
    linkAdminCanvasRoster: vi.fn(),
    createAdminCourseMutation: vi.fn(),
    updateAdminCourseMutation: vi.fn(),
    deleteAdminCourseMutation: vi.fn(),
    publishAdminCourseMutation: vi.fn(),
    unpublishAdminCourseMutation: vi.fn(),
    updateAdminCourseRagSettingsMutation: vi.fn(),
    renameAdminCourseMaterialMutation: vi.fn(),
    deleteAdminCourseMaterialMutation: vi.fn(),
    updateAdminCourseEmbeddingSettingsMutation: vi.fn(),
    startAdminCourseReEmbedMutation: vi.fn(),
    syncAdminCanvasMaterialsMutation: vi.fn(),
    addAdminCourseTAMutation: vi.fn(),
    removeAdminCourseTAMutation: vi.fn(),
    updateAdminPolicyMutation: vi.fn(),
    createAdminAiProviderMutation: vi.fn(),
    updateAdminAiProviderMutation: vi.fn(),
    deleteAdminAiProviderMutation: vi.fn(),
    createAdminAiModelMutation: vi.fn(),
    updateAdminAiModelMutation: vi.fn(),
    deleteAdminAiModelMutation: vi.fn(),
    triggerAdminCronJobMutation: vi.fn(),
  };
});

vi.mock("~/lib/agent-tools/admin-platform.server", () => ({
  getAdminCourseRagSettings: vi.fn(),
  getAdminCourseEmbeddingSettings: vi.fn(),
  getAdminCourseReEmbedJob: vi.fn(),
  getAdminDashboardStats: vi.fn(),
  getAdminPolicies: vi.fn(),
  listAdminAiProviders: vi.fn(),
  listAdminCanvasMaterials: vi.fn(),
  listAdminCourseChats: vi.fn(),
  listAdminCourseMaterials: vi.fn(),
  listAdminCourseTAs: vi.fn(),
  listAdminCronJobs: vi.fn(),
  listAdminOllamaModels: vi.fn(),
  listAdminUnitChats: vi.fn(),
  listAdminVllmModels: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-reads.server", () => ({
  getAdminCanvasIntegration: vi.fn(),
  listAdminCanvasCourses: vi.fn(),
  listAdminInvitations: vi.fn(),
}));

// runIdempotentAdminMutation calls withIdempotency, which persists claim rows via
// prisma.idempotencyRecord — no DB in this unit test, so bypass straight to the
// handler (equivalent to "no Idempotency-Key" passthrough) and let the mocked
// admin-mutations functions stand in for the actual mutation. Keep the real
// hashRequestBody — admin-write-confirmation.server's hashWritePayload depends on it.
vi.mock("~/lib/idempotency.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/idempotency.server")>();
  return {
    ...actual,
    withIdempotency: async (
      opts: { body?: Record<string, unknown> | null },
      handler: (body: Record<string, unknown> | null) => Promise<Response>,
    ) => handler(opts.body ?? null),
  };
});

import { createAdminChatTools } from "~/lib/agent-tools/create-admin-chat-tools";
import { agentReadyEndpoints } from "~/lib/agent-readiness/manifest";
import {
  getAccessibleCourse,
  listAccessibleCourses,
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminCourseTopics,
  getAdminCourseTopic,
  listAdminUsers,
  resolveAdminCourseId,
  resolveAdminUserId,
} from "~/lib/agent-tools/admin-context.server";
import {
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  createAdminEnrollment,
  updateAdminEnrollmentRole,
  deactivateAdminEnrollment,
  updateAdminBugReportStatus,
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
  runConfirmedAdminWriteTool,
  userRefValidationError,
} from "~/lib/agent-tools/admin-mutations.server";
import {
  getAdminCourseRagSettings,
  getAdminCourseEmbeddingSettings,
  getAdminCourseReEmbedJob,
  getAdminDashboardStats,
  getAdminPolicies,
  listAdminAiProviders,
  listAdminCanvasMaterials,
  listAdminCourseChats,
  listAdminCourseMaterials,
  listAdminCourseTAs,
  listAdminCronJobs,
  listAdminOllamaModels,
  listAdminUnitChats,
  listAdminVllmModels,
} from "~/lib/agent-tools/admin-platform.server";
import {
  getAdminCanvasIntegration,
  listAdminCanvasCourses,
  listAdminInvitations,
} from "~/lib/agent-tools/admin-reads.server";

const ADMIN = { id: "admin-1", role: "ADMIN" };
const ctx = {
  user: ADMIN,
  effectiveCourseId: "course-1",
  effectiveCourseCode: "COSC 111",
};

const call = { toolCallId: "test", messages: [] };

/** Registers a write preview (confirmed:false) then confirms it (confirmed:true) on the
 * next call — turnId is null in `ctx`, so a fresh preview is always confirmable
 * immediately (see admin-write-confirmation.server: same-turn rejection only applies
 * when the preview was bound to a non-null turnId). */
async function runWrite(tool: { execute: (args: never, call: never) => Promise<unknown> }, args: Record<string, unknown>) {
  const preview = await tool.execute({ ...args, confirmed: false } as never, call as never);
  expect(preview).toMatchObject({ writeSucceeded: false, error: "CONFIRMATION_REQUIRED" });
  return tool.execute({ ...args, confirmed: true } as never, call as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { resetWritePreviewsForTests } = await import(
    "~/lib/agent-tools/admin-write-confirmation.server"
  );
  resetWritePreviewsForTests();
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

describe("createAdminChatTools no-arg / simple passthrough reads", () => {
  it("listCourses delegates to listAccessibleCourses", async () => {
    vi.mocked(listAccessibleCourses).mockResolvedValue({ courses: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourses.execute({}, call as never);
    expect(listAccessibleCourses).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ courses: [] });
  });

  it("getPolicies delegates to getAdminPolicies", async () => {
    vi.mocked(getAdminPolicies).mockResolvedValue({ policies: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getPolicies.execute({}, call as never);
    expect(getAdminPolicies).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ policies: [] });
  });

  it("listAiProviders delegates to listAdminAiProviders", async () => {
    vi.mocked(listAdminAiProviders).mockResolvedValue({ providers: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listAiProviders.execute({}, call as never);
    expect(listAdminAiProviders).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ providers: [] });
  });

  it("listVllmModels delegates to listAdminVllmModels", async () => {
    vi.mocked(listAdminVllmModels).mockResolvedValue({ models: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listVllmModels.execute({}, call as never);
    expect(listAdminVllmModels).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ models: [] });
  });

  it("listCronJobs delegates to listAdminCronJobs", async () => {
    vi.mocked(listAdminCronJobs).mockResolvedValue({ jobs: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCronJobs.execute({}, call as never);
    expect(listAdminCronJobs).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ jobs: [] });
  });

  it("getDashboardStats delegates to getAdminDashboardStats", async () => {
    vi.mocked(getAdminDashboardStats).mockResolvedValue({ users: 1 } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getDashboardStats.execute({}, call as never);
    expect(getAdminDashboardStats).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ users: 1 });
  });

  it("getCourse delegates to getAccessibleCourse", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ course: { id: "course-1" } } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCourse.execute({ courseId: "course-1" }, call as never);
    expect(getAccessibleCourse).toHaveBeenCalledWith(ADMIN, "course-1");
    expect(result).toEqual({ course: { id: "course-1" } });
  });

  it("listUsers passes email/query/limit through to listAdminUsers", async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listUsers.execute(
      { email: "a@test.com", query: undefined, limit: 10 },
      call as never,
    );
    expect(listAdminUsers).toHaveBeenCalledWith(ADMIN, {
      email: "a@test.com",
      query: undefined,
      limit: 10,
    });
    expect(result).toEqual({ users: [] });
  });

  it("listBugReports passes status/source/limit through", async () => {
    vi.mocked(listAdminBugReportsForChat).mockResolvedValue({ reports: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listBugReports.execute(
      { status: "UNHANDLED", source: "CORE", limit: 5 },
      call as never,
    );
    expect(listAdminBugReportsForChat).toHaveBeenCalledWith(ADMIN, {
      status: "UNHANDLED",
      source: "CORE",
      limit: 5,
    });
    expect(result).toEqual({ reports: [] });
  });

  it("listInvitations passes limit through to listAdminInvitations", async () => {
    vi.mocked(listAdminInvitations).mockResolvedValue({ invitations: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listInvitations.execute({ limit: 100 }, call as never);
    expect(listAdminInvitations).toHaveBeenCalledWith(ADMIN, 100);
    expect(result).toEqual({ invitations: [] });
  });

  it("getCanvasIntegration passes instructor ref through", async () => {
    vi.mocked(getAdminCanvasIntegration).mockResolvedValue({ connected: false } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCanvasIntegration.execute(
      { instructorUserId: "inst-1", instructorEmail: undefined },
      call as never,
    );
    expect(getAdminCanvasIntegration).toHaveBeenCalledWith(ADMIN, {
      instructorUserId: "inst-1",
      instructorEmail: undefined,
    });
    expect(result).toEqual({ connected: false });
  });

  it("listCanvasCourses passes instructor ref through", async () => {
    vi.mocked(listAdminCanvasCourses).mockResolvedValue({ courses: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCanvasCourses.execute(
      { instructorUserId: undefined, instructorEmail: "inst@test.com" },
      call as never,
    );
    expect(listAdminCanvasCourses).toHaveBeenCalledWith(ADMIN, {
      instructorUserId: undefined,
      instructorEmail: "inst@test.com",
    });
    expect(result).toEqual({ courses: [] });
  });

  it("listOllamaModels passes baseUrl through", async () => {
    vi.mocked(listAdminOllamaModels).mockResolvedValue({ models: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listOllamaModels.execute(
      { baseUrl: "http://localhost:11434" },
      call as never,
    );
    expect(listAdminOllamaModels).toHaveBeenCalledWith(ADMIN, "http://localhost:11434");
    expect(result).toEqual({ models: [] });
  });
});

describe("createAdminChatTools course-scoped reads (courseOpts passthrough)", () => {
  const courseOpts = { courseId: "course-5", courseCode: "COSC 222", fallbackCourseId: "course-1" };

  it("getCourseRagSettings", async () => {
    vi.mocked(getAdminCourseRagSettings).mockResolvedValue({ ragTopK: 5 } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCourseRagSettings.execute(
      { courseId: "course-5", courseCode: "COSC 222" },
      call as never,
    );
    expect(getAdminCourseRagSettings).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ ragTopK: 5 });
  });

  it("listCourseMaterials", async () => {
    vi.mocked(listAdminCourseMaterials).mockResolvedValue({ materials: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourseMaterials.execute(
      { courseId: "course-5", courseCode: "COSC 222" },
      call as never,
    );
    expect(listAdminCourseMaterials).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ materials: [] });
  });

  it("listCanvasMaterials", async () => {
    vi.mocked(listAdminCanvasMaterials).mockResolvedValue({ files: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCanvasMaterials.execute(
      { courseId: "course-5", courseCode: "COSC 222" },
      call as never,
    );
    expect(listAdminCanvasMaterials).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ files: [] });
  });

  it("getCourseEmbeddingSettings", async () => {
    vi.mocked(getAdminCourseEmbeddingSettings).mockResolvedValue({ embeddingProvider: "openai" } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCourseEmbeddingSettings.execute(
      { courseId: "course-5", courseCode: "COSC 222" },
      call as never,
    );
    expect(getAdminCourseEmbeddingSettings).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ embeddingProvider: "openai" });
  });

  it("listCourseTAs", async () => {
    vi.mocked(listAdminCourseTAs).mockResolvedValue({ tas: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourseTAs.execute(
      { courseId: "course-5", courseCode: "COSC 222" },
      call as never,
    );
    expect(listAdminCourseTAs).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ tas: [] });
  });

  it("getCourseReEmbedJob passes jobId alongside courseOpts", async () => {
    vi.mocked(getAdminCourseReEmbedJob).mockResolvedValue({ status: "RUNNING" } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCourseReEmbedJob.execute(
      { courseId: "course-5", courseCode: "COSC 222", jobId: "job-1" },
      call as never,
    );
    expect(getAdminCourseReEmbedJob).toHaveBeenCalledWith(ADMIN, { ...courseOpts, jobId: "job-1" });
    expect(result).toEqual({ status: "RUNNING" });
  });

  it("listCourseChats passes limit alongside courseOpts", async () => {
    vi.mocked(listAdminCourseChats).mockResolvedValue({ chats: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourseChats.execute(
      { courseId: "course-5", courseCode: "COSC 222", limit: 20 },
      call as never,
    );
    expect(listAdminCourseChats).toHaveBeenCalledWith(ADMIN, { ...courseOpts, limit: 20 });
    expect(result).toEqual({ chats: [] });
  });

  it("listUnitChats passes department and limit positionally", async () => {
    vi.mocked(listAdminUnitChats).mockResolvedValue({ chats: [] } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.listUnitChats.execute(
      { department: "COSC", limit: 30 },
      call as never,
    );
    expect(listAdminUnitChats).toHaveBeenCalledWith(ADMIN, "COSC", 30);
    expect(result).toEqual({ chats: [] });
  });
});

describe("createAdminChatTools resolveCourse-based reads", () => {
  it("getCourseTopic resolves the course then fetches the topic", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "course-1",
      courseCode: "COSC 111",
    });
    vi.mocked(getAdminCourseTopic).mockResolvedValue({ topic: { id: "topic-1" } } as never);
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCourseTopic.execute(
      { courseCode: "COSC 111", topicId: "topic-1" },
      call as never,
    );
    expect(resolveAdminCourseId).toHaveBeenCalled();
    expect(getAdminCourseTopic).toHaveBeenCalledWith(ADMIN, "course-1", "topic-1");
    expect(result).toEqual({ topic: { id: "topic-1" } });
  });

  it("listCourseEnrollments short-circuits on a resolveCourse error without calling the list fn", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" });
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourseEnrollments.execute(
      { courseId: "missing" },
      call as never,
    );
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(listAdminCourseEnrollments).not.toHaveBeenCalled();
  });

  it("resolveCourse falls through to undefined when neither courseCode nor the ctx fallback is set", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "course-1",
      courseCode: "COSC 111",
    });
    vi.mocked(listAdminCourseTopics).mockResolvedValue({ topics: [] } as never);
    const noCodeCtx = { user: ADMIN, effectiveCourseId: "course-1", effectiveCourseCode: undefined };
    const tools = createAdminChatTools(noCodeCtx);
    await tools.listCourseTopics.execute({ courseId: "course-1" }, call as never);
    expect(resolveAdminCourseId).toHaveBeenCalledWith(ADMIN, {
      courseId: "course-1",
      courseCode: undefined,
      fallbackCourseId: "course-1",
    });
  });

  it("listCourseTopics short-circuits on a resolveCourse error without calling the list fn", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" });
    const tools = createAdminChatTools(ctx);
    const result = await tools.listCourseTopics.execute(
      { courseId: "missing" },
      call as never,
    );
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(listAdminCourseTopics).not.toHaveBeenCalled();
  });

  it("getCourseTopic short-circuits on a resolveCourse error without calling getAdminCourseTopic", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" });
    const tools = createAdminChatTools(ctx);
    const result = await tools.getCourseTopic.execute(
      { courseId: "missing", topicId: "topic-1" },
      call as never,
    );
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(getAdminCourseTopic).not.toHaveBeenCalled();
  });
});

describe("createAdminChatTools write tools — confirmed flow", () => {
  const courseOpts = { courseId: "course-5", courseCode: "COSC 222", fallbackCourseId: "course-1" };

  it("updateCourseEnrollment", async () => {
    vi.mocked(updateAdminEnrollmentRole).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", enrollmentId: "enr-1", role: "TA" };
    const result = await runWrite(tools.updateCourseEnrollment, args);
    expect(updateAdminEnrollmentRole).toHaveBeenCalledWith(ADMIN, { ...courseOpts, enrollmentId: "enr-1", role: "TA" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("deactivateCourseEnrollment", async () => {
    vi.mocked(deactivateAdminEnrollment).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", enrollmentId: "enr-1" };
    const result = await runWrite(tools.deactivateCourseEnrollment, args);
    expect(deactivateAdminEnrollment).toHaveBeenCalledWith(ADMIN, { ...courseOpts, enrollmentId: "enr-1" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateBugReportStatus", async () => {
    vi.mocked(updateAdminBugReportStatus).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { reportId: "report-1", status: "RESOLVED" };
    const result = await runWrite(tools.updateBugReportStatus, args);
    expect(updateAdminBugReportStatus).toHaveBeenCalledWith(ADMIN, "report-1", "RESOLVED");
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("createCourseTopic (confirmed=true path)", async () => {
    vi.mocked(createAdminCourseTopic).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", name: "New Topic" };
    const result = await runWrite(tools.createCourseTopic, args);
    expect(createAdminCourseTopic).toHaveBeenCalledWith(ADMIN, { ...courseOpts, name: "New Topic" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateCourseTopic", async () => {
    vi.mocked(updateAdminCourseTopic).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", topicId: "topic-1", name: "Renamed" };
    const result = await runWrite(tools.updateCourseTopic, args);
    expect(updateAdminCourseTopic).toHaveBeenCalledWith(ADMIN, { ...courseOpts, topicId: "topic-1", name: "Renamed" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("deleteCourseTopic", async () => {
    vi.mocked(deleteAdminCourseTopic).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", topicId: "topic-1", name: undefined };
    const result = await runWrite(tools.deleteCourseTopic, args);
    expect(deleteAdminCourseTopic).toHaveBeenCalledWith(ADMIN, { ...courseOpts, topicId: "topic-1", name: undefined });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("createInvitation (confirmed=true path)", async () => {
    vi.mocked(createAdminInvitationMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { email: "invite@test.com", name: "Invitee", role: "INSTRUCTOR", authorizedUnits: undefined };
    const result = await runWrite(tools.createInvitation, args);
    expect(createAdminInvitationMutation).toHaveBeenCalledWith(ADMIN, {
      email: "invite@test.com",
      name: "Invitee",
      role: "INSTRUCTOR",
      authorizedUnits: undefined,
    });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("revokeInvitation", async () => {
    vi.mocked(revokeAdminInvitationMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const result = await runWrite(tools.revokeInvitation, { invitationId: "inv-1" });
    expect(revokeAdminInvitationMutation).toHaveBeenCalledWith(ADMIN, "inv-1");
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("resendInvitation", async () => {
    vi.mocked(resendAdminInvitationMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const result = await runWrite(tools.resendInvitation, { invitationId: "inv-1" });
    expect(resendAdminInvitationMutation).toHaveBeenCalledWith(ADMIN, "inv-1");
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("connectCanvas", async () => {
    vi.mocked(connectAdminCanvas).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = {
      instructorUserId: "inst-1",
      instructorEmail: undefined,
      canvasUrl: "https://canvas.test",
      apiKey: "key",
      isTestMode: true,
    };
    const result = await runWrite(tools.connectCanvas, args);
    expect(connectAdminCanvas).toHaveBeenCalledWith(ADMIN, {
      instructorUserId: "inst-1",
      instructorEmail: undefined,
      canvasUrl: "https://canvas.test",
      apiKey: "key",
      isTestMode: true,
    });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("syncCanvasCourses", async () => {
    vi.mocked(syncAdminCanvasCourses).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { instructorUserId: "inst-1", instructorEmail: undefined, canvasCourseIds: ["c1", "c2"] };
    const result = await runWrite(tools.syncCanvasCourses, args);
    expect(syncAdminCanvasCourses).toHaveBeenCalledWith(ADMIN, {
      instructorUserId: "inst-1",
      instructorEmail: undefined,
      canvasCourseIds: ["c1", "c2"],
    });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("disconnectCanvas", async () => {
    vi.mocked(disconnectAdminCanvas).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { instructorUserId: "inst-1", instructorEmail: undefined };
    const result = await runWrite(tools.disconnectCanvas, args);
    expect(disconnectAdminCanvas).toHaveBeenCalledWith(ADMIN, args);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("linkCanvasRoster", async () => {
    vi.mocked(linkAdminCanvasRoster).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { userId: "user-1", userEmail: undefined, studentNumber: "123456" };
    const result = await runWrite(tools.linkCanvasRoster, args);
    expect(linkAdminCanvasRoster).toHaveBeenCalledWith(ADMIN, args);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("linkCanvasRoster returns a validation error without calling confirmWrite when userRef is missing", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.linkCanvasRoster.execute(
      { confirmed: false, userId: undefined, userEmail: undefined, studentNumber: "123456" },
      call as never,
    );
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
    expect(linkAdminCanvasRoster).not.toHaveBeenCalled();
  });

  it("createCourse", async () => {
    vi.mocked(createAdminCourseMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = {
      name: "New Course",
      code: "COSC 999",
      section: "A",
      term: "Fall",
      year: 2026,
      startDate: "2026-09-01",
      endDate: undefined,
      department: "COSC",
      description: undefined,
      isPublished: undefined,
      aiInstructions: undefined,
      instructorUserIds: ["inst-1"],
    };
    const result = await runWrite(tools.createCourse, args);
    expect(createAdminCourseMutation).toHaveBeenCalledWith(ADMIN, args);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateCourse", async () => {
    vi.mocked(updateAdminCourseMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", name: "Renamed Course" };
    const result = await runWrite(tools.updateCourse, args);
    expect(updateAdminCourseMutation).toHaveBeenCalledWith(ADMIN, courseOpts, { name: "Renamed Course" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("deleteCourse", async () => {
    vi.mocked(deleteAdminCourseMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222" };
    const result = await runWrite(tools.deleteCourse, args);
    expect(deleteAdminCourseMutation).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("publishCourse", async () => {
    vi.mocked(publishAdminCourseMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222" };
    const result = await runWrite(tools.publishCourse, args);
    expect(publishAdminCourseMutation).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("unpublishCourse", async () => {
    vi.mocked(unpublishAdminCourseMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222" };
    const result = await runWrite(tools.unpublishCourse, args);
    expect(unpublishAdminCourseMutation).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateCourseRagSettings", async () => {
    vi.mocked(updateAdminCourseRagSettingsMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", ragTopK: 8, ragSimilarityThreshold: 0.7 };
    const result = await runWrite(tools.updateCourseRagSettings, args);
    expect(updateAdminCourseRagSettingsMutation).toHaveBeenCalledWith(ADMIN, courseOpts, {
      ragTopK: 8,
      ragSimilarityThreshold: 0.7,
    });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("renameCourseMaterial", async () => {
    vi.mocked(renameAdminCourseMaterialMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", materialId: "mat-1", name: "Renamed" };
    const result = await runWrite(tools.renameCourseMaterial, args);
    expect(renameAdminCourseMaterialMutation).toHaveBeenCalledWith(ADMIN, {
      ...courseOpts,
      materialId: "mat-1",
      name: "Renamed",
    });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("deleteCourseMaterial", async () => {
    vi.mocked(deleteAdminCourseMaterialMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", materialId: "mat-1" };
    const result = await runWrite(tools.deleteCourseMaterial, args);
    expect(deleteAdminCourseMaterialMutation).toHaveBeenCalledWith(ADMIN, { ...courseOpts, materialId: "mat-1" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateCourseEmbeddingSettings", async () => {
    vi.mocked(updateAdminCourseEmbeddingSettingsMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" };
    const result = await runWrite(tools.updateCourseEmbeddingSettings, args);
    expect(updateAdminCourseEmbeddingSettingsMutation).toHaveBeenCalledWith(ADMIN, courseOpts, {
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("startCourseReEmbed", async () => {
    vi.mocked(startAdminCourseReEmbedMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222" };
    const result = await runWrite(tools.startCourseReEmbed, args);
    expect(startAdminCourseReEmbedMutation).toHaveBeenCalledWith(ADMIN, courseOpts);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("syncCanvasMaterials", async () => {
    vi.mocked(syncAdminCanvasMaterialsMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", canvasFileIds: ["f1"] };
    const result = await runWrite(tools.syncCanvasMaterials, args);
    expect(syncAdminCanvasMaterialsMutation).toHaveBeenCalledWith(ADMIN, { ...courseOpts, canvasFileIds: ["f1"] });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("addCourseTA", async () => {
    vi.mocked(addAdminCourseTAMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", userId: "user-1" };
    const result = await runWrite(tools.addCourseTA, args);
    expect(addAdminCourseTAMutation).toHaveBeenCalledWith(ADMIN, { ...courseOpts, userId: "user-1" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("removeCourseTA", async () => {
    vi.mocked(removeAdminCourseTAMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { courseId: "course-5", courseCode: "COSC 222", userId: "user-1" };
    const result = await runWrite(tools.removeCourseTA, args);
    expect(removeAdminCourseTAMutation).toHaveBeenCalledWith(ADMIN, { ...courseOpts, userId: "user-1" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updatePolicy", async () => {
    vi.mocked(updateAdminPolicyMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const result = await runWrite(tools.updatePolicy, { key: "allowSignups", value: true });
    expect(updateAdminPolicyMutation).toHaveBeenCalledWith(ADMIN, "allowSignups", true);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("createAiProvider", async () => {
    vi.mocked(createAdminAiProviderMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { name: "openai", displayName: "OpenAI", description: "desc" };
    const result = await runWrite(tools.createAiProvider, args);
    expect(createAdminAiProviderMutation).toHaveBeenCalledWith(ADMIN, args);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateAiProvider", async () => {
    vi.mocked(updateAdminAiProviderMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { providerId: "prov-1", displayName: "Updated" };
    const result = await runWrite(tools.updateAiProvider, args);
    expect(updateAdminAiProviderMutation).toHaveBeenCalledWith(ADMIN, "prov-1", { displayName: "Updated" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("deleteAiProvider", async () => {
    vi.mocked(deleteAdminAiProviderMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const result = await runWrite(tools.deleteAiProvider, { providerId: "prov-1" });
    expect(deleteAdminAiProviderMutation).toHaveBeenCalledWith(ADMIN, "prov-1");
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("createAiModel", async () => {
    vi.mocked(createAdminAiModelMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = {
      providerId: "prov-1",
      modelId: "gpt-5",
      name: "GPT-5",
      description: "desc",
      type: "CHAT",
    };
    const result = await runWrite(tools.createAiModel, args);
    expect(createAdminAiModelMutation).toHaveBeenCalledWith(ADMIN, args);
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateAiModel", async () => {
    vi.mocked(updateAdminAiModelMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { id: "model-1", name: "Renamed" };
    const result = await runWrite(tools.updateAiModel, args);
    expect(updateAdminAiModelMutation).toHaveBeenCalledWith(ADMIN, "model-1", { name: "Renamed" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("deleteAiModel", async () => {
    vi.mocked(deleteAdminAiModelMutation).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const result = await runWrite(tools.deleteAiModel, { id: "model-1" });
    expect(deleteAdminAiModelMutation).toHaveBeenCalledWith(ADMIN, "model-1");
    expect(result).toEqual({ writeSucceeded: true });
  });
});

describe("createAdminChatTools idempotent write tools", () => {
  it("createUser runs createAdminUser through runIdempotentAdminMutation on confirmed=true", async () => {
    vi.mocked(createAdminUser).mockResolvedValue({
      writeSucceeded: true,
      ok: true,
      user: { id: "user-9" },
    } as never);
    const tools = createAdminChatTools(ctx);
    const args = {
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
      idempotencyKey: "create-test-user-2",
    };
    const result = await runWrite(tools.createUser, args);
    expect(createAdminUser).toHaveBeenCalledWith(ADMIN, {
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("createCourseEnrollment runs createAdminEnrollment through runIdempotentAdminMutation", async () => {
    vi.mocked(createAdminEnrollment).mockResolvedValue({ writeSucceeded: true, ok: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = {
      courseId: "course-5",
      courseCode: "COSC 222",
      userId: "user-1",
      userEmail: undefined,
      role: "STUDENT",
      idempotencyKey: "enroll-1",
    };
    const result = await runWrite(tools.createCourseEnrollment, args);
    expect(createAdminEnrollment).toHaveBeenCalledWith(ADMIN, {
      courseId: "course-5",
      courseCode: "COSC 222",
      fallbackCourseId: "course-1",
      userId: "user-1",
      userEmail: undefined,
      role: "STUDENT",
    });
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("createCourseEnrollment returns a validation error without registering a preview when userRef is missing", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.createCourseEnrollment.execute(
      {
        confirmed: false,
        courseId: "course-5",
        courseCode: "COSC 222",
        userId: undefined,
        userEmail: undefined,
        role: "STUDENT",
        idempotencyKey: "enroll-2",
      },
      call as never,
    );
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
    expect(createAdminEnrollment).not.toHaveBeenCalled();
  });

  it("triggerCronJob runs triggerAdminCronJobMutation through runIdempotentAdminMutation", async () => {
    vi.mocked(triggerAdminCronJobMutation).mockResolvedValue({ writeSucceeded: true, ok: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { jobName: "cleanup-invitations", idempotencyKey: "trigger-1" };
    const result = await runWrite(tools.triggerCronJob, args);
    expect(triggerAdminCronJobMutation).toHaveBeenCalledWith(ADMIN, "cleanup-invitations");
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });
});

describe("createAdminChatTools user-resolution write tools", () => {
  it("updateUser resolves the user by id then calls updateAdminUser", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "user-1",
      email: "user@test.com",
      name: "User",
    });
    vi.mocked(updateAdminUser).mockResolvedValue({ writeSucceeded: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { userId: "user-1", userEmail: undefined, name: "Updated Name" };
    const result = await runWrite(tools.updateUser, args);
    expect(resolveAdminUserId).toHaveBeenCalledWith(ADMIN, { userId: "user-1", userEmail: undefined });
    expect(updateAdminUser).toHaveBeenCalledWith(ADMIN, "user-1", { name: "Updated Name" });
    expect(result).toEqual({ writeSucceeded: true });
  });

  it("updateUser propagates a resolveAdminUserId error without calling updateAdminUser", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const tools = createAdminChatTools(ctx);
    const args = { userId: "missing-user", userEmail: undefined, name: "Updated Name" };
    const result = await runWrite(tools.updateUser, args);
    expect(result).toMatchObject({ writeSucceeded: false, error: "USER_NOT_FOUND" });
    expect(updateAdminUser).not.toHaveBeenCalled();
  });

  it("deleteUser returns a validation error without calling confirmWrite when userRef is missing", async () => {
    const tools = createAdminChatTools(ctx);
    const result = await tools.deleteUser.execute(
      { confirmed: false, userId: undefined, userEmail: undefined },
      call as never,
    );
    expect(result).toMatchObject({ writeSucceeded: false, error: "VALIDATION_ERROR" });
    expect(deleteAdminUser).not.toHaveBeenCalled();
  });

  it("deleteUser resolves the user by email then calls deleteAdminUser", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "user-2",
      email: "delete@test.com",
      name: "Delete Me",
    });
    vi.mocked(deleteAdminUser).mockResolvedValue({ writeSucceeded: true, ok: true } as never);
    const tools = createAdminChatTools(ctx);
    const args = { userId: undefined, userEmail: "delete@test.com" };
    const result = await runWrite(tools.deleteUser, args);
    expect(resolveAdminUserId).toHaveBeenCalledWith(ADMIN, { userId: undefined, userEmail: "delete@test.com" });
    expect(deleteAdminUser).toHaveBeenCalledWith(ADMIN, "user-2");
    expect(result).toMatchObject({ writeSucceeded: true, ok: true });
  });

  it("deleteUser propagates a resolveAdminUserId error without calling deleteAdminUser", async () => {
    vi.mocked(resolveAdminUserId).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const tools = createAdminChatTools(ctx);
    const args = { userId: "missing-user", userEmail: undefined };
    const result = await runWrite(tools.deleteUser, args);
    expect(result).toMatchObject({ writeSucceeded: false, error: "USER_NOT_FOUND" });
    expect(deleteAdminUser).not.toHaveBeenCalled();
  });
});

describe("createAdminChatTools zod parameter schemas", () => {
  it("createUser parameters reject an invalid email", () => {
    const tools = createAdminChatTools(ctx);
    const parsed = tools.createUser.parameters.safeParse({
      confirmed: false,
      name: "Test User",
      email: "not-an-email",
      role: "STUDENT",
      idempotencyKey: "key-1",
    });
    expect(parsed.success).toBe(false);
  });

  it("createUser parameters default confirmed to false when omitted", () => {
    const tools = createAdminChatTools(ctx);
    const parsed = tools.createUser.parameters.safeParse({
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
      idempotencyKey: "key-1",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.confirmed).toBe(false);
    }
  });

  it("updateCourseRagSettings parameters reject an out-of-range similarity threshold", () => {
    const tools = createAdminChatTools(ctx);
    const parsed = tools.updateCourseRagSettings.parameters.safeParse({
      courseId: "course-1",
      ragSimilarityThreshold: 1.5,
    });
    expect(parsed.success).toBe(false);
  });
});
