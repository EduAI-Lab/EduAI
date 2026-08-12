// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  chat: { findMany: vi.fn(), count: vi.fn() },
  courseMaterial: { count: vi.fn() },
  enrollment: { count: vi.fn() },
  user: { count: vi.fn() },
  course: { findMany: vi.fn(), count: vi.fn() },
  aIProvider: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  aIModel: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  resolveAdminCourseId: vi.fn(),
}));

vi.mock("~/lib/courses/tas.server", () => ({
  addCourseTA: vi.fn(),
  getCourseTA: vi.fn(),
  removeCourseTA: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicies: vi.fn(),
  getPolicyDefinitions: vi.fn(),
  isPolicyKey: vi.fn(),
  setPolicy: vi.fn(),
}));

vi.mock("~/lib/ai/routing/tiers", () => ({
  invalidateTierModelCache: vi.fn(),
}));

vi.mock("~/lib/db.cron-jobs.server", () => ({
  KNOWN_CRON_JOBS: [
    {
      name: "backup-nightly",
      description: "Full pg_dump",
      schedule: "0 2 * * *",
      scheduleLabel: "Daily at 02:00 UTC",
      script: "backup-nightly.sh",
    },
    {
      name: "ai-tutor-reconcile",
      description: "Nullify stale refs",
      schedule: "0 2 * * *",
      scheduleLabel: "Daily at 02:00 UTC (AI Tutor server)",
      script: "",
      triggerEnabled: false,
    },
  ],
  listCronJobStatuses: vi.fn(),
  getRecentCronJobRuns: vi.fn(),
  resetCronSchedule: vi.fn(),
  startCronRun: vi.fn(),
  triggerCronJobAsync: vi.fn(),
  updateCronSchedule: vi.fn(),
  findRunningCronRun: vi.fn(),
}));

vi.mock("~/lib/cron-scheduler.server", () => ({
  rescheduleJob: vi.fn(),
}));

import { resolveAdminCourseId } from "~/lib/agent-tools/admin-context.server";
import { addCourseTA, getCourseTA, removeCourseTA } from "~/lib/courses/tas.server";
import { getPolicies, getPolicyDefinitions, isPolicyKey, setPolicy } from "~/lib/policy.server";
import { invalidateTierModelCache } from "~/lib/ai/routing/tiers";
import {
  KNOWN_CRON_JOBS,
  listCronJobStatuses,
  getRecentCronJobRuns,
  resetCronSchedule,
  startCronRun,
  triggerCronJobAsync,
  updateCronSchedule,
  findRunningCronRun,
} from "~/lib/db.cron-jobs.server";
import { rescheduleJob } from "~/lib/cron-scheduler.server";

import {
  listAdminCourseTAs,
  addAdminCourseTA,
  removeAdminCourseTA,
  listAdminCourseChats,
  listAdminUnitChats,
  getAdminPolicies,
  updateAdminPolicy,
  listAdminAiProviders,
  createAdminAiProvider,
  updateAdminAiProvider,
  deleteAdminAiProvider,
  createAdminAiModel,
  updateAdminAiModel,
  deleteAdminAiModel,
  listAdminCronJobs,
  getAdminCronJobRuns,
  triggerAdminCronJob,
  updateAdminCronSchedule,
  resetAdminCronSchedule,
  getAdminDashboardStats,
  listAdminOllamaModels,
  listAdminVllmModels,
} from "~/lib/agent-tools/admin-platform.server";

const ADMIN = { id: "a1", role: "ADMIN" };
const STUDENT = { id: "s1", role: "STUDENT" };

