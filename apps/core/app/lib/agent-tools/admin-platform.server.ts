import { Prisma } from "@prisma/client";
import cron from "node-cron";

import type { RbacUser } from "~/lib/auth/course-access.server";
import { CreateAIProviderSchema, CreateAIModelSchema, UpdateAIProviderSchema, UpdateAIModelSchema } from "~/lib/ai/schemas";
import {
  isEmbeddingIndexStale,
  parseEmbeddingSettingsUpdate,
  resolveEffectiveEmbeddingSettings,
  validateEmbeddingSettingsUpdate,
} from "~/lib/ai/embedding-config";
import { clearCourseEmbeddingSettingsCache } from "~/lib/ai/embedding";
import { invalidateTierModelCache } from "~/lib/ai/routing/tiers";
import {
  InvalidOllamaBaseUrlError,
  ollamaTagsUrl,
} from "~/lib/ai/ollama-url.server";
import {
  findActiveReEmbedJob,
  getReEmbedJobForCourse,
  serializeReEmbedJob,
  startReEmbedJob,
} from "~/lib/ai/re-embed-job.server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import {
  CreateCourseSchema,
  UpdateCourseRagSettingsSchema,
  UpdateCourseSchema,
} from "~/lib/courses/schemas";
import {
  getCourseRagSettings,
  invalidateCourseRagSettingsCache,
} from "~/lib/courses/server";
import { addCourseTA, getCourseTA, removeCourseTA } from "~/lib/courses/tas.server";
import {
  discoverCanvasMaterialsForCourse,
  syncSelectedCanvasMaterials,
} from "~/lib/canvas/materials.server";
import {
  getPolicies,
  getPolicyDefinitions,
  isPolicyKey,
  setPolicy,
} from "~/lib/policy.server";
import {
  KNOWN_CRON_JOBS,
  getRecentCronJobRuns,
  listCronJobStatuses,
  resetCronSchedule,
  startCronRun,
  updateCronSchedule,
} from "~/lib/db.cron-jobs.server";
import { rescheduleJob } from "~/lib/cron-scheduler.server";
import prisma from "~/lib/prisma.server";
import { resolveAdminCourseId } from "./admin-context.server";

type ToolError = { error: string; fields?: Record<string, string> };

function requirePlatformAdmin(user: RbacUser): ToolError | null {
  if (user.role !== "ADMIN") {
    return { error: "Forbidden" };
  }
  return null;
}

function adminPayload<T extends Record<string, unknown>>(data: T) {
  return {
    dataSource: "database" as const,
    queriedAt: new Date().toISOString(),
    ...data,
  };
}

async function resolveCourseId(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
  },
): Promise<string | ToolError> {
  const resolved = await resolveAdminCourseId(actor, opts);
  if ("error" in resolved) {
    return resolved;
  }
  return resolved.courseId;
}

// ── Courses ───────────────────────────────────────────────────────────────────

export async function createAdminCourse(
  actor: RbacUser,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = CreateCourseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  const instructors = await prisma.user.findMany({
    where: { id: { in: parsed.data.instructorUserIds }, role: "INSTRUCTOR" },
    select: { id: true },
  });
  if (instructors.length !== parsed.data.instructorUserIds.length) {
    return { error: "INVALID_INSTRUCTOR" };
  }

  const course = await prisma.$transaction(async (tx) => {
    const created = await tx.course.create({
      data: {
        name: parsed.data.name,
        code: parsed.data.code,
        section: parsed.data.section,
        term: parsed.data.term,
        year: parsed.data.year,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        department: parsed.data.department,
        description: parsed.data.description,
        isPublished: parsed.data.isPublished,
        aiInstructions: parsed.data.aiInstructions,
        instructorId: parsed.data.instructorUserIds[0],
      },
    });
    await tx.enrollment.createMany({
      data: parsed.data.instructorUserIds.map((userId) => ({
        courseId: created.id,
        userId,
        role: "INSTRUCTOR" as const,
        isActive: true,
      })),
    });
    return created;
  });

  return { ok: true, course };
}

export async function updateAdminCourse(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const parsed = UpdateCourseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  const course = await prisma.course.update({
    where: { id: courseId, deletedAt: null },
    data: parsed.data,
  });
  return { ok: true, course };
}

export async function deleteAdminCourse(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  await prisma.course.update({
    where: { id: courseId },
    data: { deletedAt: new Date() },
  });
  return { ok: true, courseId };
}

export async function setAdminCoursePublished(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  publish: boolean,
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const course = await prisma.course.update({
    where: { id: courseId, deletedAt: null },
    data: { isPublished: publish },
    select: { id: true, isPublished: true },
  });
  return { ok: true, course };
}

