// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/agent-tools/admin-canvas.server", () => ({
  readCanvasCourses: vi.fn(),
  readCanvasIntegration: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-invitations.server", () => ({
  listAdminInvitations: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-platform.server", () => ({
  getAdminCourseEmbeddingSettings: vi.fn(),
  getAdminCourseRagSettings: vi.fn(),
  getAdminCourseReEmbedJob: vi.fn(),
  getAdminCronJobRuns: vi.fn(),
  getAdminDashboardStats: vi.fn(),
  getAdminPolicies: vi.fn(),
  listAdminAiProviders: vi.fn(),
  listAdminCanvasMaterials: vi.fn(),
  listAdminCourseChats: vi.fn(),
  listAdminCourseMaterials: vi.fn(),
  listAdminCourseTAs: vi.fn(),
  listAdminCronJobs: vi.fn(),
  listAdminUnitChats: vi.fn(),
}));

import { readCanvasCourses, readCanvasIntegration } from "~/lib/agent-tools/admin-canvas.server";
import { listAdminInvitations as listInvitationsForAdmin } from "~/lib/agent-tools/admin-invitations.server";
import {
  getAdminCourseEmbeddingSettings,
  getAdminCourseRagSettings,
  getAdminCourseReEmbedJob,
  getAdminCronJobRuns,
  getAdminDashboardStats,
  getAdminPolicies,
  listAdminAiProviders,
  listAdminCanvasMaterials,
  listAdminCourseChats,
  listAdminCourseMaterials,
  listAdminCourseTAs,
  listAdminCronJobs,
  listAdminUnitChats,
} from "~/lib/agent-tools/admin-platform.server";
import {
  getAdminCanvasIntegration,
  listAdminCanvasCourses,
  listAdminInvitations,
  readAdminAiProviders,
  readAdminCanvasMaterials,
  readAdminCourseChats,
  readAdminCourseEmbeddingSettings,
  readAdminCourseMaterials,
  readAdminCourseRagSettings,
  readAdminCourseReEmbedJob,
  readAdminCourseTAs,
  readAdminCronJobRuns,
  readAdminCronJobs,
  readAdminDashboardStats,
  readAdminPolicies,
  readAdminUnitChats,
} from "~/lib/agent-tools/admin-reads.server";

const ADMIN = { id: "a1", role: "ADMIN" };
const STUDENT = { id: "s1", role: "STUDENT" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminInvitations", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminInvitations(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
    expect(listInvitationsForAdmin).not.toHaveBeenCalled();
  });

  it("wraps invitations in a dataSource envelope for admin", async () => {
    vi.mocked(listInvitationsForAdmin).mockResolvedValue({
      invitations: [{ id: "i1" } as never],
      count: 1,
      total: 1,
      truncated: false,
    });
    const result = await listAdminInvitations(ADMIN, 50);
    expect(result).toMatchObject({
      dataSource: "database",
      invitations: [{ id: "i1" }],
      count: 1,
      total: 1,
      truncated: false,
    });
    expect(listInvitationsForAdmin).toHaveBeenCalledWith(ADMIN, 50);
  });

  it("passes through errors from the delegate", async () => {
    vi.mocked(listInvitationsForAdmin).mockResolvedValue({ error: "Forbidden" });
    const result = await listAdminInvitations(ADMIN);
    expect(result).toEqual({ error: "Forbidden" });
  });
});

describe("getAdminCanvasIntegration", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await getAdminCanvasIntegration(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
    expect(readCanvasIntegration).not.toHaveBeenCalled();
  });

  it("wraps the integration result for admin", async () => {
    vi.mocked(readCanvasIntegration).mockResolvedValue({
      userId: "a1",
      integration: null,
      connected: false,
    });
    const result = await getAdminCanvasIntegration(ADMIN);
    expect(result).toMatchObject({ dataSource: "database", userId: "a1", connected: false });
  });

  it("passes through errors from the delegate", async () => {
    vi.mocked(readCanvasIntegration).mockResolvedValue({ error: "USER_NOT_FOUND" });
    const result = await getAdminCanvasIntegration(ADMIN, { instructorUserId: "missing" });
    expect(result).toEqual({ error: "USER_NOT_FOUND" });
  });
});

describe("listAdminCanvasCourses", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminCanvasCourses(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
    expect(readCanvasCourses).not.toHaveBeenCalled();
  });

  it("wraps courses with a count for admin", async () => {
    vi.mocked(readCanvasCourses).mockResolvedValue({
      userId: "a1",
      courses: [{ canvasId: "1" } as never, { canvasId: "2" } as never],
    });
    const result = await listAdminCanvasCourses(ADMIN);
    expect(result).toMatchObject({
      dataSource: "database",
      userId: "a1",
      count: 2,
      courses: [{ canvasId: "1" }, { canvasId: "2" }],
    });
  });

  it("passes through errors from the delegate", async () => {
    vi.mocked(readCanvasCourses).mockResolvedValue({ error: "CANVAS_NOT_CONNECTED" });
    const result = await listAdminCanvasCourses(ADMIN);
    expect(result).toEqual({ error: "CANVAS_NOT_CONNECTED" });
  });
});

