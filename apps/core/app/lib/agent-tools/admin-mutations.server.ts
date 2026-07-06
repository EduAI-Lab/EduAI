import { Prisma } from "@prisma/client";
import type { EnrollmentRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import type { RbacUser } from "~/lib/auth/course-access.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import {
  addEnrollment,
  deactivateEnrollment,
  updateEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import {
  createCourseTopic,
  deleteCourseTopic,
  updateCourseTopic,
} from "~/lib/courses/server";
import { updateBugReportStatus } from "~/lib/bug-reports/server";
import {
  getAccessibleCourse,
  resolveAdminCourseId,
  resolveAdminUserId,
} from "./admin-context.server";
import {
  connectCanvasForUser,
  disconnectCanvasForUser,
  linkCanvasRosterForUser,
  syncCanvasForUser,
} from "./admin-canvas.server";
import {
  createAdminInvitation,
  resendAdminInvitation,
  revokeAdminInvitation,
} from "./admin-invitations.server";
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
} from "./admin-platform.server";

type ToolError = { error: string; fields?: Record<string, string> };
type MutationResult = Record<string, unknown> | ToolError;

export const ADMIN_WRITE_TOOL_NAMES = new Set([
  "createUser",
  "updateUser",
  "deleteUser",
  "createCourseEnrollment",
  "updateCourseEnrollment",
  "deactivateCourseEnrollment",
  "updateBugReportStatus",
  "createCourseTopic",
  "updateCourseTopic",
  "deleteCourseTopic",
  "createInvitation",
  "revokeInvitation",
  "resendInvitation",
  "connectCanvas",
  "syncCanvasCourses",
  "disconnectCanvas",
  "linkCanvasRoster",
  "createCourse",
  "updateCourse",
  "deleteCourse",
  "publishCourse",
  "unpublishCourse",
  "updateCourseRagSettings",
  "renameCourseMaterial",
  "deleteCourseMaterial",
  "updateCourseEmbeddingSettings",
  "startCourseReEmbed",
  "syncCanvasMaterials",
  "addCourseTA",
  "removeCourseTA",
  "updatePolicy",
  "createAiProvider",
  "updateAiProvider",
  "deleteAiProvider",
  "createAiModel",
  "updateAiModel",
  "deleteAiModel",
  "triggerCronJob",
]);

export function isAdminWriteToolName(name: string): boolean {
  return ADMIN_WRITE_TOOL_NAMES.has(name);
}

function requirePlatformAdmin(user: RbacUser): ToolError | null {
  if (user.role !== "ADMIN") {
    return { error: "Forbidden" };
  }
  return null;
}

function mutationPayload(data: Record<string, unknown>) {
  return {
    dataSource: "database" as const,
    mutation: true as const,
    writeSucceeded: true as const,
    appliedAt: new Date().toISOString(),
    ...data,
  };
}

function mutationFailure(error: ToolError & Record<string, unknown>) {
  return {
    dataSource: "database" as const,
    mutation: true as const,
    writeSucceeded: false as const,
    appliedAt: new Date().toISOString(),
    ...error,
  };
}

export function userRefValidationError(opts: {
  userId?: string;
  userEmail?: string;
}): MutationResult | null {
  if (opts.userId?.trim() || opts.userEmail?.trim()) {
    return null;
  }
  return mutationFailure({
    error: "VALIDATION_ERROR",
    fields: { user: "userId or userEmail required — call listUsers first" },
  });
}

/** When the model calls a write tool before the admin confirmed in chat. */
export function requireWriteConfirmation(confirmed: boolean): MutationResult | null {
  if (confirmed === true) {
    return null;
  }
  return mutationFailure({
    error: "CONFIRMATION_REQUIRED",
    message:
      "Write not applied — wait for the admin to explicitly confirm in chat, then call this tool again with confirmed: true.",
  });
}