export async function getAdminCourseRagSettings(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const settings = await getCourseRagSettings(courseId);
  if (!settings) return { error: "COURSE_NOT_FOUND" };
  return adminPayload({ settings });
}

export async function updateAdminCourseRagSettings(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const parsed = UpdateCourseRagSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: parsed.data,
    select: { id: true, ragTopK: true, ragSimilarityThreshold: true },
  });
  invalidateCourseRagSettingsCache(courseId);
  return { ok: true, settings: updated };
}

// ── Materials & embedding ─────────────────────────────────────────────────────

export async function listAdminCourseMaterials(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const materials = await prisma.courseMaterial.findMany({
    where: { courseId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
      uploadedBy: true,
    },
  });
  return adminPayload({ materials, count: materials.length });
}

export async function renameAdminCourseMaterial(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    materialId: string;
    name: string;
  },
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const material = await prisma.courseMaterial.update({
    where: { id: opts.materialId, courseId, deletedAt: null },
    data: { title: opts.name },
    select: { id: true, title: true },
  });
  return { ok: true, material };
}

export async function deleteAdminCourseMaterial(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    materialId: string;
  },
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  await prisma.courseMaterial.update({
    where: { id: opts.materialId, courseId },
    data: { deletedAt: new Date() },
  });
  return { ok: true, materialId: opts.materialId };
}

export async function getAdminCourseEmbeddingSettings(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const course = await getCourseIfCanManageMaterials(actor, courseId);
  if (!course) return { error: "COURSE_NOT_FOUND" };

  const fields = {
    embeddingProvider: course.embeddingProvider,
    embeddingModel: course.embeddingModel,
    embeddedWithProvider: course.embeddedWithProvider,
    embeddedWithModel: course.embeddedWithModel,
    lastEmbeddedAt: course.lastEmbeddedAt,
  };
  const effective = resolveEffectiveEmbeddingSettings(fields);
  return adminPayload({
    settings: fields,
    effective,
    needsReEmbed: isEmbeddingIndexStale(fields, effective),
  });
}

export async function updateAdminCourseEmbeddingSettings(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const course = await getCourseIfCanManageMaterials(actor, courseId);
  if (!course) return { error: "COURSE_NOT_FOUND" };

  const parsed = parseEmbeddingSettingsUpdate(input);
  if (!parsed.ok) return { error: "VALIDATION_ERROR", fields: { body: parsed.error } };

  const current = {
    embeddingProvider: course.embeddingProvider,
    embeddingModel: course.embeddingModel,
    embeddedWithProvider: course.embeddedWithProvider,
    embeddedWithModel: course.embeddedWithModel,
    lastEmbeddedAt: course.lastEmbeddedAt,
  };
  const validated = validateEmbeddingSettingsUpdate(current, parsed.value);
  if (!validated.ok) return { error: "VALIDATION_ERROR", fields: { body: validated.error } };

  await prisma.course.update({
    where: { id: courseId },
    data: {
      embeddingProvider: validated.value.embeddingProvider,
      embeddingModel: validated.value.embeddingModel,
    },
  });
  clearCourseEmbeddingSettingsCache(courseId);
  return { ok: true, courseId };
}

export async function startAdminCourseReEmbed(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const active = await findActiveReEmbedJob(courseId);
  if (active) {
    return adminPayload({ job: serializeReEmbedJob(active), alreadyRunning: true });
  }

  const { job } = await startReEmbedJob(courseId);
  return adminPayload({ job: serializeReEmbedJob(job), alreadyRunning: false });
}

export async function getAdminCourseReEmbedJob(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    jobId: string;
  },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const job = await getReEmbedJobForCourse(courseId, opts.jobId);
  if (!job) return { error: "JOB_NOT_FOUND" };
  return adminPayload({ job: serializeReEmbedJob(job) });
}

export async function listAdminCanvasMaterials(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const materials = await discoverCanvasMaterialsForCourse(actor.id, courseId);
  return adminPayload({ materials, count: materials.length });
}

export async function syncAdminCanvasMaterials(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    canvasFileIds: string[];
  },
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { instructorId: true },
  });
  if (!course?.instructorId) {
    return { error: "COURSE_INSTRUCTOR_REQUIRED" };
  }

  const result = await syncSelectedCanvasMaterials(
    course.instructorId,
    courseId,
    opts.canvasFileIds,
  );
  return { ok: true, ...result };
}

// ── TAs, chats, policies, AI config, cron, dashboard ────────────────────────

export async function listAdminCourseTAs(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const tas = await getCourseTA(courseId);
  return adminPayload({ tas, count: tas.length });
}

export async function addAdminCourseTA(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null; userId: string },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const result = await addCourseTA(courseId, { userId: opts.userId });
  if ("error" in result) return { error: result.error };
  return { ok: true, ta: result };
}