const COURSE_OPTS = { courseId: "c1" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── TAs ──────────────────────────────────────────────────────────────────

describe("listAdminCourseTAs", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminCourseTAs(STUDENT, COURSE_OPTS);
    expect(result).toEqual({ error: "Forbidden" });
    expect(resolveAdminCourseId).not.toHaveBeenCalled();
  });

  it("propagates course resolution error", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" });
    const result = await listAdminCourseTAs(ADMIN, COURSE_OPTS);
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns TAs for admin", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(getCourseTA).mockResolvedValue([
      { id: "e1", user: { id: "u1", name: "TA One", email: "ta1@test.com" } },
    ] as never);

    const result = await listAdminCourseTAs(ADMIN, COURSE_OPTS);
    expect(result).toMatchObject({ dataSource: "database", count: 1 });
    expect("tas" in result && result.tas).toHaveLength(1);
    expect(getCourseTA).toHaveBeenCalledWith("c1");
  });
});

describe("addAdminCourseTA", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await addAdminCourseTA(STUDENT, { ...COURSE_OPTS, userId: "u1" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns the error from addCourseTA on failure", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(addCourseTA).mockResolvedValue({ error: "User not found" } as never);

    const result = await addAdminCourseTA(ADMIN, { ...COURSE_OPTS, userId: "u1" });
    expect(result).toEqual({ error: "User not found" });
  });

  it("adds a TA successfully", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(addCourseTA).mockResolvedValue({
      ta: { id: "e1", user: { id: "u1", name: "TA", email: "ta@test.com" } },
    } as never);

    const result = await addAdminCourseTA(ADMIN, { ...COURSE_OPTS, userId: "u1" });
    // NOTE: addCourseTA already resolves to { ta: {...} }, and this function wraps
    // it again as `{ ok: true, ta: result }`, producing a double-nested `ta.ta`
    // shape rather than a flat `ta`. Asserting the real (buggy) shape here rather
    // than silently normalizing it away — see final report.
    expect(result).toMatchObject({ ok: true, ta: { ta: { id: "e1" } } });
    expect(addCourseTA).toHaveBeenCalledWith("c1", { userId: "u1" });
  });
});

describe("removeAdminCourseTA", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await removeAdminCourseTA(STUDENT, { ...COURSE_OPTS, userId: "u1" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns the error from removeCourseTA on failure", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(removeCourseTA).mockResolvedValue({ error: "TA not found for this course" } as never);

    const result = await removeAdminCourseTA(ADMIN, { ...COURSE_OPTS, userId: "u1" });
    expect(result).toEqual({ error: "TA not found for this course" });
  });

  it("removes a TA successfully", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    vi.mocked(removeCourseTA).mockResolvedValue({ success: true, taId: "e1", taName: "TA" } as never);

    const result = await removeAdminCourseTA(ADMIN, { ...COURSE_OPTS, userId: "u1" });
    expect(result).toEqual({ ok: true });
    expect(removeCourseTA).toHaveBeenCalledWith("c1", { userId: "u1" });
  });
});

// ── Chats ────────────────────────────────────────────────────────────────

describe("listAdminCourseChats", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminCourseChats(STUDENT, COURSE_OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns chats with the default limit", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    prismaMock.chat.findMany.mockResolvedValue([{ id: "ch1", title: "t", userId: "u1" }]);

    const result = await listAdminCourseChats(ADMIN, COURSE_OPTS);
    expect(result).toMatchObject({ dataSource: "database", count: 1 });
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: "c1" }, take: 50 }),
    );
  });

  it("caps the limit at 200", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId: "c1", courseCode: "COSC 111" });
    prismaMock.chat.findMany.mockResolvedValue([]);

    await listAdminCourseChats(ADMIN, { ...COURSE_OPTS, limit: 5000 });
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });
});