/** Audit log + normalize write tool results for the model and UI. */
export async function runAdminWriteTool(
  toolName: string,
  actor: RbacUser,
  run: () => Promise<MutationResult>,
): Promise<MutationResult> {
  const result = await run();
  const succeeded =
    "writeSucceeded" in result && result.writeSucceeded === true && !("error" in result && result.error);

  console.info("[admin-chat:write]", {
    tool: toolName,
    actorId: actor.id,
    writeSucceeded: succeeded,
    error: "error" in result ? result.error : undefined,
  });

  if ("error" in result && result.error) {
    return mutationFailure(result as ToolError & Record<string, unknown>);
  }
  if (!succeeded) {
    return mutationFailure({ ...result, error: "WRITE_FAILED" });
  }
  return result;
}

export async function runConfirmedAdminWriteTool(
  toolName: string,
  actor: RbacUser,
  confirmed: boolean,
  run: () => Promise<MutationResult>,
): Promise<MutationResult> {
  const gate = requireWriteConfirmation(confirmed);
  if (gate) {
    console.info("[admin-chat:write]", {
      tool: toolName,
      actorId: actor.id,
      writeSucceeded: false,
      error: "CONFIRMATION_REQUIRED",
    });
    return gate;
  }
  return runAdminWriteTool(toolName, actor, run);
}

function mapEnrollmentResult(
  result: Awaited<
    ReturnType<typeof addEnrollment | typeof updateEnrollmentRole | typeof deactivateEnrollment>
  >,
) {
  if ("status" in result) {
    if (result.status === "422" && "error" in result) {
      return mutationFailure({
        error: result.error,
        fields: "fields" in result ? result.fields : undefined,
      });
    }
    if (result.status === "409" && "error" in result) {
      return mutationFailure({
        error: result.error,
        ...("currentInstructorCount" in result
          ? { currentInstructorCount: result.currentInstructorCount }
          : {}),
      });
    }
    if (result.status === "404") {
      return mutationFailure({ error: "NOT_FOUND" });
    }
    if (result.status === "201" || result.status === "200") {
      return mutationPayload({
        ok: true,
        enrollment: "enrollment" in result ? result.enrollment : undefined,
        previousRole: "previousRole" in result ? result.previousRole : undefined,
      });
    }
    if (result.status === "204") {
      return mutationPayload({
        ok: true,
        role: "role" in result ? result.role : undefined,
      });
    }
  }
  return mutationFailure({ error: "UNKNOWN" });
}

/** ADMIN — create platform user (same validation as POST /api/users). */
export async function createAdminUser(
  actor: RbacUser,
  input: {
    name: string;
    email: string;
    role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "TA" | "STUDENT";
    isActive?: boolean;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  try {
    const user = await prisma.user.create({
      data: {
        ...parsed.data,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    return mutationPayload({ ok: true, user });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "EMAIL_ALREADY_EXISTS" };
    }
    throw error;
  }
}

/** ADMIN — update platform user (same guards as PATCH /api/users). */
export async function updateAdminUser(
  actor: RbacUser,
  userId: string,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  if (userId === actor.id) {
    if (input.isActive === false) {
      return { error: "CANNOT_DEACTIVATE_SELF" };
    }
    if (input.role !== undefined && input.role !== actor.role) {
      return { error: "CANNOT_CHANGE_OWN_ROLE" };
    }
  }

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  if (Object.keys(parsed.data).length === 0) {
    return {
      error: "VALIDATION_ERROR",
      fields: { body: "at least one field to update is required" },
    };
  }

  if (parsed.data.authorizedUnits !== undefined) {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!target) {
      return { error: "USER_NOT_FOUND" };
    }
    const effectiveRole = parsed.data.role ?? target.role;
    if (effectiveRole !== "UNIT_ADMIN") {
      return { error: "ROLE_MISMATCH" };
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        authorizedUnits: true,
        updatedAt: true,
      },
    });
    return mutationPayload({ ok: true, user });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "USER_NOT_FOUND" };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "EMAIL_ALREADY_EXISTS" };
    }
    throw error;
  }
}