export async function removeAdminCourseTA(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null; userId: string },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const result = await removeCourseTA(courseId, { userId: opts.userId });
  if ("error" in result) return { error: result.error };
  return { ok: true };
}

export async function listAdminCourseChats(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null; limit?: number },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courseId = await resolveCourseId(actor, opts);
  if (typeof courseId !== "string") return courseId;

  const limit = Math.min(opts.limit ?? 50, 200);
  const chats = await prisma.chat.findMany({
    where: { courseId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return adminPayload({ chats, count: chats.length });
}

export async function listAdminUnitChats(
  actor: RbacUser,
  department: string,
  limit = 50,
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const courses = await prisma.course.findMany({
    where: { department, deletedAt: null },
    select: { id: true },
  });
  const courseIds = courses.map((c) => c.id);
  const chats = courseIds.length
    ? await prisma.chat.findMany({
        where: { courseId: { in: courseIds } },
        orderBy: { updatedAt: "desc" },
        take: Math.min(limit, 200),
        select: { id: true, title: true, courseId: true, userId: true, updatedAt: true },
      })
    : [];
  return adminPayload({ department, chats, count: chats.length });
}

export async function getAdminPolicies(actor: RbacUser) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  return adminPayload({
    policies: await getPolicies(),
    definitions: getPolicyDefinitions(),
  });
}

export async function updateAdminPolicy(
  actor: RbacUser,
  key: string,
  value: boolean,
): Promise<Record<string, unknown> | ToolError> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  if (!isPolicyKey(key)) {
    return { error: "UNKNOWN_POLICY_KEY" };
  }

  await setPolicy(key, value, actor.id);
  return { ok: true, key, value };
}

export async function listAdminAiProviders(actor: RbacUser) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const providers = await prisma.aIProvider.findMany({
    include: { models: { orderBy: { name: "asc" } }, _count: { select: { models: true } } },
    orderBy: { name: "asc" },
  });
  return adminPayload({ providers, count: providers.length });
}

export async function createAdminAiProvider(actor: RbacUser, input: Record<string, unknown>) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = CreateAIProviderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  try {
    const provider = await prisma.aIProvider.create({ data: parsed.data });
    invalidateTierModelCache();
    return { ok: true, provider };
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "PROVIDER_NAME_NOT_UNIQUE" };
    }
    throw error;
  }
}

export async function updateAdminAiProvider(
  actor: RbacUser,
  providerId: string,
  input: Record<string, unknown>,
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = UpdateAIProviderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  const provider = await prisma.aIProvider.update({
    where: { id: providerId },
    data: parsed.data,
  });
  invalidateTierModelCache();
  return { ok: true, provider };
}

export async function deleteAdminAiProvider(actor: RbacUser, providerId: string) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  await prisma.aIProvider.delete({ where: { id: providerId } });
  invalidateTierModelCache();
  return { ok: true, providerId };
}

export async function createAdminAiModel(actor: RbacUser, input: Record<string, unknown>) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = CreateAIModelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  const model = await prisma.aIModel.create({ data: parsed.data });
  invalidateTierModelCache();
  return { ok: true, model };
}

export async function updateAdminAiModel(
  actor: RbacUser,
  modelId: string,
  input: Record<string, unknown>,
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = UpdateAIModelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  const model = await prisma.aIModel.update({ where: { id: modelId }, data: parsed.data });
  invalidateTierModelCache();
  return { ok: true, model };
}

export async function deleteAdminAiModel(actor: RbacUser, modelId: string) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  await prisma.aIModel.delete({ where: { id: modelId } });
  invalidateTierModelCache();
  return { ok: true, modelId };
}

export async function listAdminCronJobs(actor: RbacUser) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const jobs = await listCronJobStatuses();
  return adminPayload({ jobs, count: jobs.length });
}

export async function getAdminCronJobRuns(actor: RbacUser, jobName: string) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const runs = await getRecentCronJobRuns(jobName);
  return adminPayload({ jobName, runs, count: runs.length });
}

export async function triggerAdminCronJob(actor: RbacUser, jobName: string) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const job = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
  if (!job) return { error: "UNKNOWN_CRON_JOB" };
  if (job.triggerEnabled === false) {
    return { error: "CRON_JOB_NOT_TRIGGERABLE" };
  }

  const { findRunningCronRun, startCronRun } = await import("~/lib/db.cron-jobs.server");
  const alreadyRunning = await findRunningCronRun(jobName);
  if (alreadyRunning) {
    return { ok: true, runId: alreadyRunning.id, jobName, reused: true };
  }

  const { runId, created } = await startCronRun(jobName, {
    source: "ADMIN_CHAT",
    triggeredByUserId: actor.id,
  });
  // The dedicated cron worker claims ADMIN_CHAT runs during reconciliation so
  // shell jobs execute under eduai-cron instead of the Core web account.
  return { ok: true, runId, jobName, reused: !created };
}