describe("listAdminUnitChats", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminUnitChats(STUDENT, "COSC");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns chats scoped to a department's courses", async () => {
    prismaMock.course.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    prismaMock.chat.findMany.mockResolvedValue([
      { id: "ch1", title: "t", courseId: "c1", userId: "u1" },
    ]);

    const result = await listAdminUnitChats(ADMIN, "COSC", 10);
    expect(result).toMatchObject({ department: "COSC", count: 1 });
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: { in: ["c1", "c2"] } },
        take: 10,
      }),
    );
  });

  it("returns an empty chat list when the department has no courses", async () => {
    prismaMock.course.findMany.mockResolvedValue([]);

    const result = await listAdminUnitChats(ADMIN, "NOPE");
    expect(result).toMatchObject({ department: "NOPE", chats: [], count: 0 });
    expect(prismaMock.chat.findMany).not.toHaveBeenCalled();
  });

  it("caps the limit at 200 when courses exist", async () => {
    prismaMock.course.findMany.mockResolvedValue([{ id: "c1" }]);
    prismaMock.chat.findMany.mockResolvedValue([]);

    await listAdminUnitChats(ADMIN, "COSC", 9999);
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });
});

// ── Policies ─────────────────────────────────────────────────────────────

describe("getAdminPolicies", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await getAdminPolicies(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns policies and definitions for admin", async () => {
    vi.mocked(getPolicies).mockResolvedValue({ "chat.webToolsEnabled": true } as never);
    vi.mocked(getPolicyDefinitions).mockReturnValue([{ key: "chat.webToolsEnabled" }] as never);

    const result = await getAdminPolicies(ADMIN);
    expect(result).toMatchObject({
      dataSource: "database",
      policies: { "chat.webToolsEnabled": true },
      definitions: [{ key: "chat.webToolsEnabled" }],
    });
  });
});

describe("updateAdminPolicy", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminPolicy(STUDENT, "chat.webToolsEnabled", true);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns UNKNOWN_POLICY_KEY for an invalid key", async () => {
    vi.mocked(isPolicyKey).mockReturnValue(false);
    const result = await updateAdminPolicy(ADMIN, "not.a.real.key", true);
    expect(result).toEqual({ error: "UNKNOWN_POLICY_KEY" });
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it("updates the policy for a valid key", async () => {
    vi.mocked(isPolicyKey).mockReturnValue(true);
    const result = await updateAdminPolicy(ADMIN, "chat.webToolsEnabled", false);
    expect(result).toEqual({ ok: true, key: "chat.webToolsEnabled", value: false });
    expect(setPolicy).toHaveBeenCalledWith("chat.webToolsEnabled", false, "a1");
  });
});

// ── AI providers ─────────────────────────────────────────────────────────

describe("listAdminAiProviders", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminAiProviders(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns providers for admin", async () => {
    prismaMock.aIProvider.findMany.mockResolvedValue([{ id: "p1", name: "openai" }]);
    const result = await listAdminAiProviders(ADMIN);
    expect(result).toMatchObject({ dataSource: "database", count: 1 });
    expect("providers" in result && result.providers).toHaveLength(1);
  });
});

const VALID_PROVIDER_INPUT = {
  name: "openai",
  displayName: "OpenAI",
  description: "OpenAI provider",
};

describe("createAdminAiProvider", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await createAdminAiProvider(STUDENT, VALID_PROVIDER_INPUT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    const result = await createAdminAiProvider(ADMIN, { name: "" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(prismaMock.aIProvider.create).not.toHaveBeenCalled();
  });

  it("creates a provider successfully", async () => {
    prismaMock.aIProvider.create.mockResolvedValue({ id: "p1", ...VALID_PROVIDER_INPUT });
    const result = await createAdminAiProvider(ADMIN, VALID_PROVIDER_INPUT);
    expect(result).toMatchObject({ ok: true, provider: { id: "p1" } });
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });

  it("returns PROVIDER_NAME_NOT_UNIQUE on a P2002 conflict", async () => {
    prismaMock.aIProvider.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.0.0",
      }),
    );
    const result = await createAdminAiProvider(ADMIN, VALID_PROVIDER_INPUT);
    expect(result).toEqual({ error: "PROVIDER_NAME_NOT_UNIQUE" });
  });

  it("rethrows unexpected errors", async () => {
    prismaMock.aIProvider.create.mockRejectedValue(new Error("db down"));
    await expect(createAdminAiProvider(ADMIN, VALID_PROVIDER_INPUT)).rejects.toThrow("db down");
  });
});