/** ADMIN — delete platform user (same guards as DELETE /api/users). */
export async function deleteAdminUser(actor: RbacUser, userId: string): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  if (userId === actor.id) {
    return { error: "CANNOT_DELETE_SELF" };
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
    return mutationPayload({ ok: true, deletedUserId: userId });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "USER_NOT_FOUND" };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return { error: "CANNOT_DELETE_USER_WITH_DATA" };
    }
    throw error;
  }
}

/** ADMIN — enroll a user in a course. */
export async function createAdminEnrollment(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    userId?: string;
    userEmail?: string;
    role: EnrollmentRole;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolvedUser = await resolveAdminUserId(actor, {
    userId: opts.userId,
    userEmail: opts.userEmail,
  });
  if ("error" in resolvedUser) {
    return resolvedUser;
  }

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  const gate = await getAccessibleCourse(actor, resolved.courseId);
  if ("error" in gate) {
    return gate;
  }

  const mapped = mapEnrollmentResult(
    await addEnrollment(resolved.courseId, {
      userId: resolvedUser.userId,
      role: opts.role,
    }),
  );
  if ("writeSucceeded" in mapped && mapped.writeSucceeded === false) {
    return mapped;
  }

  const verified = await prisma.enrollment.findFirst({
    where: {
      courseId: resolved.courseId,
      userId: resolvedUser.userId,
      isActive: true,
    },
    select: {
      id: true,
      role: true,
      isActive: true,
      enrolledAt: true,
      user: { select: { email: true, name: true } },
    },
  });

  if (!verified) {
    return mutationFailure({
      error: "VERIFY_FAILED",
      message: "Enrollment not visible in database after write",
    });
  }

  return {
    ...mapped,
    verifiedEnrollment: verified,
    resolvedUser,
  };
}

/** ADMIN — change enrollment role. */
export async function updateAdminEnrollmentRole(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    enrollmentId: string;
    role: EnrollmentRole;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  return mapEnrollmentResult(
    await updateEnrollmentRole(resolved.courseId, opts.enrollmentId, {
      role: opts.role,
    }),
  );
}

/** ADMIN — deactivate (soft-delete) an enrollment. */
export async function deactivateAdminEnrollment(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    enrollmentId: string;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  return mapEnrollmentResult(
    await deactivateEnrollment(resolved.courseId, opts.enrollmentId),
  );
}

/** ADMIN — update bug report triage status. */
export async function updateAdminBugReportStatus(
  actor: RbacUser,
  reportId: string,
  status: "UNHANDLED" | "IN_PROGRESS" | "RESOLVED",
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const updated = await updateBugReportStatus(reportId, status);
  if (!updated) {
    return { error: "NOT_FOUND" };
  }
  return mutationPayload({ ok: true, report: updated });
}

function mapTopicCreateResult(
  result: Awaited<ReturnType<typeof createCourseTopic>>,
): MutationResult {
  if (result.status === "201") {
    return mutationPayload({ ok: true, topic: result.topic });
  }
  if (result.status === "404") {
    return { error: "COURSE_NOT_FOUND" };
  }
  if (result.status === "409") {
    return { error: "TOPIC_ALREADY_EXISTS", existingId: result.existingId };
  }
  return mutationFailure({
    error: "VALIDATION_ERROR",
    fields: { name: "invalid topic name" },
  });
}

function mapTopicUpdateResult(
  result: Awaited<ReturnType<typeof updateCourseTopic>>,
): MutationResult {
  if (result.status === "200") {
    return mutationPayload({ ok: true, topic: result.topic });
  }
  if (result.status === "404") {
    return { error: "TOPIC_NOT_FOUND" };
  }
  if (result.status === "409") {
    return { error: "TOPIC_ALREADY_EXISTS", existingId: result.existingId };
  }
  return mutationFailure({
    error: "VALIDATION_ERROR",
    fields: { name: "invalid topic name" },
  });
}