describe("thin course/platform delegations", () => {
  it("readAdminCourseRagSettings delegates to getAdminCourseRagSettings", async () => {
    vi.mocked(getAdminCourseRagSettings).mockResolvedValue({ dataSource: "database", settings: {} } as never);
    const opts = { courseId: "c1" };
    const result = await readAdminCourseRagSettings(ADMIN, opts);
    expect(getAdminCourseRagSettings).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ dataSource: "database", settings: {} });
  });

  it("readAdminCourseMaterials delegates to listAdminCourseMaterials", async () => {
    vi.mocked(listAdminCourseMaterials).mockResolvedValue({ materials: [], count: 0 } as never);
    const opts = { courseId: "c1" };
    const result = await readAdminCourseMaterials(ADMIN, opts);
    expect(listAdminCourseMaterials).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ materials: [], count: 0 });
  });

  it("readAdminCourseEmbeddingSettings delegates to getAdminCourseEmbeddingSettings", async () => {
    vi.mocked(getAdminCourseEmbeddingSettings).mockResolvedValue({ settings: {} } as never);
    const opts = { courseId: "c1" };
    const result = await readAdminCourseEmbeddingSettings(ADMIN, opts);
    expect(getAdminCourseEmbeddingSettings).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ settings: {} });
  });

  it("readAdminCourseReEmbedJob delegates to getAdminCourseReEmbedJob", async () => {
    vi.mocked(getAdminCourseReEmbedJob).mockResolvedValue({ job: { id: "j1" } } as never);
    const opts = { courseId: "c1", jobId: "j1" };
    const result = await readAdminCourseReEmbedJob(ADMIN, opts);
    expect(getAdminCourseReEmbedJob).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ job: { id: "j1" } });
  });

  it("readAdminCanvasMaterials delegates to listAdminCanvasMaterials", async () => {
    vi.mocked(listAdminCanvasMaterials).mockResolvedValue({ materials: [], count: 0 } as never);
    const opts = { courseId: "c1" };
    const result = await readAdminCanvasMaterials(ADMIN, opts);
    expect(listAdminCanvasMaterials).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ materials: [], count: 0 });
  });

  it("readAdminCourseTAs delegates to listAdminCourseTAs", async () => {
    vi.mocked(listAdminCourseTAs).mockResolvedValue({ tas: [], count: 0 } as never);
    const opts = { courseId: "c1" };
    const result = await readAdminCourseTAs(ADMIN, opts);
    expect(listAdminCourseTAs).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ tas: [], count: 0 });
  });

  it("readAdminCourseChats delegates to listAdminCourseChats", async () => {
    vi.mocked(listAdminCourseChats).mockResolvedValue({ chats: [], count: 0 } as never);
    const opts = { courseId: "c1", limit: 10 };
    const result = await readAdminCourseChats(ADMIN, opts);
    expect(listAdminCourseChats).toHaveBeenCalledWith(ADMIN, opts);
    expect(result).toEqual({ chats: [], count: 0 });
  });

  it("readAdminUnitChats delegates to listAdminUnitChats", async () => {
    vi.mocked(listAdminUnitChats).mockResolvedValue({ department: "CS", chats: [], count: 0 } as never);
    const result = await readAdminUnitChats(ADMIN, "CS", 20);
    expect(listAdminUnitChats).toHaveBeenCalledWith(ADMIN, "CS", 20);
    expect(result).toEqual({ department: "CS", chats: [], count: 0 });
  });

  it("readAdminPolicies delegates to getAdminPolicies", async () => {
    vi.mocked(getAdminPolicies).mockResolvedValue({ policies: {}, definitions: {} } as never);
    const result = await readAdminPolicies(ADMIN);
    expect(getAdminPolicies).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ policies: {}, definitions: {} });
  });

  it("readAdminAiProviders delegates to listAdminAiProviders", async () => {
    vi.mocked(listAdminAiProviders).mockResolvedValue({ providers: [], count: 0 } as never);
    const result = await readAdminAiProviders(ADMIN);
    expect(listAdminAiProviders).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ providers: [], count: 0 });
  });

  it("readAdminCronJobs delegates to listAdminCronJobs", async () => {
    vi.mocked(listAdminCronJobs).mockResolvedValue({ jobs: [], count: 0 } as never);
    const result = await readAdminCronJobs(ADMIN);
    expect(listAdminCronJobs).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ jobs: [], count: 0 });
  });

  it("readAdminCronJobRuns delegates to getAdminCronJobRuns", async () => {
    vi.mocked(getAdminCronJobRuns).mockResolvedValue({ jobName: "j1", runs: [], count: 0 } as never);
    const result = await readAdminCronJobRuns(ADMIN, "j1");
    expect(getAdminCronJobRuns).toHaveBeenCalledWith(ADMIN, "j1");
    expect(result).toEqual({ jobName: "j1", runs: [], count: 0 });
  });

  it("readAdminDashboardStats delegates to getAdminDashboardStats", async () => {
    vi.mocked(getAdminDashboardStats).mockResolvedValue({ stats: {} } as never);
    const result = await readAdminDashboardStats(ADMIN);
    expect(getAdminDashboardStats).toHaveBeenCalledWith(ADMIN);
    expect(result).toEqual({ stats: {} });
  });
});