describe("updateAdminAiProvider", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminAiProvider(STUDENT, "p1", { name: "x" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    const result = await updateAdminAiProvider(ADMIN, "p1", { defaultBaseUrl: "not-a-url" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("updates a provider successfully", async () => {
    prismaMock.aIProvider.update.mockResolvedValue({ id: "p1", name: "openai2" });
    const result = await updateAdminAiProvider(ADMIN, "p1", { name: "openai2" });
    expect(result).toMatchObject({ ok: true, provider: { id: "p1" } });
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });
});

describe("deleteAdminAiProvider", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await deleteAdminAiProvider(STUDENT, "p1");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("deletes a provider successfully", async () => {
    prismaMock.aIProvider.delete.mockResolvedValue({ id: "p1" });
    const result = await deleteAdminAiProvider(ADMIN, "p1");
    expect(result).toEqual({ ok: true, providerId: "p1" });
    expect(prismaMock.aIProvider.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });
});

// ── AI models ────────────────────────────────────────────────────────────

const VALID_MODEL_INPUT = {
  modelId: "gpt-4o",
  name: "GPT-4o",
  description: "OpenAI flagship model",
  type: "CHAT",
  providerId: "p1",
};

describe("createAdminAiModel", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await createAdminAiModel(STUDENT, VALID_MODEL_INPUT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    const result = await createAdminAiModel(ADMIN, { modelId: "" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(prismaMock.aIModel.create).not.toHaveBeenCalled();
  });

  it("creates a model successfully", async () => {
    prismaMock.aIModel.create.mockResolvedValue({ id: "m1", ...VALID_MODEL_INPUT });
    const result = await createAdminAiModel(ADMIN, VALID_MODEL_INPUT);
    expect(result).toMatchObject({ ok: true, model: { id: "m1" } });
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });
});

describe("updateAdminAiModel", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminAiModel(STUDENT, "m1", { name: "x" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    const result = await updateAdminAiModel(ADMIN, "m1", { type: "NOT_A_TYPE" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("updates a model successfully", async () => {
    prismaMock.aIModel.update.mockResolvedValue({ id: "m1", name: "GPT-4o Turbo" });
    const result = await updateAdminAiModel(ADMIN, "m1", { name: "GPT-4o Turbo" });
    expect(result).toMatchObject({ ok: true, model: { id: "m1" } });
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });
});

describe("deleteAdminAiModel", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await deleteAdminAiModel(STUDENT, "m1");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("deletes a model successfully", async () => {
    prismaMock.aIModel.delete.mockResolvedValue({ id: "m1" });
    const result = await deleteAdminAiModel(ADMIN, "m1");
    expect(result).toEqual({ ok: true, modelId: "m1" });
    expect(invalidateTierModelCache).toHaveBeenCalled();
  });
});

// ── Cron jobs ────────────────────────────────────────────────────────────

describe("listAdminCronJobs", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminCronJobs(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns cron job statuses for admin", async () => {
    vi.mocked(listCronJobStatuses).mockResolvedValue([{ name: "backup-nightly" }] as never);
    const result = await listAdminCronJobs(ADMIN);
    expect(result).toMatchObject({ dataSource: "database", count: 1 });
  });
});

describe("getAdminCronJobRuns", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await getAdminCronJobRuns(STUDENT, "backup-nightly");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns recent runs for admin", async () => {
    vi.mocked(getRecentCronJobRuns).mockResolvedValue([{ id: "r1" }] as never);
    const result = await getAdminCronJobRuns(ADMIN, "backup-nightly");
    expect(result).toMatchObject({ jobName: "backup-nightly", count: 1 });
    expect(getRecentCronJobRuns).toHaveBeenCalledWith("backup-nightly");
  });
});