function mapTopicDeleteResult(
  result: Awaited<ReturnType<typeof deleteCourseTopic>>,
): MutationResult {
  if (result.status === "204") {
    return mutationPayload({ ok: true, deleted: true });
  }
  if (result.status === "404") {
    return { error: "TOPIC_NOT_FOUND" };
  }
  return mutationFailure({
    error: "VALIDATION_ERROR",
    fields: { topic: "topicId or name required" },
  });
}

/** ADMIN — create a course topic (same as POST /api/courses/:id/topics). */
export async function createAdminCourseTopic(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    name: string;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  return mapTopicCreateResult(
    await createCourseTopic(resolved.courseId, { name: opts.name }, actor.id),
  );
}

/** ADMIN — rename a course topic (same as PATCH /api/courses/:id/topics/:topicId). */
export async function updateAdminCourseTopic(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    topicId: string;
    name: string;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  return mapTopicUpdateResult(
    await updateCourseTopic(resolved.courseId, opts.topicId, { name: opts.name }),
  );
}

/** ADMIN — soft-delete a course topic (same as DELETE /api/courses/:id/topics). */
export async function deleteAdminCourseTopic(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    topicId?: string;
    name?: string;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  if (!opts.topicId?.trim() && !opts.name?.trim()) {
    return mutationFailure({
      error: "VALIDATION_ERROR",
      fields: { topic: "topicId or name required" },
    });
  }

  return mapTopicDeleteResult(
    await deleteCourseTopic(resolved.courseId, {
      topicId: opts.topicId,
      name: opts.name,
    }),
  );
}

function isToolError(result: { error?: string }): result is { error: string; fields?: Record<string, string> } {
  return typeof result.error === "string";
}

function mapToolError(result: { error: string; fields?: Record<string, string> }): MutationResult {
  return mutationFailure(result);
}

/** ADMIN — create invitation and send email (POST /api/invitations). */
export async function createAdminInvitationMutation(
  actor: RbacUser,
  input: {
    email: string;
    name?: string;
    role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT";
    authorizedUnits?: string[];
  },
): Promise<MutationResult> {
  const result = await createAdminInvitation(actor, input);
  if (isToolError(result)) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

/** ADMIN — revoke a pending invitation (DELETE /api/invitations/:id). */
export async function revokeAdminInvitationMutation(
  actor: RbacUser,
  invitationId: string,
): Promise<MutationResult> {
  const result = await revokeAdminInvitation(actor, invitationId);
  if (isToolError(result)) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

/** ADMIN — resend invitation email (POST /api/invitations/:id). */
export async function resendAdminInvitationMutation(
  actor: RbacUser,
  invitationId: string,
): Promise<MutationResult> {
  const result = await resendAdminInvitation(actor, invitationId);
  if (isToolError(result)) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

/** ADMIN — connect Canvas for self or an instructor (POST /api/canvas/connect). */
export async function connectAdminCanvas(
  actor: RbacUser,
  input: {
    instructorUserId?: string;
    instructorEmail?: string;
    canvasUrl: string;
    apiKey?: string;
    isTestMode?: boolean;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const result = await connectCanvasForUser(actor, input);
  if ("error" in result) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

/** ADMIN — sync Canvas courses (POST /api/canvas/sync). */
export async function syncAdminCanvasCourses(
  actor: RbacUser,
  input: {
    instructorUserId?: string;
    instructorEmail?: string;
    canvasCourseIds: string[];
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const result = await syncCanvasForUser(actor, input);
  if ("error" in result) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

/** ADMIN — disconnect Canvas (DELETE /api/canvas/disconnect). */
export async function disconnectAdminCanvas(
  actor: RbacUser,
  input: { instructorUserId?: string; instructorEmail?: string },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const result = await disconnectCanvasForUser(actor, input);
  if ("error" in result) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

/** ADMIN — link Canvas roster for a student/TA (POST /api/canvas/link-roster). */
export async function linkAdminCanvasRoster(
  actor: RbacUser,
  input: { userId?: string; userEmail?: string; studentNumber: string },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const userRefError = userRefValidationError({
    userId: input.userId,
    userEmail: input.userEmail,
  });
  if (userRefError) {
    return userRefError;
  }

  const result = await linkCanvasRosterForUser(actor, input);
  if ("error" in result) {
    return mapToolError(result);
  }
  return mutationPayload(result);
}

function wrapPlatformResult(result: Record<string, unknown> | ToolError): MutationResult {
  if ("error" in result) {
    return mutationFailure(result as ToolError & Record<string, unknown>);
  }
  return mutationPayload(result);
}

export async function createAdminCourseMutation(
  actor: RbacUser,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await createAdminCourse(actor, input));
}

export async function updateAdminCourseMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminCourse(actor, opts, input));
}

export async function deleteAdminCourseMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
): Promise<MutationResult> {
  return wrapPlatformResult(await deleteAdminCourse(actor, opts));
}

export async function publishAdminCourseMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
): Promise<MutationResult> {
  return wrapPlatformResult(await setAdminCoursePublished(actor, opts, true));
}

export async function unpublishAdminCourseMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
): Promise<MutationResult> {
  return wrapPlatformResult(await setAdminCoursePublished(actor, opts, false));
}

export async function updateAdminCourseRagSettingsMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminCourseRagSettings(actor, opts, input));
}