export async function updateAdminCronSchedule(
  actor: RbacUser,
  input: { jobName: string; schedule: string; scheduleLabel: string },
) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const known = KNOWN_CRON_JOBS.find((j) => j.name === input.jobName);
  if (!known) return { error: "UNKNOWN_CRON_JOB" };
  if (!cron.validate(input.schedule)) return { error: "INVALID_CRON_SCHEDULE" };

  await updateCronSchedule(input.jobName, input.schedule, input.scheduleLabel);
  rescheduleJob(input.jobName, input.schedule);
  return { ok: true, jobName: input.jobName };
}

export async function resetAdminCronSchedule(actor: RbacUser, jobName: string) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const known = KNOWN_CRON_JOBS.find((j) => j.name === jobName);
  if (!known) return { error: "UNKNOWN_CRON_JOB" };

  await resetCronSchedule(jobName);
  rescheduleJob(jobName, known.schedule);
  return { ok: true, jobName };
}

export async function getAdminDashboardStats(actor: RbacUser) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const week = new Date();
  week.setDate(week.getDate() - 7);

  const [chatCount, chatCountWeek, materialCount, studentCount, instructorCount, totalUsers, activeCourseCount] =
    await Promise.all([
      prisma.chat.count(),
      prisma.chat.count({ where: { createdAt: { gte: week } } }),
      prisma.courseMaterial.count({ where: { deletedAt: null } }),
      prisma.enrollment.count({ where: { role: "STUDENT", isActive: true } }),
      prisma.user.count({ where: { role: "INSTRUCTOR" } }),
      prisma.user.count(),
      prisma.course.count({ where: { isActive: true, deletedAt: null } }),
    ]);

  return adminPayload({
    stats: {
      chatCount,
      chatCountWeek,
      materialCount,
      studentCount,
      instructorCount,
      totalUsers,
      activeCourseCount,
    },
  });
}

function resolveVllmBaseUrl(raw: string): string {
  let base = raw.replace(/\/$/, "");
  if (!base.endsWith("/v1")) {
    base = `${base}/v1`;
  }
  return base;
}

/** ADMIN — list models from local Ollama (GET /api/ollama-models). */
export async function listAdminOllamaModels(actor: RbacUser, baseUrl?: string) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  let ollamaUrl: string;
  try {
    ollamaUrl = ollamaTagsUrl(baseUrl);
  } catch (error) {
    if (error instanceof InvalidOllamaBaseUrlError) {
      return { error: error.message };
    }
    throw error;
  }

  try {
    const response = await fetch(ollamaUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return { error: `OLLAMA_FETCH_FAILED: ${response.status} ${response.statusText}` };
    }
    const data = (await response.json()) as {
      models?: Array<Record<string, unknown>>;
    };
    const models =
      data.models?.map((model) => ({
        name: model.name,
        model: model.model ?? model.name,
        size: model.size,
        modified_at: model.modified_at,
      })) ?? [];
    return adminPayload({ models, count: models.length, baseUrl: ollamaUrl });
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    const message =
      err.name === "AbortError"
        ? "Request timeout — Ollama server did not respond"
        : err.message || "Failed to connect to Ollama server";
    return { error: message, baseUrl: ollamaUrl };
  }
}

/** ADMIN — list models from vLLM/LiteLLM proxy (GET /api/vllm-models). */
export async function listAdminVllmModels(actor: RbacUser) {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const vllmPort = process.env.VLLM_PORT || "8001";
  const rawBase = process.env.VLLM_BASE_URL || `http://localhost:${vllmPort}`;
  const baseUrl = resolveVllmBaseUrl(rawBase);
  const apiKey = process.env.VLLM_API_KEY || "vllm-local";

  try {
    const modelsUrl = `${baseUrl}/models`;
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return { error: `VLLM_FETCH_FAILED: ${response.status} ${response.statusText}` };
    }
    const data = (await response.json()) as {
      data?: Array<{ id: string; owned_by?: string; created?: number }>;
    };
    const models = data.data ?? [];
    return adminPayload({ models, count: models.length, baseUrl });
  } catch (error: unknown) {
    const err = error as { name?: string; code?: string; message?: string };
    let message = err.message || "Failed to connect to vLLM proxy";
    if (err.name === "AbortError") {
      message = "Request timeout — vLLM proxy did not respond within 10s";
    } else if (err.code === "ECONNREFUSED") {
      message = "Connection refused — check VLLM_BASE_URL and LiteLLM";
    }
    return { error: message, baseUrl };
  }
}