describe("triggerAdminCronJob", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await triggerAdminCronJob(STUDENT, "backup-nightly");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns UNKNOWN_CRON_JOB for an unrecognized job", async () => {
    const result = await triggerAdminCronJob(ADMIN, "does-not-exist");
    expect(result).toEqual({ error: "UNKNOWN_CRON_JOB" });
  });

  it("returns CRON_JOB_NOT_TRIGGERABLE for a triggerEnabled:false job", async () => {
    const result = await triggerAdminCronJob(ADMIN, "ai-tutor-reconcile");
    expect(result).toEqual({ error: "CRON_JOB_NOT_TRIGGERABLE" });
  });

  it("reuses an already-running job", async () => {
    vi.mocked(findRunningCronRun).mockResolvedValue({ id: "run1" });
    const result = await triggerAdminCronJob(ADMIN, "backup-nightly");
    expect(result).toEqual({ ok: true, runId: "run1", jobName: "backup-nightly", reused: true });
    expect(startCronRun).not.toHaveBeenCalled();
  });

  it("starts a new run and triggers the cron script async", async () => {
    vi.mocked(findRunningCronRun).mockResolvedValue(null);
    vi.mocked(startCronRun).mockResolvedValue({ runId: "run2", created: true });
    const result = await triggerAdminCronJob(ADMIN, "backup-nightly");
    expect(result).toEqual({ ok: true, runId: "run2", jobName: "backup-nightly", reused: false });
    expect(triggerCronJobAsync).toHaveBeenCalledWith("backup-nightly", "backup-nightly.sh", "run2");
  });

  it("does not trigger the script when the run was reclaimed, not created", async () => {
    vi.mocked(findRunningCronRun).mockResolvedValue(null);
    vi.mocked(startCronRun).mockResolvedValue({ runId: "run3", created: false });
    const result = await triggerAdminCronJob(ADMIN, "backup-nightly");
    expect(result).toEqual({ ok: true, runId: "run3", jobName: "backup-nightly", reused: true });
    expect(triggerCronJobAsync).not.toHaveBeenCalled();
  });
});

describe("updateAdminCronSchedule", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminCronSchedule(STUDENT, {
      jobName: "backup-nightly",
      schedule: "0 3 * * *",
      scheduleLabel: "Daily at 03:00",
    });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns UNKNOWN_CRON_JOB for an unrecognized job", async () => {
    const result = await updateAdminCronSchedule(ADMIN, {
      jobName: "does-not-exist",
      schedule: "0 3 * * *",
      scheduleLabel: "Daily at 03:00",
    });
    expect(result).toEqual({ error: "UNKNOWN_CRON_JOB" });
  });

  it("returns INVALID_CRON_SCHEDULE for a malformed cron string", async () => {
    const result = await updateAdminCronSchedule(ADMIN, {
      jobName: "backup-nightly",
      schedule: "not-a-cron-expression",
      scheduleLabel: "Bogus",
    });
    expect(result).toEqual({ error: "INVALID_CRON_SCHEDULE" });
    expect(updateCronSchedule).not.toHaveBeenCalled();
  });

  it("updates the schedule and reschedules the job", async () => {
    const result = await updateAdminCronSchedule(ADMIN, {
      jobName: "backup-nightly",
      schedule: "0 3 * * *",
      scheduleLabel: "Daily at 03:00",
    });
    expect(result).toEqual({ ok: true, jobName: "backup-nightly" });
    expect(updateCronSchedule).toHaveBeenCalledWith("backup-nightly", "0 3 * * *", "Daily at 03:00");
    expect(rescheduleJob).toHaveBeenCalledWith("backup-nightly", "0 3 * * *");
  });
});