export async function renameAdminCourseMaterialMutation(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    materialId: string;
    name: string;
  },
): Promise<MutationResult> {
  return wrapPlatformResult(await renameAdminCourseMaterial(actor, opts));
}

export async function deleteAdminCourseMaterialMutation(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    materialId: string;
  },
): Promise<MutationResult> {
  return wrapPlatformResult(await deleteAdminCourseMaterial(actor, opts));
}

export async function updateAdminCourseEmbeddingSettingsMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminCourseEmbeddingSettings(actor, opts, input));
}

export async function startAdminCourseReEmbedMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;
  const result = await startAdminCourseReEmbed(actor, opts);
  if ("error" in result) return mutationFailure(result as ToolError);
  return mutationPayload(result);
}

export async function syncAdminCanvasMaterialsMutation(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    canvasFileIds: string[];
  },
): Promise<MutationResult> {
  return wrapPlatformResult(await syncAdminCanvasMaterials(actor, opts));
}

export async function addAdminCourseTAMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null; userId: string },
): Promise<MutationResult> {
  return wrapPlatformResult(await addAdminCourseTA(actor, opts));
}

export async function removeAdminCourseTAMutation(
  actor: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null; userId: string },
): Promise<MutationResult> {
  return wrapPlatformResult(await removeAdminCourseTA(actor, opts));
}

export async function updateAdminPolicyMutation(
  actor: RbacUser,
  key: string,
  value: boolean,
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminPolicy(actor, key, value));
}

export async function createAdminAiProviderMutation(
  actor: RbacUser,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await createAdminAiProvider(actor, input));
}

export async function updateAdminAiProviderMutation(
  actor: RbacUser,
  providerId: string,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminAiProvider(actor, providerId, input));
}

export async function deleteAdminAiProviderMutation(
  actor: RbacUser,
  providerId: string,
): Promise<MutationResult> {
  return wrapPlatformResult(await deleteAdminAiProvider(actor, providerId));
}

export async function createAdminAiModelMutation(
  actor: RbacUser,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await createAdminAiModel(actor, input));
}

export async function updateAdminAiModelMutation(
  actor: RbacUser,
  modelId: string,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminAiModel(actor, modelId, input));
}

export async function deleteAdminAiModelMutation(
  actor: RbacUser,
  modelId: string,
): Promise<MutationResult> {
  return wrapPlatformResult(await deleteAdminAiModel(actor, modelId));
}

export async function triggerAdminCronJobMutation(
  actor: RbacUser,
  jobName: string,
): Promise<MutationResult> {
  return wrapPlatformResult(await triggerAdminCronJob(actor, jobName));
}

export async function updateAdminCronScheduleMutation(
  actor: RbacUser,
  input: { jobName: string; schedule: string; scheduleLabel: string },
): Promise<MutationResult> {
  return wrapPlatformResult(await updateAdminCronSchedule(actor, input));
}