describe("resetAdminCronSchedule", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await resetAdminCronSchedule(STUDENT, "backup-nightly");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns UNKNOWN_CRON_JOB for an unrecognized job", async () => {
    const result = await resetAdminCronSchedule(ADMIN, "does-not-exist");
    expect(result).toEqual({ error: "UNKNOWN_CRON_JOB" });
  });

  it("resets the schedule to the known default", async () => {
    const result = await resetAdminCronSchedule(ADMIN, "backup-nightly");
    expect(result).toEqual({ ok: true, jobName: "backup-nightly" });
    expect(resetCronSchedule).toHaveBeenCalledWith("backup-nightly");
    expect(rescheduleJob).toHaveBeenCalledWith("backup-nightly", "0 2 * * *");
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────

describe("getAdminDashboardStats", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await getAdminDashboardStats(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns aggregated stats for admin", async () => {
    prismaMock.chat.count.mockResolvedValueOnce(100).mockResolvedValueOnce(10);
    prismaMock.courseMaterial.count.mockResolvedValue(5);
    prismaMock.enrollment.count.mockResolvedValue(50);
    prismaMock.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(60);
    prismaMock.course.count.mockResolvedValue(8);

    const result = await getAdminDashboardStats(ADMIN);
    expect(result).toMatchObject({
      dataSource: "database",
      stats: {
        chatCount: 100,
        chatCountWeek: 10,
        materialCount: 5,
        studentCount: 50,
        instructorCount: 3,
        totalUsers: 60,
        activeCourseCount: 8,
      },
    });
  });
});

// ── Ollama / vLLM model listing ─────────────────────────────────────────

describe("listAdminOllamaModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminOllamaModels(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns an error for a disallowed base URL", async () => {
    const result = await listAdminOllamaModels(ADMIN, "http://evil.example.com");
    expect(result).toHaveProperty("error");
    expect(String((result as { error: string }).error)).toMatch(/host must match|loopback/i);
  });

  it("returns models on a successful fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3", model: "llama3:latest", size: 123, modified_at: "2026-01-01" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminOllamaModels(ADMIN);
    expect(result).toMatchObject({ dataSource: "database", count: 1 });
    expect("models" in result && result.models).toEqual([
      { name: "llama3", model: "llama3:latest", size: 123, modified_at: "2026-01-01" },
    ]);
  });

  it("returns an error for a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminOllamaModels(ADMIN);
    expect(result).toEqual({ error: "OLLAMA_FETCH_FAILED: 500 Internal Server Error" });
  });

  it("returns a timeout message on AbortError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminOllamaModels(ADMIN);
    expect(result).toMatchObject({ error: "Request timeout — Ollama server did not respond" });
  });

  it("returns the underlying message for other thrown errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unreachable"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminOllamaModels(ADMIN);
    expect(result).toMatchObject({ error: "network unreachable" });
  });
});

describe("listAdminVllmModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminVllmModels(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns models on a successful fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "m1", owned_by: "vllm" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminVllmModels(ADMIN);
    expect(result).toMatchObject({ dataSource: "database", count: 1 });
    expect("models" in result && result.models).toEqual([{ id: "m1", owned_by: "vllm" }]);
  });

  it("returns an error for a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminVllmModels(ADMIN);
    expect(result).toEqual({ error: "VLLM_FETCH_FAILED: 503 Service Unavailable" });
  });

  it("returns a timeout message on AbortError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminVllmModels(ADMIN);
    expect(result).toMatchObject({
      error: "Request timeout — vLLM proxy did not respond within 10s",
    });
  });

  it("returns a connection-refused message for ECONNREFUSED", async () => {
    const connError = new Error("connect ECONNREFUSED") as Error & { code?: string };
    connError.code = "ECONNREFUSED";
    const fetchMock = vi.fn().mockRejectedValue(connError);
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminVllmModels(ADMIN);
    expect(result).toMatchObject({
      error: "Connection refused — check VLLM_BASE_URL and LiteLLM",
    });
  });

  it("returns the underlying message for other thrown errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAdminVllmModels(ADMIN);
    expect(result).toMatchObject({ error: "boom" });
  });
});
